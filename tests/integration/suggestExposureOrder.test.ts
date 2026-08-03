import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/supabaseClient", () => ({ supabase: undefined }));

import {
  buildSuggestPresentation,
  computeSuggestSectionVisibility,
  createCommittedExposureEmissionState,
  emitNewCommittedExposureIds,
  selectInitialSuggestExposureOrder,
  type SuggestSectionKey,
  type SuggestSectionItems,
} from "@/lib/recommendationAdapters";
import {
  buildRecommendationExposureRecords,
  buildRecommendationTrace,
  recordRecommendationExposures,
  type RecommendationExposureWriter,
} from "@/lib/recommendationTelemetry";
import type { RecommendationTrace } from "@/lib/recommendationTypes";
import { canonicalFixture } from "../fixtures/recommendations/canonicalFixture";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function makeTrace(): RecommendationTrace {
  return buildRecommendationTrace({ result: canonicalFixture.result });
}

const card = (id: number) => ({ id });

function makeCategorized(
  overrides: Partial<Record<SuggestSectionKey, Array<{ id: number }>>>,
): SuggestSectionItems {
  const keys: SuggestSectionKey[] = [
    "watchlistPicks",
    "seasonalPicks",
    "perfectMatches",
    "recentWatchMatches",
    "studioMatches",
    "directorMatches",
    "actorMatches",
    "genreMatches",
    "documentaries",
    "decadeMatches",
    "smartDiscovery",
    "hiddenGems",
    "cultClassics",
    "crowdPleasers",
    "newReleases",
    "recentClassics",
    "deepCuts",
    "fromCollections",
    "multiSourceConsensus",
    "internationalCinema",
    "animationPicks",
    "quickWatches",
    "epicFilms",
    "criticallyAcclaimed",
    "nicheMatches",
    "moreRecommendations",
  ];
  const categorized = Object.fromEntries(
    keys.map((key) => [key, overrides[key] ?? []]),
  ) as Record<SuggestSectionKey, Array<{ id: number }>>;
  return categorized as unknown as SuggestSectionItems;
}

/**
 * Mixed presentation fixture covering every visibility class:
 * - watchlist picks (top priority section, may duplicate other sections)
 * - always-visible sections with items (seasonal, perfect, recent, consensus)
 * - secondary sections above and below the 3-item visibility threshold
 * - explore sections above and below the small-section threshold (collapsed)
 * - deepCuts (renders whenever non-empty, bypassing the collapse gates)
 * - nicheMatches (categorized but never rendered: no presentation block)
 */
function makeMixedCategorized(): SuggestSectionItems {
  return makeCategorized({
    watchlistPicks: [card(900), card(901)],
    seasonalPicks: [card(902)],
    // 900 also appears here: watchlist picks stay in the main item list.
    perfectMatches: [card(900), card(903)],
    recentWatchMatches: [card(904)],
    directorMatches: [card(910), card(911), card(912)],
    studioMatches: [card(913), card(914)],
    actorMatches: [card(915)],
    genreMatches: [card(916), card(917), card(918), card(919)],
    hiddenGems: [card(920), card(921), card(922)],
    documentaries: [card(930), card(931), card(932)],
    cultClassics: [card(933)],
    newReleases: [card(934)],
    deepCuts: [card(940)],
    nicheMatches: [card(950), card(951), card(952)],
    moreRecommendations: [card(960), card(961)],
    fromCollections: [card(970), card(971), card(972)],
    multiSourceConsensus: [card(905), card(906)],
  });
}

const INITIAL_FLAGS = {
  showAllSections: false,
  showCollapsedSmallSections: false,
};

describe("suggest initial presentation order", () => {
  it("renders only priority, qualifying secondary, and deep-cuts sections initially, in JSX order", () => {
    const { renderedSectionKeys } = computeSuggestSectionVisibility(
      makeMixedCategorized(),
      INITIAL_FLAGS,
    );

    expect(renderedSectionKeys).toEqual([
      "watchlistPicks",
      "seasonalPicks",
      "perfectMatches",
      "recentWatchMatches",
      "directorMatches",
      "genreMatches",
      "hiddenGems",
      "deepCuts",
      "multiSourceConsensus",
    ]);
  });

  it("hides secondary sections with fewer than three items behind the small-section collapse", () => {
    const { shouldRenderSection } = computeSuggestSectionVisibility(
      makeMixedCategorized(),
      INITIAL_FLAGS,
    );

    // studioMatches (2) and actorMatches (1) are secondary but too small.
    expect(shouldRenderSection("studioMatches")).toBe(false);
    expect(shouldRenderSection("actorMatches")).toBe(false);
    expect(shouldRenderSection("directorMatches")).toBe(true);
  });

  it("keeps explore sections collapsed initially regardless of their size", () => {
    const { shouldRenderSection } = computeSuggestSectionVisibility(
      makeMixedCategorized(),
      INITIAL_FLAGS,
    );

    expect(shouldRenderSection("documentaries")).toBe(false);
    expect(shouldRenderSection("fromCollections")).toBe(false);
    expect(shouldRenderSection("moreRecommendations")).toBe(false);
    expect(shouldRenderSection("cultClassics")).toBe(false);
    expect(shouldRenderSection("newReleases")).toBe(false);
  });

  it("never renders nicheMatches and always renders non-empty deepCuts", () => {
    const { shouldRenderSection } = computeSuggestSectionVisibility(
      makeMixedCategorized(),
      INITIAL_FLAGS,
    );

    expect(shouldRenderSection("nicheMatches")).toBe(false);
    expect(shouldRenderSection("deepCuts")).toBe(true);

    const expanded = computeSuggestSectionVisibility(makeMixedCategorized(), {
      showAllSections: true,
      showCollapsedSmallSections: true,
    });
    expect(expanded.shouldRenderSection("nicheMatches")).toBe(false);
    expect(expanded.shouldRenderSection("deepCuts")).toBe(true);
  });

  it("expands explore sections with showAllSections but keeps small sections collapsed", () => {
    const { renderedSectionKeys } = computeSuggestSectionVisibility(
      makeMixedCategorized(),
      { showAllSections: true, showCollapsedSmallSections: false },
    );

    expect(renderedSectionKeys).toEqual([
      "watchlistPicks",
      "seasonalPicks",
      "perfectMatches",
      "recentWatchMatches",
      "directorMatches",
      "genreMatches",
      "documentaries",
      "hiddenGems",
      "deepCuts",
      "fromCollections",
      "multiSourceConsensus",
    ]);
  });

  it("expands small sections with showCollapsedSmallSections but keeps explore sections collapsed", () => {
    const { renderedSectionKeys } = computeSuggestSectionVisibility(
      makeMixedCategorized(),
      { showAllSections: false, showCollapsedSmallSections: true },
    );

    expect(renderedSectionKeys).toEqual([
      "watchlistPicks",
      "seasonalPicks",
      "perfectMatches",
      "recentWatchMatches",
      "directorMatches",
      "studioMatches",
      "actorMatches",
      "genreMatches",
      "hiddenGems",
      "cultClassics",
      "newReleases",
      "deepCuts",
      "multiSourceConsensus",
      "moreRecommendations",
    ]);
  });

  it("reports the collapsed button counts shown to the user", () => {
    const initial = computeSuggestSectionVisibility(
      makeMixedCategorized(),
      INITIAL_FLAGS,
    );
    // Explore-sized collapsed: documentaries (3), fromCollections (3).
    expect(initial.exploreButtonCount).toBe(2);
    // Small collapsed: studioMatches, actorMatches, cultClassics, newReleases,
    // deepCuts, moreRecommendations. deepCuts is counted by the page's
    // pre-existing collapsed-small count even though it always renders; the
    // helper preserves that button behavior exactly.
    expect(initial.smallSectionsButtonCount).toBe(6);

    const expanded = computeSuggestSectionVisibility(makeMixedCategorized(), {
      showAllSections: true,
      showCollapsedSmallSections: true,
    });
    expect(expanded.exploreButtonCount).toBe(0);
    expect(expanded.smallSectionsButtonCount).toBe(0);
  });

  it("renders nothing for an empty categorization", () => {
    const { renderedSectionKeys, exploreButtonCount, smallSectionsButtonCount } =
      computeSuggestSectionVisibility(makeCategorized({}), INITIAL_FLAGS);

    expect(renderedSectionKeys).toEqual([]);
    expect(exploreButtonCount).toBe(0);
    expect(smallSectionsButtonCount).toBe(0);
  });
});

describe("initial suggest exposure order", () => {
  it("returns exactly the initially presented card ids in exact render order", () => {
    const ids = selectInitialSuggestExposureOrder(makeMixedCategorized());

    // JSX order: watchlist -> seasonal -> perfect (deduped) -> recent watch ->
    // director -> genre -> hidden gems -> deep cuts -> multi-source consensus.
    expect(ids).toEqual([
      900, 901, 902, 903, 904, 910, 911, 912, 916, 917, 918, 919, 920, 921,
      922, 940, 905, 906,
    ]);
  });

  it("excludes collapsed-only, explore-only, and never-rendered niche cards", () => {
    const ids = selectInitialSuggestExposureOrder(makeMixedCategorized());

    // Secondary sections below the 3-item threshold.
    expect(ids).not.toContain(913);
    expect(ids).not.toContain(914);
    expect(ids).not.toContain(915);
    // Explore sections collapsed behind "Explore N More Categories".
    expect(ids).not.toContain(930);
    expect(ids).not.toContain(931);
    expect(ids).not.toContain(932);
    expect(ids).not.toContain(970);
    // Small sections collapsed behind "Show N more sections".
    expect(ids).not.toContain(933);
    expect(ids).not.toContain(934);
    expect(ids).not.toContain(960);
    expect(ids).not.toContain(961);
    // nicheMatches has no presentation block and is never exposed.
    expect(ids).not.toContain(950);
    expect(ids).not.toContain(951);
    expect(ids).not.toContain(952);
  });

  it("dedupes cards that appear in the watchlist section and another section", () => {
    const ids = selectInitialSuggestExposureOrder(makeMixedCategorized());

    expect(ids.filter((id) => id === 900)).toHaveLength(1);
    // First occurrence wins: the watchlist position precedes perfect matches.
    expect(ids.indexOf(900)).toBeLessThan(ids.indexOf(903));
  });

  it("returns an empty order when every card lands in a collapsed section", () => {
    const categorized = makeCategorized({
      documentaries: [card(801), card(802), card(803)],
      nicheMatches: [card(804)],
      actorMatches: [card(805)],
    });

    expect(selectInitialSuggestExposureOrder(categorized)).toEqual([]);
  });
});

describe("committed presentation exposure emission", () => {
  it("emits initial, palate, and expansion deltas in committed order without duplicates", () => {
    const categorized = makeCategorized({
      perfectMatches: [card(1)],
      documentaries: [card(6), card(7), card(8)],
      crowdPleasers: [card(2)],
      newReleases: [card(3)],
    });
    const scope = { generation: 4, owner: USER_ID };

    const initial = buildSuggestPresentation(categorized, [], INITIAL_FLAGS);
    expect(initial.orderedTmdbIds).toEqual([1]);

    const initialEmission = emitNewCommittedExposureIds(
      createCommittedExposureEmissionState(),
      scope,
      initial,
    );
    expect(initialEmission.newlyVisibleIds).toEqual([1]);

    const withPalate = buildSuggestPresentation(
      categorized,
      [card(4), card(5)],
      INITIAL_FLAGS,
    );
    expect(withPalate.orderedTmdbIds).toEqual([1, 4, 5]);
    const palateEmission = emitNewCommittedExposureIds(
      initialEmission.state,
      scope,
      withPalate,
    );
    expect(palateEmission.newlyVisibleIds).toEqual([4, 5]);

    const expanded = buildSuggestPresentation(
      categorized,
      [card(4), card(5)],
      { showAllSections: true, showCollapsedSmallSections: true },
    );
    // The async palate section remains between crowd pleasers and new
    // releases, while the expansion reveals the previously collapsed cards.
    expect(expanded.orderedTmdbIds).toEqual([1, 6, 7, 8, 2, 4, 5, 3]);
    const expansionEmission = emitNewCommittedExposureIds(
      palateEmission.state,
      scope,
      expanded,
    );
    expect(expansionEmission.newlyVisibleIds).toEqual([6, 7, 8, 2, 3]);

    const repeatEmission = emitNewCommittedExposureIds(
      expansionEmission.state,
      scope,
      expanded,
    );
    expect(repeatEmission.newlyVisibleIds).toEqual([]);
  });

  it("persists palate and expansion deltas at their full committed post-ranks", async () => {
    const categorized = makeCategorized({
      perfectMatches: [card(1)],
      documentaries: [card(6), card(7), card(8)],
      crowdPleasers: [card(2)],
    });
    const scope = { generation: 4, owner: USER_ID };
    const initial = buildSuggestPresentation(categorized, [], INITIAL_FLAGS);
    const initialEmission = emitNewCommittedExposureIds(
      createCommittedExposureEmissionState(),
      scope,
      initial,
    );
    const withPalate = buildSuggestPresentation(
      categorized,
      [card(4), card(5)],
      INITIAL_FLAGS,
    );
    const palateEmission = emitNewCommittedExposureIds(
      initialEmission.state,
      scope,
      withPalate,
    );

    const palateWriter = vi.fn<RecommendationExposureWriter>(
      async () => undefined,
    );
    await recordRecommendationExposures({
      userId: USER_ID,
      trace: makeTrace(),
      orderedTmdbIds: palateEmission.newlyVisibleIds,
      postRanksById: withPalate.postRanksById,
      writer: palateWriter,
    });

    expect(palateEmission.newlyVisibleIds).toEqual([4, 5]);
    expect(palateWriter.mock.calls[0]?.[0].map((record) => record.post_rank)).toEqual(
      [2, 3],
    );

    const expanded = buildSuggestPresentation(
      categorized,
      [card(4), card(5)],
      { showAllSections: true, showCollapsedSmallSections: true },
    );
    const expansionEmission = emitNewCommittedExposureIds(
      palateEmission.state,
      scope,
      expanded,
    );
    const expansionWriter = vi.fn<RecommendationExposureWriter>(
      async () => undefined,
    );
    await recordRecommendationExposures({
      userId: USER_ID,
      trace: makeTrace(),
      orderedTmdbIds: expansionEmission.newlyVisibleIds,
      postRanksById: expanded.postRanksById,
      writer: expansionWriter,
    });

    expect(expansionEmission.newlyVisibleIds).toEqual([6, 7, 8, 2]);
    expect(
      expansionWriter.mock.calls[0]?.[0].map((record) => record.post_rank),
    ).toEqual([2, 3, 4, 5]);
  });

  it("resets the emitted set for a new generation or owner", () => {
    const presentation = buildSuggestPresentation(
      makeCategorized({ perfectMatches: [card(11)] }),
      [],
      INITIAL_FLAGS,
    );

    const first = emitNewCommittedExposureIds(
      createCommittedExposureEmissionState(),
      { generation: 1, owner: "owner-a" },
      presentation,
    );
    expect(first.newlyVisibleIds).toEqual([11]);
    expect(
      emitNewCommittedExposureIds(
        first.state,
        { generation: 1, owner: "owner-a" },
        presentation,
      ).newlyVisibleIds,
    ).toEqual([]);

    const newOwner = emitNewCommittedExposureIds(
      first.state,
      { generation: 1, owner: "owner-b" },
      presentation,
    );
    expect(newOwner.newlyVisibleIds).toEqual([11]);

    const newGeneration = emitNewCommittedExposureIds(
      newOwner.state,
      { generation: 2, owner: "owner-b" },
      presentation,
    );
    expect(newGeneration.newlyVisibleIds).toEqual([11]);
  });
});

describe("exposure sink consumes the initial presentation order", () => {
  let writer: Mock<RecommendationExposureWriter>;

  beforeEach(() => {
    writer = vi.fn<RecommendationExposureWriter>(async () => undefined);
  });

  it("records one row per initially presented card with presentation post-ranks and engine pre-ranks", async () => {
    const categorized = makeMixedCategorized();
    const orderedTmdbIds = selectInitialSuggestExposureOrder(categorized);
    const preRanksById = new Map<number, number>([
      [900, 11],
      [903, 4],
      [940, 2],
    ]);

    await recordRecommendationExposures({
      userId: USER_ID,
      trace: makeTrace(),
      orderedTmdbIds,
      preRanksById,
      writer,
    });

    expect(writer).toHaveBeenCalledTimes(1);
    const records = writer.mock.calls[0]?.[0] ?? [];
    expect(records.map((record) => record.tmdb_id)).toEqual(orderedTmdbIds);
    expect(records.map((record) => record.post_rank)).toEqual(
      orderedTmdbIds.map((_id, index) => index + 1),
    );
    // Engine pre-ranks survive; missing entries fall back to the post-rank.
    expect(records[0].pre_rank).toBe(11);
    expect(records[3].pre_rank).toBe(4);
    expect(records.find((record) => record.tmdb_id === 940)?.pre_rank).toBe(2);
    expect(records[1].pre_rank).toBe(records[1].post_rank);

    const exposed = new Set(records.map((record) => record.tmdb_id));
    for (const hiddenId of [
      913, 914, 915, 930, 931, 932, 933, 934, 950, 951, 952, 960, 961, 970,
      971, 972,
    ]) {
      expect(exposed.has(hiddenId), `hidden id ${hiddenId} logged`).toBe(
        false,
      );
    }
  });

  it("writes nothing when the initial presentation is empty", async () => {
    const categorized = makeCategorized({
      documentaries: [card(801), card(802), card(803)],
    });

    await recordRecommendationExposures({
      userId: USER_ID,
      trace: makeTrace(),
      orderedTmdbIds: selectInitialSuggestExposureOrder(categorized),
      writer,
    });

    expect(writer).not.toHaveBeenCalled();
  });

  it("matches the shared record builder for the same presentation order", () => {
    const orderedTmdbIds = selectInitialSuggestExposureOrder(
      makeMixedCategorized(),
    );

    const records = buildRecommendationExposureRecords({
      userId: USER_ID,
      trace: makeTrace(),
      orderedTmdbIds,
    });

    expect(records.map((record) => record.tmdb_id)).toEqual(orderedTmdbIds);
    expect(records.map((record) => record.post_rank)).toEqual(
      orderedTmdbIds.map((_id, index) => index + 1),
    );
  });
});

describe("/suggest page wiring", () => {
  const page = readFileSync(
    fileURLToPath(new URL("../../src/app/suggest/page.tsx", import.meta.url)),
    "utf8",
  );

  it("defers the sink until the committed shared presentation emits visible deltas", () => {
    expect(page).toContain("buildSuggestPresentation(");
    expect(page).toContain("committedSuggestPresentation");
    expect(page).toContain("emitNewCommittedExposureIds(");
    expect(page).toMatch(
      /orderedTmdbIds:\s*emission\.newlyVisibleIds/,
    );
    expect(page).toMatch(
      /postRanksById:\s*committedSuggestPresentation\.postRanksById/,
    );
    // The pre-categorization raw details order is never logged directly.
    expect(page).not.toMatch(/orderedTmdbIds:\s*details\.map/);
    expect(page).not.toContain("selectInitialSuggestExposureOrder(");
  });

  it("renders sections through the committed presentation model", () => {
    expect(page).toContain("const committedSuggestPresentation = useMemo(");
    expect(page).toMatch(
      /const \{\s*renderedSectionKeys,\s*shouldRenderSection,\s*exploreButtonCount,\s*smallSectionsButtonCount,\s*\} = committedSuggestPresentation/s,
    );
    expect(page).toContain("shouldRenderSection(");
    // deepCuts renders through the shared gate instead of a private length
    // check so rendering and exposure cannot drift.
    expect(page).toContain('shouldRenderSection("deepCuts")');
    expect(page).toContain('shouldRenderSection("palateCleanser")');
    expect(page).not.toMatch(
      /categorizedSuggestions\.deepCuts\.length\s*>=\s*1\s*&&/,
    );
  });

  it("keeps the owner/current-run guards, canonical trace, and pre-ranks on the sink call", () => {
    expect(page).toMatch(/recordRecommendationExposures\s*\(\s*\{[^}]*preRanksById/);
    expect(page).toMatch(/trace:\s*canonical\.trace/);
    expect(page).toMatch(/isCurrentRun\(\)/);
    expect(page).toMatch(/userId:\s*currentUid/);
  });
});
