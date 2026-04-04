# BACKEND BUGFIX SUMMARY

This document summarizes fixes applied during the backend shakedown session.

## Bug 1 — CRITICAL: Watchmode recommendations always excluded (FIXED)

- Root cause: Hard filter removed all Watchmode recs because the trending pool never overlaps with seed-based TMDB/TasteDive pools
- Fix: `src/lib/recommendationAggregator.ts` — removed hard filter; replaced with soft deprioritization via lowered confidence scores. Watchmode confidence changed from fixed 0.6 to dynamic `Math.min(0.35 + popularity_score * 0.05, 0.50)` (default 0.35).
- Fix: `src/lib/watchmode.ts` — added `popularity_score?: number` to `WatchmodeTitle` interface

## Bug 2 — HIGH: tuimdb_uid_cache table name (NOT A BUG)

- Intentional — TuiMDB is a separate service from TMDB; naming is correct

## Bug 3 — HIGH: tmdb_similar_cache TTL too short (FIXED)

- Root cause: `TMDB_SIMILAR_CACHE_TTL_DAYS = 7` caused all 103 rows to expire
- Fix: `src/lib/apiCache.ts` — increased to 30 days; exported all TTL constants
- Fix: `src/app/api/v1/_lib/adminCache.ts` — replaced hardcoded 7-day cutoff with per-table TTL map (`CACHE_TABLE_TTL_MS: Record<ClearableCacheTable, number>`)

## Bug 4 — MEDIUM: Exploration stats inflation (FIXED)

- Root cause: Bulk seed + incremental double-counting; no upper-bound validation; guard condition `=== 0` conflated "never seeded" with "zero exploratory films"
- Fix: `src/lib/enrich.ts` — guard changed to `!currentStats` (only seed when no row exists)
- Fix: `src/app/api/v1/stats/route.ts` — defensive cap `Math.min(exploratory_films_rated, total_rated)`
- Fix: `supabase/migrations/20260403000000_fix_exploration_stats_constraint.sql` — CTE-based cleanup migration

## Bug 5 — MEDIUM: TasteDive/Watchmode cache dead code + RLS (FIXED)

- Root cause: Cache functions existed in `apiCache.ts` but were never imported/called; RLS only allowed service_role writes but code used anon client
- Fix: `src/lib/apiCache.ts` — switched TasteDive and Watchmode cache functions to use `getSupabaseAdmin()`
- Fix: `src/lib/tastedive.ts` — wired cache-first pattern into `getSimilarContent()`
- Fix: `src/lib/watchmode.ts` — wired cache-first pattern into `getTrendingTitles()`, `getStreamingSources()`, `getStreamingSourcesByTMDB()`. Added key-space collision guard for negative-integer synthetic keys.

## Bug 6 — LOW: Duplicate film entries (NOT A BUG)

- PK `(user_id, uri)` + upsert with `onConflict` already prevents duplicates at DB level

## Bug 7 — LOW: Liked suggestions missing year (FIXED)

- Root cause: TMDB 404s, missing `release_date`, no fallback from request body, no backfill on "already exists" path
- Fix: `src/app/api/v1/suggestions/liked/route.ts` — added `body.year` as fallback, added `parseOptionalYear()` helper
- Fix: `supabase/migrations/20260403100000_backfill_liked_suggestion_metadata.sql` — recreated `add_liked_suggestion` RPC to backfill null `year` and `poster_path` on "already exists" path

---

## API Refactor — Deep Personalization Engine (2026-04-03)

Replaced the generic `aggregateRecommendations` flow in `POST /api/v1/suggestions/generate` with the same personalized engine used by the web suggest page.

### Changes

- **`supabase/migrations/20260403110000_user_taste_profile_cache.sql`** — New `user_taste_profile_cache` table with RLS. Caches computed taste profiles for 24h, invalidated when film count changes.
- **`src/lib/serverSuggestionsEngine.ts`** — New server-side data loading module:
  - `loadUserContext(userId)` — loads all user tables in parallel via `supabaseAdmin` with explicit user scoping
  - `buildTasteProfileServer(userId, userContext)` — builds/caches taste profiles server-side, passes `tmdbDetails` to avoid internal route fetches
  - `generateServerCandidates(userId, userContext, tasteProfile, seedTmdbIds?)` — replaces `generateSmartCandidates` with direct TMDB API calls (no internal route fetches)
  - `buildFeatureFeedbackFromRows(rows)` — mirrors `getAvoidedFeatures()` shape
  - `buildAdjacentGenreMap(rows)` — builds `Map<string, Array<{genre, weight}>>` for `enhancedProfile.adjacentGenres`
- **`src/app/api/v1/suggestions/generate/route.ts`** — Replaced `aggregateRecommendations` with the new personalization engine; `seed_tmdb_ids` made optional and used as bias signals; response now includes `reasons`, `genres`, `year`, `poster_path`, `vote_category`.
- **`F:\Code\lettrsuggest-mcp\src\index.ts`** — Updated to display enriched suggestion fields (year, genres, top reason, formatted score). Bumped to v1.3.0.

### Key Fixes Applied During Review Loop

- `mappings` converted to `Map<string, number>` (not array) for `suggestByOverlap`
- `adjacentGenres` placed inside `enhancedProfile` (not top-level)
- Correct table/column: `suggestion_exposure_log` / `exposed_at`
- `localHour` set to `null` (not server time) in API context
- `explorationRate` guarded against `NaN`
- TMDB queries batched in 200-item chunks to avoid URL length limits

---

Notes:

- All fixes were applied to the codebase and corresponding migrations were added to the `supabase/migrations/` folder where applicable.
