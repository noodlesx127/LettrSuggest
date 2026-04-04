# LettrSuggest Backend — Suggestion Quality Fix Handoff #2

**Project:** `F:\Code\LettrSuggest`
**Diagnosed from:** Live shakedown run April 4, 2026 (post-commit a392e96)
**Context:** Engine working, personalization reasons visible. These are the remaining quality issues.

---

## Fix Status (updated April 4, 2026)

| Issue                                        | Confirmed?                                                         | Status                                                                |
| -------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Issue 1 — TMDB_GENRE_MAP missing export      | NOT CONFIRMED — export exists at genreEnhancement.ts:70            | No fix needed                                                         |
| Issue 2 — Trending duplicates                | CONFIRMED                                                          | ✅ FIXED                                                              |
| Issue 3 — Genre weight inflation             | CONFIRMED                                                          | ✅ FIXED                                                              |
| Issue 4 — Diversity caps + director mismatch | NOT CONFIRMED — maxSameGenre is already 5, directors field correct | No fix needed                                                         |
| Issue 5 — Consensus scoring popularity bias  | PARTIALLY CONFIRMED                                                | ✅ PARTIALLY FIXED (consensusBonus 0.5→0.25; taste context not wired) |
| Issue 6 — directorCounts empty               | NOT CONFIRMED — field name is correct                              | No fix needed                                                         |

---

## Current State Summary (what was confirmed in code)

These fixes from prior handoffs are **already done and confirmed in source**:

- ✅ `getPreferenceWeight`: 3-star not-liked films now return 0.0 (mediocre films no longer inflate genre weights)
- ✅ Quality multiplier: Replaced with niche bonus (1.1x only for voteCount < 500 AND voteAverage >= 7.0)
- ✅ Base score floor: Removed — no more free 0.2-0.3 scores for zero-match films
- ✅ Discover sort: Changed to `vote_average.desc` with random page 1-5
- ✅ Context reasons deferred to end of `reasons[]` array
- ✅ `TMDB_GENRE_MAP` is properly exported from `genreEnhancement.ts` (line 70) and imported correctly in route.ts

---

## Issue 1 — ~~CRITICAL~~: Genre filter silently broken — missing export [NOT CONFIRMED — NO FIX NEEDED]

**Confirmed in:** `src/lib/genreEnhancement.ts` and `src/app/api/v1/suggestions/generate/route.ts`

`route.ts` imports `TMDB_GENRE_MAP` from `@/lib/genreEnhancement`:

```typescript
import { TMDB_GENRE_MAP } from "@/lib/genreEnhancement";
```

`TMDB_GENRE_MAP` does **not exist** in `genreEnhancement.ts`. Searching the file returns zero results for that name. At runtime `TMDB_GENRE_MAP` is `undefined`, so `TMDB_GENRE_MAP[gid]` throws or returns undefined for every genre ID, and the filter silently passes all films through. This is why `genre_filter="Horror"` still returns Butch Cassidy and the Sundance Kid as #1.

**Fix — Two options, pick one:**

**Option A (quickest):** Define the map inline in `route.ts` and remove the broken import:

```typescript
// Remove:
import { TMDB_GENRE_MAP } from "@/lib/genreEnhancement";

// Add near the top of route.ts (before the POST handler):
const TMDB_GENRE_MAP: Record<number, string> = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "History",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Science Fiction",
  10770: "TV Movie",
  53: "Thriller",
  10752: "War",
  37: "Western",
};
```

**Option B (cleaner):** Add the export to `genreEnhancement.ts`:

```typescript
// Add to src/lib/genreEnhancement.ts:
export const TMDB_GENRE_MAP: Record<number, string> = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "History",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Science Fiction",
  10770: "TV Movie",
  53: "Thriller",
  10752: "War",
  37: "Western",
};
```

Option A is safer — avoids any risk of circular imports through `genreEnhancement.ts`.

**Verify the filter logic works after the map is defined.** The filter in `route.ts` currently does:

```typescript
const canonicalName = TMDB_GENRE_MAP[gid]?.toLowerCase();
return canonicalName ? itemGenres.includes(canonicalName) : false;
```

`itemGenres` comes from `item.genres` which are already lowercase strings from `enrich.ts`. Confirm the case matches — if `enrich.ts` returns genres as `"Horror"` (title case) and the map lowercases to `"horror"`, the comparison will fail. Either:

- Keep both lowercase: `itemGenres.map(g => g.toLowerCase())` and `TMDB_GENRE_MAP[gid].toLowerCase()` ← already doing this
- OR store `item.genres` in the response as-is and compare case-insensitively

The current code lowercases both sides so it should work once the map is defined.

---

## Issue 2 — ~~HIGH~~: Persistent same-film duplicates across all runs [✅ FIXED]

**Confirmed from:** Live shakedown — Butch Cassidy (#1 in all 4 runs), Pretty Lethal, Send Help, Boyz n the Hood, Dances with Wolves appearing in every run regardless of seeds.

**Root cause:** `generateServerCandidates` in `serverSuggestionsEngine.ts` runs two sources that always return identical results:

1. `fetchTmdb("/trending/movie/day")` — same 20 films every day globally
2. `fetchTmdb("/trending/movie/week")` — same 20 films every week globally

These 40 films are added to every candidate pool unconditionally. With `vote_average.desc` scoring, high-quality trending films (Butch Cassidy, Boyz n the Hood) earn strong scores from genre weight matches and appear every run. The random-page discover fix is in the code but trending overrides it.

**Fix — Three changes to `src/lib/serverSuggestionsEngine.ts`:**

**Change A:** Cap how many trending candidates contribute to the final pool. After candidate collection, limit trending sources to their proportion:

In `generateServerCandidates`, after all sources are collected, add a trending cap:

```typescript
// After the loop collecting all source results into candidateOrder/candidateSet,
// add a per-source cap to prevent any single source from dominating.
// Trending sources are generic — cap them at 10 each.
const SOURCE_CAPS: Record<string, number> = {
  "trending-day": 10,
  "trending-week": 10,
  "discover-top-genres": 15,
};

// Rebuild candidateOrder respecting source caps
const sourceCounts = new Map<string, number>();
const cappedCandidateOrder: number[] = [];

for (const tmdbId of candidateOrder) {
  const meta = sourceMetadata.get(tmdbId);
  if (!meta) {
    cappedCandidateOrder.push(tmdbId);
    continue;
  }

  // Check if any source for this film is over its cap
  // A film from multiple sources passes through if ANY source is under cap
  const canAdd = meta.sources.some((source) => {
    const cap = SOURCE_CAPS[source];
    if (cap === undefined) return true; // No cap for seed-based sources
    const count = sourceCounts.get(source) ?? 0;
    return count < cap;
  });

  if (canAdd) {
    cappedCandidateOrder.push(tmdbId);
    // Increment counts for all non-capped sources
    for (const source of meta.sources) {
      if (SOURCE_CAPS[source] !== undefined) {
        sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
      }
    }
  }
}

return {
  candidateIds: cappedCandidateOrder,
  sourceMetadata,
};
```

**Change B:** Add page randomization to trending calls. TMDB trending doesn't have a page parameter for variety, but we can randomly select between day/week with a secondary discover call substituting:

```typescript
// Replace the two static trending calls with one randomly chosen + one discover:
const useDayTrending = Math.random() > 0.5;

requests.push(
  fetchTmdb<TmdbListResult>(
    useDayTrending ? "/trending/movie/day" : "/trending/movie/week",
  )
    .then((result) => ({
      source: useDayTrending ? "trending-day" : "trending-week",
      ids: (result.results ?? []).map((movie) => movie.id),
    }))
    .catch(() => ({ source: "trending", ids: [] })),
);

// Use the other trending window only if we have few seeds
if (topSeedTmdbIds.length < 4) {
  requests.push(
    fetchTmdb<TmdbListResult>(
      useDayTrending ? "/trending/movie/week" : "/trending/movie/day",
    )
      .then((result) => ({
        source: useDayTrending ? "trending-week" : "trending-day",
        ids: (result.results ?? []).map((movie) => movie.id),
      }))
      .catch(() => ({ source: "trending-alt", ids: [] })),
  );
}
```

**Change C:** Increase seed-based similar calls relative to trending. Currently `topSeedTmdbIds` generates 8 similar calls which together produce ~160 candidate IDs. These are personalized. Trending adds 40 more generic ones on top. The fix is to increase the seed similar pool:

```typescript
// Change the limit in getTopSeedTmdbIds call:
const topSeedTmdbIds = getTopSeedTmdbIds(userContext, 12); // was 8 — more seeds = more variety
```

This produces ~240 seed-based candidates vs 20-40 trending, shifting the ratio toward personalized content.

---

## Issue 3 — ~~MEDIUM~~: Off-brand results from genre weight inflation [✅ FIXED]

**Confirmed from:** The Devil Wears Prada and Green Book appearing from seeds Eraserhead/Blue Velvet/Harakiri/Cure — seeds that clearly point to arthouse/neo-noir/psychological horror, but the Drama genre weight (193 positive signals) is so high that any Drama film scores strongly.

**Root cause:** The `getPreferenceWeight` fix already addressed 3-star films returning 0.0, which was the main inflator. But with 193 Drama signals at 4+ stars, even with the fix, Drama accumulates a massive weight that makes `totalGenreWeight * weights.genre` dominate other scoring signals.

**Fix — Add a per-genre weight ceiling in `suggestByOverlap`:**

In `enrich.ts`, find where genre weights are applied (~line 6290):

```typescript
// Current:
const totalGenreWeight = gHits.reduce(
  (sum, g) => sum + (pref.genres.get(g) ?? 0),
  0,
);
score += totalGenreWeight * weights.genre;
```

Change to cap the effective weight per genre to prevent any single dominant genre from overwhelming scores:

```typescript
const MAX_GENRE_WEIGHT = 15.0; // Cap prevents any one genre from dominating

const totalGenreWeight = gHits.reduce(
  (sum, g) => sum + Math.min(pref.genres.get(g) ?? 0, MAX_GENRE_WEIGHT),
  0,
);
score += totalGenreWeight * weights.genre;
```

This means a user with 193 Drama signals and a user with 15 Drama signals get the same effective boost — they both love Drama, the strength is already proven at 15, there's no additional value in counting to 193. Films that match on keywords, directors, or actors will now be able to differentiate themselves from films that only match on a dominant genre.

Apply the same cap to `genreCombos`, `keywords`, and `directors`:

```typescript
// Genre combos:
const comboWeight = Math.min(pref.genreCombos.get(feats.genreCombo) ?? 1, 10.0);

// Directors:
const totalDirWeight = dHits.reduce(
  (sum, d) => sum + Math.min(pref.directors.get(d) ?? 0, 8.0),
  0,
);

// Keywords (already uses log scale, less of an issue but cap anyway):
const MAX_KEYWORD_WEIGHT = 10.0;
const sortedKHits = kHits.map((k) => ({
  keyword: k,
  weight: Math.min(tfidfWeight ?? fallbackWeight, MAX_KEYWORD_WEIGHT),
}));
```

---

## Issue 4 — ~~MEDIUM~~: Genre diversity caps — verify and tighten [NOT CONFIRMED — NO FIX NEEDED]

**Confirm current state** by searching `applyDiversityFilter` call in `enrich.ts`:

```
grep -n "maxSameGenre" src/lib/enrich.ts
```

If it still shows `maxSameGenre: 15`, tighten it:

```typescript
const diversified = applyDiversityFilter(mmrReranked, {
  maxSameDirector: 3, // was 4
  maxSameGenre: 6, // was 15 — 6/36 results = 17% max per genre
  maxSameDecade: 8, // was 10
  maxSameStudio: 4, // was 6
  maxSameActor: 4, // was 6
});
```

Also verify `directorCounts` is populating in the diversity filter output. From the log `directorCounts: []` in all runs — this means `feats.directors` isn't being attached to result objects OR `applyDiversityFilter` isn't reading them. Check the result object `r` in `enrich.ts` to confirm `directors: feats.directors` is present, and then check `applyDiversityFilter` reads `item.directors`.

---

## Issue 5 — ~~MEDIUM~~: Issue 10 — Consensus scoring rewards popularity [✅ PARTIALLY FIXED — consensusBonus 0.5→0.25]

**Note:** Part A (taste context injection into aggregator) and Part B (threading from web page) were not implemented — the deep personalization path (`serverSuggestionsEngine.ts` → `suggestByOverlap`) already handles personal relevance downstream. Only the consensus multiplier rebalancing was applied since the aggregator's taste-awareness is an architectural change that requires A/B testing.

**Location:** `src/lib/recommendationAggregator.ts` — `calculateAggregateScore()`

**The Problem in Detail:**

The current scoring formula for `multiSourceConsensus` is:

```typescript
// Score = (weighted confidence average) + consensusBonus + qualitySourceBonus
// Where:
//   consensusBonus = min(sources.length / ACTIVE_SOURCE_COUNT, 1.0) * 0.5
//   qualitySourceBonus = 0.05 if TasteDive present
```

A film appearing in TMDB + TasteDive + Watchmode scores ~1.3–1.5. A film appearing only in TasteDive (because it's genuinely niche and only that API knows it) scores ~0.9. This means the aggregator systematically ranks mainstream films (which all three generic APIs know) higher than niche films (which only the personalized API finds). Consensus is measuring "how mainstream is this film" not "how well does this match this user."

The fix has two parts: **(A) inject personal taste context** and **(B) rebalance the consensus bonus.**

### Part A — Accept taste signals in `aggregateRecommendations`

**File:** `src/lib/recommendationAggregator.ts`

Add optional taste parameters to the function signature:

```typescript
export async function aggregateRecommendations(params: {
  seedMovies: Array<{ tmdbId: number; title: string; imdbId?: string }>;
  limit?: number;
  sourceReliability?: Map<string, number>;
  deadlineMs?: number;
  // NEW: Personal taste context for relevance boosting
  tasteContext?: {
    topGenreIds: number[]; // User's top genre IDs by weight
    topKeywordNames: string[]; // User's top keyword names (TF-IDF ranked)
    topDirectorNames: string[]; // User's top director names
  };
}): Promise<AggregateRecommendationsResult>;
```

Then in `calculateAggregateScore`, add a personal relevance bonus when taste context is provided:

```typescript
function calculateAggregateScore(
  rec: AggregatedRecommendation,
  sourceReliability?: Map<string, number>,
  tasteContext?: {
    topGenreIds: number[];
    topKeywordNames: string[];
    topDirectorNames: string[];
  },
  tmdbDetailsCache?: Map<number, any>,
): number {
  // ... existing weight/confidence calculation ...

  // NEW: Personal relevance bonus — boosts films that match user taste signals
  let personalRelevanceBonus = 0;

  if (tasteContext && tmdbDetailsCache) {
    const movieDetails = tmdbDetailsCache.get(rec.tmdbId);

    if (movieDetails) {
      // Genre match
      const movieGenreIds = (movieDetails.genres ?? []).map((g: any) => g.id);
      const genreOverlap = movieGenreIds.filter((id: number) =>
        tasteContext.topGenreIds.includes(id),
      ).length;
      personalRelevanceBonus += Math.min(genreOverlap * 0.08, 0.25);

      // Director match (strong signal)
      const directors = (movieDetails.credits?.crew ?? [])
        .filter((c: any) => c.job === "Director")
        .map((c: any) => c.name as string);
      const directorMatch = directors.some((d: string) =>
        tasteContext.topDirectorNames.includes(d),
      );
      if (directorMatch) personalRelevanceBonus += 0.3;

      // Keyword match
      const keywords = [
        ...(movieDetails.keywords?.keywords ?? []).map((k: any) => k.name),
        ...(movieDetails.keywords?.results ?? []).map((k: any) => k.name),
      ];
      const keywordOverlap = keywords.filter((k: string) =>
        tasteContext.topKeywordNames.includes(k),
      ).length;
      personalRelevanceBonus += Math.min(keywordOverlap * 0.05, 0.2);
    }
  }

  // REBALANCED: Reduce consensus bonus so it doesn't override personal fit
  // Old: consensusBonus = min(sources / ACTIVE_SOURCE_COUNT, 1.0) * 0.5
  // New: max 0.25 (was 0.5) — consensus validates but doesn't dominate
  const consensusBonus =
    Math.min(rec.sources.length / ACTIVE_SOURCE_COUNT, 1.0) * 0.25;

  return (
    totalScore / totalWeight +
    consensusBonus +
    qualitySourceBonus +
    personalRelevanceBonus
  );
}
```

### Part B — Thread taste context from the generate route into the aggregator

**File:** `src/app/api/v1/suggestions/generate/route.ts`

The aggregator is no longer called directly from the route (the new engine uses `generateServerCandidates` which calls TMDB similar directly). But `aggregateRecommendations` is still called from the web page via `actions/recommendations.ts`. Update that server action to pass taste context:

**File:** `src/app/actions/recommendations.ts`

```typescript
export async function getAggregatedRecommendations(params: {
  seedMovies: Array<{ tmdbId: number; title: string; imdbId?: string }>;
  limit?: number;
  // NEW: optional taste context
  tasteContext?: {
    topGenreIds: number[];
    topKeywordNames: string[];
    topDirectorNames: string[];
  };
}): Promise<AggregatedRecommendation[]> {
  try {
    const { recommendations } = await aggregateRecommendations({
      ...params,
      tasteContext: params.tasteContext,
    });
    return recommendations;
  } catch (error) {
    console.error("[RecommendationsAction] Failed:", error);
    return [];
  }
}
```

**File:** `src/app/suggest/page.tsx`

Find the `getAggregatedRecommendations` call (inside `generateSmartCandidates` or equivalent). Pass the taste profile:

```typescript
const { getAggregatedRecommendations } =
  await import("@/app/actions/recommendations");

const aggregatedRecs = await getAggregatedRecommendations({
  seedMovies: seedsForAggregator,
  limit: 60,
  tasteContext: {
    topGenreIds: tasteProfile.topGenres.slice(0, 5).map((g) => g.id),
    topKeywordNames: tasteProfile.topKeywords.slice(0, 10).map((k) => k.name),
    topDirectorNames: tasteProfile.topDirectors.slice(0, 5).map((d) => d.name),
  },
});
```

### Part C — Pass taste context from the API route to the aggregator

For the API path, `serverSuggestionsEngine.ts` doesn't call `aggregateRecommendations` directly — it uses direct TMDB similar calls. However, the `sourceMetadata` passed into `suggestByOverlap` from `generateServerCandidates` includes `consensusLevel`, which feeds into `suggestByOverlap`'s source reliability multiplier. This multiplier (line ~7580 in `enrich.ts`) currently boosts high-consensus films by 1.05×.

With the consensus bonus rebalanced, reduce this multiplier accordingly:

```typescript
// In enrich.ts, find the consensusBoost calculation:
const consensusBoost =
  sourceMeta.consensusLevel === "high"
    ? 1.05 // keep — multi-source validated
    : sourceMeta.consensusLevel === "low"
      ? 0.97 // change from 0.97 to 0.99 — single source shouldn't be penalized as much
      : 1.0;
```

---

## Issue 6 — ~~LOW~~: Verify `directorCounts: []` in diversity filter [NOT CONFIRMED — NO FIX NEEDED]

From the Netlify log: `directorCounts: []` in every run. The diversity filter tracks genre counts correctly but not directors.

In `enrich.ts`, confirm the result object includes `directors`:

```typescript
// Search for the result object construction — it should contain:
const r = {
  tmdbId: cid,
  score,
  reasons,
  // ...
  directors: feats.directors, // ← verify this line exists
  // ...
};
```

If it's there, check `applyDiversityFilter` in `enrich.ts`:

```typescript
// Search for applyDiversityFilter implementation
// It should read item.directors to enforce maxSameDirector
// If directorCounts is empty but the field exists, the filter
// may be checking item.director (singular) instead of item.directors (array)
```

Fix the field name mismatch if found.

---

## Build & Deploy

- Push to git → Netlify auto-deploys
- Taste profile cache TTL is 24h — after deploying Issue 3's weight cap, the cached profiles will be stale until they expire. To force immediate recomputation, either: (a) wait 24h, (b) add a cache-busting version field to the cache key, or (c) temporarily lower `TASTE_CACHE_TTL_MS` to 1h for one deploy cycle

## Do NOT Change

- `getPreferenceWeight` — already correctly updated
- Quality multiplier — already correctly updated to niche-only bonus
- Base score floor — already removed
- `loadCachedTmdbDetails` batch pre-load — working correctly
- Context reasons deferral — working correctly
- The `suggestByOverlap` core scoring weights — correct
