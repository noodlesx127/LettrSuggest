# Phase 2: Integrity, Observability, and Evaluation

**Phase state:** In progress  
**Entry condition:** Phase 1 complete  
**Exit condition:** Import inputs are user-safe and atomic, request/exposure diagnostics explain output, and offline/online evaluation gates are operational.

## Task 5: Production Suggestion Timeout And Quality Blocker Closure

**Task state:** Complete  
**Checkpoint impact:** None; 2A.3 remains `Ready` and is the next ordered checkpoint after this correction.

- [x] Land the original deterministic/deduped 300-entry metadata window and per-request five-second timeout.
- [x] Restore web/v1 personalization-input parity through one shared normalized builder and scorer seam.
- [x] Add a 20-second request-wide metadata deadline and reject unhealthy partial scoring pools.
- [x] Scope restored suggestion, exposure-suppression, and pairwise state to the authenticated user.
- [x] Record focused, full-gate, authenticated Playwright, live generation, review, and change-impact evidence.

**Verification:** 2026-07-31 - Focused recommendation suites PASS, 122/122 across 6 files; full Vitest PASS, 344/344 across 26 files; lint, typecheck, production build, formatting, and `git diff --check` PASS. The build retained the existing non-fatal dynamic-route and stale browser-data warnings. Authenticated recommendation-page Playwright PASS, 2/2. An authenticated canonical generation completed in 12.821 seconds with 74 stored outputs, 74 year-bearing outputs across 9 decades, no retryable metadata-health error, and visible multi-era coverage. Independent final review APPROVED after transport-safe retry results, post-retrieval metadata budgeting, and UID-plus-auth-epoch async guards closed all Critical/High/Medium findings. Codebase Memory depth-3 impact analysis from `c1af1cd` found no unexpected external runtime dependency; the broad affected graph remained inside the recommendation/suggestion subsystem, including expected scoring, metadata, feedback, pairwise, exposure, and presentation paths.

**Next action:** Resume 2A.3 Atomic Snapshot Reconciliation.

**TDD evidence:**

- 2026-07-30 - Original Task 4 RED: `rtk npm run test -- tests/unit/suggestionStorage.test.ts` - failed because `@/lib/suggestionStorage` did not exist.
- 2026-07-30 - Original Task 2 RED: `rtk npm run test -- tests/unit/recommendationPersonalization.test.ts tests/unit/recommendationScoring.test.ts` - both suites failed because `src/lib/recommendationPersonalization.ts` and `src/lib/recommendationScoring.ts` did not yet exist.
- 2026-07-30 - Account-transition reset RED: `rtk npm run test -- tests/integration/recommendationAdapters.test.ts` - 1/15 tests failed because the synchronous user-scoped account-transition reset contract was missing.
- 2026-07-30 - Adapter-parity RED: `rtk npm run test -- tests/integration/recommendationAdapters.test.ts -t "keeps normalized web and v1 scorer inputs in parity"` - the new test failed because `buildRecommendationScoringInputs` was not yet available.
- 2026-07-30 - Task 3 RED: `rtk npm run test -- tests/unit/serverTmdbDetails.test.ts` - 6/6 failed because structured completion/helpers/options/taste cap were absent.
- 2026-07-30 - Metadata deadline liveness RED: `rtk npm run test -- tests/unit/serverTmdbDetails.test.ts tests/integration/webRecommendationGenreDetails.test.ts` - 2/16 failed because cache upsert was awaited and queue claims relied only on timer state.
- 2026-07-31 - Final-review correction RED: focused action/deadline/account-transition tests failed 3/27 because metadata failures crossed the Server Action boundary as thrown errors, candidate retrieval consumed the metadata budget, and interactive operations lacked post-await identity guards.
- 2026-07-31 - Auth-epoch RED: `rtk npm run test -- tests/integration/recommendationAdapters.test.ts` - 2/16 failed because UID-only guards could accept stale work after an A-to-B-to-A transition.

## Checkpoint 2A.1: Per-User Local Import State

**Checkpoint state:** Complete

**Files:**
- Create: `src/lib/importStorage.ts`
- Create: `tests/unit/importStorage.test.ts`
- Modify: `src/lib/importStore.tsx`
- Modify: `src/lib/db.ts`

- [x] Write tests for anonymous-to-user, user-A-to-user-B, logout, remount, and stale-local-versus-cloud transitions. Assert keys include authenticated user ID and one user never receives another user's collection.
- [x] Run tests; expect failure because `lettr-import-v1` is global and state loads only on mount.
- [x] Implement a storage adapter with explicit anonymous/user namespaces and auth-transition reload/clear behavior. Treat authenticated cloud state as authoritative; do not select by row count.
- [x] Run tests and typecheck; expect pass.
- [x] Commit with `rtk git commit -m "fix: isolate import state by authenticated user"`.

## Checkpoint 2A.2: Import Normalization

**Checkpoint state:** Complete

**Files:**
- Create: `tests/unit/importNormalization.test.ts`
- Create: `supabase/migrations/20260730020406_add_watchlist_added_at_to_film_events.sql`
- Modify: `src/lib/normalize.ts`
- Modify: `src/lib/diary.ts`
- Modify: `src/app/import/page.tsx`
- Modify: `src/lib/enrich.ts`

- [x] Write fixtures asserting blank/whitespace year becomes `null`, valid year remains numeric, `watchlist_added_at` round-trips, and duplicate diary/review events collapse under the persisted identity.
- [x] Run tests; expect failure because blank year becomes zero and watchlist time is not retained end-to-end.
- [x] Implement explicit nullable year parsing, timestamp propagation, and deterministic watch-event identity matching the database uniqueness contract.
- [x] Run tests and typecheck; expect pass.
- [x] Commit with `rtk git commit -m "fix: normalize imported film events consistently"`.

## Checkpoint 2A.3: Atomic Snapshot Reconciliation

**Checkpoint state:** Ready

**Files:**
- Create: `src/lib/importSnapshot.ts`
- Create: `tests/integration/importIntegrity.test.ts`
- Create: `supabase/migrations/20260722120000_reconcile_import_snapshot.sql`
- Modify: `src/app/import/page.tsx`
- Modify: `src/lib/recommendationRevision.ts`

- [ ] Write integration tests for replacing a prior full snapshot, removing/deactivating absent rows, preserving valid mappings/events, rolling back on a mapping/persistence failure, and returning failure instead of success. Assert successful reconciliation changes the recommendation input revision.
- [ ] Run tests; expect failure because current upserts leave stale rows and errors are swallowed.
- [ ] Implement one authenticated transactional RPC accepting a snapshot/import ID or equivalent staging contract. Validate ownership, reconcile all user-scoped rows, and return structured counts/errors.
- [ ] Extract page persistence into `importSnapshot.ts`; set UI success only after reconciliation and required post-import work succeed. Surface retryable failures without discarding local input.
- [ ] Run integration, database, typecheck, and import UI tests; expect pass.
- [ ] Commit with `rtk git commit -m "fix: reconcile imports as atomic snapshots"`.

## Checkpoint 2B.1: Bounded Request Diagnostics

**Files:**
- Create: `src/lib/recommendationTelemetry.ts`
- Create: `tests/unit/recommendationTelemetry.test.ts`
- Modify: `src/lib/recommendationEngine.ts`
- Modify: `src/lib/recommendationTypes.ts`
- Modify: `src/app/api/v1/suggestions/generate/route.ts`

- [ ] Write tests for stage input/output counts, source shares, health/mode, relaxations, drop-reason counts, engine version, experiment bucket, input revision, and request seed. Assert serialized diagnostics contain no raw film lists, feedback text, JWTs, provider keys, or unbounded candidate arrays.
- [ ] Run tests; expect failure before bounded trace construction exists.
- [ ] Implement an allowlisted trace builder and emit the same canonical diagnostic structure through v1 and web adapters. Cap map cardinality and reason values.
- [ ] Run tests, adapter parity, and API diagnostics tests; expect pass.
- [ ] Commit with `rtk git commit -m "feat: add bounded recommendation diagnostics"`.

## Checkpoint 2B.2: Exposure Schema and Diagnostics Integration

**Files:**
- Create: `supabase/migrations/20260723120000_version_recommendation_exposure.sql`
- Create: `tests/integration/recommendationExposure.test.ts`
- Modify: `src/lib/recommendationTelemetry.ts`
- Modify: `src/lib/enrich.ts`
- Modify: `src/app/suggest/page.tsx`
- Modify: `src/app/api/v1/admin/diagnostics/route.ts`

- [ ] Write tests asserting persisted exposures include engine version, experiment bucket, input revision, pre/post rank, bounded drop reasons, and source-family share, while preserving user ownership and retention limits.
- [ ] Run tests; expect failure against the existing exposure shape.
- [ ] Add only required columns/indexes and retention support. Route exposure writes through the telemetry sink after final output so both adapters use one schema.
- [ ] Extend admin diagnostics with aggregates, never raw private histories.
- [ ] Run integration/database/API tests and advisors; expect pass.
- [ ] Commit with `rtk git commit -m "feat: version recommendation exposure telemetry"`.

## Checkpoint 2C.1: Offline Quality and Parity Evaluation

**Files:**
- Create: `tests/fixtures/recommendations/evaluationCorpus.ts`
- Create: `tests/integration/recommendationEvaluation.test.ts`
- Create: `scripts/evaluate-recommendations.ts`
- Modify: `package.json`
- Replace or retire: `scripts/verify_algo.ts`
- Replace or retire: `scripts/counterfactual_replay.ts`

- [ ] Define a versioned corpus covering sparse history, broad history, strong negatives, explicit seeds, strict genres, provider duplication, degraded inputs, and large requested counts. Each case includes accepted ordered IDs or invariant thresholds.
- [ ] Write assertions for deterministic repeats, seed/exclusion violations, count fulfillment, source concentration, diversity, popularity concentration, rank churn, attribution, and web/v1 parity.
- [ ] Run the evaluation; expect at least one failure until all real engine dependencies use the canonical deterministic seams.
- [ ] Fix only wiring defects exposed by the corpus; do not tune quality weights. Make the script exit nonzero on threshold failure and output bounded JSON/Markdown results.
- [ ] Run `rtk npm run test` and the evaluation script; expect pass.
- [ ] Commit with `rtk git commit -m "test: add recommendation quality evaluation"`.

## Checkpoint 2C.2: Online Measurement Readiness

**Files:**
- Create: `tests/integration/recommendationExperiment.test.ts`
- Modify: `src/lib/abTesting.ts`
- Modify: `src/lib/recommendationTelemetry.ts`
- Create: `docs/summary/recommendation-baseline.md`

- [ ] Write tests asserting stable user/request bucket assignment, engine/config version capture, exposure-to-feedback joins, and exclusion of users without valid assignment from experiment comparisons.
- [ ] Run tests; expect failure where assignment and exposure are not joined canonically.
- [ ] Implement one stable experiment assignment boundary and telemetry join keys. Document baseline sample requirements, primary metric, guardrails, and stop conditions.
- [ ] Run the full Phase 2 gate, relevant Playwright tests, database tests, and advisors; expect pass.
- [ ] Mark Phase 2 complete, make 3.1 ready, and commit with `rtk git commit -m "feat: prepare recommendation outcome measurement"`.
