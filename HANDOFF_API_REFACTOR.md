# LettrSuggest — Option A: API/Backend Refactor Handoff
**Project:** `F:\Code\LettrSuggest`

## Prerequisites — Read This First

**This handoff must be done AFTER `HANDOFF_ALGO_FIX.md` is complete and deployed.**

The goal of this refactor is to make the API produce suggestions equivalent in quality and personalization to the web suggest page. If the algo fix isn't done first, you'll be refactoring the API to match a broken engine. Do the algo fix, verify the web page produces better results, then do this.

---

## The Problem

`/api/v1/suggestions/generate` currently calls `aggregateRecommendations()` from `src/lib/recommendationAggregator.ts` — a simple multi-source aggregator that does no personalization. The web suggest page uses an entirely different engine (`suggestByOverlap` in `src/lib/enrich.ts`, 8738 lines) that does deep personalization with TF-IDF keywords, director/actor matching, subgenre detection, feedback learning, MMR diversity, and more.

The API and web page are not 1-to-1. The API is producing generic results because it's using the wrong engine.

**After this refactor:** `POST /api/v1/suggestions/generate` will use the same scoring engine as the web page. The `auth.userId` already available from the API key authentication will be used to load all user context server-side via `supabaseAdmin`.

---

## Why supabaseAdmin (Not supabaseClient)

`enrich.ts` and `trending.ts` use `supabase` from `supabaseClient.ts` — the browser client. Server-side (in API routes), there is no active user session, so RLS policies that rely on `auth.uid()` return zero rows. `supabaseAdmin` uses the service role key, bypasses RLS, and is already used by every existing API route in this codebase. The refactor adds `.eq('user_id', auth.userId)` to all queries to scope data correctly — identical security to RLS, enforced in application code instead. Normal users are unaffected.

---

## Architecture: What to Build

Do NOT modify `enrich.ts`, `trending.ts`, or `suggest/page.tsx`. Those are the working web pipeline. Instead, create a new server-side module that:
1. Loads all user context using `supabaseAdmin`
2. Passes that pre-loaded context into the existing scoring functions
3. Feeds results back through the existing API response envelope

### New File: `src/lib/serverSuggestionsEngine.ts`

This is the core deliverable. It orchestrates the full suggestion pipeline server-side. Think of it as "the suggest page's data loading + scoring logic, but for API routes."

---

## Implementation — Step by Step

### Step 1: Understand What Data the Engine Needs

Before writing code, trace what `suggest/page.tsx` loads and passes to `suggestByOverlap`. The full param surface is:

```typescript
// From suggest/page.tsx, the call to suggestByOverlap includes:
{
  userId: string,
  films: FilmEvent[],            // user's full watched history (lite version)
  mappings: FilmMapping[],       // URI → tmdb_id map
  candidates: number[],          // candidate TMDB IDs to score
  excludeGenres?: Set<string>,
  maxCandidates: number,
  concurrency: number,
  excludeWatchedIds: Set<number>,
  desiredResults: number,
  sourceMetadata: Map<...>,
  sourceReliability: Map<...>,
  mmrLambda: number,
  mmrTopKFactor: number,
  featureFeedback: object | undefined,
  watchlistEntries: object[],
  context: { mode, localHour },
  recentExposures: Map<number, number>,
  enhancedProfile: {
    topKeywords, topActors, topStudios, topCountries,
    topLanguages, avoidGenres, avoidKeywords,
    preferredSubgenreKeywordIds
  }
}
```

Each of these comes from somewhere on the web page. The server engine needs to load all of it via `supabaseAdmin`.

---

### Step 2: Create the Data Loading Layer

In `src/lib/serverSuggestionsEngine.ts`, build a `loadUserContext(userId, supabaseAdmin)` function that fetches everything needed:

```typescript
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function loadUserContext(userId: string) {
  const db = getSupabaseAdmin();

  // Load in parallel — all use supabaseAdmin + eq('user_id', userId)
  const [
    filmsResult,
    mappingsResult,
    feedbackResult,
    explorationResult,
    adjacentResult,
    exposuresResult,
    blockedResult,
  ] = await Promise.all([

    // 1. Film events (watched films)
    db.from('film_events')
      .select('uri, title, year, rating, rewatch, last_date, watch_count, liked, on_watchlist')
      .eq('user_id', userId)
      .order('last_date', { ascending: false, nullsFirst: false }),

    // 2. Film TMDB mappings (URI → tmdb_id)
    db.from('film_tmdb_map')
      .select('uri, tmdb_id')
      .eq('user_id', userId),

    // 3. User feature feedback (Pandora learning data)
    db.from('user_feature_feedback')
      .select('feature_id, feature_name, feature_type, inferred_preference, positive_count, negative_count, last_updated')
      .eq('user_id', userId),

    // 4. Exploration stats (adaptive learning rate)
    db.from('user_exploration_stats')
      .select('exploration_rate, exploratory_films_rated, exploratory_avg_rating')
      .eq('user_id', userId)
      .maybeSingle(),

    // 5. Adjacent genre preferences (genre transition learning)
    db.from('user_adjacent_preferences')
      .select('from_genre_name, to_genre_name, success_rate, rating_count')
      .eq('user_id', userId)
      .gte('rating_count', 3)
      .gte('success_rate', 0.5),

    // 6. Recent suggestion exposures (repeat penalty)
    db.from('suggestion_exposures')
      .select('tmdb_id, shown_at')
      .eq('user_id', userId)
      .gte('shown_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()),

    // 7. Blocked suggestions
    db.from('blocked_suggestions')
      .select('tmdb_id')
      .eq('user_id', userId),
  ]);

  // Handle errors gracefully — log and use empty fallbacks
  // Don't throw on individual failures; partial data is better than nothing
  if (filmsResult.error) console.error('[ServerEngine] Failed to load films:', filmsResult.error);
  if (mappingsResult.error) console.error('[ServerEngine] Failed to load mappings:', mappingsResult.error);

  return {
    films: filmsResult.data ?? [],
    mappings: mappingsResult.data ?? [],
    feedback: feedbackResult.data ?? [],
    explorationRate: explorationResult.data?.exploration_rate ?? 0.15,
    adjacentGenres: adjacentResult.data ?? [],
    recentExposures: buildExposureMap(exposuresResult.data ?? []),
    blockedIds: new Set((blockedResult.data ?? []).map((b: any) => b.tmdb_id as number)),
  };
}

function buildExposureMap(rows: Array<{ tmdb_id: number; shown_at: string }>): Map<number, number> {
  const map = new Map<number, number>();
  const now = Date.now();
  for (const row of rows) {
    const daysSince = (now - new Date(row.shown_at).getTime()) / (1000 * 60 * 60 * 24);
    map.set(row.tmdb_id, daysSince);
  }
  return map;
}
```

**Check the actual table and column names before writing this.** The names above are based on observed data in this codebase but verify against `supabase/schema.sql` and `supabase/migrations/`. The `suggestion_exposures` table name is inferred — search for `suggestion_exposures` or similar in the codebase to confirm.

---

### Step 3: Build the Candidate Generation (Server-Safe)

`generateSmartCandidates` in `trending.ts` mostly makes HTTP calls to TMDB and calls `getAggregatedRecommendations` (a server action). Both of these work server-side. However it also uses `fetch()` to call internal Next.js API routes (`/api/tmdb/...`) which may not resolve correctly in the API route context.

**Audit `generateSmartCandidates` for internal fetch calls before using it.** If it calls `/api/tmdb/movie` or similar internal routes, those need to be replaced with direct TMDB API calls using the existing `fetchTmdb()` helper from `src/app/api/v1/_lib/tmdb.ts`.

Build a server-side candidate generation wrapper in `serverSuggestionsEngine.ts`:

```typescript
import { getWeightedSeedIds } from '@/lib/trending';
import { generateSmartCandidates } from '@/lib/trending';

export async function generateServerCandidates(
  userId: string,
  context: { films: any[]; mappings: any[]; tasteProfile: any }
) {
  const { films, mappings, tasteProfile } = context;

  // Build the TMDB details map from the supabase cache
  // This replaces the client-side getBulkTmdbDetails() call
  const db = getSupabaseAdmin();
  const tmdbIds = mappings.map((m: any) => m.tmdb_id).filter(Boolean);
  const { data: cachedMovies } = await db
    .from('tmdb_movies')
    .select('tmdb_id, data')
    .in('tmdb_id', tmdbIds);

  const tmdbDetailsMap = new Map<number, any>();
  for (const row of cachedMovies ?? []) {
    tmdbDetailsMap.set(row.tmdb_id, row.data);
  }

  // Build film objects for seed selection
  const filmsForSeeding = films
    .map((f: any) => {
      const mapping = mappings.find((m: any) => m.uri === f.uri);
      if (!mapping) return null;
      const details = tmdbDetailsMap.get(mapping.tmdb_id);
      return {
        uri: f.uri,
        tmdbId: mapping.tmdb_id,
        rating: f.rating,
        liked: f.liked,
        rewatch: f.rewatch,
        lastDate: f.last_date,
        genreIds: details?.genres?.map((g: any) => g.id) ?? [],
        popularity: details?.popularity,
        releaseDate: details?.release_date,
        title: f.title,
      };
    })
    .filter(Boolean);

  // Get weighted seed IDs with signature scoring enabled
  const seedIds = getWeightedSeedIds(
    filmsForSeeding,
    25,
    true, // ensureDiversity
    {
      topGenres: tasteProfile.topGenres,
      topDecades: tasteProfile.topDecades,
      useSignatureScoring: true, // IMPORTANT: must be true for niche-first seeds
    }
  );

  // Build the profile object that generateSmartCandidates expects
  const highlyRatedIds = filmsForSeeding
    .filter((f: any) => (f.rating ?? 0) >= 4 || f.liked)
    .map((f: any) => f.tmdbId);

  const smartCandidates = await generateSmartCandidates({
    highlyRatedIds,
    topGenres: tasteProfile.topGenres,
    topKeywords: tasteProfile.topKeywords,
    topDirectors: tasteProfile.topDirectors,
    topActors: tasteProfile.topActors,
    topStudios: tasteProfile.topStudios,
    topDecades: tasteProfile.topDecades,
    tmdbDetailsMap,
    // Add other profile fields as needed
  });

  // Combine all candidate sources
  const allCandidateIds = [
    ...smartCandidates.trending,
    ...smartCandidates.similar,
    ...smartCandidates.discovered,
  ];

  return {
    candidateIds: [...new Set(allCandidateIds)],
    sourceMetadata: smartCandidates.sourceMetadata,
  };
}
```

---

### Step 4: Build the Taste Profile Server-Side

`buildTasteProfile` in `enrich.ts` fetches TMDB data and user data via `supabase`. Rather than modifying it, look at what it returns and replicate the data loading using `supabaseAdmin`.

**Read `buildTasteProfile` in `enrich.ts` carefully.** It returns:
- `topGenres`, `topKeywords`, `topDirectors`, `topActors`, `topStudios`, `topCountries`, `topLanguages`
- `avoidGenres`, `avoidKeywords`
- `topDecades`
- `nichePreferences`
- `preferredSubgenreKeywordIds`

Check if there is a `user_taste_cache` or similar table that stores pre-computed taste profiles. If there is, the server engine can read from it directly (it gets populated when the user visits the web page or imports data). Search for `taste_cache` or `user_taste_profile` in the codebase.

**If a taste cache table exists:** Load the pre-computed profile from supabaseAdmin instead of recomputing it. This is the preferred approach — recomputing from scratch on every API call is expensive.

**If no cache exists:** You have two options:
1. Add a taste profile cache table (migration required), populated by the import/suggest flow on the web page, read by the API
2. Compute it inline using supabaseAdmin — the computation itself (weighted scoring, TF-IDF) is pure TypeScript; only the data loading needs supabaseAdmin

For option 2, create a `buildTasteProfileServer(userId)` function that:
- Loads film_events + film_tmdb_map + tmdb_movies from supabaseAdmin
- Calls the existing pure computation functions from `enrich.ts` if they can be isolated
- OR re-implements the profile building using the already-loaded data from `loadUserContext()`

---

### Step 5: Wire suggestByOverlap Server-Side

`suggestByOverlap` in `enrich.ts` fetches individual TMDB movies via `fetchTmdbMovieCached()`. Trace that function — it likely hits `supabase.from('tmdb_movies')` for cached data, then falls back to a TMDB API call.

Check if `fetchTmdbMovieCached` uses `supabase` directly or has injectable dependencies:

```typescript
// Search in enrich.ts for:
fetchTmdbMovieCached
// and trace where it reads from supabase
```

**If it uses `supabase` (browser client):** The function will still work server-side as long as `tmdb_movies` has no RLS (it doesn't — confirmed in `schema.sql`, it has no `enable row level security`). So calls to `supabase.from('tmdb_movies')` will work with the anon key even without a session, because there's no RLS blocking public reads on that table.

**Verify:** Check `schema.sql` and migrations for `alter table public.tmdb_movies enable row level security`. If it's NOT there, `suggestByOverlap` can call the anon `supabase` client for TMDB cache reads without changes, because it's a public shared table.

For tables that DO have RLS (film_events, film_tmdb_map, user_feature_feedback, etc.) — these are the tables you pre-loaded in Step 2. Pass pre-loaded data directly into `suggestByOverlap` via its existing parameters instead of letting it re-fetch from supabase.

---

### Step 6: Update the Generate Endpoint

**File:** `src/app/api/v1/suggestions/generate/route.ts`

Replace the current body with the new engine. Keep the existing request body parsing and auth — only change what happens after `body` is parsed:

```typescript
// Current (replace this):
const { recommendations, sourceDebug } = await aggregateRecommendations({
  seedMovies,
  limit: internalLimit,
  deadlineMs: 7500,
});

// New (replace with):
const userContext = await loadUserContext(auth.userId);
const tasteProfile = await buildTasteProfileServer(auth.userId, userContext);

const { candidateIds, sourceMetadata } = await generateServerCandidates(
  auth.userId,
  { films: userContext.films, mappings: userContext.mappings, tasteProfile }
);

// Filter excluded IDs from candidates
const excludeSet = new Set([
  ...body.exclude_tmdb_ids,
  ...Array.from(userContext.blockedIds),
]);
const filteredCandidates = candidateIds.filter(id => !excludeSet.has(id));

// Build the enhanced profile object
const enhancedProfile = {
  topKeywords: tasteProfile.topKeywords,
  topActors: tasteProfile.topActors,
  topStudios: tasteProfile.topStudios,
  topCountries: tasteProfile.topCountries,
  topLanguages: tasteProfile.topLanguages,
  avoidGenres: tasteProfile.avoidGenres,
  avoidKeywords: tasteProfile.avoidKeywords,
  preferredSubgenreKeywordIds: tasteProfile.preferredSubgenreKeywordIds ?? [],
};

// Build featureFeedback from loaded feedback data
const featureFeedback = buildFeatureFeedbackFromRows(userContext.feedback);

// Build lite films for suggestByOverlap
const liteFilms = userContext.films.map(f => ({
  uri: f.uri,
  title: f.title,
  year: f.year,
  rating: f.rating,
  liked: f.liked,
}));

// Load adjacent genres for adaptive learning
const adjacentGenres = buildAdjacentGenreMap(userContext.adjacentGenres);

// Build exploration MMR lambda
const mmrExplorationRate = userContext.explorationRate;
const lambda = 0.3 + (mmrExplorationRate / 0.3) * 0.4;
const mmrLambda = Math.max(0.3, Math.min(0.7, lambda));

const scored = await suggestByOverlap({
  userId: auth.userId,
  films: liteFilms,
  mappings: userContext.mappings,
  candidates: filteredCandidates,
  maxCandidates: Math.min(filteredCandidates.length, 1200),
  concurrency: 6,
  excludeWatchedIds: new Set(userContext.mappings.map((m: any) => m.tmdb_id)),
  desiredResults: Math.min(body.limit * 4, 200), // larger pool than requested, then trim
  sourceMetadata,
  mmrLambda,
  mmrTopKFactor: 2.5,
  featureFeedback: featureFeedback || undefined,
  watchlistEntries: [],
  context: { mode: 'background', localHour: new Date().getHours() },
  recentExposures: userContext.recentExposures,
  enhancedProfile,
  adjacentGenres, // ← renamed from adjacentBoosts in some versions
});

const data = scored
  .slice(0, body.limit)
  .map(item => ({
    tmdb_id: item.tmdbId,
    title: item.title ?? '',
    score: Math.round(item.score * 1000) / 1000,
    consensus_level: item.consensusLevel ?? 'low',
    sources: (item.sources ?? []).map(s => ({ source: s, confidence: 1.0 })),
    // NEW enriched fields (MCP and API consumers can use these)
    reasons: item.reasons ?? [],
    genres: item.genres ?? [],
    year: item.release_date?.slice(0, 4) ?? null,
    poster_path: item.poster_path ?? null,
    vote_category: item.voteCategory ?? null,
  }));
```

**Helper functions needed** (add to `serverSuggestionsEngine.ts`):

```typescript
function buildFeatureFeedbackFromRows(rows: any[]) {
  // Transform user_feature_feedback rows into the featureFeedback shape
  // that suggestByOverlap expects.
  // Look at how getAvoidedFeatures() in enrich.ts transforms this data —
  // replicate that transformation here using the pre-loaded rows.
  // The shape is: { avoidActors, avoidDirectors, avoidGenres, avoidKeywords,
  //                  avoidFranchises, avoidSubgenres, preferActors, preferDirectors,
  //                  preferGenres, preferKeywords, preferSubgenres }
}

function buildAdjacentGenreMap(rows: any[]): Map<string, Array<{genre: string; weight: number}>> {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.from_genre_name)) map.set(row.from_genre_name, []);
    map.get(row.from_genre_name).push({ genre: row.to_genre_name, weight: row.success_rate });
  }
  return map;
}
```

---

### Step 7: Enrich the Response Shape

The current API response only returns `tmdb_id, title, score, consensus_level, sources`. The new response includes `reasons, genres, year, poster_path, vote_category`.

This is a **backwards-compatible additive change** — old fields remain, new fields are added. Existing MCP consumers won't break.

Update `src/app/api/v1/suggestions/generate/route.ts` response schema comment and add the new fields to the OpenAPI docs if any exist.

---

### Step 8: Update the MCP Server

**File:** `F:\Code\lettrsuggest-mcp\src\index.ts`

After the API enriches its response, update the MCP `ls_suggest_movies` tool to display the new fields:

1. Show `reasons` in the suggestion output (this is the most valuable change — instead of just showing `*Similar content via TasteDive (match: 100%)*`, the user sees `*Directed by your favorite director, matches specific themes: neo-noir, psychological thriller*`)

2. Show `vote_category` badge in output

3. Show `year` and `genres` alongside title

```typescript
// In the ls_suggest_movies output formatting loop:
results.forEach((movie, index) => {
  const consensusTag = movie.consensus_level === 'high' ? ' 🔥'
    : movie.consensus_level === 'medium' ? ' ✨' : '';
  
  // NEW: show top reason (personalization signal)
  const topReason = movie.reasons?.[0] ?? '';
  
  // NEW: show genres and year
  const genreStr = movie.genres?.slice(0, 3).join(', ') ?? '';
  const yearStr = movie.year ? ` (${movie.year})` : '';
  
  lines.push(
    `### ${index + 1}. ${movie.title}${yearStr}${consensusTag}`,
    genreStr ? `*${genreStr}*` : '',
    `*(score: ${movie.score.toFixed(2)} · ${movie.sources.map(s => s.source).join(', ')})*`,
    topReason ? `*${topReason}*` : '',
    '',
  );
});
```

Bump MCP version to `1.3.0` and rebuild.

---

## File Checklist

| File | Action |
|------|--------|
| `src/lib/serverSuggestionsEngine.ts` | **CREATE** — data loading, taste profile, candidate generation, helper functions |
| `src/app/api/v1/suggestions/generate/route.ts` | **UPDATE** — replace aggregateRecommendations with new engine |
| `src/lib/enrich.ts` | **READ ONLY** — do not modify; reference for parameter shapes |
| `src/lib/trending.ts` | **READ ONLY** — do not modify; re-use getWeightedSeedIds and generateSmartCandidates |
| `supabase/schema.sql` | **READ** — verify table names, RLS status of tmdb_movies |
| `supabase/migrations/` | **READ** — check for taste profile cache tables |
| `F:\Code\lettrsuggest-mcp\src\index.ts` | **UPDATE** — display richer suggestion output |

---

## Things to Verify Before Coding

1. **Table names** — Confirm the actual table names by reading `supabase/schema.sql` and migration files. The tables used in this doc are: `film_events`, `film_tmdb_map`, `tmdb_movies`, `user_feature_feedback`, `user_exploration_stats`, `user_adjacent_preferences`, `suggestion_exposures`, `blocked_suggestions`. Verify each exists.

2. **tmdb_movies RLS** — Confirm `tmdb_movies` does NOT have RLS enabled. If it does, add a policy allowing public read access (it's a shared non-user-specific cache table and should be public).

3. **Taste profile cache** — Search the codebase for any table that caches the computed taste profile. If found, use it. If not, decide whether to add one (recommended for performance) or compute inline.

4. **suggestion_exposures table** — Search for where `logSuggestionExposure` from `enrich.ts` writes to. Confirm the table name and schema.

5. **generateSmartCandidates internal fetches** — Audit for any `fetch('/api/...')` calls that use relative internal URLs. These won't work in API route context. Replace with direct function calls or the `fetchTmdb()` helper.

6. **featureFeedback shape** — Search for `getAvoidedFeatures` in `enrich.ts` to understand the exact shape that `suggestByOverlap` expects for `featureFeedback`. Replicate that transformation in `buildFeatureFeedbackFromRows()`.

---

## Do NOT Do These Things

- Do not modify `enrich.ts` or `trending.ts` — the web page depends on them unchanged
- Do not expose `SUPABASE_SERVICE_ROLE_KEY` in client-side code or responses
- Do not remove the existing `aggregateRecommendations` import or the `recommendationAggregator.ts` file — it may still be used by the web page's `multiSourceConsensus` section
- Do not change the existing request body schema (`seed_tmdb_ids`, `limit`, `exclude_tmdb_ids`) — the MCP currently sends this format
- Do not break the existing response envelope structure (`{ data, meta, error }`)

---

## Testing

After implementation, test these scenarios via the MCP:

**Test 1 — Default suggestions:**
```
ls_suggest_movies (no params)
```
Expected: Suggestions should now show `reasons` that reference specific directors, actors, or keywords from the user's watch history. The score range should be wider than the current flat 1.055. Films should NOT be mainstream popular titles with no taste connection.

**Test 2 — Custom seeds:**
```
ls_suggest_movies custom_seeds=["Blade Runner", "Eraserhead", "Harakiri"]
```
Expected: Results should be notably more niche than before. Should see neo-noir, arthouse, and samurai-adjacent films — not generic action or sci-fi.

**Test 3 — Verify reasons are populated:**
Check that `reasons` array in the response contains personalization signals like:
- "Directed by [director] — you've highly rated 4 films by this director"
- "Matches specific themes you especially love: neo-noir, psychological thriller"
- NOT: "Similar content via TasteDive (match: 100%)"

**Test 4 — Verify no regression on non-suggestion endpoints:**
Run `ls_get_profile`, `ls_get_stats`, `ls_get_diary` to confirm the auth layer and profile endpoints still work unchanged.
