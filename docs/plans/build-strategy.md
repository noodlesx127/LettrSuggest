# Build Strategy

## Purpose

Deliver the recommendation remediation program as small, reversible checkpoints while keeping the application deployable. `docs/plans/MAIN.md` controls order and status.

## Working Rules

1. Work one checkpoint at a time.
2. Update `MAIN.md` and the active phase file before and after execution.
3. Start with a failing automated contract when behavior changes.
4. Make the smallest implementation that satisfies that contract.
5. Run the smallest relevant test slice, then the checkpoint gate.
6. Commit code, tests, migrations, and tracker evidence together.
7. Do not mix unrelated cleanup or weight tuning into remediation commits.
8. Do not switch a production caller until canonical fixture parity passes.

## Delivery Boundaries

### Database Changes

- Add forward-only timestamped migrations under `supabase/migrations/`; never edit deployed migration history to change production behavior.
- Enumerate exact function signatures before revoking or granting execution.
- Default privileged functions to no `PUBLIC`, `anon`, or `authenticated` execution unless the tested contract requires it.
- Keep self-service and admin-targeted operations separate.
- Apply database changes to a development branch/local stack first, then verify effective privileges before production.
- Regenerate Supabase TypeScript types when schema changes affect application code.

### Recommendation Engine Changes

- Introduce canonical contracts before orchestration.
- Keep `enrich.ts` as the initial scoring implementation; extract only pure seams required by tests.
- Inject context loading, providers, RNG, clock, scorer, reranker, and telemetry rather than calling globals from orchestration.
- Migrate v1 first, prove fixtures, then migrate web.
- Remove superseded orchestration in the same checkpoint that completes web parity.

### Import Changes

- Extract normalization and persistence from page components before changing semantics.
- Use authenticated-user storage namespaces.
- Reconcile a full export as one snapshot with an explicit failure result.
- Change recommendation cache revisions in the same checkpoint that changes imported profile inputs.

### Telemetry and Evaluation

- Add only bounded identifiers, counts, versions, rank changes, and drop reasons.
- Never persist API secrets or raw private film lists in diagnostic payloads.
- Version engine behavior and fixture data.
- Treat tuning as an experiment with a single hypothesis and explicit guardrails.

## Branch and Commit Shape

Use one coherent commit per checkpoint. Preferred messages:

```text
test: establish privileged function security baseline
fix: enforce privileged function authorization
test: add recommendation contract harness
fix: correct recommendation signal semantics
refactor: introduce canonical recommendation engine
fix: reconcile imports atomically
feat: add bounded recommendation diagnostics
test: add recommendation quality evaluation
```

Before each commit inspect `git status`, the scoped diff, and recent history. Stage only checkpoint files. Never include unrelated dirty-worktree changes.

## Build Gates

### Checkpoint Gate

- Relevant unit or integration tests.
- Lint on touched TypeScript files.
- `npm run typecheck` when contracts or application code change.
- Database tests and effective privilege queries for migrations.

### Phase Gate

```powershell
rtk npm run lint
rtk npm run typecheck
rtk npm run test
rtk npm run build
```

Add the relevant Playwright test files. For database phases, add `rtk supabase test db`, Supabase security advisors, and Supabase performance advisors.

## Rollout

- Security migrations ship independently and first.
- Correctness fixes ship behind existing API shapes with additive diagnostics.
- Canonical engine adapters switch one caller at a time after fixture parity.
- Include an explicit engine version in responses and telemetry before the first caller switch.
- Keep vector retrieval disabled by configuration until Phase 3 records a go decision.
- Stop rollout when error rate, degraded-input rate, empty-result rate, requested-count fulfillment, or rank-stability guardrails regress.

## Recovery

- Correct code regressions with a new commit; do not rewrite checkpoint history.
- Correct deployed database behavior with a new migration.
- If an adapter switch regresses production, disable that adapter path using the existing deployment/configuration mechanism while preserving telemetry for diagnosis.
- Record the blocker and recovery evidence in `MAIN.md` before resuming.
