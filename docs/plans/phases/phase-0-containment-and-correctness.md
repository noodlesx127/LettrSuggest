# Phase 0: Containment and Correctness

**Phase state:** In progress  
**Current checkpoint:** 0A.3  
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

**State:** Ready

**Files:**
- Modify: `docs/summary/privileged-function-inventory.md`
- Modify: `docs/plans/MAIN.md`

- [ ] **Step 1: Apply the migration to the intended development branch**

Use the Supabase development branch/local workflow. Do not apply an untested migration directly to production.

- [ ] **Step 2: Re-query effective privileges**

Repeat the 0A.1 catalog query and compare every overload/role with the intended matrix. Record differences and resolve them before continuing.

- [ ] **Step 3: Run remote negative and positive validation**

Verify anonymous, cross-user, self-service, admin, and service behavior through the same interfaces production uses. No role may rely only on an ACL check when the function body also needs identity authorization.

- [ ] **Step 4: Review platform controls**

Run Supabase security and performance advisors. Enable leaked-password protection in Auth settings and record the project/date confirmation without storing credentials.

- [ ] **Step 5: Commit validation evidence**

Mark 0A.3 complete and 0B.1 ready.

```powershell
rtk git add docs/summary/privileged-function-inventory.md docs/plans/MAIN.md docs/plans/phases/phase-0-containment-and-correctness.md
rtk git commit -m "docs: verify privileged function containment"
```

## Checkpoint 0B.1: Fast Test Harness and Preference Contracts

**State:** Not started

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vitest.config.ts`
- Create: `src/lib/recommendationPreference.ts`
- Create: `tests/unit/recommendationPreference.test.ts`
- Modify: `src/lib/serverSuggestionsEngine.ts`

- [ ] **Step 1: Install and configure Vitest**

Run: `rtk npm install --save-dev vitest@^4.1.6`  
Add the scripts and configuration specified in `docs/plans/testing-strategy.md`.

- [ ] **Step 2: Write failing polarity and identifier tests**

```typescript
expect(classifyPreferenceProbability(0.49)).toBe("negative");
expect(classifyPreferenceProbability(0.5)).toBe("neutral");
expect(classifyPreferenceProbability(0.51)).toBe("positive");
expect(normalizeFeatureKey(" Keywords ", "Time Travel")).toEqual({ type: "keyword", id: "time travel" });
```

Also test null/non-finite inputs and canonical feature-type aliases.

- [ ] **Step 3: Run the tests and confirm failure**

Run: `rtk npm run test -- tests/unit/recommendationPreference.test.ts`  
Expected: FAIL because the pure module does not exist.

- [ ] **Step 4: Implement the minimal pure contract and replace v1 sign logic**

Export `classifyPreferenceProbability(value): "negative" | "neutral" | "positive"` using the `0.5` boundary. Export `normalizeFeatureKey(type, id)` with trimmed lowercase canonical values. Update `buildFeatureFeedbackFromRows` to ignore neutral values and use the shared result.

- [ ] **Step 5: Run the harness gate and commit**

Run: `rtk npm run test -- tests/unit/recommendationPreference.test.ts`  
Expected: PASS.  
Run: `rtk npm run typecheck`  
Expected: PASS.

```powershell
rtk git add package.json package-lock.json vitest.config.ts src/lib/recommendationPreference.ts src/lib/serverSuggestionsEngine.ts tests/unit/recommendationPreference.test.ts docs/plans
rtk git commit -m "fix: correct recommendation preference polarity"
```

## Checkpoint 0B.2: Atomic Metadata Tuples and Recency

**State:** Not started

**Files:**
- Create: `src/lib/recommendationNormalization.ts`
- Create: `tests/unit/recommendationNormalization.test.ts`
- Modify: `src/lib/enrich.ts`
- Modify: `src/lib/serverSuggestionsEngine.ts`

- [ ] **Step 1: Write failed-middle-fetch and order-independent tests**

Build three film inputs with distinct rating/date/feature markers and fail metadata for the middle film. Assert the first and third retain their own markers. Shuffle identical dated inputs and assert normalized recent IDs are equal.

- [ ] **Step 2: Confirm the tests fail**

Run: `rtk npm run test -- tests/unit/recommendationNormalization.test.ts`  
Expected: FAIL because compacted feature arrays and positional recency break tuple identity.

- [ ] **Step 3: Introduce and use an atomic normalized film tuple**

Define a typed tuple containing URI, TMDB ID, film event, rating, watch date, details health, details, and features. Preserve failed details as `null` in the same tuple. Sort recency by parsed date with TMDB ID as deterministic tie-breaker; do not infer recency from input position.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `rtk npm run test -- tests/unit/recommendationNormalization.test.ts`  
Expected: PASS.  
Run: `rtk npm run typecheck`  
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
rtk git add src/lib/recommendationNormalization.ts src/lib/enrich.ts src/lib/serverSuggestionsEngine.ts tests/unit/recommendationNormalization.test.ts docs/plans
rtk git commit -m "fix: preserve recommendation metadata identity"
```

## Checkpoint 0B.3: Explicit Seed Semantics

**State:** Not started

**Files:**
- Create: `tests/unit/recommendationSeeds.test.ts`
- Modify: `src/lib/serverSuggestionsEngine.ts`
- Modify: `src/app/api/v1/suggestions/generate/route.ts`

- [ ] **Step 1: Write failing seed tests**

Inject a provider fake that records requested seed IDs. Assert explicit seeds are requested as neighborhoods, excluded from returned candidates, combined deterministically with history seeds, and produce equal output for an equal request seed.

- [ ] **Step 2: Confirm current behavior fails**

Run: `rtk npm run test -- tests/unit/recommendationSeeds.test.ts`  
Expected: FAIL because explicit seeds are inserted as candidates rather than retrieval anchors.

- [ ] **Step 3: Implement retrieval-anchor behavior**

Pass explicit seeds into neighborhood retrieval, add them to the exclusion set before scoring, remove direct candidate insertion, and derive all selection from the request-scoped seed. Keep the global weak-seed list removal for Phase 1B.1 where all retrieval paths converge.

- [ ] **Step 4: Verify and commit**

Run: `rtk npm run test -- tests/unit/recommendationSeeds.test.ts`  
Expected: PASS.

```powershell
rtk git add src/lib/serverSuggestionsEngine.ts src/app/api/v1/suggestions/generate/route.ts tests/unit/recommendationSeeds.test.ts docs/plans
rtk git commit -m "fix: use explicit seeds as retrieval anchors"
```

## Checkpoint 0C.1: Input Health and Neutral Request Context

**State:** Not started

**Files:**
- Create: `tests/integration/recommendationInputHealth.test.ts`
- Modify: `src/lib/serverSuggestionsEngine.ts`
- Modify: `src/lib/enrich.ts`
- Modify: `src/app/api/v1/suggestions/generate/route.ts`
- Modify: `tests/api-v1.spec.ts`

- [ ] **Step 1: Write health and context tests**

Assert each input source returns `ok`, `empty`, or `failed`; a failed required source yields mode `degraded`; valid empty history yields `cold_start`; complete context yields `personalized`; omitted viewing context is neutral and never background.

- [ ] **Step 2: Confirm failure**

Run: `rtk npm run test -- tests/integration/recommendationInputHealth.test.ts`  
Expected: FAIL because failures collapse to empty and the route forces background.

- [ ] **Step 3: Implement source health and additive diagnostics**

Return per-source health from `loadUserContext`; derive overall mode without relabeling failed data; represent neutral context explicitly; remove forced background. Add response metadata for mode, failed source names, engine version, and deterministic request seed.

- [ ] **Step 4: Verify integration and HTTP behavior**

Run: `rtk npm run test -- tests/integration/recommendationInputHealth.test.ts`  
Expected: PASS.  
Run: `rtk npx playwright test tests/api-v1.spec.ts -g "generation diagnostics|neutral context"`  
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
rtk git add src/lib/serverSuggestionsEngine.ts src/lib/enrich.ts src/app/api/v1/suggestions/generate/route.ts tests docs/plans
rtk git commit -m "fix: report recommendation input health honestly"
```

## Checkpoint 0C.2: Strict Filters and Effective Advanced Behavior

**State:** Not started

**Files:**
- Create: `tests/unit/advancedFiltering.test.ts`
- Modify: `src/lib/advancedFiltering.ts`
- Modify: `src/app/api/v1/suggestions/generate/route.ts`
- Modify: `tests/api-v1.spec.ts`

- [ ] **Step 1: Write failing filter tests**

Assert explicit genres never return a non-matching film by default, mixed-case keywords match canonical negatives, advanced boosts change stable order, and score thresholds do not silently re-admit rejected items. Test explicit staged relaxation only when the request opts into it.

- [ ] **Step 2: Confirm failure**

Run: `rtk npm run test -- tests/unit/advancedFiltering.test.ts`  
Expected: FAIL on case normalization and discarded boost behavior.

- [ ] **Step 3: Implement strict eligibility and stable boosted order**

Normalize both candidate and avoided keyword values. Apply `boost` to the candidate ranking input with TMDB ID tie-breaks. Remove fail-open fallback for strict genre and threshold constraints; return fewer results with diagnostic reason when eligible supply is insufficient.

- [ ] **Step 4: Run the Phase 0 gate**

```powershell
rtk npm run lint
rtk npm run typecheck
rtk npm run test
rtk npx playwright test tests/api-v1.spec.ts
rtk npm run build
rtk supabase test db
```

Expected: all commands pass. Rerun Supabase security and performance advisors and record results.

- [ ] **Step 5: Complete Phase 0 and commit**

Update all Phase 0 evidence in `MAIN.md`, mark 0C.2 complete, and make 1A.1 ready.

```powershell
rtk git add src/lib/advancedFiltering.ts src/app/api/v1/suggestions/generate/route.ts tests docs/plans
rtk git commit -m "fix: enforce honest recommendation filters"
```
