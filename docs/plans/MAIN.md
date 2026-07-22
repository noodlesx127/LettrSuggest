# Recommendation Remediation Program

**Status:** Ready  
**Current checkpoint:** 1A.1 - Canonical contracts and frozen fixtures  
**Next action:** Begin checkpoint 1A.1 by writing the canonical request, result, evidence, and diagnostic fixture contracts.
**Safe stopping point:** Phase 0 is complete in `c300820`; Phase 1 checkpoint 1A.1 is ready but not started.

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
| 0A.3 Production security validation | Complete | 0A.2 | Effective helper grants/triggers verified; security/performance advisors reviewed; leaked-password/HIBP protection enabled or the dated Free-plan exception below is recorded; no remaining advisor finding is waived | `2fdf02c` |
| 0B.1 Fast test harness and preference contracts | Complete | 0A.3 | Vitest runs in CI shape; polarity and identifier tests pass | `5117a41` |
| 0B.2 Atomic metadata tuples and recency | Complete | 0B.1 | Failed-middle-fetch and date-order fixtures pass | `dbf59dd` |
| 0B.3 Explicit seed semantics | Complete | 0B.2 | Seeds influence retrieval, never appear as results, and runs are deterministic | `07d6885` |
| 0C.1 Input health and neutral request context | Complete | 0B.3 | `ok/empty/failed` state, honest mode, neutral default, and additive diagnostics pass | `e5faf73` |
| 0C.2 Strict filters and effective advanced behavior | Complete | 0C.1 | Genre/negative/threshold contracts and advanced boosts pass | `c300820` |
| 1A.1 Canonical contracts and frozen fixtures | Ready | Phase 0 | Request/result/evidence/diagnostic types compile; fixture expectations pass | Not started |
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
| Critical privileged database functions | 0A.1-0A.3 | Effective privilege tests and advisor results | Closed |
| 1. Reversed negative feature feedback | 0B.1 | Probability-boundary unit tests | Closed |
| 2. Explicit seeds do not seed neighborhoods | 0B.3 | Retrieval-anchor fixture | Closed |
| 3. API recency reversed | 0B.2 | Date-ordered fixture | Closed |
| 4. Metadata fetch tuple misalignment | 0B.2 | Failed-middle-fetch fixture | Closed |
| 5. False same-provider consensus | 1B.2 | Provider-family evidence fixture | Open |
| 6. Forced background prior | 0C.1 | Neutral-context API test | Closed |
| 7. Genre filtering fails open | 0C.2 | Strict genre endpoint test | Closed |
| 8. Random pre-score truncation | 1B.1 | Deterministic retention fixture | Open |
| 9. Diversity caps underfill | 1C.1 | Staged-relaxation count test | Open |
| 10. Calibration cannot change composition | 1C.1 | Larger-window replacement test | Open |
| 11. Incorrect niche quota/order | 1C.1 | Score-aware target test | Open |
| 12. Inactive/lossy vector source | 1D.2, 3.3 | Capability and cached-score parity evidence | Open |
| 13. Seed weighting discarded | 1B.1 | Weighted-boundary test | Open |
| 14. Exploration/MMR direction | 1C.1 | Monotonic diversity test | Open |
| 15. Weak profile-cache invalidation | 1D.1 | Input-revision matrix | Open |
| 16. Global weak-seed blacklist | 1B.1 | Removal plus taste-neutral fixture | Open |
| 17. Input failures become generic results | 0C.1 | Degraded-state endpoint test | Closed |
| 18. Advanced boosts discarded | 0C.2 | Rank-impact test | Closed |
| 19. Case-sensitive negative matching | 0C.2 | Mixed-case test | Closed |
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
| 2026-07-20 | Keep Supabase Free and accept disabled leaked-password/HIBP protection as a platform limitation; this exception is limited to HIBP only and waives no remaining security or performance advisor finding. |

## Verification Results

- 2026-07-20 - `rtk npx supabase test db --linked --file supabase/tests/database/privileged_functions.test.sql` - CLI rejected the obsolete `--file` flag; Supabase CLI 2.62.5 accepts test paths positionally.
- 2026-07-20 - `rtk npx supabase test db supabase/tests/database/privileged_functions.test.sql --linked` - runner could not start because Supabase CLI requires the `pg_prove` Docker image and Docker Desktop is unavailable.
- 2026-07-20 - Executed the same transaction-isolated pgTAP suite through Supabase MCP against linked project `xtcsekftikdsauttlcin` - expected FAIL, 14 of 20 assertions failed: five `anon` ACL assertions, five inherited `PUBLIC EXECUTE` assertions, and cross-user calls to liked suggestions, film stats, rate limiting, and admin deletion. All five exact-signature assertions and the cross-user `delete_user_data` rejection passed.
- 2026-07-20 - Extended `supabase/tests/database/privileged_functions.test.sql` to 55 assertions covering exact signatures, PUBLIC/anon/authenticated/service_role ACLs, self/cross-user/admin/service invocation, null identity, generated target/non-target rows, returned deletion counts, and post-call preservation. The pre-migration run of `rtk npx supabase test db supabase/tests/database/privileged_functions.test.sql --linked` was blocked before pgTAP execution by the missing Docker Desktop `pg_prove` image; the prior linked 0A.1 run above remains the available failing evidence for the unsafe current behavior.
- 2026-07-20 - `rtk npm run lint` - PASS; no ESLint warnings or errors.
- 2026-07-20 - `rtk npm run typecheck` - PASS; `tsc --noEmit` completed successfully.
- 2026-07-21 - Initial `rtk npm run test -- tests/unit/advancedFiltering.test.ts` - expected FAIL, 7/7 failed before strict eligibility, canonical negative matching, and stable score ordering existed. Review-driven extensions later failed 1/10 on post-MMR deduplication and 2/12 on strict-first relaxation tiers and non-finite score rejection before those defects were corrected.
- 2026-07-21 - `rtk npm run test -- tests/unit/advancedFiltering.test.ts tests/unit/recommendationSeeds.test.ts tests/integration/recommendationInputHealth.test.ts` - PASS, 61/61. Strict genre and threshold eligibility, canonical negatives, real cross-genre rank impact, deterministic boosted ordering, explicit additive relaxation, finite-score fail-closed behavior with and without genres, request-seed semantics, and input-health regressions pass.
- 2026-07-21 - Ephemeral confirmed Supabase identity plus `rtk npx playwright test tests/api-v1.spec.ts -g "strict genre"` through the local Playwright web-server configuration - PASS, 1/1. Every returned result matched the requested Action genre and bounded shortage diagnostics were present when applicable. Cleanup ran in `finally`; a production query confirmed zero matching `phase0-strict-filter-%@example.invalid` users.
- 2026-07-21 - Full Phase 0 application gate: `rtk npm run lint` PASS with no warnings/errors; `rtk npm run typecheck` PASS; `rtk npm run test` PASS, 95/95 across 5 files; `rtk npm run build` PASS. The build retained existing non-fatal dynamic-route and stale browser-data warnings.
- 2026-07-21 - Full `tests/api-v1.spec.ts` Playwright gate with an ephemeral confirmed Supabase identity - PASS, 46/46 runnable tests; 12 admin/webhook tests skipped because optional admin credentials were not provided. Cleanup ran in `finally`, and a production query confirmed zero matching `phase0-full-gate-%@example.invalid` users.
- 2026-07-21 - Exact production database phase gate through Supabase MCP - PASS: `privileged_functions.test.sql` 55/55 and `privileged_helpers.test.sql` 67/67, both without SQL errors, both reaching final `ROLLBACK`, and both retaining zero fixture data.
- 2026-07-21 - Final Supabase advisor rerun - REVIEWED. Security remains at six accepted warnings: five intended authenticated `SECURITY DEFINER` functions whose body authorization is covered by pgTAP, plus disabled HIBP under the dated Free-plan exception. Performance remains INFO-only unused-index candidates; no index was removed without production traffic evidence.
- 2026-07-21 - Initial `rtk npm run test -- tests/integration/recommendationInputHealth.test.ts` - expected FAIL, 17/17 failed before source health, honest modes, neutral context, and diagnostics were implemented.
- 2026-07-21 - Safety-review regression extension - expected FAIL: the integration suite recorded 12 failures of 30 and the seed suite recorded 1 failure of 11 before blocked-source fail-closed behavior, payload validation, required diagnostics, sanitized errors, and injected generation time were implemented. A later review extension recorded 4 failures of 34 before conservative partial-health handling, nullable exploration support, and traced 503 envelopes were implemented.
- 2026-07-21 - `rtk npm run test -- tests/integration/recommendationInputHealth.test.ts` - PASS, 34/34. All seven sources distinguish `ok`, `empty`, and `failed`; malformed payloads fail validation; required failures degrade; blocked-source failure returns a bounded traced 503 before generation; healthy empty history is cold start; contributing mapped evidence is personalized; and omitted context is neutral.
- 2026-07-21 - `rtk npm run test -- tests/unit/recommendationSeeds.test.ts` - PASS, 11/11 after request-time injection was added to deterministic seed selection.
- 2026-07-21 - Ephemeral confirmed Supabase identity plus `rtk npx playwright test tests/api-v1.spec.ts -g "generation diagnostics|neutral context"` through the retained local Playwright web-server configuration - PASS, 2/2. The HTTP gate verified bounded additive diagnostics, standard envelopes, neutral context, and stable request seeds. The identity was deleted in `finally`; a production query confirmed zero matching `phase0-input-health-%@example.invalid` users remained.
- 2026-07-21 - `rtk npm run lint`, `rtk npm run typecheck`, and `rtk git diff --check` - PASS. Independent spec and code-quality reviews approved 0C.1 after fail-open, malformed-input, diagnostics-consistency, clock, logging, partial-health, nullable-exploration, and error-envelope findings were corrected.
- 2026-07-21 - Initial `rtk npm run test -- tests/unit/recommendationSeeds.test.ts` - expected FAIL, 2 failed / 1 passed because the provider seam recorded no neighborhood requests before explicit seeds were wired into retrieval.
- 2026-07-21 - Seed-contract review extensions - expected FAIL, first because the route helper seam did not exist, then 4 of 10 tests failed on canonical seed order, stable equal-score history order, provider concurrency (`29 > 5`), and omitted/empty genre canonicalization.
- 2026-07-21 - `rtk npm run test -- tests/unit/recommendationSeeds.test.ts` - PASS, 10/10. Explicit seeds are deterministic neighborhood anchors, are absent from candidates and source metadata, combine explicit-first with stable history anchors, ignore global randomness, preserve the deferred weak-seed blacklist, canonicalize set-like request inputs, and retain all anchors behind a request-scoped provider concurrency limit of 5 including fallbacks.
- 2026-07-21 - `rtk npm run typecheck` and `rtk git diff --check` - PASS. Independent spec and code-quality reviews approved the checkpoint after route-boundary, canonicalization, history-order, and concurrency gaps were corrected.
- 2026-07-21 - Initial `rtk npm run test -- tests/unit/recommendationNormalization.test.ts` - expected FAIL because `@/lib/recommendationNormalization` did not exist, establishing the 0B.2 red state.
- 2026-07-21 - `rtk npm run test -- tests/unit/recommendationNormalization.test.ts` - PASS, 8/8. The suite covers failed-middle-fetch identity, shuffled and tied date order, failed metadata inside the recent window, distinct-film recency, pinned feedback at and beyond caps, and one-details-result fan-out for duplicate film events.
- 2026-07-21 - `rtk npm run typecheck` and `rtk git diff --check` - PASS. Independent spec and code-quality reviews approved atomic tuple integration after recent-window, pinned-feedback, unique-fetch, and duplicate-film corrections.
- 2026-07-20 - `rtk git diff --check` - PASS.
- 2026-07-20 - `rtk npx playwright test tests/api-v1.spec.ts -g "liked|stats|rate limit"` - BLOCKED/FAIL before endpoint execution: 7 credential-dependent tests skipped and 2 unauthenticated tests failed because no Playwright `baseURL` is configured (`Invalid URL`).
- 2026-07-20 - Supabase MCP `apply_migration` - PASS; production migration `20260720235302_secure_privileged_functions` applied successfully after explicit user authorization.
- 2026-07-20 - Production catalog inspection - PASS; all five exact functions are `SECURITY DEFINER` with `SET search_path = ''`, no `PUBLIC`/`anon` execution remains, and authenticated/service-role grants exactly match the intended matrix.
- 2026-07-20 - Transaction-isolated production authorization probe through Supabase MCP - PASS, 25/25 checks. Generated identities verified anonymous denial, authenticated self/cross-user/null-identity boundaries, database-backed admin authorization, service liked/stats/rate behavior, service deletion denial, and the rate-limit body claim defense; all fixture writes were rolled back.
- 2026-07-20 - Temporary confirmed test identity plus `PLAYWRIGHT_BASE_URL=https://lettrsuggest.netlify.app` and `rtk npx playwright test tests/api-v1.spec.ts -g "Key management flow|Liked suggestions CRUD|GET /suggestions/liked|GET /stats"` - PASS, 13/13. The production gate covered unauthenticated rejection, API-key create/use/rate-limit/revoke, liked suggestion list/create/delete, and film stats. The temporary identity was deleted in a `finally` block; a production query confirmed zero matching test users remained.
- 2026-07-20 - Exact `supabase/tests/database/privileged_functions.test.sql` executed as one transaction through Supabase MCP against production - PASS, 55/55 pgTAP assertions; the script reached `ROLLBACK`. A separate cleanup query confirmed zero retained `@privileged-functions.test` users or `pgtap-*` API keys.
- 2026-07-20 - Production target-function catalog re-query - PASS; all five exact targets remain `SECURITY DEFINER`, use `SET search_path = ''`, deny `anon`, and match the intended authenticated/service-role matrix.
- 2026-07-20 - Supabase performance advisor - REVIEWED; findings are INFO-level unused-index candidates only, with no immediate Phase 0 removal because production traffic evidence is insufficient.
- 2026-07-20 - Supabase security advisor and Management API auth configuration - REVIEWED; 15 lints remained, including five non-target `anon`-executable security-definer functions and disabled leaked-password protection. `PATCH /v1/projects/xtcsekftikdsauttlcin/config/auth` with `password_hibp_enabled: true` was rejected because HaveIBeenPwned protection requires Pro. The user explicitly approved keeping Free and accepting this HIBP-only limitation; no other advisor finding is waived and no billing or Auth configuration change was made.
- 2026-07-20 - Pre-migration production baseline: the unchanged then-current `supabase/tests/database/privileged_helpers.test.sql` ran as one transaction, reached `finish()` and `ROLLBACK`, and recorded 31 passed / 33 failed of 64 assertions as expected. No permanent database changes remained.
- 2026-07-20 - Targeted follow-up transaction: `on_auth_user_created_role` matched `tgrelid = auth.users`, the exact `handle_new_user_role()` `tgfoid`, `tgtype = 5`, and enabled state; inserting two generated `auth.users` rows created both profile rows and both default `user_roles` rows. The transaction rolled back with no permanent changes.
- 2026-07-20 - Final pre-migration production baseline: the exact 67-assertion `supabase/tests/database/privileged_helpers.test.sql` transaction reached `finish()` and `ROLLBACK`, with 34 passed / 33 expected failures and no retained writes. All three film-trigger behavior assertions passed; the failures were the intended search-path, ACL, arbitrary-ID, and prune-validation contracts.
- 2026-07-20 - `rtk git diff --check` - PASS after the film-trigger contract and documentation updates; Git emitted only the pre-existing LF/CRLF warning for `supabase/.temp/cli-latest`.
- 2026-07-20 - Supabase MCP `apply_migration` - PASS; production migration `20260721011822_contain_privileged_helpers` applied successfully. The repository migration is aligned at `supabase/migrations/20260721011822_contain_privileged_helpers.sql`.
- 2026-07-20 - Exact post-migration `supabase/tests/database/privileged_helpers.test.sql` production transaction - PASS, 67/67 pgTAP assertions with no SQL errors; the script reached `ROLLBACK` and retained no writes.
- 2026-07-20 - Production helper catalog and trigger re-query - PASS; all five helpers are owned by `postgres`, are `SECURITY DEFINER`, and use `SET search_path = ''`. `handle_new_user()`, `handle_new_user_role()`, `prune_api_caches(integer)`, and `sync_film_events_last_date()` are executable only by `postgres`; `is_admin(uuid)` is executable only by `authenticated` and `postgres`. The two auth triggers remain enabled AFTER INSERT ROW triggers, and the film-date trigger remains an enabled AFTER INSERT OR UPDATE ROW trigger on `film_diary_events_raw`.
- 2026-07-20 - Production cleanup and cron verification - PASS; zero generated helper-test auth users, films, or raw diary rows remained. Cron job 1 remains active as `postgres` at `20 3 * * *` with `select public.prune_api_caches(30);`, and the function retains all eight production prune targets.
- 2026-07-20 - Final Supabase advisor review - PASS for the accepted gate. Security warnings fell from 15 to 6: five intended authenticated `SECURITY DEFINER` RPC warnings whose body authorization is covered by pgTAP, plus disabled HIBP under the dated Free-plan exception. All five prior anonymous helper-exposure warnings are resolved. Performance findings remain INFO-only unused-index candidates and were not removed without traffic evidence.
- 2026-07-20 - `rtk npm install --save-dev vitest@^4.1.6` - PASS; Vitest 4.1.10 resolved and the Node test harness/scripts were added with the planned unit/integration include paths and `@` alias.
- 2026-07-20 - Initial `rtk npm run test -- tests/unit/recommendationPreference.test.ts` - expected FAIL because `@/lib/recommendationPreference` did not exist, establishing the 0B.1 red state.
- 2026-07-20 - Direction-confidence and legacy-input regression extension - expected FAIL, 8 of 26 assertions failed before the fix across numeric/categorical strings, out-of-range inputs, negative-weight monotonicity, and effective subgenre override evidence.
- 2026-07-20 - `rtk npm run test -- tests/unit/recommendationPreference.test.ts` - PASS, 26/26. Boundary polarity, neutral/invalid inputs, aliases, engine integration, direction-aware negative confidence, and subgenre override evidence pass.
- 2026-07-20 - `rtk npm run lint` - PASS; no ESLint warnings or errors.
- 2026-07-20 - `rtk npm run typecheck` - PASS; `tsc --noEmit` completed successfully.

## Blockers

None. The approved 2026-07-20 gate exception remains limited to disabled leaked-password/HIBP protection on Supabase Free and waives no other security or performance advisor finding.

## Completed Commits

- `4221f4d` - approved recommendation remediation design (status approval recorded in the planning commit)
- `test: establish privileged function security baseline` - checkpoint 0A.1 inventory and expected-failing pgTAP contract (this checkpoint)
- `8fa8104` - checkpoint 0A.2 privileged-function migration, authorization tests, caller adaptation, and production evidence
- `139710c` - checkpoint 0A.2 production caller gate and reusable Playwright configuration
- `6f0828f` - checkpoint 0A.3 initial production validation and Free-plan HIBP blocker evidence
- `2fdf02c` - checkpoint 0A.3 helper containment, production verification, and advisor closure
- `5117a41` - checkpoint 0B.1 Vitest harness and corrected preference semantics
- `dbf59dd` - checkpoint 0B.2 atomic metadata identity and deterministic recency
- `07d6885` - checkpoint 0B.3 deterministic explicit-seed retrieval and exclusion
- `e5faf73` - checkpoint 0C.1 source-health, fail-closed generation, neutral context, and additive diagnostics
- `c300820` - checkpoint 0C.2 strict filters, effective advanced ranking, and complete Phase 0 verification
