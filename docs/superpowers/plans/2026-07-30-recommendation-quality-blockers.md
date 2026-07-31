# Recommendation Quality Blockers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore web/v1 personalization parity, bound candidate metadata completion, and isolate restored suggestion state by authenticated user without tuning recommendation weights.

**Architecture:** Extract normalized scorer inputs into a pure builder and place the canonical overlap adapter in a focused module that both production paths can exercise. Change TMDB detail completion from a bare map to an explicit deadline-aware health result, then enforce the approved 60-percent/output-count threshold in the web action. Move browser key construction and payload parsing into a pure module and make `/suggest` restore and persist only after the authenticated UID is known.

**Tech Stack:** Next.js 14 server actions and App Router, React 18, TypeScript strict mode, Supabase Auth, Vitest 4, Playwright.

---

## File Map

- Create `src/lib/recommendationPersonalization.ts`: pure normalization of `UserContext` and `TasteProfile` into overlap-scorer inputs.
- Create `src/lib/recommendationScoring.ts`: canonical overlap adapter that forwards normalized personalization and source metadata to `suggestByOverlap`.
- Create `src/lib/suggestionStorage.ts`: authenticated storage keys and strict parsers for the four user-owned browser values.
- Create `tests/unit/recommendationPersonalization.test.ts`: normalized-input and MMR-boundary contracts.
- Create `tests/unit/recommendationScoring.test.ts`: proves every rich input reaches `suggestByOverlap`.
- Create `tests/unit/suggestionStorage.test.ts`: user isolation, logout, malformed payload, TTL, and legacy-key contracts.
- Modify `src/lib/serverSuggestionsEngine.ts`: export required context types, cap taste metadata IDs, and return deadline-aware detail health.
- Modify `src/lib/enrich.ts`: remove the old lossy canonical wrapper after callers move to `recommendationScoring.ts`.
- Modify `src/app/actions/recommendations.ts`: use shared personalization, enforce metadata health, and forward source metadata.
- Modify `src/app/api/v1/suggestions/generate/route.ts`: replace hand-built personalization fields with the shared builder.
- Modify `src/app/suggest/page.tsx`: restore/persist the current UID namespace and reset state on auth transitions.
- Modify `tests/unit/serverTmdbDetails.test.ts`: deadline, queued-work, partial-health, and taste-ID-cap coverage.
- Modify `tests/integration/recommendationAdapters.test.ts`: production-boundary assertions for shared scoring and storage modules.
- Modify `tests/recommendation-pages.spec.ts`: seed the authenticated user's recommendation key.
- Modify `docs/plans/phases/phase-2-integrity-observability-evaluation.md`: reopen and then close Task 5 with evidence.
- Modify `docs/plans/MAIN.md`: record blocker correction while leaving `2A.3` as `Ready`.

### Task 1: Reopen The Bounded Phase 2 Blocker

**Files:**
- Modify: `docs/plans/phases/phase-2-integrity-observability-evaluation.md:7-18`

- [ ] **Step 1: Mark Task 5 correction in progress before code changes**

Replace the Task 5 heading block with:

```markdown
## Task 5: Production Suggestion Timeout And Quality Blocker Closure

**Task state:** In progress  
**Checkpoint impact:** None; 2A.3 remains `Ready` and is the next ordered checkpoint after this correction.

- [x] Land the original deterministic/deduped 300-entry metadata window and per-request five-second timeout.
- [ ] Restore web/v1 personalization-input parity through one shared normalized builder and scorer seam.
- [ ] Add a 20-second request-wide metadata deadline and reject unhealthy partial scoring pools.
- [ ] Scope restored suggestion, exposure-suppression, and pairwise state to the authenticated user.
- [ ] Record focused, full-gate, authenticated Playwright, live generation, review, and change-impact evidence.

**Next action:** Complete this bounded correction, then resume 2A.3 Atomic Snapshot Reconciliation.
```

- [ ] **Step 2: Verify only the intended tracker block changed**

Run: `rtk git diff -- docs/plans/phases/phase-2-integrity-observability-evaluation.md`

Expected: only Task 5 state/checklist text changes; checkpoint `2A.3` remains `Ready`.

### Task 2: Normalize And Forward Personalization Inputs

**Files:**
- Create: `tests/unit/recommendationPersonalization.test.ts`
- Create: `tests/unit/recommendationScoring.test.ts`
- Create: `src/lib/recommendationPersonalization.ts`
- Create: `src/lib/recommendationScoring.ts`
- Modify: `src/lib/serverSuggestionsEngine.ts:41-42,169-181`
- Modify: `src/lib/enrich.ts:8858-8910`
- Modify: `src/app/actions/recommendations.ts:20-34,77-90,129-188`
- Modify: `src/app/api/v1/suggestions/generate/route.ts:8-31,395-487`
- Modify: `tests/integration/recommendationAdapters.test.ts:357-417`

- [ ] **Step 1: Write the failing pure-builder tests**

Create `tests/unit/recommendationPersonalization.test.ts` with fixtures containing one adjacent genre, positive and negative feature feedback, one watchlist film, recent exposure data, and an out-of-range exploration rate. Assert this exact public contract:

```typescript
import { describe, expect, it } from "vitest";

import { buildRecommendationPersonalization } from "@/lib/recommendationPersonalization";

describe("buildRecommendationPersonalization", () => {
  it("normalizes every shared scorer input", () => {
    const result = buildRecommendationPersonalization(
      {
        films: [
          {
            uri: "film/a/",
            title: "A",
            year: 2020,
            rating: 4.5,
            rewatch: false,
            last_date: "2026-07-01",
            watch_count: 1,
            liked: true,
            on_watchlist: true,
          },
        ],
        mappings: new Map([["film/a/", 101]]),
        mappingsArray: [{ uri: "film/a/", tmdb_id: 101 }],
        feedback: [
          {
            feature_id: 7,
            feature_name: "Director Seven",
            feature_type: "director",
            inferred_preference: 0.9,
            positive_count: 3,
            negative_count: 0,
          },
        ],
        explorationRate: 0.15,
        adjacentGenres: [
          {
            from_genre_name: "Drama",
            to_genre_name: "Mystery",
            success_rate: 0.8,
          },
        ],
        recentExposures: new Map([[202, 3]]),
        blockedIds: new Set<number>(),
        inputHealth: {} as never,
        failedSources: [],
        mode: "personalized",
      },
      {
        topActors: [{ id: 1, name: "Actor One", weight: 1, count: 2 }],
        topStudios: [],
        topKeywords: [],
        topCountries: [],
        topLanguages: [],
        avoidGenres: [],
        avoidKeywords: [],
        avoidDirectors: [],
        preferredSubgenreKeywordIds: [99],
        topDecades: [{ decade: 1990, weight: 1 }],
        watchlistGenres: [{ name: "Drama" }],
        watchlistKeywords: [{ name: "Mystery" }],
        watchlistDirectors: [{ name: "Director Seven" }],
      } as never,
    );

    expect(result.enhancedProfile).toEqual(
      expect.objectContaining({
        topActors: [expect.objectContaining({ id: 1 })],
        preferredSubgenreKeywordIds: [99],
        watchlistGenres: ["Drama"],
        adjacentGenres: new Map([
          ["Drama", [{ genre: "Mystery", weight: 0.8 }]],
        ]),
      }),
    );
    expect(result.featureFeedback.preferDirectors).toEqual([
      expect.objectContaining({ id: 7 }),
    ]);
    expect(result.watchlistEntries).toEqual([
      { tmdbId: 101, addedAt: "2026-07-01" },
    ]);
    expect(result.recentExposures).toEqual(new Map([[202, 3]]));
    expect(result.mmrLambda).toBe(0.5);
  });

  it.each([
    [Number.NaN, 0.5],
    [-1, 0.3],
    [1, 0.7],
  ])("bounds exploration %s to MMR lambda %s", (rate, expected) => {
    const result = buildRecommendationPersonalization(
      {
        films: [],
        mappings: new Map(),
        mappingsArray: [],
        feedback: [],
        explorationRate: rate,
        adjacentGenres: [],
        recentExposures: new Map(),
        blockedIds: new Set(),
        inputHealth: {} as never,
        failedSources: [],
        mode: "cold_start",
      },
      {} as never,
    );
    expect(result.mmrLambda).toBe(expected);
  });
});
```

- [ ] **Step 2: Write the failing scorer-forwarding test**

Create `tests/unit/recommendationScoring.test.ts`, mock `suggestByOverlap` from `@/lib/enrich`, call `scoreRecommendationsWithOverlap`, and assert the call includes `enhancedProfile`, `featureFeedback`, `watchlistEntries`, `recentExposures`, `sourceMetadata`, `mmrLambda`, and `mmrTopKFactor: 2.5`. Use one canonical candidate and one complete `TMDBMovie`; return one scored item from the mock and assert it maps back to the canonical candidate shape.

- [ ] **Step 3: Run the two tests and verify RED**

Run: `rtk npm run test -- tests/unit/recommendationPersonalization.test.ts tests/unit/recommendationScoring.test.ts`

Expected: FAIL because both modules are absent.

- [ ] **Step 4: Export the source types used by the pure builder**

In `src/lib/serverSuggestionsEngine.ts`, change the declarations to:

```typescript
export type TasteProfile = Awaited<ReturnType<typeof buildTasteProfile>>;
export type FeatureFeedback = Awaited<ReturnType<typeof getAvoidedFeatures>>;

export type UserContext = {
  films: FilmEventRow[];
  mappings: Map<string, number>;
  mappingsArray: FilmMappingRow[];
  feedback: FeatureFeedbackRow[];
  explorationRate: number;
  adjacentGenres: AdjacentGenreRow[];
  recentExposures: Map<number, number>;
  blockedIds: Set<number>;
  inputHealth: UserContextInputHealth;
  failedSources: UserContextSourceName[];
  mode: RecommendationInputMode;
};
```

Export `FilmEventRow`, `FilmMappingRow`, `FeatureFeedbackRow`, and `AdjacentGenreRow` as well so the public `UserContext` declaration is nameable.

- [ ] **Step 5: Implement the shared pure builder**

Create `src/lib/recommendationPersonalization.ts`. Define `RecommendationPersonalization` from the corresponding optional fields of `Parameters<typeof suggestByOverlap>[0]`. Implement `buildRecommendationPersonalization(userContext, tasteProfile)` by moving the exact v1 construction at `route.ts:395-464` into this function. Preserve the current default exploration rate `0.15`, clamp the rate to `0..0.3` before mapping it to lambda `0.3..0.7`, build watchlist entries only for positive mapped IDs, and return the existing `recentExposures` map unchanged.

- [ ] **Step 6: Implement the focused canonical scoring seam**

Create `src/lib/recommendationScoring.ts` by moving `scoreRecommendationsWithOverlap` and `OverlapScoringContext` from `enrich.ts`. Add a required third argument:

```typescript
export async function scoreRecommendationsWithOverlap(
  params: RecommendationScoreParams,
  tmdbDetailsCache: Map<number, TMDBMovie>,
  personalization: RecommendationPersonalization & {
    sourceMetadata: NonNullable<
      Parameters<typeof suggestByOverlap>[0]["sourceMetadata"]
    >;
  },
): Promise<RecommendationCandidate[]>
```

Forward the rich fields with:

```typescript
const scored = await suggestByOverlap({
  userId: params.request.userId,
  films,
  mappings,
  candidates: params.candidates.map((candidate) => candidate.tmdbId),
  tmdbDetailsCache,
  maxCandidates: params.candidates.length,
  feedbackMap: new Map(params.context.feedbackMap),
  desiredResults: params.request.count,
  excludeWatchedIds: new Set(params.context.watchedTmdbIds),
  context: {
    mode: params.request.context.mode,
    localHour: params.request.context.localHour,
  },
  ...personalization,
  mmrTopKFactor: 2.5,
});
```

Remove the old wrapper from `enrich.ts` after all imports compile.

- [ ] **Step 7: Wire both production paths to the builder**

In the web action, build personalization immediately after `tasteProfile`, import the scorer from `@/lib/recommendationScoring`, and call:

```typescript
const scored = await scoreRecommendationsWithOverlap(
  scoreParams,
  requestDetails,
  { ...personalization, sourceMetadata },
);
```

In the v1 route, replace lines 395-464 with:

```typescript
const personalization = buildRecommendationPersonalization(
  userContext,
  tasteProfile,
);
```

Then spread `personalization` into the existing `suggestByOverlap` call and retain route-specific `maxCandidates`, `concurrency`, `desiredResults`, `sourceMetadata`, context, cache, and `mmrTopKFactor` values.

- [ ] **Step 8: Strengthen the production-boundary source test**

Extend `leaves production recommendation orchestration on the authenticated server` to assert both the web action and v1 route contain `buildRecommendationPersonalization`, the action imports `scoreRecommendationsWithOverlap` from `@/lib/recommendationScoring`, and neither production file manually constructs `mmrLambda`.

- [ ] **Step 9: Run focused GREEN verification**

Run: `rtk npm run test -- tests/unit/recommendationPersonalization.test.ts tests/unit/recommendationScoring.test.ts tests/integration/recommendationAdapters.test.ts`

Expected: PASS with all tests in the three files green.

- [ ] **Step 10: Typecheck and commit the parity fix**

Run: `rtk npm run typecheck`

Expected: PASS.

Commit only this task's files and the in-progress Task 5 tracker change:

```powershell
rtk git add src/lib/recommendationPersonalization.ts src/lib/recommendationScoring.ts src/lib/serverSuggestionsEngine.ts src/lib/enrich.ts src/app/actions/recommendations.ts src/app/api/v1/suggestions/generate/route.ts tests/unit/recommendationPersonalization.test.ts tests/unit/recommendationScoring.test.ts tests/integration/recommendationAdapters.test.ts docs/plans/phases/phase-2-integrity-observability-evaluation.md
rtk git commit -m "fix: preserve canonical personalization inputs"
```

### Task 3: Bound TMDB Metadata Completion And Enforce Health

**Files:**
- Modify: `tests/unit/serverTmdbDetails.test.ts`
- Modify: `src/lib/serverSuggestionsEngine.ts:479-493,556-620,1466-1471`
- Modify: `src/app/actions/recommendations.ts:87-90,145-168,197-211`

- [ ] **Step 1: Replace the old return-shape assertion and add RED deadline tests**

Update the existing test to expect `result.details.keys()`. Add tests using controlled promises and fake timers for these contracts:

```typescript
expect(result).toMatchObject({
  requested: 7,
  completed: 7,
  failed: 0,
  deadlineExpired: false,
});

expect(getRequiredMetadataCount(300, 100)).toBe(180);
expect(getRequiredMetadataCount(70, 100)).toBe(70);
expect(getRequiredMetadataCount(100, 20)).toBe(60);
expect(isMetadataCompletionHealthy(result, 100)).toBe(true);
```

The deadline test must start five unresolved requests, advance fake time by `20_000`, resolve the five in-flight promises, and assert no sixth request starts, `deadlineExpired` is true, and the returned promise settles without waiting for all queued IDs.

Add a taste-ID test that creates 350 relevant films in reverse recency order and asserts `getRelevantTasteTmdbIds(context)` returns exactly 300 IDs in the same deterministic order produced by `compareSeedFilms`.

- [ ] **Step 2: Run metadata tests and verify RED**

Run: `rtk npm run test -- tests/unit/serverTmdbDetails.test.ts`

Expected: FAIL because the completion result, deadline options, health helpers, and bounded taste helper do not exist.

- [ ] **Step 3: Add the explicit completion contract**

In `serverSuggestionsEngine.ts`, add:

```typescript
export type TmdbMetadataCompletion = {
  details: Map<number, TMDBMovie>;
  requested: number;
  completed: number;
  failed: number;
  deadlineExpired: boolean;
};

export const WEB_METADATA_DEADLINE_MS = 20_000;

export function getRequiredMetadataCount(
  candidateCount: number,
  resultCount: number,
): number {
  return Math.min(
    candidateCount,
    Math.max(resultCount, Math.ceil(candidateCount * 0.6)),
  );
}

export function isMetadataCompletionHealthy(
  completion: TmdbMetadataCompletion,
  resultCount: number,
): boolean {
  return completion.completed >=
    getRequiredMetadataCount(completion.requested, resultCount);
}
```

Change `ensureCompleteTmdbDetails` to accept `{ deadlineMs?: number }`, count unique requested IDs including cache hits, schedule at most five workers, and check a shared deadline flag before each worker starts its next queued ID. Race worker completion against one deadline timer; after expiry, stop dequeuing, await only already-started work, clear the timer, and return health counts plus the ordered detail map. Cache upserts remain best effort and do not decrement `completed` after a successful TMDB response.

- [ ] **Step 4: Bound taste-profile metadata IDs**

Export `getRelevantTasteTmdbIds`. Filter relevant films, sort them with `compareSeedFilms(left, right, mappings, Date.now())`, dedupe mapped IDs, and `.slice(0, 300)`. Keep `buildTasteProfileFilms(userContext.films, ...)` unchanged so all film rows still influence profile construction.

Update `buildTasteProfileServer` to read `.details` from the completion result. Use the same 20-second deadline so profile cache misses cannot recreate unbounded wall-clock work.

- [ ] **Step 5: Enforce health in the web action**

For the scoring window, call:

```typescript
const completion = await ensureCompleteTmdbDetails(
  scoringWindowIds,
  cachedCandidateDetails,
  { deadlineMs: WEB_METADATA_DEADLINE_MS },
);
if (!isMetadataCompletionHealthy(completion, adapted.request.count)) {
  throw new Error(
    "Movie metadata is temporarily unavailable. Please retry suggestions.",
  );
}
requestDetails = completion.details;
```

Use `.details` for the final unresolved-item hydration. That best-effort presentation completion must not replace the scoring-window health decision.

- [ ] **Step 6: Run focused GREEN verification**

Run: `rtk npm run test -- tests/unit/serverTmdbDetails.test.ts tests/unit/recommendationScoring.test.ts tests/integration/recommendationAdapters.test.ts`

Expected: PASS.

Run: `rtk npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the metadata fix**

```powershell
rtk git add src/lib/serverSuggestionsEngine.ts src/app/actions/recommendations.ts tests/unit/serverTmdbDetails.test.ts tests/integration/recommendationAdapters.test.ts
rtk git commit -m "fix: bound recommendation metadata completion"
```

### Task 4: Isolate Restored Suggestion State By User

**Files:**
- Create: `tests/unit/suggestionStorage.test.ts`
- Create: `src/lib/suggestionStorage.ts`
- Modify: `src/app/suggest/page.tsx:1-49,240-305,389-526,1232-1250`
- Modify: `tests/recommendation-pages.spec.ts:40-57`
- Modify: `tests/integration/recommendationAdapters.test.ts:357-417`

- [ ] **Step 1: Write RED storage-contract tests**

Create `tests/unit/suggestionStorage.test.ts` and assert:

```typescript
expect(getSuggestionStorageKeys("user-a")).toEqual({
  items: "lettrsuggest:user-a:items",
  shownIds: "lettrsuggest:user-a:shown_ids",
  pairHistory: "lettrsuggest:user-a:pair_history",
  pairwiseCount: "lettrsuggest:user-a:pairwise_count",
});
expect(getSuggestionStorageKeys("user-b")?.items).not.toBe(
  getSuggestionStorageKeys("user-a")?.items,
);
expect(getSuggestionStorageKeys(null)).toBeNull();
expect(getSuggestionStorageKeys("")).toBeNull();
expect(getSuggestionStorageKeys("lettrsuggest_items")?.items).not.toBe(
  "lettrsuggest_items",
);
```

Also assert `parseStoredSuggestionItems` rejects malformed JSON, empty/non-array payloads, non-positive IDs, non-finite scores, non-string titles, and non-string reasons; `parseStoredShownIds` rejects expired/malformed data and accepts valid positive integer IDs; pair history accepts only string arrays; pairwise count accepts only bounded non-negative integers.

- [ ] **Step 2: Run storage tests and verify RED**

Run: `rtk npm run test -- tests/unit/suggestionStorage.test.ts`

Expected: FAIL because `@/lib/suggestionStorage` does not exist.

- [ ] **Step 3: Implement the pure storage module**

Create `src/lib/suggestionStorage.ts` with `SuggestionStorageKeys`, `getSuggestionStorageKeys(userId: string | null)`, and the four parsers. Use the exact key format asserted above. Return `null` on parse or validation failure. Cap restored arrays at 300 entries and pairwise count at the page's session limit of 5. Do not read, migrate, or return any legacy global key.

- [ ] **Step 4: Replace mount-only global restore with UID-bound restore**

In `page.tsx`, initialize `uid` as `undefined | null | string` so unresolved auth differs from logout. Replace the four global restore effects with one effect keyed by `uid`:

```typescript
useEffect(() => {
  setItems(null);
  setShownIds(new Set());
  setPairHistory(new Set());
  setPairwiseCount(0);
  setPresentationHydrationEnabled(false);
  setHasCheckedStorage(false);

  const keys = getSuggestionStorageKeys(uid ?? null);
  if (!keys) {
    if (uid !== undefined) setHasCheckedStorage(true);
    return;
  }

  const restoredItems = parseStoredSuggestionItems(
    sessionStorage.getItem(keys.items),
  );
  const restoredShownIds = parseStoredShownIds(
    localStorage.getItem(keys.shownIds),
    Date.now(),
  );
  const restoredPairHistory = parseStoredPairHistory(
    sessionStorage.getItem(keys.pairHistory),
  );
  const restoredPairwiseCount = parseStoredPairwiseCount(
    sessionStorage.getItem(keys.pairwiseCount),
  );

  if (restoredItems) {
    setItems(restoredItems as MovieItem[]);
    setPresentationHydrationEnabled(true);
  }
  if (restoredShownIds) setShownIds(new Set(restoredShownIds));
  if (restoredPairHistory) setPairHistory(new Set(restoredPairHistory));
  if (restoredPairwiseCount !== null) {
    setPairwiseCount(restoredPairwiseCount);
  }
  setHasCheckedStorage(true);
}, [uid]);
```

Subscribe to `supabase.auth.onAuthStateChange` in the auth initialization effect, update `uid` from every session, and unsubscribe in cleanup. The storage effect performs the required in-memory reset before loading the next namespace.

- [ ] **Step 5: Namespace every persistence effect**

In each persistence effect, derive keys with `getSuggestionStorageKeys(uid ?? null)` and return without writing if keys are null. Add `uid` to dependencies. Preserve the existing 500ms shown-ID debounce and seven-day timestamp. Never write `lettrsuggest_items`, `lettrsuggest_shown_ids`, `lettrsuggest_pair_history`, or `lettrsuggest_pairwise_count` directly.

- [ ] **Step 6: Update the authenticated Playwright fixture**

After login, read the UID from Supabase's established browser session and seed the exact namespaced key:

```typescript
const uid = await page.evaluate(() => {
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key || !/^sb-.*-auth-token$/.test(key)) continue;
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;
    const value = JSON.parse(raw) as {
      user?: { id?: unknown };
      currentSession?: { user?: { id?: unknown } };
    };
    const candidate = value.user?.id ?? value.currentSession?.user?.id;
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  throw new Error("Authenticated Supabase user ID was not found");
});

await page.evaluate((userId) => {
  window.sessionStorage.setItem(
    `lettrsuggest:${userId}:items`,
    JSON.stringify([
      { id: 27205, title: "Smoke fixture", reasons: [], score: 0 },
    ]),
  );
  window.sessionStorage.setItem(
    "lettrsuggest_items",
    JSON.stringify([
      { id: 27206, title: "Legacy sentinel", reasons: [], score: 0 },
    ]),
  );
}, uid);
```

After navigating to `/suggest`, assert `Smoke fixture` is visible, `Legacy sentinel` is not visible, and no automatic generation POST occurred.

- [ ] **Step 7: Strengthen static production assertions**

Update the integration source test to require `getSuggestionStorageKeys` in `page.tsx`, reject direct calls using the four legacy literals, and require `onAuthStateChange` cleanup.

- [ ] **Step 8: Run focused GREEN verification**

Run: `rtk npm run test -- tests/unit/suggestionStorage.test.ts tests/integration/recommendationAdapters.test.ts`

Expected: PASS.

Run: `rtk npm run typecheck`

Expected: PASS.

- [ ] **Step 9: Commit the storage fix**

```powershell
rtk git add src/lib/suggestionStorage.ts src/app/suggest/page.tsx tests/unit/suggestionStorage.test.ts tests/integration/recommendationAdapters.test.ts tests/recommendation-pages.spec.ts
rtk git commit -m "fix: isolate restored suggestions by user"
```

### Task 5: Review, Full Gates, And Authenticated Validation

**Files:**
- Modify if findings require: only files changed in Tasks 2-4

- [ ] **Step 1: Run formatting only on changed source/test files**

Run Prettier with explicit paths for the changed TypeScript and TSX files; do not include unrelated dirty files.

Expected: exit 0.

- [ ] **Step 2: Run the focused recommendation suite**

Run:

```powershell
rtk npm run test -- tests/unit/recommendationPersonalization.test.ts tests/unit/recommendationScoring.test.ts tests/unit/serverTmdbDetails.test.ts tests/unit/suggestionStorage.test.ts tests/integration/recommendationAdapters.test.ts
```

Expected: PASS with zero failed tests.

- [ ] **Step 3: Run project gates**

Run each command separately and retain its exit result:

```powershell
rtk npm run lint
rtk npm run typecheck
rtk npm run test
rtk npm run build
rtk git diff --check
```

Expected: all commands exit 0. Existing non-fatal Next dynamic-server and browser-data warnings may be recorded but must not be reclassified as failures.

- [ ] **Step 4: Inspect change impact before review**

Run Codebase Memory `detect_changes` from commit `c1af1cd` at depth 3. Confirm the changed symbols are limited to canonical recommendation scoring, TMDB detail completion, and `/suggest` storage/auth state. Investigate any unexpected runtime dependency before continuing.

- [ ] **Step 5: Request independent bounded code review**

Dispatch a `code-reviewer` subagent with the design spec, this plan, base SHA `c1af1cd`, current HEAD, and explicit focus on deadline races, health-count math, web/v1 field parity, auth transitions, and cross-user browser state. Fix Critical and Important findings through new RED/GREEN cycles, then rerun the affected focused tests and typecheck.

- [ ] **Step 6: Run authenticated Playwright without persisting credentials**

Set the supplied admin email/password only in the test process environment as `TEST_USER_EMAIL` and `TEST_USER_PASSWORD`. Run:

```powershell
rtk npx playwright test tests/recommendation-pages.spec.ts
```

Expected: all tests pass, including authenticated recommendation pages; no credential value appears in output, files, or Git diff.

- [ ] **Step 7: Exercise one authenticated suggestion generation**

Use the authenticated browser session to visit `/suggest`, allow one canonical generation, and record only elapsed time, output count, whether the retryable metadata error appeared, and whether the list visibly spans multiple eras. Do not record recommendation titles, private history, tokens, email, or password. The run must settle within the page/platform request limit; a retryable metadata-health error is an honest bounded failure, not a generic partial success.

### Task 6: Close The Blocker Correction And Commit Evidence

**Files:**
- Modify: `docs/plans/phases/phase-2-integrity-observability-evaluation.md:7-18`
- Modify: `docs/plans/MAIN.md:132-135`

- [ ] **Step 1: Close Task 5 with exact evidence**

Mark the four correction checklist items complete and set `Task state: Complete`. Add one bounded verification bullet containing the exact date, focused/full test counts, lint/typecheck/build/diff outcomes, Playwright count, authenticated generation elapsed time/output count/error state, review disposition, and change-impact result. Keep the next action as `2A.3 Atomic Snapshot Reconciliation`.

- [ ] **Step 2: Add the new MAIN verification entry**

Insert a new dated entry above the old 2026-07-30 Task 5 entry. State that this is a blocker correction, not Phase 3 tuning; summarize shared scorer inputs, 20-second deadline/health threshold, user-scoped storage, exact verification evidence, and that checkpoint `2A.3` remains `Ready`.

- [ ] **Step 3: Verify tracker and worktree scope**

Run:

```powershell
rtk git diff --check
rtk git status --short
rtk git diff -- docs/plans/MAIN.md docs/plans/phases/phase-2-integrity-observability-evaluation.md
```

Expected: tracker evidence is complete, no credential appears, unrelated pre-existing dirty files remain untouched, and `2A.3` is still `Ready`.

- [ ] **Step 4: Commit tracker evidence and any review-driven fixes**

Stage only the intended changed files. Inspect `rtk git diff --cached` before committing.

```powershell
rtk git commit -m "docs: close recommendation quality blockers"
```

- [ ] **Step 5: Final post-commit verification**

Run `rtk git status --short` and `rtk git log --oneline -6`.

Expected: the coherent parity, metadata, storage, and tracker commits are present; only unrelated pre-existing worktree changes remain.
