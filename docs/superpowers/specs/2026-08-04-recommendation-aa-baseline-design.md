# Recommendation A/A Baseline Enrollment Design

**Date:** 2026-08-04
**Phase:** 3, checkpoints 3.1A through 3.1C
**Status:** Approved design

## Purpose

Start a valid 14-day production baseline enrollment for the canonical recommendation engine. Checkpoint 3.1A prepares and commits inactive infrastructure, 3.1B deploys and atomically activates it, and 3.1C completes observation, maturation, final analysis, audit review, and selection of one bounded optimization hypothesis.

This is an A/A baseline. `control` and `treatment` both run unchanged `v1-canonical-1` recommendation behavior. The experiment must not activate vector retrieval or alter ranking, evidence, filtering, relaxation, or output adaptation.

## Frozen Experiment Contract

- Experiment key: `phase-3-1-canonical-aa-baseline-r1`
- Assignment unit: authenticated user ID
- Allocation: 50 percent `control`, 50 percent `treatment`
- Behavior: identical `v1-canonical-1` execution in both arms
- Enrollment duration: exactly 14 consecutive days
- Maturation duration: seven full days after enrollment closes
- Analysis: one final analysis after maturation and at least 1,000 eligible measured outcomes per arm
- Vector retrieval: disabled
- Default bucket: excluded from arm comparisons

The config version is derived from the experiment key, assignment unit, exact split, and bounded algorithm material that identifies both arms as `v1-canonical-1`. The `r1` suffix is the frozen run identity. Any restart uses a new experiment key suffix such as `r2`, which produces a new config version without inventing an algorithm change. Any material change also creates a different config version and invalidates the enrollment rather than silently changing it.

## Architecture

### Enrollment Control Plane

Add a service-owned `recommendation_experiment_enrollments` table and narrowly scoped RPCs.

The activation RPC atomically inserts the frozen experiment metadata with `starts_at = clock_timestamp()` and `ends_at = starts_at + interval '14 days'`. It returns the database timestamps and config version for the tracker evidence. Activation is single-use for the experiment key and config version.

The enrollment row is immutable after activation except for an emergency `deactivated_at` timestamp set through a separate service-only RPC. Direct writes are denied. Row-level security is enabled, and table/RPC access is denied to `PUBLIC`, `anon`, and `authenticated`; only `service_role` may read or invoke the RPCs.

Only one active recommendation enrollment may exist at a time. The activation RPC rejects overlapping active windows, config-version mismatches, invalid duration, and duplicate activation.

### Runtime Assignment Boundary

Add one server-only resolver at the shared canonical generation boundary used by web and v1 flows. It:

1. Reads the active enrollment using a service-role client.
2. Confirms the database row matches the compiled frozen A/A contract and current time is in the half-open interval `[starts_at, ends_at)`.
3. Calls the existing deterministic `assignRecommendationExperiment` with the authenticated user ID.
4. Persists or retrieves the stable assignment through the existing service-owned assignment registry RPC.
5. Returns the registered assignment for trace construction.

Stored assignments win, preserving a user's arm across requests. Web and v1 requests for the same user receive the same assignment.

The resolver returns the default assignment outside the window, after emergency deactivation, for unauthenticated requests, or after any validation, read, assignment, or registry failure. It logs a bounded service-prefixed error without user IDs, assignment keys, service credentials, or raw configuration material.

### Trace And Exposure Flow

Extend the existing web and v1 trace options to carry the complete registered experiment assignment rather than only a bucket. `buildRecommendationTrace` already validates this structure and emits the bucket, nonzero config version, and nonzero assignment hash.

Exposure recording remains unchanged after trace creation. Existing database enforcement accepts active arm exposures only when matching assignment-registry evidence exists. Default exposures remain valid for fail-closed operation but are excluded from checkpoint 3.1 analysis.

No client component chooses an arm. No browser cookie, request-level randomization, or client-writable experiment state is introduced.

## Request Flow

1. Authenticate the web or v1 request and obtain the stable user ID.
2. Resolve the active enrollment and registered assignment on the server.
3. Run the unchanged canonical recommendation engine.
4. Adapt results for web or v1 using the same assignment in trace construction.
5. Record committed exposures with registry-backed experiment fields.
6. Join later server-timestamped feedback only within the existing seven-day attribution window.

Assignment failure does not block recommendation generation. It produces a default-bucket trace and a bounded operational signal so missing arm traffic is visible without exposing sensitive identifiers.

## Activation And Observation

1. Apply and verify the enrollment-control migration.
2. Deploy the assignment wiring while no enrollment row is active.
3. Verify production requests still fail closed to the default bucket and vectors remain disabled.
4. Invoke the service-only activation RPC once.
5. Record the returned UTC start, UTC end, experiment key, config version, assignment unit, and split in the phase tracker and baseline report.
6. Verify both arms produce registry-backed exposures with identical engine behavior.
7. Monitor only preregistered safety and measurement guardrails during enrollment. Do not perform interim winner analysis.
8. After the fixed window closes, wait seven full days before the one final analysis.

The production activation instant, not 2026-08-04 midnight or a pre-deployment timestamp, is the enrollment start. If deployment is delayed, activation is delayed with it.

## Guardrails And Stop Conditions

Operational monitoring may inspect assignment failures, default-bucket fallback rate, arm imbalance, exposure-write failures, registry mismatches, recommendation error rate, latency, and vector activation counts.

Deactivate the enrollment without changing recommendation behavior if any of these occur:

- The compiled contract and active database row disagree.
- Assignment or registry failures prevent trustworthy arm measurement.
- Control/treatment allocation materially departs from the preregistered split beyond the protocol threshold.
- Exposure integrity checks fail.
- Recommendation reliability regresses.
- Any vector result or activated vector row appears.

Deactivation sets `deactivated_at`; it does not delete assignments, exposures, or evidence. Requests then fail closed to `default`. A deactivated, materially changed, or underpowered run is not analyzed as the planned baseline. It restarts under a new run-specific experiment key, config version, and fixed 14-day window; the original window is not extended.

If a restart is required, checkpoint 3.1C becomes `Blocked`. Before any replacement run work, amend `MAIN.md` with new run-specific infrastructure and activation checkpoints. The infrastructure checkpoint updates the compiled contract to the next run key, repeats failing tests and verification, and creates one immutable commit. Its activation checkpoint deploys that commit inactive, verifies fallback, activates the replacement window, and commits evidence. Completed checkpoints are never reopened, and 3.1C resumes only after the replacement activation checkpoint completes.

## Testing Strategy

Follow test-driven development. Each behavior test must fail for the expected missing-feature reason before production code is added.

Required tests:

- Exact half-open enrollment boundaries and emergency deactivation.
- Atomic activation timestamps and exact 14-day duration.
- Rejection of duplicate, overlapping, unauthorized, and config-mismatched activation.
- Stable 50/50 user-level deterministic assignment with stored assignments winning.
- Registry persistence before active exposure construction.
- Default fallback for missing, inactive, invalid, unauthorized, or failed enrollment resolution.
- Identical canonical outputs for control and treatment.
- Matching assignment fields across web and v1 traces.
- No recommendation behavior or vector activation change.
- Existing exposure, feedback-attribution, and aggregation contracts remain valid.

Verification before activation includes the smallest relevant unit/integration/database suites, the frozen `2c.1` corpus, lint, typecheck, production build, migration security checks, scoped diff review, and an independent code-review loop. Production activation occurs only after all gates pass.

## Documentation And Evidence

The checkpoint 3.1 baseline report records readiness and execution evidence separately. It must include exact commands, dates, artifact or query references, production activation timestamps, frozen config identity, enrollment counts, guardrail observations, maturation status, and final aggregate metrics. It must not claim measured results before maturation or select an optimization hypothesis from interim data.

Only one checkpoint is active at a time. Checkpoint 3.1A completes when the inactive infrastructure is verified and committed. Checkpoint 3.1B completes when that immutable revision is deployed and the exact production window is activated and recorded. Checkpoint 3.1C completes only after enrollment, maturation, the one final analysis, audit review, and selection of exactly one bounded hypothesis.
