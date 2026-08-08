# Phase 3: Measured Optimization and Closure

**Phase state:** In progress

**Entry condition:** Phase 2 complete with deterministic offline and online measurement gates  
**Exit condition:** A controlled optimization decision and vector go/no-go are documented, verified, and every audit item is closed.

## Checkpoint 3.1A: A/A Enrollment Infrastructure

**Checkpoint state:** Complete

**Files:**
- Reference: `docs/superpowers/specs/2026-08-04-recommendation-aa-baseline-design.md`
- Create: `supabase/migrations/*_activate_recommendation_experiment_enrollment.sql`
- Create: `src/lib/recommendationExperimentEnrollment.ts`
- Modify: `src/lib/recommendationAdapters.ts`
- Modify: `src/lib/recommendationTelemetry.ts`
- Modify: `src/lib/serverSuggestionsEngine.ts`
- Modify: `src/app/actions/recommendations.ts`
- Modify: `src/app/api/v1/suggestions/generate/route.ts`
- Modify: `tests/integration/recommendationExperiment.test.ts`
- Modify: `tests/integration/recommendationExposure.test.ts`
- Modify: `tests/integration/recommendationAdapters.test.ts`
- Modify: `tests/recommendation-pages.spec.ts`
- Modify: `tests/api-v1.spec.ts`
- Modify: `supabase/tests/database/recommendation_experiment.test.sql`
- Modify: `docs/plans/MAIN.md`

- [x] Run the frozen versioned offline corpus.
- [x] Add failing tests for the approved A/A enrollment control plane, fail-closed assignment resolver, registry persistence, adapter parity, and unchanged arm behavior.
- [x] Add the service-owned enrollment table and atomic activation/deactivation RPCs with negative privilege and overlap tests.
- [x] Wire one stable 50/50 user-level assignment through the shared canonical web and v1 trace boundary without changing recommendation or vector behavior.
- [x] Run focused unit, integration, database, authenticated web/v1 Playwright, corpus, lint, typecheck, and build gates. Complete an independent code-review loop and record its outcome. Verify the release artifact remains inactive without an enrollment row.
- [x] Commit code, migration, tests, and tracker evidence with `rtk git commit -m "feat: prepare recommendation baseline enrollment"` before production deployment.

### Execution notes

- 2026-08-04 - Checkpoint 3.1A started. No production enrollment timestamp has been fixed and no production experiment results are claimed, measured, or implied. The enrollment discrepancy is resolved by the approved 50/50 user-level A/A design: registry-backed `control` and `treatment` labels will both execute unchanged `v1-canonical-1`, while recommendation tuning and canonical vector retrieval remain inactive. Production paths still emit only default-bucket assignments until the approved infrastructure is tested, committed, deployed inactive, and atomically activated in checkpoint 3.1B. Frozen versioned offline corpus evaluation ran PASS on 2026-08-04 via `rtk npm run evaluate:recommendations`: corpus `2c.1`, 8/8 cases passed, deterministic repeats and web/v1 parity yes on every case, zero seed, exclusion, genre, attribution, and evidence violations, count fulfillment 100% on all eligible cases with the degraded-inputs case returning its expected fail-closed 0/3 result, and vector results and vector rows activated both zero. The offline corpus performs no production writes and requires no enrollment activation.
- 2026-08-08 - Checkpoint 3.1A complete. The shared server boundary resolves one registry-backed assignment for authenticated web and v1 generation, carries the complete assignment into traces before exposure writes, and fails closed to the default bucket on invalid, failed, inactive, or timed-out enrollment RPCs. Review-driven RED/GREEN cycles covered missing runtime wiring (6 expected failures) and lifecycle/timeout gaps (5 expected failures), then closed atomic lifecycle locking, exact frozen-config validation, half-open window enforcement, controlled-exposure revalidation, and bounded RPC waits. The remote-only Supabase migration was applied inactive as ledger version `20260808210726` (`activate_recommendation_experiment_enrollment`) before the Git checkpoint commit; the local migration filename now uses the same version and `rtk npx supabase migration list` pairs the local and remote histories. Effective service-only RPC/table privileges, RLS, constraints, trigger security, zero enrollment rows, and an inactive resolver with no registry mutation were verified. Remote rollback-only pgTAP passed 147/147 for enrollment and 74/74 for exposure twice each with zero persisted fixtures or activation. Full Vitest passed 774/774, the frozen corpus passed 8/8 with deterministic web/v1 parity and zero vector results/rows, authenticated Playwright passed 2/2 for protected web rendering and v1 generation, and lint, typecheck, build, and diff checks passed. Independent reviews approved with no material findings; true concurrent two-session race execution remains a test-depth risk. Checkpoint 3.1B remains unstarted: no enrollment row, production start/end timestamp, measured result, recommendation tuning, or vector activation is claimed.

## Checkpoint 3.1B: Atomic Production Enrollment Activation

**Checkpoint state:** Ready

**Files:**
- Modify: `docs/summary/recommendation-baseline.md`
- Modify: `docs/plans/MAIN.md`

- [ ] Verify the already-applied inactive enrollment migration matches the committed revision and retains effective service-only table and RPC privileges.
- [ ] Deploy the committed 3.1A revision with no active enrollment row.
- [ ] Verify production default fallback, web/v1 health, exposure writes, and zero vector activation.
- [ ] Invoke the activation RPC once and record its returned UTC start, UTC end, experiment key, config version, assignment unit, and 50/50 split.
- [ ] Verify registry-backed exposures appear in both arms while recommendation behavior remains identical.
- [ ] Commit production activation evidence with `rtk git commit -m "ops: start recommendation baseline enrollment"`.

## Checkpoint 3.1C: Baseline Report and Optimization Hypothesis

**Checkpoint state:** Not started

**Files:**
- Modify: `docs/summary/recommendation-baseline.md`
- Modify: `docs/plans/MAIN.md`

- [ ] Collect the fixed 14-day production observation window and seven-day maturation period defined in Phase 2 without interim outcome analysis.
- [ ] Require at least 1,000 eligible measured outcomes per arm; otherwise reject the run and restart with a new run-specific experiment key and fixed window.
- [ ] If the run stops or is underpowered, mark 3.1C `Blocked` and amend `MAIN.md` with new run-specific infrastructure and activation checkpoints before changing the compiled contract, committing, deploying, or activating a replacement run. Never reopen completed checkpoints or extend the original window.
- [ ] Record deterministic repeat rate, count fulfillment, seed/exclusion violations, source concentration, diversity, popularity concentration, rank churn, degraded rate, and outcome metrics by engine version and arm.
- [ ] Perform the one final analysis and select exactly one bounded hypothesis tied to a measured weakness. Specify the single configuration/code change, expected metric movement, guardrails, sample requirement, and rollback trigger.
- [ ] Review audit coverage to confirm no correctness defect is being disguised as tuning.
- [ ] Commit with `rtk git commit -m "docs: establish recommendation quality baseline"`.

## Checkpoint 3.2: Controlled Tuning Experiment

**Files:**
- Modify: the smallest canonical engine configuration or pure ranking module required by the accepted hypothesis
- Modify: `tests/integration/recommendationEvaluation.test.ts`
- Modify: `docs/summary/recommendation-baseline.md`

- [ ] Add a failing test for the specific intended metric/invariant movement without loosening security, parity, determinism, or count thresholds.
- [ ] Run the focused test and record the expected failure.
- [ ] Implement only the accepted change behind an engine/config version and stable experiment assignment.
- [ ] Run all correctness, parity, stability, quality, Playwright, typecheck, lint, and build gates. Reject the change if any non-target guardrail regresses.
- [ ] Evaluate the documented online window. Keep or revert via a new commit based on the predeclared decision rule.
- [ ] Commit the accepted result with `rtk git commit -m "feat: tune recommendations from measured evidence"`, or commit rejection evidence with `rtk git commit -m "docs: reject recommendation tuning hypothesis"`.

## Checkpoint 3.3: Vector Go/No-Go

**Files:**
- Modify: `tests/unit/vectorCapability.test.ts`
- Modify: `docs/summary/recommendation-baseline.md`
- Modify only on a go decision: `src/lib/recommendationCandidates.ts`

- [ ] Verify embedding backfill coverage, explicit model version/dimensions, cache similarity-score preservation, cached/uncached rank parity, provider latency/error limits, and trace participation.
- [ ] Run the offline corpus with vector disabled and enabled under the same requests. Compare the declared quality metrics and all guardrails.
- [ ] Record `go` only if every capability check passes and measured benefit meets the predeclared threshold. Otherwise record `no-go` and keep vector disabled.
- [ ] On go, enable vector only through the capability gate and experiment version; run the full program gate. On no-go, make no runtime activation change.
- [ ] Commit with `rtk git commit -m "docs: decide vector recommendation activation"`.

## Checkpoint 3.4: Final Audit Closure

**Files:**
- Modify: `docs/plans/MAIN.md`
- Create: `docs/summary/recommendation-remediation-completion.md`

- [ ] For every security, finding 1-20, import, observability, and evaluation row in `MAIN.md`, link implementation evidence and a test, record an explicit gated defer, or record a rejection rationale.
- [ ] Run the complete final gate from the implementation handoff. Rerun Supabase security and performance advisors.
- [ ] Use Codebase Memory change-impact analysis to confirm no competing production recommendation orchestration remains and inspect the final Git diff/history.
- [ ] Record residual risks, production versions, rollback controls, and follow-up ownership in the completion summary.
- [ ] Mark 3.4 and the program complete in `MAIN.md`; set no new current checkpoint.
- [ ] Commit final tracker evidence as documented in `docs/superpowers/plans/2026-07-19-recommendation-remediation.md`.
