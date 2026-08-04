# Recommendation Baseline Readiness Protocol

**Status:** Readiness protocol only. **No production experiment results are
claimed, measured, or implied by this document.**

Checkpoint 2C.2 prepared the measurement boundary (deterministic assignment,
server-owned assignment registry, versioned exposure telemetry, and bounded
exposure-to-feedback outcome joins). This document fixes the rules any future
baseline measurement or controlled experiment must follow before tuning is
permitted (Phase 3).

## Scope of checkpoint 2C.2

Checkpoint 2C.2 **prepares** the assignment, registry, and exposure-to-feedback
join boundaries only. It **does not activate control/treatment traffic** in
production, assigns no real user to an arm, and changes no recommendation
quality weights. Activation/orchestration of a controlled experiment and the
accepted treatment are owned by Phase 3.1 (baseline report and optimization
hypothesis) and the later Phase 3 checkpoints. This document preregisters
protocol only; it claims no measured results.

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
  14-day enrollment window are included in this analysis. Already-assigned
  traffic may continue its arm after the window closes, but post-close
  exposures are excluded from this analysis entirely.
- **7-day maturation begins at enrollment close**, the final included
  exposure time. After the cutoff the run matures for one full attribution
  window (7 days) so every included exposure can complete its feedback
  window.
- **Analysis happens only after maturation** (enrollment close + 7 days),
  and only if the sample minimums below are met.
- Minimum measured outcomes per arm: **1,000** (exposure+feedback pairs
  inside the attribution window).
- If either minimum is unmet at the end of maturation, the run is
  inconclusive and must be extended or restarted, not interpreted.

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
