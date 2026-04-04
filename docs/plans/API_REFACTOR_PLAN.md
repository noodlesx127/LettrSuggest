# LettrSuggest — API/Backend Refactor: Revised Implementation Plan

**Derived from:** `HANDOFF_API_REFACTOR.md`  
**Plan reviewed by:** Code Reviewer (code-review skill)  
**Codebase validated by:** Explore agent  
**Date:** 2026-04-03

---

## Goal

Refactor `POST /api/v1/suggestions/generate` to use the same deep-personalization engine (`suggestByOverlap` in `src/lib/enrich.ts`) as the web suggest page, replacing the generic `aggregateRecommendations` call. User context is loaded server-side via `supabaseAdmin`.

---

## Pre-conditions

- `HANDOFF_ALGO_FIX.md` must be complete and deployed before this refactor.
- Verify web suggest page produces personalized results before proceeding.

---

## Verified Table Names & Schemas

All confirmed against `supabase/schema.sql` and `supabase/migrations/`:

| Table                       | Key Columns                                                                                                                   | Has RLS               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `film_events`               | user_id, uri, title, year, rating, rewatch, last_date, watch_count, liked, on_watchlist, updated_at                           | Yes                   |
| `film_tmdb_map`             | user_id, uri, tmdb_id, updated_at                                                                                             | Yes                   |
| `tmdb_movies`               | tmdb_id, data, updated_at                                                                                                     | **No** (shared cache) |
| `user_feature_feedback`     | id, user_id, feature_type, feature_id, feature_name, positive_count, negative_count, inferred_preference, last_updated        | Yes                   |
| `user_exploration_stats`    | user_id, exploration_rate, exploratory_films_rated, exploratory_avg_rating, last_updated                                      | Yes                   |
| `user_adjacent_preferences` | id, user_id, from_genre_id, from_genre_name, to_genre_id, to_genre_name, rating_count, avg_rating, success_rate, last_updated | Yes                   |
| `suggestion_exposure_log`   | id, user_id, tmdb_id, **exposed_at**, category, base_score, consensus_level, sources, reasons, ...                            | Yes                   |
| `blocked_suggestions`       | user_id, tmdb_id, blocked_at                                                                                                  | Yes                   |
| `user_taste_profile_cache`  | **NEW — must create via migration**                                                                                           | Yes                   |

**Critical discrepancies from original plan:**

- `suggestion_exposures` → actual: `suggestion_exposure_log`
- `shown_at` column → actual: `exposed_at`
- No taste profile cache table exists — must create one

---

## Key Function Signatures (Verified)

### `suggestByOverlap` (`enrich.ts:4844`)

```typescript
suggestByOverlap({
  userId: string,
  films: FilmEventLite[],
  mappings: Map<string, number>,   // ← Map<uri, tmdb_id>, NOT array
  candidates: number[],
  excludeGenres?: Set<string>,
  maxCandidates?: number,
  concurrency?: number,
  excludeWatchedIds?: Set<number>,
  desiredResults?: number,
  context?: SuggestContext,
  feedbackMap?: Map<number, "negative" | "positive">,
  sourceMetadata?: Map<number, { sources: string[]; consensusLevel: ... }>,
  sourceReliability?: Map<string, number>,
  mmrLambda?: number,
  mmrTopKFactor?: number,
  watchlistEntries?: Array<{ tmdbId: number; addedAt?: string | null }>,
  featureFeedback?: { ... },
  enhancedProfile?: {
    topKeywords, topActors, topStudios, topCountries, topLanguages,
    avoidGenres, avoidKeywords, preferredSubgenreKeywordIds,
    adjacentGenres?: Map<string, Array<{ genre: string; weight: number }>>,  // ← INSIDE enhancedProfile
    recentGenres?: string[],
    topDecades?: Array<{ decade: number; weight: number }>,
    watchlistGenres?, watchlistKeywords?, watchlistDirectors?
  },
  recentExposures?: Map<number, number>,
  allowSubgenres?: string[],
})
```

### `buildTasteProfile` (`enrich.ts:3048`)

```typescript
buildTasteProfile(films, mappings, topN?, negativeFeedbackIds?, tmdbDetails?, watchlistFilms?, userId?)
// MUST pass tmdbDetails to avoid internal fetch('/api/tmdb/movie') calls
```

### `generateSmartCandidates` (`trending.ts:779`)

```typescript
// WARNING: Makes internal fetch() calls to /api/tmdb/trending, /api/tmdb/movie, /api/tmdb/discover
// These CANNOT be used directly from API routes — must replace with direct TMDB calls
generateSmartCandidates({ highlyRatedIds, topGenres, topKeywords, topDirectors, topActors?,
  topStudios?, topDecades?, tmdbDetailsMap?, nichePreferences?, preferredSubgenreKeywordIds? })
// Returns: { trending, similar, discovered, sourceMetadata }
```

### `getAvoidedFeatures` shape (`enrich.ts:1874`)

```typescript
{
  avoidActors: Array<{ id: number; name: string; weight: number; count: number }>,
  avoidKeywords: Array<{ id: number; name: string; weight: number; count: number }>,
  avoidFranchises: Array<{ id: number; name: string; weight: number; count: number }>,
  avoidDirectors: Array<{ id: number; name: string; weight: number; count: number }>,
  avoidGenres: Array<{ id: number; name: string; weight: number; count: number }>,
  avoidSubgenres: Array<{ key: string; weight: number; count: number }>,
  preferActors: [...], preferKeywords: [...], preferDirectors: [...],
  preferGenres: [...], preferSubgenres: [...]
}
```

---

## Files to Create/Modify

| File                                                         | Action                                                                  |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `supabase/migrations/TIMESTAMP_user_taste_profile_cache.sql` | **CREATE** — taste profile cache table                                  |
| `src/lib/serverSuggestionsEngine.ts`                         | **CREATE** — data loading, taste profile, candidate generation, helpers |
| `src/app/api/v1/suggestions/generate/route.ts`               | **UPDATE** — replace aggregateRecommendations with new engine           |
| `src/lib/enrich.ts`                                          | **READ ONLY**                                                           |
| `src/lib/trending.ts`                                        | **READ ONLY**                                                           |
| `F:\Code\lettrsuggest-mcp\src\index.ts`                      | **UPDATE** — display richer suggestion output                           |

---

## Implementation Tasks

### Task 1: Taste Profile Cache Migration

**File:** `supabase/migrations/TIMESTAMP_user_taste_profile_cache.sql`

```sql
CREATE TABLE IF NOT EXISTS public.user_taste_profile_cache (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  profile JSONB NOT NULL,
  film_count INTEGER NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_taste_profile_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own taste cache" ON public.user_taste_profile_cache;
CREATE POLICY "Users can read own taste cache"
  ON public.user_taste_profile_cache FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can upsert own taste cache" ON public.user_taste_profile_cache;
CREATE POLICY "Users can upsert own taste cache"
  ON public.user_taste_profile_cache FOR ALL
  USING (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
```

The `serverSuggestionsEngine.ts` will check this cache first. Cache is valid if:

- `computed_at` is < 24 hours ago, AND
- `film_count` matches current `film_events` count for the user

If stale or missing, compute inline and store for next time.

---

### Task 2: Create `src/lib/serverSuggestionsEngine.ts`

This is the core deliverable. Address ALL review-identified issues:

#### 2a. Data Loading Layer

```typescript
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildTasteProfile } from "@/lib/enrich";

// SECURITY: All queries MUST include .eq('user_id', userId) except for
// shared cache tables (tmdb_movies). supabaseAdmin bypasses RLS — user
// scoping is enforced in application code here.

export async function loadUserContext(userId: string) {
  const db = getSupabaseAdmin();

  const [
    filmsResult,
    mappingsResult,
    feedbackResult,
    explorationResult,
    adjacentResult,
    exposuresResult,
    blockedResult,
  ] = await Promise.all([
    db
      .from("film_events")
      .select(
        "uri, title, year, rating, rewatch, last_date, watch_count, liked, on_watchlist",
      )
      .eq("user_id", userId)
      .order("last_date", { ascending: false, nullsFirst: false }),

    db.from("film_tmdb_map").select("uri, tmdb_id").eq("user_id", userId),

    db
      .from("user_feature_feedback")
      .select(
        "feature_id, feature_name, feature_type, inferred_preference, positive_count, negative_count, last_updated",
      )
      .eq("user_id", userId),

    db
      .from("user_exploration_stats")
      .select(
        "exploration_rate, exploratory_films_rated, exploratory_avg_rating",
      )
      .eq("user_id", userId)
      .maybeSingle(),

    db
      .from("user_adjacent_preferences")
      .select("from_genre_name, to_genre_name, success_rate, rating_count")
      .eq("user_id", userId)
      .gte("rating_count", 3)
      .gte("success_rate", 0.5),

    // FIXED: table is suggestion_exposure_log, column is exposed_at
    db
      .from("suggestion_exposure_log")
      .select("tmdb_id, exposed_at")
      .eq("user_id", userId)
      .gte(
        "exposed_at",
        new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
      ),

    db.from("blocked_suggestions").select("tmdb_id").eq("user_id", userId),
  ]);

  if (filmsResult.error)
    console.error("[ServerEngine] Failed to load films:", filmsResult.error);
  if (mappingsResult.error)
    console.error(
      "[ServerEngine] Failed to load mappings:",
      mappingsResult.error,
    );

  const films = filmsResult.data ?? [];
  const mappingsArray = mappingsResult.data ?? [];

  // FIXED B1: Convert array to Map<uri, tmdb_id> — suggestByOverlap requires Map, not array
  const mappingsMap = new Map<string, number>();
  for (const row of mappingsArray) {
    mappingsMap.set(row.uri, row.tmdb_id);
  }

  return {
    films,
    mappings: mappingsMap, // Map<string, number>
    mappingsArray, // Array form for other uses
    feedback: feedbackResult.data ?? [],
    explorationRate: explorationResult.data?.exploration_rate ?? 0.15,
    adjacentGenres: adjacentResult.data ?? [],
    // FIXED B2: correct table/column names
    recentExposures: buildExposureMap(exposuresResult.data ?? []),
    blockedIds: new Set(
      (blockedResult.data ?? []).map((b: any) => b.tmdb_id as number),
    ),
  };
}

// FIXED B2: parameter uses exposed_at, not shown_at
function buildExposureMap(
  rows: Array<{ tmdb_id: number; exposed_at: string }>,
): Map<number, number> {
  const map = new Map<number, number>();
  const now = Date.now();
  for (const row of rows) {
    const daysSince =
      (now - new Date(row.exposed_at).getTime()) / (1000 * 60 * 60 * 24);
    map.set(row.tmdb_id, daysSince);
  }
  return map;
}
```

#### 2b. Taste Profile Server-Side (with cache)

```typescript
export async function buildTasteProfileServer(
  userId: string,
  userContext: Awaited<ReturnType<typeof loadUserContext>>,
) {
  const db = getSupabaseAdmin();

  // Check taste profile cache
  const { data: cached } = await db
    .from("user_taste_profile_cache")
    .select("profile, film_count, computed_at")
    .eq("user_id", userId)
    .maybeSingle();

  const currentFilmCount = userContext.films.length;
  const cacheAge = cached
    ? (Date.now() - new Date(cached.computed_at).getTime()) / (1000 * 60 * 60)
    : Infinity;
  const cacheValid =
    cached && cacheAge < 24 && cached.film_count === currentFilmCount;

  if (cacheValid) {
    console.log("[ServerEngine] Using cached taste profile");
    return cached.profile;
  }

  // Load TMDB details for all user films — MUST pass to buildTasteProfile
  // to avoid internal fetch('/api/tmdb/movie') calls
  const tmdbIds = userContext.mappingsArray
    .map((m) => m.tmdb_id)
    .filter(Boolean);

  // FIXED P2: Batch query to avoid URL length limits on large .in() calls
  const BATCH_SIZE = 200;
  const allCachedMovies: Array<{ tmdb_id: number; data: any }> = [];
  for (let i = 0; i < tmdbIds.length; i += BATCH_SIZE) {
    const batch = tmdbIds.slice(i, i + BATCH_SIZE);
    const { data } = await db
      .from("tmdb_movies")
      .select("tmdb_id, data")
      .in("tmdb_id", batch);
    if (data) allCachedMovies.push(...data);
  }

  const tmdbDetailsMap = new Map<number, any>();
  for (const row of allCachedMovies) {
    tmdbDetailsMap.set(row.tmdb_id, row.data);
  }

  // Build lite films for taste profile
  const liteFilms = userContext.films.map((f) => ({
    uri: f.uri,
    title: f.title,
    year: f.year,
    rating: f.rating,
    liked: f.liked,
    rewatch: f.rewatch,
    last_date: f.last_date,
    watch_count: f.watch_count,
    on_watchlist: f.on_watchlist,
  }));

  // FIXED M2: Always pass tmdbDetails to prevent internal fetches
  const profile = await buildTasteProfile(
    liteFilms,
    userContext.mappings, // Map<string, number>
    30, // topN
    undefined, // negativeFeedbackIds
    tmdbDetailsMap, // REQUIRED: avoids internal /api/tmdb/movie fetches
    undefined, // watchlistFilms
    userId,
  );

  // Store in cache for next time
  await db.from("user_taste_profile_cache").upsert(
    {
      user_id: userId,
      profile,
      film_count: currentFilmCount,
      computed_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  return profile;
}
```

#### 2c. Server-Safe Candidate Generation

**CRITICAL — FIXED B3:** `generateSmartCandidates` makes internal fetch calls. Do NOT call it directly.
Instead, build a server-safe version using `fetchTmdb()` from `src/app/api/v1/_lib/tmdb.ts`.

```typescript
import { fetchTmdb } from "@/app/api/v1/_lib/tmdb";

// Server-safe TMDB calls replacing generateSmartCandidates internal fetches
async function fetchTrendingDirect(period: "day" | "week"): Promise<number[]> {
  const data = await fetchTmdb<{ results: Array<{ id: number }> }>(
    `/trending/movie/${period}`,
  );
  return (data?.results ?? []).map((m) => m.id);
}

async function fetchSimilarDirect(tmdbId: number): Promise<number[]> {
  const data = await fetchTmdb<{ results: Array<{ id: number }> }>(
    `/movie/${tmdbId}/similar`,
  );
  return (data?.results ?? []).map((m) => m.id);
}

async function discoverMoviesDirect(
  params: Record<string, string | number>,
): Promise<number[]> {
  const data = await fetchTmdb<{ results: Array<{ id: number }> }>(
    "/discover/movie",
    params,
  );
  return (data?.results ?? []).map((m) => m.id);
}

export async function generateServerCandidates(
  userId: string,
  userContext: Awaited<ReturnType<typeof loadUserContext>>,
  tasteProfile: any,
  seedTmdbIds: number[] = [], // FIXED B4: accept external seeds
): Promise<{ candidateIds: number[]; sourceMetadata: Map<number, any> }> {
  const { films, mappings, mappingsArray } = userContext;

  // Load TMDB details (batched to avoid URL length limits)
  const tmdbIds = mappingsArray.map((m) => m.tmdb_id).filter(Boolean);
  const db = getSupabaseAdmin();
  const BATCH_SIZE = 200;
  const allMovies: Array<{ tmdb_id: number; data: any }> = [];
  for (let i = 0; i < tmdbIds.length; i += BATCH_SIZE) {
    const { data } = await db
      .from("tmdb_movies")
      .select("tmdb_id, data")
      .in("tmdb_id", tmdbIds.slice(i, i + BATCH_SIZE));
    if (data) allMovies.push(...data);
  }
  const tmdbDetailsMap = new Map<number, any>(
    allMovies.map((r) => [r.tmdb_id, r.data]),
  );

  // Get highly-rated film IDs for TMDB similar calls
  const highlyRatedIds = films
    .filter((f) => (f.rating ?? 0) >= 4 || f.liked)
    .map((f) => mappings.get(f.uri))
    .filter((id): id is number => !!id);

  const sourceMetadata = new Map<
    number,
    { sources: string[]; consensusLevel: "high" | "medium" | "low" }
  >();

  const addWithSource = (
    ids: number[],
    source: string,
    level: "high" | "medium" | "low",
  ) => {
    for (const id of ids) {
      const existing = sourceMetadata.get(id);
      if (existing) {
        existing.sources.push(source);
        if (
          level === "high" ||
          (level === "medium" && existing.consensusLevel === "low")
        ) {
          existing.consensusLevel = level;
        }
      } else {
        sourceMetadata.set(id, { sources: [source], consensusLevel: level });
      }
    }
  };

  // Parallel candidate fetches using direct TMDB API (no internal routes)
  const [trendingDay, trendingWeek] = await Promise.all([
    fetchTrendingDirect("day").catch(() => [] as number[]),
    fetchTrendingDirect("week").catch(() => [] as number[]),
  ]);
  addWithSource(trendingDay, "trending_day", "medium");
  addWithSource(trendingWeek, "trending_week", "medium");

  // Similar films from top-rated seeds + external seeds
  const seedsForSimilar = [
    ...new Set([...highlyRatedIds.slice(0, 10), ...seedTmdbIds]),
  ];
  const similarResults = await Promise.allSettled(
    seedsForSimilar.slice(0, 8).map((id) => fetchSimilarDirect(id)),
  );
  for (let i = 0; i < similarResults.length; i++) {
    if (similarResults[i].status === "fulfilled") {
      addWithSource(
        (similarResults[i] as PromiseFulfilledResult<number[]>).value,
        "similar",
        "high",
      );
    }
  }

  // Discover by top genres
  const topGenreIds = (tasteProfile.topGenres ?? [])
    .slice(0, 3)
    .map((g: any) => g.id);
  if (topGenreIds.length > 0) {
    const discovered = await discoverMoviesDirect({
      with_genres: topGenreIds.join(","),
      sort_by: "vote_average.desc",
      "vote_count.gte": 100,
    }).catch(() => [] as number[]);
    addWithSource(discovered, "discover_genre", "medium");
  }

  // Include external seeds with high priority
  if (seedTmdbIds.length > 0) {
    addWithSource(seedTmdbIds, "user_seeds", "high");
  }

  const candidateIds = [
    ...new Set([
      ...seedTmdbIds, // seeds first (highest priority)
      ...trendingDay,
      ...trendingWeek,
      ...similarResults.flatMap((r) =>
        r.status === "fulfilled" ? r.value : [],
      ),
    ]),
  ];

  return { candidateIds, sourceMetadata };
}
```

#### 2d. Feature Feedback Helper

**FIXED M3:** Complete implementation (not a stub):

```typescript
export function buildFeatureFeedbackFromRows(rows: any[]) {
  // Mirror getAvoidedFeatures() shape from enrich.ts:1874
  const result = {
    avoidActors: [] as Array<{
      id: number;
      name: string;
      weight: number;
      count: number;
    }>,
    avoidKeywords: [] as Array<{
      id: number;
      name: string;
      weight: number;
      count: number;
    }>,
    avoidFranchises: [] as Array<{
      id: number;
      name: string;
      weight: number;
      count: number;
    }>,
    avoidDirectors: [] as Array<{
      id: number;
      name: string;
      weight: number;
      count: number;
    }>,
    avoidGenres: [] as Array<{
      id: number;
      name: string;
      weight: number;
      count: number;
    }>,
    avoidSubgenres: [] as Array<{ key: string; weight: number; count: number }>,
    preferActors: [] as Array<{
      id: number;
      name: string;
      weight: number;
      count: number;
    }>,
    preferKeywords: [] as Array<{
      id: number;
      name: string;
      weight: number;
      count: number;
    }>,
    preferDirectors: [] as Array<{
      id: number;
      name: string;
      weight: number;
      count: number;
    }>,
    preferGenres: [] as Array<{
      id: number;
      name: string;
      weight: number;
      count: number;
    }>,
    preferSubgenres: [] as Array<{
      key: string;
      weight: number;
      count: number;
    }>,
  };

  for (const row of rows) {
    const isAvoid =
      row.inferred_preference === "negative" || row.inferred_preference < 0;
    const weight = Math.abs(Number(row.inferred_preference) || 0);
    const count = (row.negative_count || 0) + (row.positive_count || 0);
    const entry = {
      id: Number(row.feature_id),
      name: String(row.feature_name),
      weight,
      count,
    };

    switch (row.feature_type) {
      case "actor":
        (isAvoid ? result.avoidActors : result.preferActors).push(entry);
        break;
      case "keyword":
        (isAvoid ? result.avoidKeywords : result.preferKeywords).push(entry);
        break;
      case "franchise":
        if (isAvoid) result.avoidFranchises.push(entry);
        break;
      case "director":
        (isAvoid ? result.avoidDirectors : result.preferDirectors).push(entry);
        break;
      case "genre":
        (isAvoid ? result.avoidGenres : result.preferGenres).push(entry);
        break;
      case "subgenre":
        const subEntry = { key: String(row.feature_name), weight, count };
        (isAvoid ? result.avoidSubgenres : result.preferSubgenres).push(
          subEntry,
        );
        break;
    }
  }

  return result;
}
```

#### 2e. Adjacent Genre Map Helper

```typescript
export function buildAdjacentGenreMap(
  rows: any[],
): Map<string, Array<{ genre: string; weight: number }>> {
  const map = new Map<string, Array<{ genre: string; weight: number }>>();
  for (const row of rows) {
    if (!map.has(row.from_genre_name)) map.set(row.from_genre_name, []);
    map
      .get(row.from_genre_name)!
      .push({ genre: row.to_genre_name, weight: row.success_rate });
  }
  return map;
}
```

---

### Task 3: Update `src/app/api/v1/suggestions/generate/route.ts`

Replace the body of the generate endpoint after auth/body parsing. Address:

- **FIXED B4:** `seed_tmdb_ids` is now passed to `generateServerCandidates` as bias signals (Option B — preserve API contract)
- **FIXED M4/M5:** `adjacentGenres` goes inside `enhancedProfile`, not top-level
- **FIXED m2:** Build `watchlistEntries` from loaded data

```typescript
// Keep existing: withApiAuth, body parsing, validation
// CHANGE: after body parsing, replace aggregateRecommendations with:

const userContext = await loadUserContext(auth.userId);
const tasteProfile = await buildTasteProfileServer(auth.userId, userContext);

// FIXED B4: Pass seed_tmdb_ids as bias signals (not ignored)
const { candidateIds, sourceMetadata } = await generateServerCandidates(
  auth.userId,
  userContext,
  tasteProfile,
  body.seed_tmdb_ids, // seeds bias the candidate pool
);

// Filter excluded IDs
const excludeSet = new Set([
  ...body.exclude_tmdb_ids,
  ...Array.from(userContext.blockedIds),
]);
const filteredCandidates = candidateIds.filter((id) => !excludeSet.has(id));

// Build enhanced profile — FIXED M4: adjacentGenres inside enhancedProfile
const adjacentGenresMap = buildAdjacentGenreMap(userContext.adjacentGenres);
const enhancedProfile = {
  topKeywords: tasteProfile.topKeywords,
  topActors: tasteProfile.topActors,
  topStudios: tasteProfile.topStudios,
  topCountries: tasteProfile.topCountries,
  topLanguages: tasteProfile.topLanguages,
  avoidGenres: tasteProfile.avoidGenres,
  avoidKeywords: tasteProfile.avoidKeywords,
  preferredSubgenreKeywordIds: tasteProfile.preferredSubgenreKeywordIds ?? [],
  topDecades: tasteProfile.topDecades,
  adjacentGenres: adjacentGenresMap, // ← INSIDE enhancedProfile (not top-level)
  watchlistGenres: tasteProfile.watchlistGenres?.map((g: any) => g.name) ?? [],
  watchlistKeywords:
    tasteProfile.watchlistKeywords?.map((k: any) => k.name) ?? [],
  watchlistDirectors:
    tasteProfile.watchlistDirectors?.map((d: any) => d.name) ?? [],
};

// FIXED M3: complete featureFeedback (never undefined)
const featureFeedback = buildFeatureFeedbackFromRows(userContext.feedback);

// FIXED m2: build watchlistEntries from loaded data
const watchlistEntries = userContext.films
  .filter((f) => f.on_watchlist)
  .map((f) => ({
    tmdbId: userContext.mappings.get(f.uri)!,
    addedAt: f.last_date ?? null,
  }))
  .filter((e) => e.tmdbId);

// Build lite films
const liteFilms = userContext.films.map((f) => ({
  uri: f.uri,
  title: f.title,
  year: f.year,
  rating: f.rating,
  liked: f.liked,
  rewatch: f.rewatch,
  last_date: f.last_date,
  watch_count: f.watch_count,
  on_watchlist: f.on_watchlist,
}));

// Compute MMR lambda from exploration rate
const mmrExplorationRate = userContext.explorationRate;
const lambda = 0.3 + (mmrExplorationRate / 0.3) * 0.4;
const mmrLambda = Math.max(0.3, Math.min(0.7, lambda));

// FIXED B1 (mappings is now Map), M5 (adjacentGenres inside enhancedProfile)
const scored = await suggestByOverlap({
  userId: auth.userId,
  films: liteFilms,
  mappings: userContext.mappings, // Map<string, number> ✓
  candidates: filteredCandidates,
  maxCandidates: Math.min(filteredCandidates.length, 1200),
  concurrency: 6,
  excludeWatchedIds: new Set(userContext.mappings.values()), // FIXED B1
  desiredResults: Math.min(body.limit * 4, 200),
  sourceMetadata,
  sourceReliability: undefined,
  mmrLambda,
  mmrTopKFactor: 2.5,
  featureFeedback,
  watchlistEntries,
  context: { mode: "background", localHour: new Date().getHours() },
  recentExposures: userContext.recentExposures,
  enhancedProfile,
});

const data = scored.slice(0, body.limit).map((item) => ({
  tmdb_id: item.tmdbId,
  title: item.title ?? "",
  score: Math.round(item.score * 1000) / 1000,
  consensus_level: item.consensusLevel ?? "low",
  // FIXED m1: preserve source metadata from sourceMetadata Map where available
  sources: (sourceMetadata.get(item.tmdbId)?.sources ?? item.sources ?? []).map(
    (s: string) => ({ source: s, confidence: 1.0 }),
  ),
  // New enriched fields (additive/backwards-compatible)
  reasons: item.reasons ?? [],
  genres: item.genres ?? [],
  year: item.release_date?.slice(0, 4) ?? null,
  poster_path: item.poster_path ?? null,
  vote_category: item.voteCategory ?? null,
}));
```

Also: Make `seed_tmdb_ids` optional in body validation (was required):

```typescript
seed_tmdb_ids: parsePositiveIntegerArray(body.seed_tmdb_ids, "seed_tmdb_ids", {
  required: false,  // ← changed from true; seeds are now bias signals, not required
  maxItems: 15,
}),
```

---

### Task 4: Update MCP Server

**File:** `F:\Code\lettrsuggest-mcp\src\index.ts`

In the `ls_suggest_movies` tool output formatting loop, update to show enriched fields:

```typescript
results.forEach((movie, index) => {
  const consensusTag =
    movie.consensus_level === "high"
      ? " 🔥"
      : movie.consensus_level === "medium"
        ? " ✨"
        : "";

  const topReason = movie.reasons?.[0] ?? "";
  const genreStr = movie.genres?.slice(0, 3).join(", ") ?? "";
  const yearStr = movie.year ? ` (${movie.year})` : "";

  lines.push(
    `### ${index + 1}. ${movie.title}${yearStr}${consensusTag}`,
    genreStr ? `*${genreStr}*` : "",
    `*(score: ${movie.score.toFixed(2)} · ${movie.sources.map((s: any) => s.source).join(", ")})*`,
    topReason ? `*${topReason}*` : "",
    "",
  );
});
```

Bump MCP version to `1.3.0` and rebuild.

---

## Testing

After implementation, test these scenarios:

**Test 1 — No seeds (profile-based):**

```
ls_suggest_movies (no params)
```

Expected: Suggestions show `reasons` referencing specific directors, actors, themes. Score range wider than flat 1.055.

**Test 2 — With custom seeds:**

```
ls_suggest_movies custom_seeds=["Blade Runner", "Eraserhead", "Harakiri"]
```

Expected: Seeds bias results; more niche/thematic suggestions.

**Test 3 — Verify reasons populated:**

- `reasons` array contains personalization signals
- NOT generic: "Similar content via TasteDive (match: 100%)"

**Test 4 — Non-regression:**

```
ls_get_profile, ls_get_stats, ls_get_diary
```

Expected: Unchanged behavior.

**Test 5 — TypeScript/Build:**

```
npm run typecheck
npm run build
```

Expected: No errors.

---

## Security Notes

- `supabaseAdmin` bypasses RLS — every query in `serverSuggestionsEngine.ts` MUST include `.eq('user_id', userId)` except `tmdb_movies` (shared cache with no RLS by design)
- Never return raw database error messages to the client
- `SUPABASE_SERVICE_ROLE_KEY` stays server-side only
- Request/response schema unchanged for existing MCP consumers

---

## Do NOT Do These Things

- Do not modify `enrich.ts` or `trending.ts`
- Do not call `generateSmartCandidates` directly (internal fetch issue)
- Do not expose `SUPABASE_SERVICE_ROLE_KEY` client-side
- Do not remove `aggregateRecommendations` import (may still be used elsewhere)
- Do not break the `{ data, meta, error }` response envelope
