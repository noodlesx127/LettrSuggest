# Recommendation Remediation Program Design

**Date:** 2026-07-19
**Status:** Approved
**Source review:** `docs/summary/recommendation-algorithm-deep-dive-2026-07-19.md`

## Goal

Correct the security, recommendation, import, data-integrity, testing, and observability failures identified by the deep-dive, then establish one deterministic recommendation engine that serves both the web and v1 API paths.

The program must make production safer at every checkpoint and must not resume weight or threshold tuning until signal correctness, deterministic fixtures, and request-level diagnostics are in place.

## Decisions

1. The program covers the full audit, including emergency Supabase security work and adjacent import/data-integrity findings.
2. The work follows a risk-first convergence approach: security and correctness precede architecture consolidation and tuning.
3. Web and v1 use a shared server-side engine core with thin adapters rather than making either existing path authoritative.
4. The v1 response gains additive cold-start, degraded-state, and diagnostic fields. Strict filters become the corrected default behavior.
5. Vector retrieval remains disabled behind a capability gate until embedding backfill, model versioning, and cached-versus-uncached parity are validated.
6. `docs/plans/MAIN.md` is the single source of truth for program status, priority, dependencies, verification, and the active checkpoint.

## Program Structure

The remediation is split into independently shippable phases with explicit entry and exit gates.

| Phase | Outcome | Primary audit coverage |
|---|---|---|
| 0A Security containment | No public or anonymous cross-user privileged execution | Critical security finding |
| 0B Correct signals | Feedback, recency, metadata tuples, negatives, and explicit seeds behave correctly | Findings 1-4 and 19 |
| 0C Honest API behavior | Neutral context, strict filters, degraded/cold-start status, and effective boosts | Findings 6, 7, 17, and 18 |
| 1A Canonical engine core | Shared request, context, candidate, result, and diagnostic contracts | Two-engine divergence |
| 1B Deterministic retrieval | Weighted shared seeds, provider-family evidence, source-aware retention, and seeded randomness | Findings 5, 8, 13, 16, and 20 |
| 1C Constrained ranking | Correct exploration semantics, relaxed diversity, score-aware niche selection, and effective calibration | Findings 9-11 and 14 |
| 1D Cache and source lifecycle | Revision-based profile cache and explicit vector capability state | Findings 12 and 15 |
| 2A Import integrity | User-scoped state, snapshot reconciliation, honest completion, and date/event normalization | All adjacent import findings |
| 2B Observability | Request trace from inputs through retrieval, scoring, drops, reranking, and output | Observability gaps |
| 2C Evaluation | Deterministic fixtures, offline metrics, and exposure-level online metrics | Test and evaluation gaps |
| 3 Measured optimization | Evidence-based tuning and gated vector activation decision | Additional risks and future tuning |

The January recommendation plan and `docs/plans/recommendation-evolution.md` become historical references. Their still-valid ideas may be absorbed only when they satisfy the new deterministic evaluation gates.

## Tracker Model

`docs/plans/MAIN.md` owns all cross-program state. Detailed phase files under `docs/plans/phases/` provide implementation detail but cannot independently redefine priority, dependencies, or status.

The main tracker contains:

- Program goal and non-negotiable behavioral contracts.
- Current phase and exactly one active checkpoint.
- Ordered phase/checkpoint table with status, dependencies, acceptance gate, and completion commit.
- Coverage matrix mapping every audit item to a checkpoint.
- Decision log for canonical engine, v1 compatibility, vector gating, strict filters, and subsequent architecture changes.
- Latest build and verification results.
- Known blockers, next action, and safe stopping point.
- Links to the design, deep-dive, detailed phase files, and completed summaries.

A phase cannot close while a mapped audit item lacks implementation evidence, a test, an explicit defer decision, or a documented rejection rationale.

## Shared Engine Architecture

The canonical engine is server-only and independent of Next.js route and page concerns.

```text
Web adapter --\
               -> Canonical request -> Context loader -> Candidate retrieval
v1 adapter ----/                         -> Scoring -> Constrained reranking
                                         -> Diagnostics + canonical result
```

### Boundaries

- `recommendationEngine.ts` orchestrates generation. It accepts canonical inputs and injected dependencies, then returns ranked results and diagnostics.
- `recommendationTypes.ts` defines request mode, weighted seeds, input health, candidate evidence, score attribution, drop reasons, engine version, and deterministic seed.
- `recommendationContext.ts` loads and normalizes user data into an order-independent profile. It distinguishes personalized, cold-start, and degraded states.
- `recommendationCandidates.ts` owns provider adapters and deterministic source quotas. It preserves weighted seed provenance and separates provider-family consensus from within-provider repetition.
- `enrich.ts` initially remains the scoring implementation but receives normalized tuples and deterministic options. Pure ranking stages are extracted only where needed for testing and reuse.
- Web and v1 adapters translate their inputs to the canonical request and format the canonical result. UI sectioning may group results but cannot mutate canonical scores or ranking evidence.
- Vector retrieval is registered as a disabled capability until its activation gate passes.

### Migration

Migration is incremental:

1. Introduce canonical contracts and fixture tests.
2. Wrap the v1 path with the canonical engine.
3. Wrap the web path with the same engine.
4. Prove adapter parity for equivalent fixtures.
5. Emit the canonical engine version in production diagnostics.
6. Remove superseded orchestration after both callers pass parity.

There must never be a temporary third production engine.

## Canonical Data Flow

Every generation request follows these stages:

1. Normalize intent: strict genre filters, optional viewing context, weighted explicit seeds, exploration setting, result count, and deterministic request seed.
2. Load context atomically. Each source reports `ok`, `empty`, or `failed`; failures cannot masquerade as a legitimate cold start.
3. Build one order-independent taste profile. Films, mappings, metadata, dates, ratings, IDs, and extracted features remain atomic tuples.
4. Retrieve candidates from one shared weighted seed set. Each candidate retains provider family, within-provider occurrence count, seed provenance, and retrieval score.
5. Retain candidates deterministically by source and intent quota before scoring. Random exploration has a bounded partition driven by the request-scoped RNG.
6. Score using one positive/neutral/negative preference conversion and normalized feature identifiers.
7. Apply strict eligibility filters. Explicit seeds, watched films, blocked films, and requested exclusions cannot enter final results.
8. Rerank a larger candidate window with corrected MMR semantics, score-aware niche targets, calibration, and staged diversity relaxation.
9. Backfill until the requested count is met whenever enough eligible candidates exist.
10. Return ranked results and diagnostics covering input health, selected seeds, source counts, score components, rank transitions, drops, and degradation state.

## Behavioral Contracts

- No implicit `background` viewing mode.
- Genre filters are strict unless a future explicit fallback option is supplied.
- Increasing `exploration_rate` increases exploration.
- Same-provider repetition is a capped retrieval-strength signal, never independent consensus.
- Production generation contains no unseeded randomness.
- Explicit seeds influence retrieval neighborhoods and are excluded from final results.
- Preference probabilities use a documented neutral band or count-based direction; net-negative evidence never enters positive sets.
- Context loading order cannot change recency semantics.
- Failed metadata fetches remove complete tuples and cannot shift another film's features or reasons.
- A response is `personalized` only when required inputs succeeded and user-specific evidence contributed. Other valid states are `cold_start` and `degraded`.
- Advanced-filter score effects are applied in one scoring stage or removed from the contract; they cannot be calculated and discarded.
- Identifiers are canonicalized at ingestion, with stable IDs preferred over display-name matching.

## Security Design

Security containment is independent of recommendation architecture and ships first.

The security checkpoint will:

1. Enumerate every effective production overload, owner, security mode, and execute grant for privileged routines.
2. Revoke `PUBLIC` and `anon` execution unless anonymous access is explicitly required and proven safe.
3. Derive the effective user from `auth.uid()` for self-service operations rather than trusting caller-supplied IDs.
4. Enforce explicit self or admin authorization inside every privileged function.
5. Verify anonymous denial, authenticated self access, admin access, and cross-user denial.
6. Re-run Supabase security advisors and enable leaked-password protection.

All schema changes use idempotent migrations and are validated against effective production state, not migration text alone.

## Import And Data Integrity

The import phase will establish these contracts:

- Browser state is keyed by authenticated user and reloaded or cleared on auth transitions.
- Cloud data cannot be replaced by a larger stale or anonymous local collection.
- A full import reconciles removals using snapshot generations, tombstones, or an equivalent atomic contract.
- Persistence or mapping failure prevents a success claim and exposes a retryable failure state.
- Successful retries do not retain stale errors.
- Watchlist-added timestamps are persisted and restored without substituting unrelated dates.
- Diary and review rows referring to the same watch event are deduplicated.
- Missing years remain null rather than becoming year zero.

Import integrity follows recommendation stabilization because stale or cross-user profile data would invalidate ranking evaluation.

## Observability

Every canonical request records or exposes a bounded diagnostic trace containing:

- Engine name and version.
- Request seed and experiment bucket.
- Input health and row counts by source.
- Mapping and metadata coverage.
- Selected seed IDs, weights, and provenance.
- Candidate counts before and after each source, filter, and truncation stage.
- Distinct-provider consensus and repeated same-provider evidence.
- Score components and applied multipliers.
- Pre- and post-MMR rank.
- Pre- and post-diversity rank and rejection reason.
- Calibration membership and rank changes.
- Cache hit, input revision, and metadata or model version.
- Personalized-source and generic-source share.
- Personalized, cold-start, or degraded state.

Diagnostics must avoid secrets and unnecessary personal data. Detailed traces may be sampled or retained for a bounded period, while aggregate metrics remain available for longitudinal evaluation.

## Testing Strategy

The repository needs a fast TypeScript unit and integration test layer in addition to Playwright.

### Test Layers

- Pure unit tests cover preference polarity, normalization, MMR mapping, evidence deduplication, quotas, constraint relaxation, cache revisions, and import normalization.
- Fixture pipeline tests freeze profiles, metadata, provider responses, timestamps, and RNG seeds. They assert inclusion, exclusion, relative order, score attribution, and final IDs.
- Adapter contract tests require web and v1 adapters to return identical canonical ranked IDs for equivalent requests.
- API integration tests cover strict genres, explicit seed influence and exclusion, cold-start versus degraded state, additive diagnostics, and requested-count behavior.
- Database security tests enumerate privileged functions and verify anonymous denial, self access, admin access, and cross-user denial.
- Import integration tests cover auth transitions, local-state isolation, snapshot reconciliation, persistence failure, watchlist dates, and duplicate watch events.
- Production validation is aggregate and non-destructive.

### Required Fixtures

- Strong genre and subgenre preference.
- Strong actor or director preference.
- Explicit negative features.
- Recent taste shift.
- Sparse cold start.
- Broad long-term profile with narrow current interest.
- Explicit seed request.
- Horror or crime preference that exposes background-mode bias.
- Failed metadata fetch in the middle of the liked-film list.
- Repeated same-provider candidates and true cross-provider consensus.

### Checkpoint And Phase Gates

Each checkpoint follows red-green-refactor and runs its smallest relevant test slice. Phase completion requires:

1. `npm run lint`
2. `npm run typecheck`
3. Full unit and integration suite
4. Relevant Playwright slice
5. `npm run build`
6. Phase-specific acceptance gate recorded in `docs/plans/MAIN.md`

Database phases also require fresh Supabase security and performance advisor results. Any accepted residual warning must include its remediation link and rationale in the tracker.

No weight or threshold tuning may merge unless correctness, adapter parity, and rank-stability gates remain green.

## Evaluation

Deterministic fixtures establish correctness but do not prove recommendation quality. Once the baseline is stable, offline evaluation measures holdout hit rate, NDCG, negative-feature leakage, seed influence, personalized-source share, consensus precision, catalog coverage, novelty, top-window diversity, calibration distance, rank stability, and count fulfillment.

Online metrics are segmented by engine version, experiment bucket, source, and rank. They include interested, saved, watched, dismissed, and ignored rates; pairwise wins; time to first positive action; repeat exposure and dismissal; feedback response latency; degraded request rate; and final personalized-source share.

Production currently has too few users with film data for broad population claims. Reports must include per-user distributions and avoid unsupported percentage-improvement claims.

## Execution Discipline

- Work one checkpoint at a time.
- Keep exactly one active checkpoint in `docs/plans/MAIN.md`.
- Update the main tracker and relevant phase file when work starts and completes.
- Complete security containment before recommendation feature work.
- Require fixture parity before switching either caller to the canonical engine.
- Remove old orchestration only after both adapters pass parity and production identifies the canonical engine version.
- Keep vector activation and tuning blocked until evaluation and telemetry gates pass.
- Commit each coherent checkpoint separately.
- Complete a review loop and summary at each phase boundary.

## Completion Criteria

The program is complete when:

1. Every audit finding is closed, explicitly deferred behind a documented gate, or rejected with evidence.
2. Privileged database routines enforce effective self/admin authorization and expose no unintended anonymous execution.
3. Web and v1 use the same canonical engine and match for equivalent requests.
4. Identical inputs and request seeds produce identical outputs.
5. Correctness fixtures prove signal direction, recency, tuple alignment, seed influence, strict filtering, consensus, and requested-count behavior.
6. Imports cannot leak browser state across users or preserve removed rows after a full snapshot reconciliation.
7. Request diagnostics explain how candidates entered, scored, moved, dropped, and reached the final list.
8. Tuning decisions are supported by deterministic offline results and versioned online metrics.
