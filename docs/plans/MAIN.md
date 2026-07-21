# Recommendation Remediation Program

**Status:** Blocked  
**Current checkpoint:** 0A.3 - Production security validation  
**Next action:** Upgrade the Supabase project to Pro or explicitly revise the 0A.3 gate; leaked-password protection is unavailable on the selected free plan.
**Safe stopping point:** Keep 0A.3 blocked and do not start recommendation correctness work while the required platform control is unavailable.

This file is the sole source of truth for program order, checkpoint status, gates, and audit closure. Phase plans define execution detail but do not override this tracker.

## Program Goal

Secure privileged database operations, correct proven recommendation defects, converge web and v1 on one deterministic server engine, repair import integrity, establish diagnostics and evaluation, and permit tuning only after measurable gates pass.

## References

- Approved design: `docs/superpowers/specs/2026-07-19-recommendation-remediation-design.md`
- Implementation handoff: `docs/superpowers/plans/2026-07-19-recommendation-remediation.md`
- Audit: `docs/summary/recommendation-algorithm-deep-dive-2026-07-19.md`
- Build strategy: `docs/plans/build-strategy.md`
- Testing strategy: `docs/plans/testing-strategy.md`
- Phase 0: `docs/plans/phases/phase-0-containment-and-correctness.md`
- Phase 1: `docs/plans/phases/phase-1-canonical-engine.md`
- Phase 2: `docs/plans/phases/phase-2-integrity-observability-evaluation.md`
- Phase 3: `docs/plans/phases/phase-3-measured-optimization.md`
- Historical only: `docs/plans/recommendation-algorithm-improvement-plan.md`
- Historical only: `docs/plans/recommendation-evolution.md`

## Status Rules

- Valid checkpoint states are `Not started`, `Ready`, `In progress`, `Blocked`, and `Complete`.
- Exactly one checkpoint may be `In progress`; before execution begins, exactly one may be `Ready`.
- Start a checkpoint by changing it to `In progress` here and in its phase file.
- Complete a checkpoint only after its tests, phase gate, implementation evidence, and commit are recorded.
- Move the next checkpoint to `Ready` only after all dependencies are complete.
- A phase file may add execution notes but cannot change priorities or skip gates.
- Unexpected failures become blockers here; they are not converted into silent scope reductions.

## Ordered Checkpoints

| Checkpoint | State | Depends on | Acceptance gate | Commit |
| --- | --- | --- | --- | --- |
| 0A.1 Privileged-function inventory and failing security baseline | Complete | None | Effective overload/ACL inventory and negative pgTAP tests fail for each exposed path | `test: establish privileged function security baseline` |
| 0A.2 Authorization and grants migration | Complete | 0A.1 | pgTAP proves self/admin/service boundaries and application callers pass | `8fa8104`, `test: complete privileged function caller gate` |
| 0A.3 Production security validation | Blocked | 0A.2 | Effective grants verified; security/performance advisors reviewed; leaked-password protection enabled | Not started |
| 0B.1 Fast test harness and preference contracts | Not started | 0A.3 | Vitest runs in CI shape; polarity and identifier tests pass | Not started |
| 0B.2 Atomic metadata tuples and recency | Not started | 0B.1 | Failed-middle-fetch and date-order fixtures pass | Not started |
| 0B.3 Explicit seed semantics | Not started | 0B.2 | Seeds influence retrieval, never appear as results, and runs are deterministic | Not started |
| 0C.1 Input health and neutral request context | Not started | 0B.3 | `ok/empty/failed` state, honest mode, neutral default, and additive diagnostics pass | Not started |
| 0C.2 Strict filters and effective advanced behavior | Not started | 0C.1 | Genre/negative/threshold contracts and advanced boosts pass | Not started |
| 1A.1 Canonical contracts and frozen fixtures | Not started | Phase 0 | Request/result/evidence/diagnostic types compile; fixture expectations pass | Not started |
| 1A.2 Engine orchestration seams | Not started | 1A.1 | Injected context, retrieval, scoring, reranking, RNG, and telemetry run in one engine test | Not started |
| 1B.1 Deterministic weighted retrieval | Not started | 1A.2 | Weighted seeds survive boundaries; stable tie-breaks and source quotas pass | Not started |
| 1B.2 Evidence semantics and candidate retention | Not started | 1B.1 | Provider-family consensus and same-provider repetition fixtures pass | Not started |
| 1C.1 Constrained reranking and backfill | Not started | 1B.2 | MMR direction, diversity relaxation, niche target, calibration window, and count pass | Not started |
| 1A.3 v1 canonical adapter | Not started | 1C.1 | v1 fixture and endpoint behavior match canonical output | Not started |
| 1A.4 Web canonical adapter and legacy removal | Not started | 1A.3 | Web/v1 parity passes and no competing production orchestration remains | Not started |
| 1D.1 Cache revision and invalidation | Not started | 1A.4 | Every profile input affects revision; stale cache fixture misses | Not started |
| 1D.2 Source lifecycle and vector capability gate | Not started | 1D.1 | Vector remains disabled unless model/backfill/score-parity checks pass | Not started |
| 2A.1 Per-user local import state | Not started | Phase 1 | Auth transition and cross-user isolation tests pass | Not started |
| 2A.2 Import normalization | Not started | 2A.1 | Blank years, watchlist timestamps, and watch-event dedup tests pass | Not started |
| 2A.3 Atomic snapshot reconciliation | Not started | 2A.2 | Removed rows reconcile; failures cannot report success; revisions invalidate | Not started |
| 2B.1 Bounded request diagnostics | Not started | 2A.3 | Stage counts/drop reasons/version/seed emitted without private lists or secrets | Not started |
| 2B.2 Exposure schema and diagnostics integration | Not started | 2B.1 | Pre/post rank and source-share telemetry persists with bounded retention | Not started |
| 2C.1 Offline quality and parity evaluation | Not started | 2B.2 | Frozen corpus, rank stability, adapter parity, and regression thresholds pass | Not started |
| 2C.2 Online measurement readiness | Not started | 2C.1 | Experiment assignment and outcome joins are validated | Not started |
| 3.1 Baseline report and optimization hypothesis | Not started | Phase 2 | Baseline report identifies one bounded, measurable change | Not started |
| 3.2 Controlled tuning experiment | Not started | 3.1 | Correctness/parity/stability remain green and outcome guardrails pass | Not started |
| 3.3 Vector go/no-go | Not started | 3.2 | Capability evidence supports activation or records explicit rejection | Not started |
| 3.4 Final audit closure | Not started | 3.3 | Every audit item has evidence, gated defer, or rejection rationale | Not started |

## Phase Gates

Every code checkpoint runs its smallest relevant tests. Every completed phase additionally requires:

```powershell
rtk npm run lint
rtk npm run typecheck
rtk npm run test
rtk npm run build
```

Run relevant Playwright slices where endpoint or UI behavior changed. Database phases also run `rtk supabase test db`, inspect effective grants, and rerun Supabase security and performance advisors. Record command, date, and outcome in Verification Results.

## Audit Coverage

| Audit item | Checkpoint | Required evidence | State |
| --- | --- | --- | --- |
| Critical privileged database functions | 0A.1-0A.3 | Effective privilege tests and advisor results | Open |
| 1. Reversed negative feature feedback | 0B.1 | Probability-boundary unit tests | Open |
| 2. Explicit seeds do not seed neighborhoods | 0B.3 | Retrieval-anchor fixture | Open |
| 3. API recency reversed | 0B.2 | Date-ordered fixture | Open |
| 4. Metadata fetch tuple misalignment | 0B.2 | Failed-middle-fetch fixture | Open |
| 5. False same-provider consensus | 1B.2 | Provider-family evidence fixture | Open |
| 6. Forced background prior | 0C.1 | Neutral-context API test | Open |
| 7. Genre filtering fails open | 0C.2 | Strict genre endpoint test | Open |
| 8. Random pre-score truncation | 1B.1 | Deterministic retention fixture | Open |
| 9. Diversity caps underfill | 1C.1 | Staged-relaxation count test | Open |
| 10. Calibration cannot change composition | 1C.1 | Larger-window replacement test | Open |
| 11. Incorrect niche quota/order | 1C.1 | Score-aware target test | Open |
| 12. Inactive/lossy vector source | 1D.2, 3.3 | Capability and cached-score parity evidence | Open |
| 13. Seed weighting discarded | 1B.1 | Weighted-boundary test | Open |
| 14. Exploration/MMR direction | 1C.1 | Monotonic diversity test | Open |
| 15. Weak profile-cache invalidation | 1D.1 | Input-revision matrix | Open |
| 16. Global weak-seed blacklist | 1B.1 | Removal plus taste-neutral fixture | Open |
| 17. Input failures become generic results | 0C.1 | Degraded-state endpoint test | Open |
| 18. Advanced boosts discarded | 0C.2 | Rank-impact test | Open |
| 19. Case-sensitive negative matching | 0C.2 | Mixed-case test | Open |
| 20. Unseeded randomness | 1B.1 | Repeat-run equality test | Open |
| Cross-user local import state | 2A.1 | Auth-transition isolation tests | Open |
| Larger-row-count state selection | 2A.1 | Cloud-authoritative reconciliation test | Open |
| Blank year becomes zero | 2A.2 | Null-year normalization test | Open |
| Watchlist timestamp loss | 2A.2 | Timestamp round-trip test | Open |
| Duplicate watch events | 2A.2 | Deduplication test | Open |
| Non-atomic snapshot and false success | 2A.3 | Rollback/reconciliation tests | Open |
| Missing request diagnostics | 2B.1-2B.2 | Bounded trace tests | Open |
| Missing deterministic quality suite | 2C.1 | Frozen evaluation corpus and gate | Open |

## Decision Log

| Date | Decision |
| --- | --- |
| 2026-07-19 | Use risk-first convergence: security, correctness, canonical engine, integrity/evaluation, then tuning. |
| 2026-07-19 | Use one shared server-side engine with thin web and v1 adapters; never create a third production engine. |
| 2026-07-19 | Correct v1 behavior in place with additive diagnostics and strict genre behavior by default. |
| 2026-07-19 | Treat request seeds as retrieval anchors that cannot be returned. |
| 2026-07-19 | Keep vector retrieval disabled until capability, versioning, backfill, and cache-score parity gates pass. |
| 2026-07-19 | Use deterministic fixtures and measured outcomes before changing quality weights. |

## Verification Results

- 2026-07-20 - `rtk npx supabase test db --linked --file supabase/tests/database/privileged_functions.test.sql` - CLI rejected the obsolete `--file` flag; Supabase CLI 2.62.5 accepts test paths positionally.
- 2026-07-20 - `rtk npx supabase test db supabase/tests/database/privileged_functions.test.sql --linked` - runner could not start because Supabase CLI requires the `pg_prove` Docker image and Docker Desktop is unavailable.
- 2026-07-20 - Executed the same transaction-isolated pgTAP suite through Supabase MCP against linked project `xtcsekftikdsauttlcin` - expected FAIL, 14 of 20 assertions failed: five `anon` ACL assertions, five inherited `PUBLIC EXECUTE` assertions, and cross-user calls to liked suggestions, film stats, rate limiting, and admin deletion. All five exact-signature assertions and the cross-user `delete_user_data` rejection passed.
- 2026-07-20 - Extended `supabase/tests/database/privileged_functions.test.sql` to 55 assertions covering exact signatures, PUBLIC/anon/authenticated/service_role ACLs, self/cross-user/admin/service invocation, null identity, generated target/non-target rows, returned deletion counts, and post-call preservation. The pre-migration run of `rtk npx supabase test db supabase/tests/database/privileged_functions.test.sql --linked` was blocked before pgTAP execution by the missing Docker Desktop `pg_prove` image; the prior linked 0A.1 run above remains the available failing evidence for the unsafe current behavior.
- 2026-07-20 - `rtk npm run lint` - PASS; no ESLint warnings or errors.
- 2026-07-20 - `rtk npm run typecheck` - PASS; `tsc --noEmit` completed successfully.
- 2026-07-20 - `rtk git diff --check` - PASS.
- 2026-07-20 - `rtk npx playwright test tests/api-v1.spec.ts -g "liked|stats|rate limit"` - BLOCKED/FAIL before endpoint execution: 7 credential-dependent tests skipped and 2 unauthenticated tests failed because no Playwright `baseURL` is configured (`Invalid URL`).
- 2026-07-20 - Supabase MCP `apply_migration` - PASS; production migration `20260720235302_secure_privileged_functions` applied successfully after explicit user authorization.
- 2026-07-20 - Production catalog inspection - PASS; all five exact functions are `SECURITY DEFINER` with `SET search_path = ''`, no `PUBLIC`/`anon` execution remains, and authenticated/service-role grants exactly match the intended matrix.
- 2026-07-20 - Transaction-isolated production authorization probe through Supabase MCP - PASS, 25/25 checks. Generated identities verified anonymous denial, authenticated self/cross-user/null-identity boundaries, database-backed admin authorization, service liked/stats/rate behavior, service deletion denial, and the rate-limit body claim defense; all fixture writes were rolled back.
- 2026-07-20 - Temporary confirmed test identity plus `PLAYWRIGHT_BASE_URL=https://lettrsuggest.netlify.app` and `rtk npx playwright test tests/api-v1.spec.ts -g "Key management flow|Liked suggestions CRUD|GET /suggestions/liked|GET /stats"` - PASS, 13/13. The production gate covered unauthenticated rejection, API-key create/use/rate-limit/revoke, liked suggestion list/create/delete, and film stats. The temporary identity was deleted in a `finally` block; a production query confirmed zero matching test users remained.
- 2026-07-20 - Exact `supabase/tests/database/privileged_functions.test.sql` executed as one transaction through Supabase MCP against production - PASS, 55/55 pgTAP assertions; the script reached `ROLLBACK`. A separate cleanup query confirmed zero retained `@privileged-functions.test` users or `pgtap-*` API keys.
- 2026-07-20 - Production target-function catalog re-query - PASS; all five exact targets remain `SECURITY DEFINER`, use `SET search_path = ''`, deny `anon`, and match the intended authenticated/service-role matrix.
- 2026-07-20 - Supabase performance advisor - REVIEWED; findings are INFO-level unused-index candidates only, with no immediate Phase 0 removal because production traffic evidence is insufficient.
- 2026-07-20 - Supabase security advisor and Management API auth configuration - BLOCKED; 15 lints remain, including five non-target `anon`-executable security-definer functions and disabled leaked-password protection. `PATCH /v1/projects/xtcsekftikdsauttlcin/config/auth` with `password_hibp_enabled: true` was rejected because HaveIBeenPwned protection requires Pro. The user chose to keep the free plan, so no billing or auth configuration change was made.

## Blockers

Checkpoint 0A.3 requires leaked-password protection. Supabase exposes that control only on Pro plans, and the user chose to keep the free plan on 2026-07-20. The checkpoint and all dependent Phase 0 correctness work remain blocked unless the project is upgraded or the approved gate is explicitly revised. The security advisor also retains five non-target `anon`-executable security-definer findings for follow-up containment.

## Completed Commits

- `4221f4d` - approved recommendation remediation design (status approval recorded in the planning commit)
- `test: establish privileged function security baseline` - checkpoint 0A.1 inventory and expected-failing pgTAP contract (this checkpoint)
- `8fa8104` - checkpoint 0A.2 privileged-function migration, authorization tests, caller adaptation, and production evidence
