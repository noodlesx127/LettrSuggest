# Recommendation Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Secure and rebuild the recommendation path into one deterministic, testable engine with reliable inputs, diagnostics, and measured optimization.

**Architecture:** A shared server-side recommendation engine accepts canonical requests and injected context/retrieval/scoring/reranking dependencies. Thin v1 and web adapters preserve caller shapes, while deterministic fixtures, database privilege tests, import snapshot contracts, and bounded telemetry gate each migration.

**Tech Stack:** Next.js 14 App Router, TypeScript, React, Supabase/PostgreSQL, Vitest, pgTAP, Playwright.

---

## How To Execute

`docs/plans/MAIN.md` is the sole program tracker. Execute one checkpoint from the linked phase plan, update both tracker locations, run the documented gate, and create the checkpoint commit before continuing.

| Order | Plan | Working result |
| --- | --- | --- |
| 1 | `docs/plans/phases/phase-0-containment-and-correctness.md` | Privileged functions secured and proven signal/API defects corrected |
| 2 | `docs/plans/phases/phase-1-canonical-engine.md` | One deterministic engine serves v1 and web; lifecycle gates are explicit |
| 3 | `docs/plans/phases/phase-2-integrity-observability-evaluation.md` | Imports reconcile safely; diagnostics and evaluation are operational |
| 4 | `docs/plans/phases/phase-3-measured-optimization.md` | One measured optimization cycle and vector decision close the audit |

## Program Checklist

- [ ] **Step 1: Complete Phase 0 security containment and correctness**

Run every checkpoint in `docs/plans/phases/phase-0-containment-and-correctness.md`. Expected: security tests, unit contracts, and v1 API contracts pass; Phase 0 gate is recorded in `MAIN.md`.

- [ ] **Step 2: Complete Phase 1 canonical engine convergence**

Run every checkpoint in `docs/plans/phases/phase-1-canonical-engine.md`. Expected: one canonical engine serves both callers, parity fixtures pass, old orchestration is removed, and vector remains capability-gated.

- [ ] **Step 3: Complete Phase 2 integrity, observability, and evaluation**

Run every checkpoint in `docs/plans/phases/phase-2-integrity-observability-evaluation.md`. Expected: import snapshots are user-safe and atomic, diagnostics are bounded, and offline/online evaluation gates are usable.

- [ ] **Step 4: Complete Phase 3 measured optimization and closure**

Run every checkpoint in `docs/plans/phases/phase-3-measured-optimization.md`. Expected: controlled evidence supports the accepted tuning and vector decisions; every audit row in `MAIN.md` is closed.

- [ ] **Step 5: Run the final program gate**

```powershell
rtk npm run lint
rtk npm run typecheck
rtk npm run test
rtk npx playwright test
rtk npm run build
rtk supabase test db
```

Expected: all commands pass. Supabase security and performance advisors have no newly introduced findings, and all accepted residual findings have rationale in `MAIN.md`.

- [ ] **Step 6: Commit final audit closure**

```powershell
rtk git add docs/plans/MAIN.md docs/plans/phases docs/summary
rtk git commit -m "docs: close recommendation remediation audit"
```

Expected: the commit contains only final tracker evidence and the phase review summary.

## File Responsibility Map

- `src/lib/recommendationTypes.ts`: canonical request, response, health, evidence, score, and diagnostic contracts.
- `src/lib/recommendationPreference.ts`: preference polarity and feature identifier normalization.
- `src/lib/recommendationContext.ts`: atomic user context loading, normalization, health, and revision.
- `src/lib/recommendationCandidates.ts`: weighted deterministic retrieval, quotas, evidence, and source capability.
- `src/lib/recommendationReranking.ts`: pure MMR, diversity relaxation, niche, calibration, and backfill.
- `src/lib/recommendationEngine.ts`: dependency-injected orchestration only.
- `src/lib/recommendationAdapters.ts`: v1 and web translation to/from canonical contracts.
- `src/lib/recommendationTelemetry.ts`: bounded request and exposure diagnostics.
- `src/lib/enrich.ts`: retained initial scoring implementation, narrowed behind canonical seams.
- `src/lib/importSnapshot.ts`: import normalization and atomic snapshot contract.
- `src/lib/importStore.tsx`: authenticated-user local-state lifecycle.

## Non-Negotiable Constraints

- Security precedes feature work.
- No third production engine.
- No implicit background context.
- Seeds influence neighborhoods and cannot be returned.
- Degraded inputs cannot be labeled personalized.
- Strict genres are the default.
- Same-provider repetition is not consensus.
- Unseeded generation is forbidden; request-scoped determinism is required.
- Vector and tuning remain blocked until deterministic evaluation and telemetry pass.
