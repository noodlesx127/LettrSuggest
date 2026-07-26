# Phase 1: Canonical Recommendation Engine

**Phase state:** In progress  
**Entry condition:** Phase 0 complete  
**Exit condition:** One deterministic server engine serves v1 and web, cache inputs are revisioned, and optional sources are capability-gated.

`docs/plans/MAIN.md` controls checkpoint status. Each checkpoint begins with a failing deterministic test and ends with one coherent commit.

## Checkpoint 1A.1: Canonical Contracts and Frozen Fixtures

**Checkpoint state:** Complete

**Files:**
- Create: `src/lib/recommendationTypes.ts`
- Create: `tests/fixtures/recommendations/canonicalFixture.ts`
- Create: `tests/integration/recommendationContracts.test.ts`

- [x] Define `RecommendationRequest`, weighted seeds, neutral context, source health, candidate evidence, score attribution, drop reason, engine mode/version, diagnostics, and `RecommendationResult` in one server-safe module.
- [x] Write a compile/runtime contract test that constructs the canonical fixture and asserts seed exclusion, health fields, ordered expected IDs, attribution, and no private-list fields in diagnostics.
- [x] Run `rtk npm run test -- tests/integration/recommendationContracts.test.ts`; expect failure before the contracts exist.
- [x] Implement only the types, validation helpers, and frozen fixture needed by the test; run the test and `rtk npm run typecheck`; expect pass.
- [x] Update trackers and commit with `rtk git commit -m "test: define canonical recommendation contracts"`.

## Checkpoint 1A.2: Engine Orchestration Seams

**Checkpoint state:** Complete

**Files:**
- Create: `src/lib/recommendationContext.ts`
- Create: `src/lib/recommendationEngine.ts`
- Create: `tests/integration/recommendationContext.test.ts`
- Create: `tests/integration/recommendationEngine.test.ts`
- Modify: `src/lib/enrich.ts`

- [x] Write a context test asserting each films/mappings/metadata/dates/ratings/features record remains atomic, source health is preserved, normalized output is independent of database row order, and input revision material covers every loaded source.
- [x] Write an engine test with injected `loadContext`, `retrieveCandidates`, `scoreCandidates`, `rerankCandidates`, `rng`, and `telemetry` fakes. Assert call order, request propagation, seed exclusion, health-derived mode, final IDs, and one bounded trace.
- [x] Run both tests; expect failure because no canonical context or orchestration seam exists.
- [x] Implement `loadRecommendationContext(repository, userId)` in `recommendationContext.ts` using the Phase 0 health and tuple contracts. Implement `createRecommendationEngine(dependencies)` and `generate(request)` as orchestration only. Wrap existing `suggestByOverlap` behind the scorer dependency without moving unrelated persistence helpers.
- [x] Run the focused tests and typecheck; expect pass.
- [x] Commit with `rtk git commit -m "refactor: introduce recommendation engine orchestration"`.

## Checkpoint 1B.1: Deterministic Weighted Retrieval

**Checkpoint state:** Complete

**Files:**
- Create: `src/lib/recommendationCandidates.ts`
- Create: `tests/unit/recommendationCandidates.test.ts`
- Modify: `src/lib/recommendationAggregator.ts`
- Modify: `src/lib/trending.ts`
- Modify: `src/lib/serverSuggestionsEngine.ts`

- [x] Write tests asserting weighted seeds remain weighted at provider calls, identical request seeds select identical providers/pages/order, stable ties use TMDB ID, per-source quotas retain high-intent supply, and the global `WEAK_SEED_TMDB_IDS` list has no effect.
- [x] Run the tests; expect failure from ID-only boundaries and ambient randomness.
- [x] Implement a request-scoped deterministic RNG, weighted seed selection, stable dedupe/tie-breaking, and source/intent quotas in `recommendationCandidates.ts`. Adapt existing provider functions rather than duplicating clients.
- [x] Remove random pre-score shuffle/truncation and the taste-specific global weak-seed blacklist. Keep explicit block/exclusion inputs user-scoped.
- [x] Run focused tests, lint touched files, and typecheck; expect pass.
- [x] Commit with `rtk git commit -m "refactor: make recommendation retrieval deterministic"`.

## Checkpoint 1B.2: Evidence Semantics and Candidate Retention

**Checkpoint state:** Complete

**Files:**
- Modify: `src/lib/recommendationCandidates.ts`
- Modify: `src/lib/recommendationAggregator.ts`
- Create: `tests/unit/recommendationEvidence.test.ts`

- [x] Write fixtures where one provider repeats an ID and two independent provider families return another ID. Assert only distinct families increase consensus, repetition is tracked separately, source confidence survives merging, and quotas are applied before global truncation.
- [x] Run tests; expect failure because repeated same-provider evidence currently raises consensus.
- [x] Implement normalized provider-family evidence and deterministic merge semantics. Preserve raw sources for attribution but cap family contribution.
- [x] Run tests and the canonical engine fixture; expect pass without unrelated order churn.
- [x] Commit with `rtk git commit -m "fix: distinguish consensus from provider repetition"`.

## Checkpoint 1C.1: Constrained Reranking and Backfill

**Checkpoint state:** Complete

**Files:**
- Create: `src/lib/recommendationReranking.ts`
- Create: `tests/unit/recommendationReranking.test.ts`
- Modify: `src/lib/enrich.ts`
- Modify: `src/lib/calibration.ts`

- [x] Write tests for `lambda * relevance - (1 - lambda) * similarity`, monotonic exploration-to-diversity behavior, named diversity relaxation stages, exact requested-count backfill when eligible supply exists, score-aware niche targets, and calibration replacement from a larger window.
- [x] Run tests; expect failure on exploration mapping, hard caps, niche interleave, and calibration composition.
- [x] Extract pure reranking stages with stable TMDB ID ties. Apply strict eligibility first, then relevance/MMR, niche/calibration constraints, staged diversity relaxation, and final backfill.
- [x] Keep each drop/relaxation reason available for telemetry. Do not alter base relevance weights in this checkpoint.
- [x] Run reranking and canonical fixture tests; expect pass.
- [x] Commit with `rtk git commit -m "fix: constrain recommendation reranking with backfill"`.

## Checkpoint 1A.3: v1 Canonical Adapter

**Checkpoint state:** Complete

**Files:**
- Create: `src/lib/recommendationAdapters.ts`
- Create: `tests/integration/recommendationAdapters.test.ts`
- Modify: `src/app/api/v1/suggestions/generate/route.ts`
- Modify: `src/lib/serverSuggestionsEngine.ts`
- Modify: `tests/api-v1.spec.ts`

- [x] Write adapter tests mapping every v1 request field into the canonical request and canonical output into the existing response plus additive diagnostics. Assert strict genres, explicit seeds, count, exclusions, mode, and engine version.
- [x] Run tests; expect failure before the adapter exists.
- [x] Implement the v1 adapter and change the route to call the canonical engine. Leave reusable context/provider implementations but remove v1-only orchestration from `generateServerCandidates` once no production caller uses it.
- [x] Run adapter tests and canonical fixture tests; the focused Playwright generation command completed with all 3 authenticated tests skipped because credentials were unavailable.
- [x] Commit with `rtk git commit -m "refactor: route v1 through canonical recommendations"`.

## Checkpoint 1A.4: Web Canonical Adapter and Legacy Removal

**Checkpoint state:** Ready

**Files:**
- Modify: `src/lib/recommendationAdapters.ts`
- Modify: `src/app/suggest/page.tsx`
- Modify: `src/lib/trending.ts`
- Modify: `src/app/actions/recommendations.ts`
- Modify: `src/lib/recommendationAggregator.ts`
- Modify: `tests/integration/recommendationAdapters.test.ts`

- [ ] Add a parity test that adapts equivalent web and v1 intent and compares eligible ordered IDs, evidence, mode, and engine version from the canonical fixture.
- [ ] Run it; expect failure because web still performs its own aggregation, shuffle, scoring, calibration, and exposure sequence.
- [ ] Implement the web adapter and one thin server entry point. Move the page to presentation/hydration only; remove competing pre-score shuffle, calibration, and candidate orchestration after parity passes.
- [ ] Search production entry points to prove only `recommendationEngine.generate` orchestrates recommendation generation. Keep provider helpers called through canonical dependencies.
- [ ] Run unit/integration tests, relevant Playwright suggest flow, lint, typecheck, and build; expect pass.
- [ ] Commit with `rtk git commit -m "refactor: converge web on canonical recommendations"`.

## Checkpoint 1D.1: Cache Revision and Invalidation

**Files:**
- Create: `src/lib/recommendationRevision.ts`
- Create: `tests/unit/recommendationCache.test.ts`
- Create: `supabase/migrations/20260721120000_version_taste_profile_cache.sql`
- Modify: `src/lib/serverSuggestionsEngine.ts`
- Modify: `src/app/api/v1/admin/diagnostics/route.ts`

- [ ] Write tests varying ratings, dates, mappings, watchlist, feedback, quiz state, blocks, metadata version, and profile model version one at a time. Assert each changes the deterministic revision and stale entries miss.
- [ ] Run tests; expect failure because cache validity uses film count/time only.
- [ ] Implement stable canonical serialization and hash revision. Add revision/model columns and migration/backfill behavior; compare revisions on reads and expose only bounded revision/version diagnostics.
- [ ] Run unit tests, migration tests, typecheck, and diagnostics API tests; expect pass.
- [ ] Commit with `rtk git commit -m "fix: version recommendation profile cache inputs"`.

## Checkpoint 1D.2: Source Lifecycle and Vector Capability Gate

**Files:**
- Modify: `src/lib/recommendationCandidates.ts`
- Modify: `src/lib/embeddings.ts`
- Modify: `src/lib/vectorSimilarityCache.ts`
- Modify: `scripts/generate-embeddings.ts`
- Create: `tests/unit/vectorCapability.test.ts`

- [ ] Write tests asserting vector is disabled without explicit model version, compatible dimensions, completed backfill marker, similarity score persistence, and cached/uncached rank parity.
- [ ] Run tests; expect failure because cache entries lose similarity scores and no complete capability contract exists.
- [ ] Implement a capability result with named failed checks. Version embeddings/cache records as needed and preserve similarity scores; do not enable production vector retrieval in this checkpoint.
- [ ] Run tests and record production backfill coverage as evidence, not as an activation claim.
- [ ] Run the full Phase 1 gate from `MAIN.md`, relevant Playwright tests, and Supabase advisors; expect pass.
- [ ] Mark Phase 1 complete, make 2A.1 ready, and commit with `rtk git commit -m "fix: gate vector recommendations by capability"`.
