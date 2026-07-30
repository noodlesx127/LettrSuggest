# Suggestion Generation Timeout Hotfix Design

**Date:** 2026-07-30
**Status:** Approved
**Incident:** `Logs/console-export-2026-7-29_23-24-9.log`
**Affected pages:** `/suggest`, `/genre-suggest`

## Goal

Prevent fresh-import recommendation requests from exhausting the Netlify request window while preserving canonical ordering, strict genre eligibility, deterministic behavior, and the existing web response shape.

The hotfix covers the shared server recommendation path and the additional client presentation work performed by `/suggest`. It does not implement checkpoint 2A.3 snapshot reconciliation; that checkpoint resumes after this production blocker is closed.

## Incident Evidence

- Two `/suggest` Server Action requests failed after approximately 30 seconds with HTTP 502/500.
- Browser Supabase requests failed concurrently with 521 responses and missing CORS headers.
- Supabase API logs showed a burst of successful Node-origin, one-ID `tmdb_movies` reads rather than database-wide downtime.
- `scoreRecommendationsWithOverlap` calls `suggestByOverlap` without its existing `tmdbDetailsCache` seam. `suggestByOverlap` may perform one cache/API lookup for each of up to 1,200 candidates.
- Candidate details fetched through `/api/tmdb/movie` are not persisted, so final result hydration can fetch selected movies again.
- `/suggest` concurrently builds a separate client taste profile and waits for its watchlist hydration before displaying canonical results.
- `/genre-suggest` does not build the client taste profile, but it uses the same server action and eagerly completes every generated candidate before strict genre filtering.
- Both pages read `canonical.items` without validating the Server Action result, producing the observed secondary `undefined.items` error after transport failure.

## Decisions

1. Keep one canonical server recommendation entry for both web pages. Do not add a fallback or third recommendation engine.
2. Batch, deduplicate, and reuse candidate metadata within one web recommendation request.
3. Bound the web scoring metadata window to `min(uniqueCandidateCount, max(requestedCount * 3, 100), 300)`. A request for 100 results therefore scores at most 300 candidates instead of 1,200.
4. Preserve candidate order when applying the window. The limit is deterministic and occurs before metadata loading, scoring, and genre filtering.
5. Load cached metadata for the bounded window in existing 200-ID Supabase batches, complete missing details through the existing concurrency-five server helper, and persist successful completions to `tmdb_movies`.
6. Pass the completed request-scoped metadata map into overlap scoring. Scoring must not issue one-ID cache/API lookups for candidates outside or missing from that map.
7. Reuse the same metadata map for final web adaptation. Final hydration may query or fetch only final IDs not already complete in the request map.
8. Strict genre filtering applies to the same bounded, completed candidate window. It must never fail open. Niche and mixed-genre presentation behavior remains unchanged.
9. Add a five-second timeout to individual server TMDB HTTP requests. A timed-out movie is omitted through the existing partial-metadata behavior; one provider call cannot occupy the full Netlify request window.
10. `/suggest` starts presentation-only mapping, watchlist, and taste-profile hydration after canonical generation settles. Canonical items render without awaiting presentation hydration.
11. `/suggest` deduplicates presentation metadata IDs and caps them at 300 in source-film order. Presentation failures do not discard canonical items.
12. Both pages reject a missing or malformed canonical payload with `Recommendation service returned an invalid response`. They must not dereference `undefined.items` or silently convert a transport failure into a legitimate empty result.
13. `/genre-suggest` retains manual generation. `/suggest` retains automatic generation and existing sectioning, filters, watchlist picks, and palate-cleansers.

## Server Data Flow

```text
canonical web request
  -> load user context and taste profile
  -> retrieve ordered candidate IDs
  -> deduplicate and take deterministic scoring window (100-300 IDs)
  -> batch-read tmdb_movies once
  -> complete missing details with concurrency 5 and 5s per-request timeout
  -> strict genre filter, when requested
  -> score with the completed request metadata map
  -> canonical rerank/backfill within eligible scored candidates
  -> hydrate only unresolved final IDs
  -> adapt to the existing { items, diagnostics } web result
```

The bounded window may produce fewer than the requested count when metadata is unavailable or strict filters leave too few eligible candidates. That is preferable to timing out, and it is reported through the existing empty/shortage behavior rather than by relaxing eligibility.

## Client Data Flow

### `/suggest`

1. Resolve authentication and authoritative film availability as today.
2. Run canonical generation.
3. Validate the returned payload.
4. Render canonical items immediately after current presentation filters.
5. Start or continue bounded presentation hydration for headers and watchlist badges.
6. Update presentation-only state when hydration completes; failure leaves canonical items intact.

### `/genre-suggest`

1. Resolve authentication and selected genres as today.
2. Run canonical generation with strict genre names.
3. Validate the returned payload.
4. Partition the returned items into existing genre and subgenre sections.

## Error Handling

- Server TMDB timeouts and individual metadata failures remain partial failures handled with `Promise.allSettled`; failed IDs are omitted.
- A malformed canonical engine result fails before final metadata hydration.
- A malformed Server Action payload produces the same controlled page error on both web pages.
- Presentation hydration logs a prefixed error and degrades headers/badges only.
- No raw film lists, tokens, provider keys, or unbounded candidate payloads are added to logs.

## Test Design

### RED contracts

- `ensureCompleteTmdbDetails` fetches and upserts each unique missing ID once and never exceeds concurrency five.
- Web generation preserves candidate order while limiting its metadata/scoring window to 300 for a 100-result request.
- The completed request-scoped metadata map reaches overlap scoring and is reused for final hydration.
- Strict genre generation filters only against completed details in the same bounded window and does not hydrate an unbounded candidate list.
- A missing canonical engine result fails with an explicit invariant error before metadata hydration.
- A shared canonical response validator rejects `undefined`, non-object payloads, and non-array `items`.
- Both page sources use the shared validator; `/suggest` no longer awaits presentation hydration before setting canonical items.
- Server TMDB HTTP requests abort after five seconds.

### Verification

Run the smallest relevant Vitest files first, then:

```powershell
rtk npm run lint
rtk npm run typecheck
rtk npm run test
rtk npm run build
rtk npx playwright test tests/recommendation-pages.spec.ts
```

The authenticated Playwright slice may be reported as skipped only when required credentials are unavailable. A production deployment and live fresh-import validation are separate rollout steps and require explicit deployment authorization.

## Scope Boundaries

- Do not alter recommendation weights, MMR semantics, source quotas, cache revisions, vector capability, or v1 response contracts.
- Do not reconcile import snapshots or change database schema in this hotfix.
- Do not make presentation hydration authoritative for recommendation eligibility.
- Do not include unrelated worktree changes in the hotfix commits.

## Follow-Up

After verification, resume checkpoint 2A.3 and add a fresh import-to-suggestions regression to its acceptance evidence. Atomic reconciliation must prevent false import success, remove stale rows, and invalidate recommendation revisions independently of this timeout hotfix.
