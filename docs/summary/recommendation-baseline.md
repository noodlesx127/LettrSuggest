# Recommendation Baseline Protocol and Active Window

**Status:** Enrollment active. **No production outcome result is claimed,
measured, or implied by this document.**

## Active Production Enrollment

- Experiment key: `phase-3-1-canonical-aa-baseline-r1`
- Config version: `37ed98ccebd44c08`
- Engine version: `v1-canonical-1` in both labels
- Assignment unit: `user`
- Traffic split: `control=0.5`, `treatment=0.5`
- Enrollment window: `[2026-08-09 00:45:21.379590+00, 2026-08-23 00:45:21.379590+00)`
- Attribution maturation ends: `2026-08-30 00:45:21.379590+00`
- Canonical vector retrieval: disabled

The service-owned activation RPC returned this row from its single production
invocation. The committed 3.1A build was deployed and smoke-tested while the
control plane was still inactive before activation. Post-activation production
checks verified a registry-backed real `control` exposure, exact window
persistence, canonical engine-only traffic, no orphan assignment evidence, and
zero vector-share activation. The available real test identity deterministically
belongs to `control`; a rollback-only remote transaction verified that exact
registry evidence permits one controlled exposure in each arm while active and
left no fixture users, profiles, assignments, or exposures. This is operational
integrity evidence, not baseline outcome analysis.

Checkpoint 2C.2 prepared the measurement boundary (deterministic assignment,
server-owned assignment registry, versioned exposure telemetry, and bounded
exposure-to-feedback outcome joins). It also fixed the rules this active
baseline and any later controlled experiment must follow before tuning is
permitted.

## Scope of checkpoint 2C.2

Checkpoint 2C.2 prepared the assignment, registry, and exposure-to-feedback
join boundaries without activating traffic or changing recommendation quality
weights. Checkpoint 3.1B subsequently activated the frozen A/A baseline recorded
above. The preregistered protocol remains binding for this run; this document
still claims no measured outcome result before checkpoint 3.1C's one permitted
post-maturation analysis.

## 1. Population

- Only **validly assigned** traffic is measurable: exposures whose bucket is
  exactly `control` or `treatment`, paired with a **nonzero 16-char lowercase
  hex experiment config version** and a **nonzero 16-char lowercase hex
  assignment hash** that matches a server-owned registry row (same
  assignment hash, owner, engine version, config version, and bucket),
  recorded by the current engine version (`v1-canonical-1`).
- `default`-bucket and legacy/unassigned exposures (null bucket, the zero
  config version `0000000000000000`, or the zero assignment hash) are
  **excluded** from every experiment comparison. They remain valid production
  traffic and are never treated as a study arm.
- Rows failing any bounded validation (malformed config version or assignment
  hash, non-current engine, missing registry evidence, mismatched
  owner/movie, malformed timestamps) are excluded fail-closed and never
  imputed.

## 2. Attribution

- Attribution window: **7 days** from the exposure timestamp
  (`EXPERIMENT_ATTRIBUTION_WINDOW_DAYS`).
- Feedback counts only when it is **strictly after** the exposure and at or
  before exposure + 7 days.
- Each user+movie pair attributes to the **latest eligible exposure** with
  in-window feedback (deterministic tie-break: latest timestamp, then config
  version, then bucket). One outcome per user+movie pair.

## 3. Primary metric

- **Positive-feedback rate** per measured outcome:
  `positive outcomes / measured outcomes`, aggregated per bucket for the one
  specified experiment config version.
- Aggregates carry bounded counts and rates only; user ids, movie ids, raw
  rows, and feedback text never enter the measurement output.

## 4. Enrollment window, maturation, and analysis timing

Fix **before** starting any measurement run; never adapt mid-run:

- **Fixed enrollment window: 14 consecutive days.** New users/requests are
  assigned to arms only inside this window. When the enrollment window
  closes, **no new assignments** are made and the experiment config is
  frozen.
- **Included-exposure cutoff:** only exposures recorded during the fixed
  14-day enrollment window are included in this analysis. Stored assignments
  remain preserved for auditability, but requests revert to the `default`
  bucket when the window closes; no post-close arm exposures are emitted.
- **7-day maturation begins at enrollment close**, the final included
  exposure time. After the cutoff the run matures for one full attribution
  window (7 days) so every included exposure can complete its feedback
  window.
- **Analysis happens only after maturation** (enrollment close + 7 days),
  and only if the sample minimums below are met.
- Minimum measured outcomes per arm: **1,000** (exposure+feedback pairs
  inside the attribution window).
- If either minimum is unmet at the end of maturation, the run is
  inconclusive and must not be interpreted or extended. Restart with a new
  run-specific experiment key, config version, and fixed 14-day window.

## 5. Guardrails

The thresholds below are **preregistered readiness defaults** and are
explicitly **not measured results**. They were chosen conservatively before
any run and must not be retuned mid-run. Monitor alongside the primary
metric; these bound acceptable behavior:

- **Negative-feedback rate:** the treatment arm's negative-feedback rate must
  not exceed the control arm by more than **2 percentage points** (absolute).
- **Degraded-mode request share:** arm difference must stay within
  **1 percentage point** (absolute).
- **Result-count fulfillment** (requested vs. returned): arm difference must
  stay within **2 percentage points** (absolute).
- **Exposure-write failure rate:** must stay below **0.5%** of attempted
  writes per arm (telemetry must not block or distort recommendation
  delivery).

## 6. Stop conditions

Halt the experiment and roll back to the default bucket if any occurs:

- Any section 5 guardrail threshold is breached, or a breach is large,
  persistent, or worsening.
- Assignment or telemetry integrity failure (bucket/config/hash pairing
  violations, malformed persisted rows, missing registry evidence, join
  eligibility collapse).
- Assignment imbalance: realized arm shares diverge from the configured
  traffic split by more than **2 percentage points** per arm.
- Any production incident traced to the experiment path.

## 7. No peeking

- Exactly **one** analysis, performed only after the fixed enrollment window,
  the 7-day maturation, and the sample minimums are met.
- No interim significance checks, no early stopping for apparent wins, no
  repeated comparisons that inflate false-positive risk.
- Guardrails (section 5) and stop conditions (section 6) are the only
  permitted interim looks, and they never read a "winner".

## 8. Vector retrieval

- Canonical production vector retrieval remains **disabled** throughout the
  baseline and any experiment. Activation is gated separately by checkpoint
  3.3 and must not change mid-experiment; changing it would invalidate the
  config-version partitioning.
