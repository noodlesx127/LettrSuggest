# Phase 0: Containment and Correctness

**Phase state:** In progress  
**Current checkpoint:** 0C.2  
**Exit condition:** Privileged functions enforce effective authorization, proven signal defects are fixture-tested, and v1 reports honest deterministic behavior.

`docs/plans/MAIN.md` controls checkpoint status. Execute in order.

## Checkpoint 0A.1: Privileged-Function Inventory and Failing Baseline

**State:** Complete

**Files:**
- Create: `supabase/tests/database/privileged_functions.test.sql`
- Create: `docs/summary/privileged-function-inventory.md`
- Inspect: `supabase/migrations/20260405130000_fix_security_advisors.sql`
- Inspect: `supabase/migrations/20260322130000_create_film_diary_events_raw.sql`
- Inspect: `src/app/api/v1/suggestions/liked/route.ts`
- Inspect: `src/app/api/v1/stats/route.ts`
- Inspect: `src/app/api/v1/_lib/rateLimiter.ts`
- Inspect: `src/app/actions/admin.ts`

- [x] **Step 1: Mark 0A.1 in progress**

Change 0A.1 to `In progress` in this file and `MAIN.md`; keep every other checkpoint not active.

- [x] **Step 2: Record effective production signatures and ACLs**

Query `pg_proc`, `pg_namespace`, and `aclexplode(coalesce(proacl, acldefault('f', proowner)))` for every public security-definer function and all overloads of `add_liked_suggestion`, `get_film_stats`, `increment_rate_limit`, `delete_user_data`, and `admin_delete_user_data`. Record exact identity arguments, owner, security mode, search path, executable roles, intended caller, and application call site in the inventory.

- [x] **Step 3: Write negative pgTAP authorization tests**

The test must set role/JWT claims and assert:

```sql
select has_function('public', 'add_liked_suggestion', array['uuid','integer','text','integer','text']);
select function_privs_are('public', 'add_liked_suggestion', array['uuid','integer','text','integer','text'], 'anon', array[]::text[]);
select function_privs_are('public', 'get_film_stats', array['uuid'], 'anon', array[]::text[]);
select function_privs_are('public', 'delete_user_data', array['uuid'], 'anon', array[]::text[]);
```

Add authenticated cross-user calls inside `lives_ok`/`throws_ok` assertions using two generated test users. Assert the current unsafe behavior rather than weakening the test to migration text.

- [x] **Step 4: Run the baseline and confirm a security failure**

Run: `rtk npx supabase test db supabase/tests/database/privileged_functions.test.sql`  
Expected: FAIL because at least one unsafe role can execute a privileged user-targeted function or a cross-user function trusts `p_user_id`.

- [x] **Step 5: Complete and commit the inventory checkpoint**

Record the failing assertions and command in `MAIN.md`; mark 0A.1 complete and 0A.2 ready.

```powershell
rtk git add supabase/tests/database/privileged_functions.test.sql docs/summary/privileged-function-inventory.md docs/plans/MAIN.md docs/plans/phases/phase-0-containment-and-correctness.md
rtk git commit -m "test: establish privileged function security baseline"
```

## Checkpoint 0A.2: Authorization and Grants Migration

**State:** Complete

**Files:**
- Create: `supabase/migrations/20260720235302_secure_privileged_functions.sql`
- Modify: `supabase/tests/database/privileged_functions.test.sql`
- Verify: application callers listed in 0A.1

- [x] **Step 1: Extend tests for the intended privilege matrix**

Assert exact signatures and outcomes: `anon` has no execute access; authenticated self-service functions require `auth.uid() = p_user_id`; cross-user calls fail; admin deletion requires a role verified from `user_roles`; rate limiting is service-only unless the API is changed to use authenticated self-operation; service callers continue to work.

Evidence: `supabase/tests/database/privileged_functions.test.sql` now covers the five exact signatures, inherited `PUBLIC` access, `anon`/`authenticated`/`service_role` ACLs, generated self/cross-user/admin fixtures, null identity, positive/negative calls, returned deletion counts, and target/non-target row outcomes. A manual audit confirms 55 assertion-producing pgTAP calls match `select plan(55)`. SQLSTATE/message checks are constrained to the ACL and function authorization contracts; fixtures use generated UUIDs, valid auth/profile/user-role FKs, actual table schemas, and transaction rollback.

- [x] **Step 2: Establish the failing authorization baseline before implementation**

Run: `rtk npx supabase test db supabase/tests/database/privileged_functions.test.sql`  
Expected: FAIL on the new self/admin/service authorization matrix.

Evidence: The linked 0A.1 pgTAP baseline established the required red state with 14/20 failures across all five target ACLs and four unsafe cross-user paths. The expanded suite retained those failing contracts and added the intended positive boundaries before implementation; the unavailable Docker-backed runner prevented a redundant expanded pre-migration execution.

- [x] **Step 3: Add one forward-only migration**

For every exact signature, the migration must revoke inherited access before granting the minimum role:

```sql
revoke all on function public.add_liked_suggestion(uuid, integer, text, integer, text) from public, anon, authenticated;
revoke all on function public.get_film_stats(uuid) from public, anon, authenticated;
revoke all on function public.increment_rate_limit(uuid, timestamptz) from public, anon, authenticated;
```

Recreate self-service bodies with fixed `search_path`, explicit `auth.uid()` checks, and no trusted caller identity. Keep admin-targeted and service-only routines separate. Drop obsolete unsafe overloads identified in 0A.1.

Evidence: `supabase/migrations/20260720235302_secure_privileged_functions.sql` contains the single forward-only migration, uses `CREATE OR REPLACE FUNCTION` for every exact target, keeps `scope text DEFAULT 'all'`, deletes `public.film_diary_events_raw` in admin import/all while preserving the `film_diary_events` response key, and applies the minimum grants. Supabase MCP applied it directly to production as migration `20260720235302_secure_privileged_functions` on 2026-07-20 after explicit user authorization.

- [x] **Step 4: Adapt callers only where the minimum role contract requires it**

Keep caller-supplied IDs derived from the verified session, never request JSON. If a routine becomes service-only, retain it behind server code using the service client and verify the route authenticates before invoking it.

Evidence: Existing API callers retain their verified server-side/service-role paths; the admin delete action now invokes the admin RPC with a request-scoped anon-key client carrying the verified access token, while `requireAdmin` continues to enforce the admin role. No caller scope was broadened. Step 5 records the passing production API verification.

- [x] **Step 5: Run database and API tests**

Run: `rtk npx supabase test db supabase/tests/database/privileged_functions.test.sql`  
Expected: PASS.  
Run: `rtk npx playwright test tests/api-v1.spec.ts -g "liked|stats|rate limit"`  
Expected: PASS for authorized callers and rejection for unauthorized callers.

Evidence: Production catalog inspection passed for all exact signatures, fixed search paths, and effective ACLs. The exact retained 55-assertion pgTAP file then passed as one production transaction through Supabase MCP and reached `ROLLBACK`; a separate query found zero retained generated users or keys. A temporary confirmed test identity and `PLAYWRIGHT_BASE_URL=https://lettrsuggest.netlify.app` ran the production application gate: 13/13 Playwright tests passed across unauthenticated rejection, API-key create/use/rate-limit/revoke, liked list/create/delete, and stats. Cleanup ran in `finally`, and a production query confirmed zero matching test users remained.

- [x] **Step 6: Commit the authorization fix**

Update tracker evidence, mark 0A.2 complete, and make 0A.3 ready.

Evidence: Implementation and production database evidence were committed in `8fa8104`; the passing pgTAP and application-caller gates plus reusable Playwright base-URL configuration complete the checkpoint in a follow-up test commit.

```powershell
rtk git add supabase/migrations supabase/tests/database/privileged_functions.test.sql src/app/api/v1 src/app/actions/admin.ts docs/plans/MAIN.md docs/plans/phases/phase-0-containment-and-correctness.md
rtk git commit -m "fix: enforce privileged function authorization"
```

## Checkpoint 0A.3: Production Security Validation

**State:** Complete

**Files:**
- Create: `supabase/migrations/20260721011822_contain_privileged_helpers.sql`
- Create: `supabase/tests/database/privileged_helpers.test.sql`
- Modify: `docs/summary/privileged-function-inventory.md`
- Modify: `docs/plans/MAIN.md`

### Current helper-containment extension

- [x] **Step A: Write the focused pgTAP contract before the migration**

  `supabase/tests/database/privileged_helpers.test.sql` is transaction-isolated and plans exactly 67 assertions. The final exact pre-migration production run reached `finish()` and `ROLLBACK`, recording 34 passed / 33 expected failures with no permanent changes. The contract covers exact signatures, ownership/grantees, fixed search paths, schema-qualified bodies, trigger catalogs and outcomes, generated identities, `is_admin` self/cross-user authorization, raw diary INSERT/UPDATE synchronization, non-target preservation, and safe prune validation/denial probes.

- [x] **Step B: Add one forward-only helper-containment migration**

  `supabase/migrations/20260721011822_contain_privileged_helpers.sql` hardens all five helper bodies, preserves all eight live prune deletions, reconciles `on_auth_user_created_role` and `trg_sync_film_events_last_date` without `CASCADE`, revokes client/public execution, grants `authenticated` only on `is_admin(uuid)`, and ends with the PostgREST schema reload notification. Supabase applied it as production migration `20260721011822_contain_privileged_helpers`.

- [x] **Step C: Run the migration and post-migration verification**

  Production migration `20260721011822_contain_privileged_helpers` applied successfully. The exact unchanged pgTAP suite passed 67/67 in a rolled-back production transaction. Catalog verification confirmed `postgres` ownership, empty search paths, owner-only execution for trigger/maintenance helpers, authenticated-plus-owner execution for `is_admin(uuid)`, and the exact enabled trigger contracts. Cleanup found zero retained generated identities or film rows. Cron job 1 remains active and unchanged as `postgres`. Final security review contains only five intended body-authorized authenticated RPC warnings plus the approved HIBP limitation; performance findings remain INFO-only.

The earlier steps below are completed validation evidence for the 0A.2 target RPCs; the helper-containment extension above is the final completed 0A.3 work.

### Previously completed 0A.2 target validation

- [x] **Step 1: Apply the migration to the intended environment**

Use the Supabase development branch/local workflow. Do not apply an untested migration directly to production.

Evidence: A development branch and local Docker runtime were unavailable. After the user explicitly authorized direct production deployment, migration `20260720235302_secure_privileged_functions` was applied and validated transactionally in production.

- [x] **Step 2: Re-query effective privileges**

Repeat the 0A.1 catalog query and compare every overload/role with the intended matrix. Record differences and resolve them before continuing.

Evidence: The 2026-07-20 production re-query found all five exact targets present, security-definer, fixed to `SET search_path = ''`, denied to `anon`, and matched to the intended authenticated/service-role matrix.

- [x] **Step 3: Run remote negative and positive validation**

Verify anonymous, cross-user, self-service, admin, and service behavior through the same interfaces production uses. No role may rely only on an ACL check when the function body also needs identity authorization.

Evidence: The exact 55-assertion pgTAP suite passed as a rolled-back production transaction, and the 13-test Playwright production slice passed through JWT and API-key application paths. Cleanup queries found no retained generated identities or keys.

- [x] **Step 4: Review platform controls**

Run Supabase security and performance advisors. Enable leaked-password protection in Auth settings when the selected plan supports it, or record the explicit dated HIBP-only Free-plan exception without storing credentials.

Evidence: Advisors were reviewed on 2026-07-20. Performance findings are INFO-level unused indexes. Security reported 15 lints, including five non-target functions still executable by `anon` and disabled leaked-password protection. The Management API rejected `password_hibp_enabled: true` because the feature requires Pro. The user explicitly approved keeping Free and accepting disabled leaked-password/HIBP protection as a limitation dated 2026-07-20; the exception is limited to HIBP only and does not waive any remaining advisor finding. No billing or Auth configuration change occurred.

- [x] **Step 5: Commit validation evidence**

0A.3 is complete and 0B.1 is ready. The checkpoint commit includes the aligned migration source, focused pgTAP contract, inventory, and tracker evidence.

```powershell
rtk git add supabase/migrations/20260721011822_contain_privileged_helpers.sql supabase/tests/database/privileged_helpers.test.sql docs/summary/privileged-function-inventory.md docs/plans/MAIN.md docs/plans/phases/phase-0-containment-and-correctness.md
rtk git commit -m "fix: contain privileged helper functions"
```

## Checkpoint 0B.1: Fast Test Harness and Preference Contracts

**State:** Complete

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vitest.config.ts`
- Create: `src/lib/recommendationPreference.ts`
- Create: `tests/unit/recommendationPreference.test.ts`
- Modify: `src/lib/serverSuggestionsEngine.ts`

- [x] **Step 1: Install and configure Vitest**

Run: `rtk npm install --save-dev vitest@^4.1.6`  
Add the scripts and configuration specified in `docs/plans/testing-strategy.md`.

Evidence: Vitest 4.1.10 resolved from the requested compatible range. `vitest.config.ts` uses the Node environment, planned unit/integration includes, and the `@` source alias. `package.json` exposes `test`, `test:unit`, and `test:integration` run scripts.

- [x] **Step 2: Write failing polarity and identifier tests**

```typescript
expect(classifyPreferenceProbability(0.49)).toBe("negative");
expect(classifyPreferenceProbability(0.5)).toBe("neutral");
expect(classifyPreferenceProbability(0.51)).toBe("positive");
expect(normalizeFeatureKey(" Keywords ", "Time Travel")).toEqual({ type: "keyword", id: "time travel" });
```

Also test null/non-finite inputs and canonical feature-type aliases.

Evidence: `tests/unit/recommendationPreference.test.ts` covers the 0.49/0.5/0.51 boundary, null/non-finite/out-of-range values, numeric and categorical legacy strings, canonical type aliases, engine routing, negative confidence monotonicity, and effective subgenre override evidence.

- [x] **Step 3: Run the tests and confirm failure**

Run: `rtk npm run test -- tests/unit/recommendationPreference.test.ts`  
Expected: FAIL because the pure module does not exist.

Evidence: The first focused run failed because `@/lib/recommendationPreference` did not exist. The review-driven regression extension then failed 8 of 26 assertions before its implementation, confirming the string, range, weight-direction, and subgenre evidence defects.

- [x] **Step 4: Implement the minimal pure contract and replace v1 sign logic**

Export `classifyPreferenceProbability(value): "negative" | "neutral" | "positive"` using the `0.5` boundary. Export `normalizeFeatureKey(type, id)` with trimmed lowercase canonical values. Update `buildFeatureFeedbackFromRows` to ignore neutral values and use the shared result.

Evidence: `src/lib/recommendationPreference.ts` provides the shared finite 0..1 probability and canonical identifier contracts. `buildFeatureFeedbackFromRows` now ignores neutral/invalid rows, uses canonical feature types, weights negative probabilities as `1 - p`, preserves numeric/categorical legacy inputs, and computes subgenre weight/count from the effective direction.

- [x] **Step 5: Run the harness gate and commit**

Run: `rtk npm run test -- tests/unit/recommendationPreference.test.ts`  
Expected: PASS.  
Run: `rtk npm run typecheck`  
Expected: PASS.

Evidence: The focused suite passes 26/26; `npm run lint`, `npm run typecheck`, and `git diff --check` pass. Independent spec and code-quality reviews approved the checkpoint after the direction-confidence and subgenre fixes.

```powershell
rtk git add package.json package-lock.json vitest.config.ts src/lib/recommendationPreference.ts src/lib/serverSuggestionsEngine.ts tests/unit/recommendationPreference.test.ts docs/plans
rtk git commit -m "fix: correct recommendation preference polarity"
```

## Checkpoint 0B.2: Atomic Metadata Tuples and Recency

**State:** Complete

**Files:**
- Create: `src/lib/recommendationNormalization.ts`
- Create: `tests/unit/recommendationNormalization.test.ts`
- Modify: `src/lib/enrich.ts`
- Modify: `src/lib/serverSuggestionsEngine.ts`
- Modify: `src/app/api/v1/suggestions/generate/route.ts`

- [x] **Step 1: Write failed-middle-fetch and order-independent tests**

Build three film inputs with distinct rating/date/feature markers and fail metadata for the middle film. Assert the first and third retain their own markers. Shuffle identical dated inputs and assert normalized recent IDs are equal.

Evidence: The focused fixture retains all three tuples and their own ratings, dates, details, and features when the middle details result is null. Shuffled and equal-date inputs produce the same date-descending, TMDB-ID-tied order. Additional contracts cover failed and duplicate entries at the recent boundary and explicit feedback under history caps.

- [x] **Step 2: Confirm the tests fail**

Run: `rtk npm run test -- tests/unit/recommendationNormalization.test.ts`  
Expected: FAIL because compacted feature arrays and positional recency break tuple identity.

Evidence: The initial focused run failed because `@/lib/recommendationNormalization` did not exist, establishing the red state before production implementation.

- [x] **Step 3: Introduce and use an atomic normalized film tuple**

Define a typed tuple containing URI, TMDB ID, film event, rating, watch date, details health, details, and features. Preserve failed details as `null` in the same tuple. Sort recency by parsed date with TMDB ID as deterministic tie-breaker; do not infer recency from input position.

Evidence: `recommendationNormalization.ts` owns the atomic tuple and pure selection contracts. `suggestByOverlap` fetches each unique ID once, fans details back to intact tuples, uses tuple identity for weighting and attribution, applies date sorting before caps, and selects recent distinct films before dropping failed features. The v1 adapter now preserves `last_date`, and server taste-profile input is deterministically date ordered.

- [x] **Step 4: Run focused tests and typecheck**

Run: `rtk npm run test -- tests/unit/recommendationNormalization.test.ts`  
Expected: PASS.  
Run: `rtk npm run typecheck`  
Expected: PASS.

Evidence: The focused suite passes 8/8; typecheck and `git diff --check` pass. Independent spec and code-quality reviews approved the checkpoint after explicit-feedback and duplicate-ID regressions were corrected.

- [x] **Step 5: Commit**

```powershell
rtk git add src/lib/recommendationNormalization.ts src/lib/enrich.ts src/lib/serverSuggestionsEngine.ts src/app/api/v1/suggestions/generate/route.ts tests/unit/recommendationNormalization.test.ts docs/plans
rtk git commit -m "fix: preserve recommendation metadata identity"
```

## Checkpoint 0B.3: Explicit Seed Semantics

**State:** Complete

**Files:**
- Create: `tests/unit/recommendationSeeds.test.ts`
- Create: `src/app/api/v1/suggestions/generate/routeHelpers.ts`
- Modify: `src/lib/serverSuggestionsEngine.ts`
- Modify: `src/app/api/v1/suggestions/generate/route.ts`

- [x] **Step 1: Write failing seed tests**

Inject a provider fake that records requested seed IDs. Assert explicit seeds are requested as neighborhoods, excluded from returned candidates, combined deterministically with history seeds, and produce equal output for an equal request seed.

- [x] **Step 2: Confirm current behavior fails**

Run: `rtk npm run test -- tests/unit/recommendationSeeds.test.ts`  
Expected: FAIL because explicit seeds are inserted as candidates rather than retrieval anchors.

Evidence: The first focused run recorded 2 failures / 1 pass because the provider seam saw no neighborhood calls. Review-driven extensions also failed before their fixes on the missing route helper seam, canonical ordering, shuffled equal-score history, and unbounded provider concurrency.

- [x] **Step 3: Implement retrieval-anchor behavior**

Pass explicit seeds into neighborhood retrieval, add them to the exclusion set before scoring, remove direct candidate insertion, and derive all selection from the request-scoped seed. Keep the global weak-seed list removal for Phase 1B.1 where all retrieval paths converge.

Evidence: Explicit seeds are canonicalized and scheduled first, history anchors have deterministic score/date/TMDB/URI ordering, route inputs derive a canonical request seed, candidates are defensively filtered at both engine and route boundaries, and all provider/fallback requests share a request-scoped concurrency limit of 5.

- [x] **Step 4: Verify and commit**

Run: `rtk npm run test -- tests/unit/recommendationSeeds.test.ts`  
Expected: PASS.

Evidence: The focused suite passes 10/10; typecheck and `git diff --check` pass. Independent spec and code-quality reviews approved the checkpoint after partial-leak, route-boundary, deterministic-order, and provider-concurrency gaps were corrected.

```powershell
rtk git add src/lib/serverSuggestionsEngine.ts src/app/api/v1/suggestions/generate/route.ts src/app/api/v1/suggestions/generate/routeHelpers.ts tests/unit/recommendationSeeds.test.ts docs/plans
rtk git commit -m "fix: use explicit seeds as retrieval anchors"
```

## Checkpoint 0C.1: Input Health and Neutral Request Context

**State:** Complete

**Files:**
- Create: `tests/integration/recommendationInputHealth.test.ts`
- Modify: `src/lib/serverSuggestionsEngine.ts`
- Modify: `src/lib/enrich.ts`
- Modify: `src/app/api/v1/suggestions/generate/route.ts`
- Modify: `src/app/api/v1/suggestions/generate/routeHelpers.ts`
- Modify: `tests/api-v1.spec.ts`
- Modify: `tests/unit/recommendationSeeds.test.ts`

- [x] **Step 1: Write health and context tests**

Assert each input source returns `ok`, `empty`, or `failed`; a failed required source yields mode `degraded`; valid empty history yields `cold_start`; complete context yields `personalized`; omitted viewing context is neutral and never background.

Evidence: The focused integration suite covers all seven source states, required and optional failures, malformed containers and rows, cold-start and personalized evidence, blocked-source fail-closed behavior, bounded diagnostics, and omitted/explicit context modes.

- [x] **Step 2: Confirm failure**

Run: `rtk npm run test -- tests/integration/recommendationInputHealth.test.ts`  
Expected: FAIL because failures collapse to empty and the route forces background.

Evidence: The initial suite failed 17/17. Review-driven contracts later failed 12 of 30 integration tests plus 1 of 11 seed tests, then 4 of 34 integration tests, before the safety and compatibility corrections were implemented.

- [x] **Step 3: Implement source health and additive diagnostics**

Return per-source health from `loadUserContext`; derive overall mode without relabeling failed data; represent neutral context explicitly; remove forced background. Add response metadata for mode, failed source names, engine version, and deterministic request seed.

Evidence: Required context diagnostics are validated and conservatively normalized; blocked-source failure returns a traced 503 before profile, provider, cache, or scoring work; optional failures remain visible; generation time is injected; and response metadata is additive and bounded on both successful response paths.

- [x] **Step 4: Verify integration and HTTP behavior**

Run: `rtk npm run test -- tests/integration/recommendationInputHealth.test.ts`  
Expected: PASS.  
Run: `rtk npx playwright test tests/api-v1.spec.ts -g "generation diagnostics|neutral context"`  
Expected: PASS.

Evidence: The focused integration suite passes 34/34 and the seed regression suite passes 11/11. The authenticated HTTP slice passes 2/2 with an ephemeral confirmed Supabase user, proving bounded diagnostics, neutral context, standard envelopes, and stable request seeds; cleanup left zero matching users. Lint, typecheck, and diff hygiene pass, and independent spec and code-quality reviews approve the checkpoint.

- [x] **Step 5: Commit**

```powershell
rtk git add src/lib/serverSuggestionsEngine.ts src/lib/enrich.ts src/app/api/v1/suggestions/generate/route.ts tests docs/plans
rtk git commit -m "fix: report recommendation input health honestly"
```

## Checkpoint 0C.2: Strict Filters and Effective Advanced Behavior

**State:** In progress

**Files:**
- Create: `tests/unit/advancedFiltering.test.ts`
- Modify: `src/lib/advancedFiltering.ts`
- Modify: `src/lib/enrich.ts`
- Modify: `src/app/api/v1/suggestions/generate/route.ts`
- Modify: `src/app/api/v1/suggestions/generate/routeHelpers.ts`
- Modify: `tests/unit/recommendationSeeds.test.ts`
- Modify: `tests/api-v1.spec.ts`

- [x] **Step 1: Write failing filter tests**

Assert explicit genres never return a non-matching film by default, mixed-case keywords match canonical negatives, advanced boosts change stable order, and score thresholds do not silently re-admit rejected items. Test explicit staged relaxation only when the request opts into it.

Evidence: `tests/unit/advancedFiltering.test.ts` contains 13 focused contracts covering strict genre and threshold eligibility, mixed-case/whitespace negative keywords, real cross-genre rank impact, effective-score and TMDB-ID ordering, post-MMR order/duplicate preservation, explicit strict-first relaxation tiers, shortage diagnostics, and non-finite score rejection with and without a genre request. Route-seed tests cover relaxation canonicalization and invalid inapplicable relaxation.

- [x] **Step 2: Confirm failure**

Run: `rtk npm run test -- tests/unit/advancedFiltering.test.ts`  
Expected: FAIL on case normalization and discarded boost behavior.

Evidence: The initial focused run failed 7/7 before the filtering helpers and canonical matching existed. Review-driven TDD extensions then failed 1/10 before post-MMR deduplication was removed and 2/12 before strict-first additive relaxation and finite-score exclusion were implemented.

- [x] **Step 3: Implement strict eligibility and stable boosted order**

Normalize both candidate and avoided keyword values. Apply `boost` to the candidate ranking input with TMDB ID tie-breaks. Remove fail-open fallback for strict genre and threshold constraints; return fewer results with diagnostic reason when eligible supply is insufficient.

Evidence: `advancedFiltering.ts` now canonicalizes negative keywords, treats genre and score as strict finite eligibility constraints, preserves post-MMR order during filtering, and supports only explicit additive threshold/genre relaxation. `enrich.ts` applies stable effective-score/TMDB-ID ordering after real cross-genre boosts and before MMR. The route never restores rejected candidates, rejects relaxation without genres, includes applicable relaxation in the deterministic request seed, and emits bounded insufficiency diagnostics.

- [x] **Step 4: Run the Phase 0 gate**

```powershell
rtk npm run lint
rtk npm run typecheck
rtk npm run test
rtk npx playwright test tests/api-v1.spec.ts
rtk npm run build
rtk supabase test db
```

Expected: all commands pass. Rerun Supabase security and performance advisors and record results.

Evidence: Lint and typecheck passed. Full Vitest passed 95/95 across five files. Production build completed successfully with only existing non-fatal dynamic-route and stale browser-data warnings. Full API Playwright passed all 46 runnable tests with 12 optional admin/webhook tests skipped; the focused strict-genre gate also passed 1/1. Ephemeral users were deleted and cleanup queries returned zero. Because the local Supabase CLI runner still requires unavailable Docker, the exact database contracts ran through Supabase MCP against production: 55/55 privileged-function and 67/67 helper assertions passed, both rolled back with no retained data. Security advisors remain at five intentionally authenticated/body-authorized function warnings plus the dated Free-plan HIBP exception; performance findings remain INFO-only unused-index candidates.

- [ ] **Step 5: Complete Phase 0 and commit**

Update all Phase 0 evidence in `MAIN.md`, mark 0C.2 complete, and make 1A.1 ready.

Pending: create the verified checkpoint implementation commit, then record its hash, close audit items 7, 18, and 19, mark Phase 0 complete, and make checkpoint 1A.1 Ready.

```powershell
rtk git add src/lib/advancedFiltering.ts src/app/api/v1/suggestions/generate/route.ts tests docs/plans
rtk git commit -m "fix: enforce honest recommendation filters"
```
