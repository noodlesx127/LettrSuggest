# Phase 3: Measured Optimization and Closure

**Phase state:** Not started  
**Entry condition:** Phase 2 complete with deterministic offline and online measurement gates  
**Exit condition:** A controlled optimization decision and vector go/no-go are documented, verified, and every audit item is closed.

## Checkpoint 3.1: Baseline Report and Optimization Hypothesis

**Files:**
- Modify: `docs/summary/recommendation-baseline.md`
- Modify: `docs/plans/MAIN.md`

- [ ] Run the versioned offline corpus and collect the minimum accepted production observation window defined in Phase 2.
- [ ] Record deterministic repeat rate, count fulfillment, seed/exclusion violations, source concentration, diversity, popularity concentration, rank churn, degraded rate, and available outcome metrics by engine version.
- [ ] Select exactly one bounded hypothesis tied to a measured weakness. Specify the single configuration/code change, expected metric movement, guardrails, sample requirement, and rollback trigger.
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
