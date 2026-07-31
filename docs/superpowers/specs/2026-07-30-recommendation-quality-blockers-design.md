# Recommendation Quality Blockers Design

**Status:** Approved
**Date:** 2026-07-30
**Program impact:** Phase 2 blocker correction; checkpoint 2A.3 remains next after this bounded fix

## Problem

The production suggestions page can return generic, era-concentrated, or underfilled results for three correctness reasons that must not be masked by Phase 3 tuning:

1. The web canonical scorer omits personalization inputs that the v1 scorer receives.
2. Candidate metadata requests have per-call timeouts but no request-wide deadline or minimum healthy-pool contract; failures silently remove candidates.
3. Restored suggestion state is stored under global browser keys and can cross authenticated-user boundaries.

The browser log from the reported run proves that 70 recommendation posters hydrated, but it does not contain enough server diagnostics to assign exact causality among filtering, metadata loss, and candidate composition.

## Goals

- Give web and v1 scoring the same normalized personalization inputs.
- Bound metadata completion wall-clock work and reject materially degraded candidate pools instead of ranking them silently.
- Prevent restored recommendations and related suggestion-session state from crossing user boundaries.
- Preserve current API shapes except for an explicit retryable error when metadata health is insufficient.
- Add regression tests before implementation and avoid recommendation-weight changes.

## Non-Goals

- Tune recommendation weights, thresholds, exploration, or diversity targets.
- Implement Phase 2 diagnostics or the offline evaluation corpus early.
- Redesign suggestion-page presentation.
- Migrate unowned legacy browser-storage values.

## Design

### Shared Personalization Inputs

Add one pure server-side builder that converts the loaded user context and taste profile into the overlap scorer's normalized inputs:

- enhanced profile, including positive and negative features, preferred subgenres, decades, adjacent genres, and watchlist features;
- feature feedback;
- watchlist entries;
- recent exposures;
- MMR lambda derived from the user's bounded exploration rate.

Both the v1 route and the web canonical action will consume this builder. The canonical overlap-scoring adapter will accept these inputs explicitly and forward them to `suggestByOverlap` together with source metadata. This keeps one scoring implementation while preventing either adapter from silently dropping personalization fields.

Tests will compare the normalized scorer inputs produced for equivalent web and v1 context and prove that representative enhanced-profile, negative-feedback, watchlist, exposure, source, and MMR fields reach the overlap scorer.

### Bounded Metadata Completion

Metadata completion will use a request-wide deadline in addition to the existing per-request timeout and concurrency limit. It will return structured completion health containing the completed map, requested count, completed count, failed count, and whether the deadline expired. Queued work will stop starting after the deadline; already-started requests remain protected by their individual timeout.

For a scoring window of `candidateCount` and requested output `resultCount`, partial success is healthy only when the completed pool contains at least:

```text
min(candidateCount, max(resultCount, ceil(candidateCount * 0.60)))
```

This requires enough candidates to satisfy the request and at least 60% coverage when the retrieval pool provides headroom. If retrieval itself yields fewer candidates than requested, metadata completion must preserve all available candidates; later count-fulfillment diagnostics remain Phase 2 work.

The production web action will apply a 20-second metadata deadline to the scoring window. If completion health is below the threshold, it will fail with a retryable upstream-unavailable error instead of scoring a materially biased partial pool. Healthy partial completion remains allowed. Cache writes stay best-effort and do not determine request health.

Taste-profile metadata completion will also be bounded so an unbounded history cannot recreate the timeout before candidate retrieval. Relevant taste IDs will be deterministically ordered by the existing seed recency/strength comparator and capped at 300 before cache loading or completion. This changes only metadata cost; all film/event rows remain available to profile construction.

Tests will use controlled promises and fake time to prove concurrency remains bounded, queued work stops at the deadline, healthy partial results are accepted, unhealthy partial results are rejected, and a large slow window cannot wait through every per-item timeout.

### Authenticated Browser Storage

Suggestion browser-storage keys will include the authenticated Supabase user ID. The page will not restore or persist user-owned state until the current UID is known. It will clear in-memory restored state when authentication changes and then load only the new user's namespace.

The following state is user-owned and will be namespaced consistently:

- restored recommendation items;
- shown recommendation IDs;
- pairwise comparison history;
- pairwise prompt count.

Legacy global keys will be ignored rather than migrated because ownership cannot be established safely. Existing data naturally expires or may be removed opportunistically without being displayed.

The storage key construction and payload validation will live in a small pure module so unit tests can prove user-A/user-B isolation, logout behavior, malformed payload rejection, and legacy-key rejection. The Playwright recommendation-page fixture will seed the authenticated user's key instead of the legacy global key.

## Error Handling

- Authentication and degraded recommendation-input failures retain their current behavior.
- Insufficient metadata health produces one stable retryable error safe for the page to display; individual candidate IDs and private profile data are not exposed.
- Individual TMDB failures remain logged server-side with bounded counts. They no longer disappear without affecting an explicit health decision.
- Browser-storage parse failures remain non-fatal and cannot load data from another namespace.

## Verification

The change follows red-green TDD:

1. Focused unit/integration tests fail for missing scorer inputs, absent request-wide metadata health, and global storage ownership.
2. Implement the smallest production changes to pass those tests.
3. Run focused recommendation suites, lint, typecheck, full Vitest, build, and `git diff --check`.
4. Run authenticated Playwright recommendation-page tests with credentials supplied only through process environment variables.
5. Exercise one authenticated suggestions generation and record output count, elapsed time, and visible errors without recording credentials or private recommendation history in documentation.
6. Run an independent bounded code review and resolve critical or important findings.

## Tracker And Delivery

Record this work as a reopened production suggestion blocker under Phase 2 without changing the ordered checkpoint state: 2A.3 remains `Ready`. Commit the approved specification separately, then commit tests, implementation, and tracker evidence as one coherent blocker fix. Do not include unrelated dirty-worktree files.
