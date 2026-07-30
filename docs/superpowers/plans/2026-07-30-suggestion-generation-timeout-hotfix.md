# Suggestion Generation Timeout Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent `/suggest` and `/genre-suggest` from exhausting the Netlify request window after a fresh import while preserving deterministic canonical order and strict genre eligibility.

**Architecture:** Both pages continue to use the canonical server action. The action will deduplicate and cap its ordered candidate metadata window, complete that metadata once, pass the request-scoped map into overlap scoring, and reuse it for final adaptation. Client presentation hydration becomes bounded and non-blocking, while a shared validator turns malformed action payloads into one controlled error.

**Tech Stack:** Next.js 14 Server Actions, React 18, TypeScript, Supabase, TMDB, Vitest, Playwright

---

## File Map

- Create `src/lib/canonicalWebResponse.ts`: shared runtime validation for the web Server Action response.
- Create `tests/unit/canonicalWebResponse.test.ts`: validator contracts for valid and malformed payloads.
- Create `tests/unit/serverTmdbDetails.test.ts`: real helper tests for unique completion and concurrency five.
- Create `tests/unit/tmdbClient.test.ts`: server TMDB request timeout contract.
- Modify `src/lib/serverSuggestionsEngine.ts`: deduplicate missing detail IDs before scheduling work.
- Modify `src/app/api/v1/_lib/tmdb.ts`: abort individual upstream TMDB requests after five seconds.
- Modify `src/lib/enrich.ts`: allow the canonical web path to supply its completed request metadata map to overlap scoring.
- Modify `src/app/actions/recommendations.ts`: apply the deterministic 100-300 candidate window, reuse one metadata map, and validate the canonical engine result.
- Modify `tests/integration/webRecommendationGenreDetails.test.ts`: verify windowing, strict filtering, map reuse, final hydration reuse, and canonical-result invariants.
- Modify `src/app/suggest/page.tsx`: validate responses, remove the presentation-hydration wait, defer hydration until generation settles, and cap presentation IDs at 300.
- Modify `src/app/genre-suggest/page.tsx`: use the same response validator.
- Modify `tests/integration/recommendationAdapters.test.ts`: source contracts for both page boundaries and non-blocking `/suggest` behavior.
- Modify `docs/plans/MAIN.md`: record the production blocker and final verification evidence without advancing 2A.3.
- Modify `docs/plans/phases/phase-2-integrity-observability-evaluation.md`: record the blocker resolution and the required 2A.3 import-to-suggestions follow-up.

## Task 1: Shared Canonical Response Validation

**Files:**
- Create: `src/lib/canonicalWebResponse.ts`
- Create: `tests/unit/canonicalWebResponse.test.ts`

- [ ] **Step 1: Write the failing validator tests**

Create `tests/unit/canonicalWebResponse.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseCanonicalWebItems } from "@/lib/canonicalWebResponse";

describe("parseCanonicalWebItems", () => {
  it("returns the canonical items array without changing its order", () => {
    const items = [{ id: 22 }, { id: 11 }];

    expect(parseCanonicalWebItems({ items })).toBe(items);
  });

  it.each([
    undefined,
    null,
    "invalid",
    {},
    { items: undefined },
    { items: {} },
  ])("rejects a malformed canonical response: %j", (payload) => {
    expect(() => parseCanonicalWebItems(payload)).toThrow(
      "Recommendation service returned an invalid response",
    );
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
rtk npm run test -- tests/unit/canonicalWebResponse.test.ts
```

Expected: FAIL because `@/lib/canonicalWebResponse` does not exist.

- [ ] **Step 3: Implement the minimal shared validator**

Create `src/lib/canonicalWebResponse.ts`:

```ts
import type { WebRecommendationItem } from "@/lib/recommendationAdapters";

const INVALID_RESPONSE_MESSAGE =
  "Recommendation service returned an invalid response";

export function parseCanonicalWebItems(
  payload: unknown,
): WebRecommendationItem[] {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("items" in payload) ||
    !Array.isArray(payload.items)
  ) {
    throw new Error(INVALID_RESPONSE_MESSAGE);
  }

  return payload.items as WebRecommendationItem[];
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```powershell
rtk npm run test -- tests/unit/canonicalWebResponse.test.ts
```

Expected: PASS with 7 cases.

- [ ] **Step 5: Commit the validator checkpoint**

```powershell
rtk git add src/lib/canonicalWebResponse.ts tests/unit/canonicalWebResponse.test.ts
rtk git commit -m "fix: validate canonical web responses"
```

## Task 2: Deduplicate and Time-Bound Server TMDB Completion

**Files:**
- Create: `tests/unit/serverTmdbDetails.test.ts`
- Create: `tests/unit/tmdbClient.test.ts`
- Modify: `src/lib/serverSuggestionsEngine.ts:572-609`
- Modify: `src/app/api/v1/_lib/tmdb.ts:39-85`

- [ ] **Step 1: Write the failing unique-ID and concurrency test**

Create `tests/unit/serverTmdbDetails.test.ts`. Mock `@/lib/supabaseAdmin` and `@/app/api/v1/_lib/tmdb` before importing the helper:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchTmdb: vi.fn(),
  from: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/app/api/v1/_lib/tmdb", () => ({
  fetchTmdb: mocks.fetchTmdb,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({ from: mocks.from }),
}));

import { ensureCompleteTmdbDetails } from "@/lib/serverSuggestionsEngine";

describe("ensureCompleteTmdbDetails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.from.mockReturnValue({ upsert: mocks.upsert });
  });

  it("fetches and upserts each unique missing ID once with concurrency five", async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    mocks.fetchTmdb.mockImplementation(async (path: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      const id = Number(path.split("/").at(-1));
      return { id, credits: { cast: [], crew: [] }, keywords: { keywords: [] } };
    });

    const pending = ensureCompleteTmdbDetails(
      [101, 101, 202, 303, 404, 505, 606, 707],
      new Map(),
    );
    await vi.waitFor(() => expect(releases).toHaveLength(5));
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.splice(0).forEach((release) => release());

    const details = await pending;

    expect(mocks.fetchTmdb).toHaveBeenCalledTimes(7);
    expect(mocks.upsert).toHaveBeenCalledTimes(7);
    expect(maxActive).toBeLessThanOrEqual(5);
    expect([...details.keys()]).toEqual([101, 202, 303, 404, 505, 606, 707]);
  });
});
```

- [ ] **Step 2: Run the helper test and verify RED**

Run:

```powershell
rtk npm run test -- tests/unit/serverTmdbDetails.test.ts
```

Expected: FAIL because ID `101` is fetched and upserted twice.

- [ ] **Step 3: Deduplicate scheduled detail IDs while preserving order**

Change `idsToFetch` in `ensureCompleteTmdbDetails`:

```ts
  const idsToFetch = [...new Set(tmdbIds)].filter(
    (tmdbId) => !isTmdbProfileComplete(existingMap.get(tmdbId)),
  );
```

- [ ] **Step 4: Re-run the helper test and verify GREEN**

Run:

```powershell
rtk npm run test -- tests/unit/serverTmdbDetails.test.ts
```

Expected: PASS; seven unique IDs are fetched and maximum concurrency is five.

- [ ] **Step 5: Write the failing five-second timeout test**

Create `tests/unit/tmdbClient.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchTmdb } from "@/app/api/v1/_lib/tmdb";

describe("fetchTmdb", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("TMDB_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("aborts an upstream request after five seconds", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    const request = fetchTmdb("/movie/101");
    const rejection = expect(request).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(5_000);

    await rejection;
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
```

- [ ] **Step 6: Run the timeout test and verify RED**

Run:

```powershell
rtk npm run test -- tests/unit/tmdbClient.test.ts
```

Expected: FAIL because `fetchTmdb` does not pass a signal and the promise remains pending.

- [ ] **Step 7: Add a five-second abort controller with timer cleanup**

In `src/app/api/v1/_lib/tmdb.ts`, add:

```ts
const TMDB_REQUEST_TIMEOUT_MS = 5_000;
```

Replace the raw fetch with:

```ts
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    TMDB_REQUEST_TIMEOUT_MS,
  );

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
```

Keep the existing response-status and JSON handling unchanged.

- [ ] **Step 8: Run both tests and verify GREEN**

Run:

```powershell
rtk npm run test -- tests/unit/serverTmdbDetails.test.ts tests/unit/tmdbClient.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit the server request-safety checkpoint**

```powershell
rtk git add src/lib/serverSuggestionsEngine.ts src/app/api/v1/_lib/tmdb.ts tests/unit/serverTmdbDetails.test.ts tests/unit/tmdbClient.test.ts
rtk git commit -m "fix: bound server TMDB detail requests"
```

## Task 3: Bound and Reuse Canonical Web Metadata

**Files:**
- Modify: `tests/integration/webRecommendationGenreDetails.test.ts`
- Modify: `src/app/actions/recommendations.ts:37-240`
- Modify: `src/lib/enrich.ts:8860-8905`

- [ ] **Step 1: Expose and mock overlap scoring in the action test**

Add `scoreRecommendationsWithOverlap: vi.fn()` to the hoisted mocks in `tests/integration/webRecommendationGenreDetails.test.ts` and update the enrich mock:

```ts
vi.mock("@/lib/enrich", () => ({
  scoreRecommendationsWithOverlap: mocks.scoreRecommendationsWithOverlap,
}));
```

In `beforeEach`, provide a pass-through score result suitable for tests whose canonical-engine mock calls `dependencies.scoreCandidates`:

```ts
mocks.scoreRecommendationsWithOverlap.mockImplementation(
  async (params: { candidates: Array<{ tmdbId: number }> }) =>
    params.candidates.map(({ tmdbId }, index) => ({
      tmdbId,
      score: 100 - index,
      evidence: {
        seedAnchors: [],
        providerFamilies: [],
        providerOccurrences: 0,
        retrievalScore: 1,
      },
      attribution: {
        retrieval: 1,
        preference: 0,
        context: 0,
        diversity: 0,
        total: 1,
      },
    })),
);
```

- [ ] **Step 2: Write the failing 300-ID ordered-window test**

Add a test that returns IDs `1..350` plus duplicate `2`, records `retrieveCandidates`, invokes `scoreCandidates`, and asserts:

```ts
expect(mocks.loadCachedTmdbDetails).toHaveBeenCalledWith(
  Array.from({ length: 300 }, (_, index) => index + 1),
);
expect(mocks.ensureCompleteTmdbDetails).toHaveBeenCalledWith(
  Array.from({ length: 300 }, (_, index) => index + 1),
  expect.any(Map),
);
expect(mocks.scoreRecommendationsWithOverlap.mock.calls[0][0].candidates)
  .toHaveLength(300);
```

Use `count: 100`. Configure the completion mock to return a complete detail object for every input ID. The expected list must preserve first occurrence order.

- [ ] **Step 3: Run the ordered-window test and verify RED**

Run:

```powershell
rtk npm run test -- tests/integration/webRecommendationGenreDetails.test.ts -t "limits the ordered scoring metadata window"
```

Expected: FAIL because the no-genre path currently does not preload a bounded candidate window and the genre path can hydrate all generated IDs.

- [ ] **Step 4: Write the failing request-map reuse test**

Add a test with generated IDs `[101, 202, 303]`, cached details for `101`, completed details for all three, and final results `[202, 303]`. Have the canonical-engine mock call `retrieveCandidates` and then `scoreCandidates`. Assert:

```ts
const completedMap = mocks.ensureCompleteTmdbDetails.mock.results[0].value;
expect(mocks.scoreRecommendationsWithOverlap).toHaveBeenCalledWith(
  expect.any(Object),
  await completedMap,
);
expect(mocks.loadCachedTmdbDetails).toHaveBeenCalledTimes(1);
expect(mocks.ensureCompleteTmdbDetails).toHaveBeenCalledTimes(1);
```

This proves final adaptation does not reload IDs already present in the request map.

- [ ] **Step 5: Write the failing strict-genre bounded-window test**

Return 350 generated candidates, complete IDs `1..300`, mark only IDs `7` and `11` as Action, and request `genreNames: ["Action"]`. Assert retrieval returns `[7, 11]`, the cache/completion helpers receive only `1..300`, and IDs `301..350` are never passed to scoring or detail completion.

- [ ] **Step 6: Write the failing canonical-result invariant test**

Add:

```ts
it("rejects a missing canonical engine result before final hydration", async () => {
  mocks.runCanonicalServerRecommendations.mockResolvedValue(undefined);

  await expect(
    generateCanonicalWebRecommendations({
      accessToken: "missing-result-token-1234567890",
      count: 10,
      requestSeed: "missing-canonical-result",
    }),
  ).rejects.toThrow("Canonical recommendation result is invalid");

  expect(mocks.loadCachedTmdbDetails).not.toHaveBeenCalled();
  expect(mocks.ensureCompleteTmdbDetails).not.toHaveBeenCalled();
});
```

The one cache/completion call is the bounded candidate preparation; no second final-hydration call is allowed.

- [ ] **Step 7: Run the integration file and verify all new tests are RED for the intended reasons**

Run:

```powershell
rtk npm run test -- tests/integration/webRecommendationGenreDetails.test.ts
```

Expected: FAIL on absent windowing, map reuse, and explicit invariant handling.

- [ ] **Step 8: Extend overlap scoring with the request-scoped map**

Change the signature in `src/lib/enrich.ts`:

```ts
export async function scoreRecommendationsWithOverlap(
  params: RecommendationScoreParams,
  tmdbDetailsCache?: Map<number, TMDBMovie>,
): Promise<RecommendationCandidate[]> {
```

Pass the map and bounded candidate count into `suggestByOverlap`:

```ts
    tmdbDetailsCache,
    maxCandidates: params.candidates.length,
```

The action will only pass candidates present in this completed map, so candidate scoring cannot fall back to one-ID lookups for missing candidate metadata.

- [ ] **Step 9: Implement the deterministic web metadata window**

In `generateCanonicalWebRecommendations`, import the shared movie type with
`import type { TMDBMovie } from "@/lib/enrich";` and, after adapting the
request, compute:

```ts
const scoringWindowSize = Math.min(
  300,
  Math.max(adapted.request.count * 3, 100),
);
let requestDetails = new Map<number, TMDBMovie>();
```

Replace the retrieval callback body after `sourceMetadata` assignment with:

```ts
const candidateWindow = [...new Set(generated.candidateIds)].slice(
  0,
  scoringWindowSize,
);
const cachedCandidateDetails = await loadCachedTmdbDetails(candidateWindow);
requestDetails = await ensureCompleteTmdbDetails(
  candidateWindow,
  cachedCandidateDetails,
);
const completedCandidateIds = candidateWindow.filter((tmdbId) =>
  requestDetails.has(tmdbId),
);

const eligibleCandidateIds =
  requestedGenreFilterNames.length === 0
    ? completedCandidateIds
    : completedCandidateIds.filter((tmdbId) =>
        matchesWebTmdbGenreFilter(
          (requestDetails.get(tmdbId)?.genres ?? []).map(
            (genre) => genre.name,
          ),
          requestedGenreFilterNames,
        ),
      );

return eligibleCandidateIds.map((tmdbId) => ({ tmdbId }));
```

- [ ] **Step 10: Pass and reuse the request metadata map**

Call the scorer with the second argument:

```ts
const scored = await scoreRecommendationsWithOverlap(
  scoreParams,
  requestDetails,
);
```

Immediately after `runCanonicalServerRecommendations`, add:

```ts
if (!result || !Array.isArray(result.results)) {
  throw new Error("Canonical recommendation result is invalid");
}
```

For final hydration, query only unresolved IDs and merge them into the same map:

```ts
const finalTmdbIds = result.results.map((candidate) => candidate.tmdbId);
const unresolvedFinalIds = finalTmdbIds.filter(
  (tmdbId) => !requestDetails.has(tmdbId),
);
if (unresolvedFinalIds.length > 0) {
  const cachedFinalDetails = await loadCachedTmdbDetails(unresolvedFinalIds);
  const completedFinalDetails = await ensureCompleteTmdbDetails(
    unresolvedFinalIds,
    cachedFinalDetails,
  );
  for (const [tmdbId, movie] of completedFinalDetails) {
    requestDetails.set(tmdbId, movie);
  }
}
const details = requestDetails;
```

- [ ] **Step 11: Run focused server tests and verify GREEN**

Run:

```powershell
rtk npm run test -- tests/integration/webRecommendationGenreDetails.test.ts tests/integration/recommendationEngine.test.ts tests/unit/serverTmdbDetails.test.ts
```

Expected: PASS. Existing canonical engine and strict genre behavior remain green.

- [ ] **Step 12: Commit the bounded server orchestration checkpoint**

```powershell
rtk git add src/app/actions/recommendations.ts src/lib/enrich.ts tests/integration/webRecommendationGenreDetails.test.ts
rtk git commit -m "fix: bound canonical recommendation metadata"
```

## Task 4: Make Client Presentation Hydration Bounded and Non-Blocking

**Files:**
- Modify: `tests/integration/recommendationAdapters.test.ts:357-408`
- Modify: `src/app/suggest/page.tsx:1-108, 251, 1263-1311, 1429-1536`
- Modify: `src/app/genre-suggest/page.tsx:318-435`

- [ ] **Step 1: Write the failing page source contracts**

Extend `leaves production recommendation orchestration on the authenticated server` with:

```ts
expect(page).toMatch(/parseCanonicalWebItems\s*\(/);
expect(genrePage).toMatch(/parseCanonicalWebItems\s*\(/);
expect(page).not.toContain("watchlistIdsHydrationRef");
expect(page).toMatch(/presentationHydrationEnabled/);
expect(page).toMatch(/slice\(0, 300\)/);
```

The test must continue asserting that both pages call the canonical Server Action and that `/suggest` retains `selectCanonicalWatchlistPicks` and `selectCanonicalPalateCleanser`.

- [ ] **Step 2: Run the source-contract test and verify RED**

Run:

```powershell
rtk npm run test -- tests/integration/recommendationAdapters.test.ts -t "leaves production recommendation orchestration"
```

Expected: FAIL because neither page uses the validator, `/suggest` still awaits `watchlistIdsHydrationRef`, and hydration is not gated or capped.

- [ ] **Step 3: Validate the canonical payload on both pages**

Import the shared helper in both pages:

```ts
import { parseCanonicalWebItems } from "@/lib/canonicalWebResponse";
```

In `/suggest`, replace `(canonical.items as MovieItem[])` with:

```ts
const canonicalItems = parseCanonicalWebItems(canonical) as MovieItem[];
const details = canonicalItems.filter((item) => {
```

In `/genre-suggest`, replace the direct assignment with:

```ts
const validMovies = parseCanonicalWebItems(canonical) as MovieItem[];
```

Do not convert malformed payloads into empty arrays; let the existing page catch blocks display the shared explicit error.

- [ ] **Step 4: Remove the presentation-hydration promise dependency**

Delete `watchlistIdsHydrationRef`. In `runSuggest`, remove:

```ts
const localWatchlistIds = await (...);
```

Use the latest state snapshot for presentation selection:

```ts
setWatchlistPicks(
  selectCanonicalWatchlistPicks(details, watchlistTmdbIds),
);
```

Add `watchlistTmdbIds` to the callback dependency list. Canonical items must reach `setItems(details)` without awaiting mapping, profile, diary, or bulk metadata hydration.

- [ ] **Step 5: Gate presentation hydration until canonical generation settles**

Add state near the existing presentation state:

```ts
const [presentationHydrationEnabled, setPresentationHydrationEnabled] =
  useState(false);
```

At the beginning of `runSuggest`, set it to `false`. In `finally`, after `setLoading(false)`, set it to `true`. Update the presentation effect guard:

```ts
if (
  !presentationHydrationEnabled ||
  !uid ||
  sourceFilms.length === 0
) {
  return;
}
```

Include `presentationHydrationEnabled` in the effect dependencies. The effect remains presentation-only and logs failures with `[Suggest]` without clearing canonical items.

- [ ] **Step 6: Deduplicate and cap presentation metadata IDs**

Before `getBulkTmdbDetails`, derive the bounded list in source-film order:

```ts
const presentationTmdbIds = [
  ...new Set(
    sourceFilms
      .map((film) => mappings.get(film.uri))
      .filter((tmdbId): tmdbId is number => Boolean(tmdbId)),
  ),
].slice(0, 300);
const details = await getBulkTmdbDetails(presentationTmdbIds);
```

Keep all source films and mappings in `buildTasteProfile`; only the metadata preload is capped. Its existing missing-detail behavior may underfill presentation state but cannot block canonical rendering.

- [ ] **Step 7: Recompute watchlist picks when late hydration completes**

Add an effect so late watchlist state updates presentation only:

```ts
useEffect(() => {
  if (!items) return;
  setWatchlistPicks(
    selectCanonicalWatchlistPicks(items, watchlistTmdbIds),
  );
}, [items, watchlistTmdbIds]);
```

This preserves watchlist picks after canonical items render first.

- [ ] **Step 8: Run focused client and validator tests and verify GREEN**

Run:

```powershell
rtk npm run test -- tests/unit/canonicalWebResponse.test.ts tests/integration/recommendationAdapters.test.ts
```

Expected: PASS.

- [ ] **Step 9: Run the authenticated page slice when credentials are available**

Run:

```powershell
rtk npx playwright test tests/recommendation-pages.spec.ts
```

Expected: PASS. If `TEST_USER_EMAIL` or `TEST_USER_PASSWORD` is absent, the existing suite may report skipped; record that exact outcome in the tracker rather than claiming browser validation.

- [ ] **Step 10: Commit the client checkpoint**

```powershell
rtk git add src/app/suggest/page.tsx src/app/genre-suggest/page.tsx tests/integration/recommendationAdapters.test.ts
rtk git commit -m "fix: defer suggestion presentation hydration"
```

## Task 5: Review, Verify, and Close the Production Blocker

**Files:**
- Modify: `docs/plans/MAIN.md`
- Modify: `docs/plans/phases/phase-2-integrity-observability-evaluation.md`

- [ ] **Step 1: Run formatting and diff safety checks**

Run:

```powershell
rtk npx prettier --check src/lib/canonicalWebResponse.ts src/lib/serverSuggestionsEngine.ts src/lib/enrich.ts src/app/api/v1/_lib/tmdb.ts src/app/actions/recommendations.ts src/app/suggest/page.tsx src/app/genre-suggest/page.tsx tests/unit/canonicalWebResponse.test.ts tests/unit/serverTmdbDetails.test.ts tests/unit/tmdbClient.test.ts tests/integration/webRecommendationGenreDetails.test.ts tests/integration/recommendationAdapters.test.ts
rtk git diff --check
```

Expected: both commands PASS. If Prettier reports files, run the same command with `--write`, then rerun `--check`.

- [ ] **Step 2: Run the focused regression gate**

Run:

```powershell
rtk npm run test -- tests/unit/canonicalWebResponse.test.ts tests/unit/serverTmdbDetails.test.ts tests/unit/tmdbClient.test.ts tests/integration/webRecommendationGenreDetails.test.ts tests/integration/recommendationAdapters.test.ts tests/integration/recommendationEngine.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the project verification gate**

Run each command separately:

```powershell
rtk npm run lint
rtk npm run typecheck
rtk npm run test
rtk npm run build
```

Expected: all PASS.

- [ ] **Step 4: Run the page-level browser gate**

Run:

```powershell
rtk npx playwright test tests/recommendation-pages.spec.ts
```

Expected: PASS or an explicit credential-based skip. Do not deploy or perform production import validation without separate authorization.

- [ ] **Step 5: Run change-impact analysis**

Use Codebase Memory `detect_changes` for project `F-Code-LettrSuggest` with the default working-tree scope. Confirm the affected path is limited to canonical web recommendation generation, shared TMDB detail requests, and the two web pages. Run any additional focused test identified by the graph before closing the blocker.

- [ ] **Step 6: Perform the required code-review loop**

Dispatch the `code-reviewer` subagent over the bounded hotfix diff. Ask it to prioritize correctness, strict genre regressions, accidental fallback one-ID fetches, React effect races, and missing tests. Apply only verified findings, rerun the smallest affected test after each change, then rerun Steps 1-4.

- [ ] **Step 7: Update the active tracker and phase evidence**

In `docs/plans/MAIN.md`, keep checkpoint 2A.3 as the next phase checkpoint and add a completed production-blocker note containing:

```md
- Suggestion timeout hotfix: completed
- Shared web metadata window: deterministic, deduplicated, maximum 300 IDs
- Server TMDB request timeout: 5 seconds with concurrency 5
- `/suggest` presentation hydration: deferred and non-blocking
- `/genre-suggest`: shared payload validation and bounded canonical server path
- Verification: <record exact lint/typecheck/test/build/Playwright outcomes>
- Next action: resume 2A.3 Atomic Snapshot Reconciliation and add fresh import-to-suggestions acceptance evidence
```

In `docs/plans/phases/phase-2-integrity-observability-evaluation.md`, record the blocker as resolved without marking 2A.3 started or complete. Explicitly retain the 2A.3 requirement for honest import failure, stale-row reconciliation, and recommendation-revision invalidation.

- [ ] **Step 8: Commit tracker closure**

```powershell
rtk git add docs/plans/MAIN.md docs/plans/phases/phase-2-integrity-observability-evaluation.md
rtk git commit -m "docs: close suggestion timeout blocker"
```

- [ ] **Step 9: Inspect final repository state**

Run:

```powershell
rtk git status --short
rtk git log --oneline -10
```

Expected: hotfix files are committed. Existing unrelated user changes remain untouched. Report the exact verification evidence and that 2A.3 is ready to resume.
