# Testing Strategy

## Test Pyramid

1. **Vitest unit tests:** pure polarity, normalization, retrieval, evidence, reranking, cache revision, diagnostics, and import functions.
2. **Vitest integration tests:** canonical engine with injected fakes, frozen pipeline fixtures, adapter parity, and import persistence contracts.
3. **pgTAP/Supabase tests:** roles, JWT claims, effective function privileges, RLS interactions, and migration behavior.
4. **Playwright API tests:** authentication, validation, strict filtering, diagnostics, generation counts, and seed semantics at the HTTP boundary.
5. **Build and production checks:** lint, typecheck, build, advisors, bounded telemetry, and rollout guardrails.

## Harness

Checkpoint 0B.1 adds `vitest` and a Node test environment.

```typescript
// vitest.config.ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
  },
});
```

Required package scripts:

```json
{
  "test": "vitest run",
  "test:unit": "vitest run tests/unit",
  "test:integration": "vitest run tests/integration"
}
```

## Frozen Recommendation Fixture

Store typed fixtures under `tests/fixtures/recommendations/`. Every end-to-end fixture fixes:

- request seed and deterministic RNG input;
- films, ratings, watch dates, mappings, watchlist, feedback, blocks, and exposures;
- one metadata request failing between two successful requests;
- provider responses with duplicate IDs within and across provider families;
- explicit seed IDs and exclusions;
- candidate genres, features, scores, and provenance;
- expected inclusion, exclusion, order, attribution, diagnostics, and final TMDB IDs.

Tests compare ordered IDs and bounded attribution fields, not snapshots of unstable prose.

## Required Contracts

### Correctness

- Probabilities `< 0.5`, `= 0.5`, and `> 0.5` map to negative, neutral, and positive.
- Metadata failures cannot shift a rating/date/feature tuple onto another film.
- Recency uses explicit dates and is independent of incoming array order.
- Explicit seeds retrieve neighborhoods and are always excluded from output.
- The same request seed and fixture produce identical output.

### Retrieval and Ranking

- Weighted seeds remain weighted through provider selection.
- Distinct provider families increase consensus; repeated evidence from one family does not.
- Source quotas retain high-intent candidates before scoring.
- Increasing exploration increases diversity under the documented lambda mapping.
- Diversity constraints relax in named stages and backfill to requested count when enough eligible candidates exist.
- Calibration may replace top-window membership from a larger candidate window.
- Niche selection is score-aware and honors its configured target within eligibility limits.

### API

- No context means neutral context, not `background`.
- Explicit genres are strict by default.
- Failed required input reports `degraded`; empty valid history reports `cold_start`.
- Advanced boosts affect order.
- Negative keywords are case-normalized.
- Diagnostics are additive and contain no raw user lists or secrets.

### Import

- Local state is isolated by authenticated user and changes on login/logout.
- Cloud state is authoritative over stale anonymous state.
- Blank years normalize to `null`.
- Watchlist timestamps round-trip.
- Duplicate diary/review rows persist once.
- Full snapshots remove or deactivate absent rows atomically.
- Any persistence or mapping failure prevents a success result.

### Security

- `PUBLIC` and `anon` cannot execute privileged user-targeted functions.
- An authenticated user cannot target another user.
- An authenticated user can perform documented self-service operations.
- Admin-targeted operations require a verified admin role.
- Service-only routines reject client roles.
- Every overload and exact signature has an asserted ACL.

## Commands

```powershell
rtk npm run test:unit
rtk npm run test:integration
rtk npm run test -- tests/unit/recommendationPreference.test.ts
rtk npx playwright test tests/api-v1.spec.ts
rtk supabase test db
rtk npm run lint
rtk npm run typecheck
rtk npm run build
```

Playwright uses real credentials and is not a substitute for deterministic engine fixtures. Recommendation endpoint tests use extended timeouts only when they cross real providers.

## Quality Gate

Before any tuning experiment, all correctness, adapter parity, requested-count fulfillment, and rank-stability tests must pass. Offline evaluation records at least:

- deterministic repeat rate;
- eligible requested-count fulfillment;
- seed/exclusion violations;
- source-family share and concentration;
- genre and feature relevance;
- catalog popularity concentration;
- intra-list diversity;
- rank churn against the accepted baseline.

Online evaluation joins engine version and experiment bucket to exposure and user outcomes. A tuning change is rejected if it improves a target metric while regressing security, correctness, parity, empty-result rate, or requested-count fulfillment.

## Evidence Recording

For every checkpoint, record in `MAIN.md` the command, date, pass/fail result, and relevant artifact or test file. A test that was not run must be stated as not run with the reason; it cannot be implied by another gate.
