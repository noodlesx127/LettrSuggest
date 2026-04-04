# Suggestion Quality Bug Fix Session — 2026-04-04

## Overview

This session addressed 9 of 11 issues from `HANDOFF_SUGGESTION_QUALITY.md`. Two were skipped (already fixed), two were deferred, and one requires an offline data backfill.

---

## Issues Fixed

### Issue 1 — Context reasons pushed too early (CRITICAL)

**File:** `src/lib/enrich.ts`

Context-bias reasons (e.g., "Good for late-night watching") were being inserted _before_ all personalization signals, making them appear first in the reasons list shown to users.

**Fix:** Replaced the early `reasons.push(...contextBias.reasons)` with a deferred capture (`const deferredContextReasons = contextBias.reasons;`) and pushed them just before the result object is built. Context reasons now always appear last.

---

### Issue 2 — Score/rank display mismatch in MCP (HIGH)

**File:** `lettrsuggest-mcp/src/index.ts`

The per-movie line showed `score:` which implied a raw TMDB vote, but the value is actually a weighted aggregate that includes diversity re-ranking.

**Fix:**

- `score:` → `relevance:` in the per-movie output
- Added `· diversity-ranked` to the strategy header line

---

### Issue 3 — Genre filter not wired end-to-end (HIGH)

**Files:** `src/lib/genreEnhancement.ts`, `src/app/api/v1/suggestions/generate/route.ts`, `lettrsuggest-mcp/src/index.ts`

The `genre_filter` MCP parameter was displayed in output but never sent to the backend API. No genre filtering was applied.

**Fix (3 files):**

- `genreEnhancement.ts`: Added `TMDB_GENRE_NAME_TO_ID` (reverse map, lowercase keys) and `GENRE_ALIASES` (sci-fi, romcom, etc.)
- `route.ts`: Added `genre_ids?: number[]` to request body, validation via `parsePositiveIntegerArray`, and a pre-slice post-filter against `TMDB_GENRE_MAP`. Includes a graceful fallback (unfiltered) if genre filter would remove all results.
- `mcp/index.ts`: Added `TMDB_GENRE_IDS` static map with aliases, now sends `genre_ids` in the POST body when a recognized genre is provided. Shows "Genre filter: X applied" vs "unrecognised — no filter applied" in output.

---

### Issue 4 — Null-year seed query (MEDIUM)

**File:** `lettrsuggest-mcp/src/index.ts`

Three locations constructed search queries as `` `${film.title} ${film.year}` `` without guarding for null/undefined year, producing searches like `"Inception null"`.

**Fix (3 locations):**

- Query string: `film.year ? \`${film.title} ${film.year}\` : film.title`
- `filmYear` variable: `film.year ? String(film.year) : null`
- `.find()` comparison: Added `filmYear != null &&` guard so null-year falls through to title-only match

---

### Issue 8 — Watchmode calls trending instead of similar titles (HIGH)

**Files:** `src/lib/watchmode.ts`, `src/lib/recommendationAggregator.ts`

The Watchmode source only used `getTrendingTitles()`, which returns generic trending content — not personalized to the user's taste.

**Fix:**

- `watchmode.ts`: Extended `getTitleDetails(watchmodeId, options?)` to support `appendSimilarTitles?: boolean`, building `append_to_response` as an array and joining with comma.
- `recommendationAggregator.ts`:
  - Added `"watchmode-similar"` to `RecommendationSource` union and `baseWeights: 1.0`
  - New `fetchWatchmodeSimilar(seedMovies)` function: processes top 3 seeds with pLimit(2) outer and pLimit(2) inner concurrency. Per seed: searches Watchmode by TMDB ID → fetches details with `appendSimilarTitles` → resolves up to 8 similar Watchmode IDs to TMDB IDs.
  - Results deduplicated and seed movies excluded from output.
  - `withDeadline` call updated: uses `.then(results => results.length > 0 ? results : fetchWatchmodeTrending())` — falls back to trending when no similar titles are found.

---

### Issue 9 — Personalization stack not wired (HIGH)

**File:** `src/app/api/v1/suggestions/generate/route.ts`

`applyAdvancedFiltering` and `applyNegativeFiltering` from `advancedFiltering.ts` existed but were never called in the API route. The route's `enhancedProfile` was incompatible with `EnhancedTasteProfile` (missing required Set/Map fields).

**Fix:**

- Added new helper `buildMinimalEnhancedTasteProfile(params)` that creates a fully-typed `EnhancedTasteProfile` adapter:
  - Populates `avoidedGenres` and `avoidedKeywords` as `Set<string>` from `tasteProfile.avoidGenres` / `avoidKeywords`
  - Provides `avoidedGenreCombos: new Set<string>()`, `subgenrePatterns: new Map()`, `crossGenrePatterns: new Map()` as safe empty defaults
  - All 22 required fields provided — TypeScript strict-mode verified
- Added `buildFilteringCandidate(item, tmdbDetailsCache)` — cache-first TMDBMovie builder from scored items
- Pipeline after `genreFiltered`: runs `applyNegativeFiltering` then `applyAdvancedFiltering` per candidate. Items failing either filter are excluded.
- `personalizationFiltered.slice(0, body.limit)` used for final output.

---

## Issues Skipped / Deferred

| Issue                                         | Reason                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **5** — Base score floor                      | Already removed in prior code                                                             |
| **6** — Vector similarity dead                | Code is correct; needs data backfill: `npx tsx scripts/generate-embeddings.ts`            |
| **7** — Trakt 0 results                       | Trakt fully removed in commits `8231371`, `15ec2ee`, `e552087`                            |
| **10** — Consensus scoring rewards popularity | Deferred — architectural change requiring broader refactor                                |
| **11** — Deterministic seeds                  | Already implemented (Fisher-Yates shuffle on top-30 pool in `serverSuggestionsEngine.ts`) |

---

## MCP Version Bump

`lettrsuggest-mcp`: `1.2.2` → `1.3.0`

Changes in this version:

- Genre filter wired end-to-end (Issue 3)
- Display labels improved: `relevance:` and `diversity-ranked` (Issue 2)
- Null-year seed query fixes (Issue 4)
