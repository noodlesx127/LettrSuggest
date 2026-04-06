# RLS Cache Write Fix — 2026-04-05

## What Was Fixed

A Supabase RLS violation caused every TMDB movie cache write during Letterboxd import enrichment to fail silently with error code `42501` (HTTP 403). This affected ALL users doing imports.

**Root Cause**: A previous migration (`20260405130000_fix_security_advisors.sql`) tightened RLS policies on shared cache tables (`tmdb_movies`, `tmdb_similar_cache`) to `service_role`-only for INSERT/UPDATE. However, the application code was making these writes from client-side components using the anon key Supabase client, which no longer had write permission.

**Impact**: All `upsertTmdbCache` calls during import enrichment failed silently. Movies were fetched from TMDB but never cached, causing repeated fresh API calls on every subsequent page load.

## Fix Applied

Created server actions in `src/app/actions/enrichment.ts` using `getSupabaseAdmin()` (service role client) to bypass RLS for legitimate cache writes:

- `upsertTmdbCacheAction(movie)` - caches a single TMDB movie
- `refreshTmdbCacheForIdsAction(ids)` - batch refreshes TMDB cache for multiple IDs
- `setCachedTMDBSimilarAction(tmdbId, similarIds, recIds)` - caches similar movie relationships

## Files Changed

| File                                   | Change                                                                |
| -------------------------------------- | --------------------------------------------------------------------- |
| `src/app/actions/enrichment.ts`        | Added 3 new server actions using admin client                         |
| `src/lib/importEnrich.ts`              | Uses `upsertTmdbCacheAction` instead of client-side write             |
| `src/app/library/page.tsx`             | Uses `upsertTmdbCacheAction` instead of client-side write             |
| `src/components/UnmappedFilmModal.tsx` | Uses `upsertTmdbCacheAction` instead of client-side write             |
| `src/lib/trending.ts`                  | Uses `setCachedTMDBSimilarAction` instead of client-side write        |
| `src/app/suggest/page.tsx`             | Uses `refreshTmdbCacheForIdsAction` instead of client-side write      |
| `src/app/genre-suggest/page.tsx`       | Uses `refreshTmdbCacheForIdsAction` instead of client-side write      |
| `src/app/api/tmdb/refresh/route.ts`    | Direct admin upsert instead of anon client                            |
| `src/lib/apiCache.ts`                  | Removed dead `setCachedTMDBSimilar` function                          |
| `src/lib/enrich.ts`                    | Removed dead `upsertTmdbCache` and `refreshTmdbCacheForIds` functions |
| `src/app/import/page.tsx`              | Removed unused `upsertTmdbCache` import                               |

## Pattern Going Forward

All writes to shared cache tables (`tmdb_movies`, `tmdb_similar_cache`, `tmdb_trending`, etc.) must use the service role client via `getSupabaseAdmin()`. These operations must happen in:

- Server Actions (`src/app/actions/`)
- API Routes (`src/app/api/`)
- Server Components

Never use the anon key Supabase client (`src/lib/supabaseClient.ts`) for writes to these tables.
