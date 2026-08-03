import type { FilterRelaxation } from "@/lib/advancedFiltering";
import type { FatigueDetection } from "@/lib/counterProgramming";
import { TMDB_GENRE_MAP } from "@/lib/genreEnhancement";
import type { RecommendationInputRevisionMaterial } from "@/lib/recommendationContext";
import { buildRecommendationTrace } from "@/lib/recommendationTelemetry";
import type {
  RecommendationRequest,
  RecommendationResult,
  RecommendationTrace,
  RecommendationTraceRelaxation,
} from "@/lib/recommendationTypes";
import { MAX_RECOMMENDATION_COUNT } from "@/lib/recommendationTypes";

export type V1RecommendationIntent = Readonly<{
  userId: string;
  seedTmdbIds: readonly number[];
  limit: number;
  excludeTmdbIds: readonly number[];
  genreIds?: readonly number[];
  genreNames?: readonly string[];
  filterRelaxation?: FilterRelaxation;
  debug: boolean;
  requestSeed: string;
}>;

export type V1RecommendationAdapterOptions = Readonly<{
  genreIds?: readonly number[];
  filterRelaxation?: FilterRelaxation;
  debug: boolean;
}>;

export type WebRecommendationIntent = Readonly<{
  userId: string;
  seedTmdbIds: readonly number[];
  limit: number;
  excludeTmdbIds: readonly number[];
  genreNames?: readonly string[];
  context?: RecommendationRequest["context"];
  requestSeed: string;
}>;

export type WebRecommendationDetails = Readonly<{
  title?: string;
  consensusLevel?: "high" | "medium" | "low";
  sources?: readonly string[];
  reasons?: readonly string[];
  explanation?: string;
  genres?: readonly string[];
  releaseDate?: string;
  posterPath?: string | null;
  voteCategory?: "hidden-gem" | "crowd-pleaser" | "cult-classic" | "standard";
  collectionName?: string;
  trailerKey?: string | null;
  voteAverage?: number;
  voteCount?: number;
  overview?: string;
  runtime?: number;
  originalLanguage?: string;
  criticScore?: number;
  imdbRating?: string;
  rottenTomatoes?: string;
  metacritic?: string;
  spokenLanguages?: readonly string[];
  productionCountries?: readonly string[];
  keywordNames?: readonly string[];
}>;

export type VoteCategory =
  | "hidden-gem"
  | "crowd-pleaser"
  | "cult-classic"
  | "standard";

export type CachedMovieMetadata = Readonly<{
  vote_average?: number | null;
  vote_count?: number | null;
  imdb_rating?: string | null;
  rotten_tomatoes?: string | null;
  metacritic?: string | null;
  critic_score?: number | null;
  ratings?: Readonly<{
    imdb_rating?: string | null;
    rotten_tomatoes?: string | null;
    metacritic?: string | null;
    critic_score?: number | null;
  }>;
}>;

export type WebRecommendationMetadata = Readonly<{
  voteCategory: VoteCategory;
  criticScore?: number;
  imdbRating?: string;
  rottenTomatoes?: string;
  metacritic?: string;
}>;

export type WebRecommendationItem = Readonly<{
  id: number;
  title: string;
  year?: string;
  reasons: string[];
  explanation?: string;
  poster_path?: string | null;
  score: number;
  voteCategory?: VoteCategory;
  collectionName?: string;
  trailerKey?: string | null;
  genres?: string[];
  vote_average?: number;
  vote_count?: number;
  overview?: string;
  sources?: string[];
  consensusLevel?: "high" | "medium" | "low";
  runtime?: number;
  original_language?: string;
  critic_score?: number;
  imdb_rating?: string;
  rotten_tomatoes?: string;
  metacritic?: string;
  spoken_languages?: string[];
  production_countries?: string[];
  keyword_names?: string[];
}>;

function normalizeGenreName(name: string): string {
  return name.trim().toLowerCase();
}

const NICHE_GENRE_NAMES = new Set([
  "anime",
  "food",
  "travel",
  "stand up",
  "sports",
]);

const NICHE_GENRE_RETRIEVAL_NAMES: Readonly<Record<string, string>> = {
  anime: "animation",
  food: "documentary",
  travel: "documentary",
  "stand up": "comedy",
  sports: "documentary",
};

export function classifyVoteCategory(
  voteAverage: number | null | undefined,
  voteCount: number | null | undefined,
): VoteCategory {
  const average =
    typeof voteAverage === "number" && Number.isFinite(voteAverage)
      ? voteAverage
      : 0;
  const count =
    typeof voteCount === "number" && Number.isFinite(voteCount) ? voteCount : 0;

  if (average >= 7.5 && count < 1000) return "hidden-gem";
  if (average >= 7.0 && count > 10_000) return "crowd-pleaser";
  if (average >= 7.0 && count >= 1000 && count <= 5000) {
    return "cult-classic";
  }
  return "standard";
}

function optionalString(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function optionalFiniteNumber(
  value: number | null | undefined,
): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function extractCachedWebRecommendationMetadata(
  movie: CachedMovieMetadata | undefined,
): WebRecommendationMetadata {
  const imdbRating =
    optionalString(movie?.imdb_rating) ??
    optionalString(movie?.ratings?.imdb_rating);
  const rottenTomatoes =
    optionalString(movie?.rotten_tomatoes) ??
    optionalString(movie?.ratings?.rotten_tomatoes);
  const metacritic =
    optionalString(movie?.metacritic) ??
    optionalString(movie?.ratings?.metacritic);
  const criticScore =
    optionalFiniteNumber(movie?.critic_score) ??
    optionalFiniteNumber(movie?.ratings?.critic_score);

  return {
    voteCategory: classifyVoteCategory(
      movie?.vote_average,
      movie?.vote_count,
    ),
    ...(criticScore === undefined ? {} : { criticScore }),
    ...(imdbRating === undefined ? {} : { imdbRating }),
    ...(rottenTomatoes === undefined ? {} : { rottenTomatoes }),
    ...(metacritic === undefined ? {} : { metacritic }),
  };
}

/**
 * Return only genre names that TMDB can match exactly.
 *
 * TuiMDB-only names are intentionally omitted so web presentation layers can
 * apply their existing niche matching rules after canonical retrieval. If a
 * request mixes a niche name with standard names, all exact prefiltering is
 * skipped so niche-only candidates remain available to presentation.
 */
export function getWebTmdbGenreFilterNames(
  genreNames: readonly string[],
): string[] {
  const requestedNames = new Set(
    genreNames.map(normalizeGenreName).filter(Boolean),
  );

  // A niche selection needs the complete canonical ordered result set so the
  // genre presentation layer can partition it with its established matching.
  // This also applies to mixed standard+niche selections.
  if ([...requestedNames].some((name) => NICHE_GENRE_NAMES.has(name))) {
    return [];
  }

  return Object.values(TMDB_GENRE_MAP)
    .filter((name) => requestedNames.has(normalizeGenreName(name)))
    .map(normalizeGenreName);
}

export function getWebTmdbRetrievalGenreNames(
  genreNames: readonly string[],
): string[] {
  const requestedNames = new Set(
    genreNames.map(normalizeGenreName).filter(Boolean),
  );
  const retrievalNames = new Set<string>();

  for (const name of Object.values(TMDB_GENRE_MAP)) {
    const normalizedName = normalizeGenreName(name);
    if (requestedNames.has(normalizedName)) {
      retrievalNames.add(normalizedName);
    }
  }

  for (const [nicheName, retrievalName] of Object.entries(
    NICHE_GENRE_RETRIEVAL_NAMES,
  )) {
    if (requestedNames.has(nicheName)) retrievalNames.add(retrievalName);
  }

  return Object.values(TMDB_GENRE_MAP)
    .map(normalizeGenreName)
    .filter((name) => retrievalNames.has(name));
}

export function matchesWebTmdbGenreFilter(
  candidateGenres: readonly string[] | undefined,
  requestedGenreFilterNames: readonly string[],
): boolean {
  if (requestedGenreFilterNames.length === 0) return true;

  const requestedNames = new Set(
    requestedGenreFilterNames.map(normalizeGenreName).filter(Boolean),
  );
  return (candidateGenres ?? []).some((genre) =>
    requestedNames.has(normalizeGenreName(genre)),
  );
}

export function matchesNicheGenrePresentation(
  genreName: string,
  title: string,
  genres: readonly string[],
): boolean {
  const normalizedGenre = normalizeGenreName(genreName);
  const normalizedTitle = title.toLowerCase();
  const normalizedGenres = genres.map(normalizeGenreName);

  if (normalizedGenre === "anime") {
    return (
      normalizedGenres.includes("anime") ||
      /anime|manga|otaku/.test(normalizedTitle)
    );
  }
  if (normalizedGenre === "stand up") {
    return normalizedTitle.includes("stand-up");
  }
  if (normalizedGenre === "food") {
    return (
      normalizedGenres.includes("documentary") &&
      /food|chef|cook|restaurant/.test(normalizedTitle)
    );
  }
  if (normalizedGenre === "travel") {
    return (
      normalizedGenres.includes("documentary") &&
      /travel|journey|world/.test(normalizedTitle)
    );
  }
  if (normalizedGenre === "sports") {
    return /sport|athlet|football|soccer|basketball|baseball|tennis|golf|boxing|wrestling|olympic|racing/.test(
      normalizedTitle,
    );
  }

  return false;
}

const LIGHT_PRESENTATION_GENRES = new Set([
  "comedy",
  "animation",
  "romance",
  "musical",
  "family",
  "fantasy",
]);

const INTENSE_PRESENTATION_GENRES = new Set([
  "horror",
  "thriller",
  "action",
  "war",
]);

const HEAVY_PRESENTATION_GENRES = new Set([
  "war",
  "documentary",
  "biography",
  "history",
  "drama",
]);

/**
 * Partition already ordered canonical results for presentation-only sections.
 * These helpers intentionally filter and slice without changing canonical order.
 */
export function selectCanonicalWatchlistPicks<T extends { id: number }>(
  items: readonly T[],
  watchlistTmdbIds: ReadonlySet<number>,
  limit = 5,
): T[] {
  return items
    .filter((item) => watchlistTmdbIds.has(item.id))
    .slice(0, Math.max(0, Math.floor(limit)));
}

export function selectCanonicalPalateCleanser<
  T extends { genres?: readonly string[] },
>(
  items: readonly T[],
  fatigue: FatigueDetection | null,
  limit = 8,
): T[] {
  if (!fatigue) return [];

  const excludedGenres =
    fatigue.type === "intensity"
      ? INTENSE_PRESENTATION_GENRES
      : HEAVY_PRESENTATION_GENRES;
  const fatiguedGenre = fatigue.genre
    ? normalizeGenreName(fatigue.genre)
    : null;

  return items
    .filter((item) => {
      const genres = new Set(
        (item.genres ?? []).map(normalizeGenreName).filter(Boolean),
      );
      if (fatiguedGenre && genres.has(fatiguedGenre)) return false;
      if ([...excludedGenres].some((genre) => genres.has(genre))) return false;
      return [...genres].some((genre) => LIGHT_PRESENTATION_GENRES.has(genre));
    })
    .slice(0, Math.max(0, Math.floor(limit)));
}

/**
 * The committed presentation model shared by recommendation pages and their
 * exposure telemetry. Section arrays remain available for JSX, while
 * orderedItems/orderedTmdbIds represent the first visible occurrence of each
 * card in the exact section order.
 */
export type FinalizedPresentationSection<T extends { id: number }> = Readonly<{
  key: string;
  items: readonly T[];
}>;

export type FinalizedPresentation<T extends { id: number }> = Readonly<{
  sections: readonly FinalizedPresentationSection<T>[];
  itemsByKey: ReadonlyMap<string, readonly T[]>;
  orderedItems: readonly T[];
  orderedTmdbIds: readonly number[];
  postRanksById: ReadonlyMap<number, number>;
}>;

/**
 * Finalize arbitrary visible sections without changing their order. Duplicate
 * cards remain in the section arrays for JSX, but telemetry's ordered view
 * records each card once at its first visible position.
 */
export function buildFinalizedPresentation<T extends { id: number }>(
  sections: readonly FinalizedPresentationSection<T>[],
): FinalizedPresentation<T> {
  const normalizedSections = sections.map((section) => ({
    key: section.key,
    items: section.items.filter(
      (item) =>
        Number.isSafeInteger(item.id) && item.id > 0,
    ),
  }));
  const itemsByKey = new Map<string, readonly T[]>();
  const orderedItems: T[] = [];
  const orderedTmdbIds: number[] = [];
  const postRanksById = new Map<number, number>();
  const seen = new Set<number>();

  for (const section of normalizedSections) {
    itemsByKey.set(section.key, section.items);
    for (const item of section.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      orderedItems.push(item);
      orderedTmdbIds.push(item.id);
      postRanksById.set(item.id, orderedTmdbIds.length);
    }
  }

  return {
    sections: normalizedSections,
    itemsByKey,
    orderedItems,
    orderedTmdbIds,
    postRanksById,
  };
}

/**
 * Presentation section visibility for the /suggest page.
 *
 * The suggest page partitions the canonical ordered output into UI sections;
 * some sections are initially collapsed behind the "Explore N More
 * Categories" and "Show N more sections" toggles, and one categorized section
 * (nicheMatches) has no render block at all. Both section rendering and
 * exposure telemetry derive from these helpers so the presented order and the
 * logged order cannot drift.
 */

export type SuggestSectionKey =
  | "watchlistPicks"
  | "seasonalPicks"
  | "perfectMatches"
  | "recentWatchMatches"
  | "studioMatches"
  | "directorMatches"
  | "actorMatches"
  | "genreMatches"
  | "documentaries"
  | "decadeMatches"
  | "smartDiscovery"
  | "hiddenGems"
  | "cultClassics"
  | "crowdPleasers"
  | "newReleases"
  | "recentClassics"
  | "deepCuts"
  | "fromCollections"
  | "multiSourceConsensus"
  | "internationalCinema"
  | "animationPicks"
  | "quickWatches"
  | "epicFilms"
  | "criticallyAcclaimed"
  | "nicheMatches"
  | "moreRecommendations";

export const SUGGEST_ALL_SECTION_KEYS: readonly SuggestSectionKey[] = [
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

const SUGGEST_ALWAYS_VISIBLE_SECTIONS: readonly SuggestSectionKey[] = [
  "watchlistPicks",
  "perfectMatches",
  "nicheMatches",
  "recentWatchMatches",
  "seasonalPicks",
  "multiSourceConsensus",
];

const SUGGEST_SECONDARY_SECTIONS: readonly SuggestSectionKey[] = [
  "directorMatches",
  "actorMatches",
  "studioMatches",
  "genreMatches",
  "smartDiscovery",
  "hiddenGems",
];

const SUGGEST_EXPLORE_SECTIONS: readonly SuggestSectionKey[] = [
  "animationPicks",
  "documentaries",
  "internationalCinema",
  "quickWatches",
  "epicFilms",
  "criticallyAcclaimed",
  "fromCollections",
  "cultClassics",
  "crowdPleasers",
  "deepCuts",
  "decadeMatches",
  "newReleases",
  "recentClassics",
  "moreRecommendations",
];

/**
 * Exact JSX render order of the sections that own a render block on the
 * page. nicheMatches is categorized but has no render block, so it is absent
 * here and its cards never surface.
 */
const SUGGEST_SECTION_RENDER_ORDER: readonly SuggestSectionKey[] = [
  "watchlistPicks",
  "seasonalPicks",
  "perfectMatches",
  "recentWatchMatches",
  "directorMatches",
  "studioMatches",
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
  "moreRecommendations",
];

export type SuggestSectionItems = Readonly<
  Record<SuggestSectionKey, ReadonlyArray<Readonly<{ id: number }>>>
>;

export type SuggestSectionVisibilityFlags = Readonly<{
  showAllSections: boolean;
  showCollapsedSmallSections: boolean;
}>;

/** The initial /suggest presentation: both expansion toggles are off. */
export const INITIAL_SUGGEST_SECTION_FLAGS: SuggestSectionVisibilityFlags = {
  showAllSections: false,
  showCollapsedSmallSections: false,
};

export type SuggestSectionVisibility = Readonly<{
  /** Section keys that actually render, in exact JSX render order. */
  renderedSectionKeys: readonly SuggestSectionKey[];
  shouldRenderSection: (key: SuggestSectionKey) => boolean;
  /** Collapsed explore sections behind "Explore N More Categories". */
  exploreButtonCount: number;
  /** Collapsed small sections behind "Show N more sections". */
  smallSectionsButtonCount: number;
}>;

const SUGGEST_SECONDARY_VISIBILITY_THRESHOLD = 3;

/**
 * Compute which suggest sections render for the given toggle flags, mirroring
 * the page presentation rules exactly: always-visible sections render when
 * non-empty, secondary sections need at least three items, explore sections
 * stay collapsed until showAllSections, small (1-2 item) sections stay
 * collapsed until showCollapsedSmallSections, deepCuts renders whenever
 * non-empty, and nicheMatches never renders.
 */
export function computeSuggestSectionVisibility(
  sectionItems: SuggestSectionItems,
  flags: SuggestSectionVisibilityFlags,
): SuggestSectionVisibility {
  const sectionCounts = Object.fromEntries(
    SUGGEST_ALL_SECTION_KEYS.map((key) => [
      key,
      sectionItems[key]?.length ?? 0,
    ]),
  ) as Record<SuggestSectionKey, number>;

  const prioritySections = SUGGEST_ALWAYS_VISIBLE_SECTIONS.filter(
    (key) => sectionCounts[key] > 0,
  );
  const prioritySet = new Set(prioritySections);

  const secondarySections = SUGGEST_SECONDARY_SECTIONS.filter(
    (key) =>
      !prioritySet.has(key) &&
      sectionCounts[key] >= SUGGEST_SECONDARY_VISIBILITY_THRESHOLD,
  );
  const visibleSectionKeys = [...prioritySections, ...secondarySections];
  const visibleSet = new Set(visibleSectionKeys);

  const collapsedSmallSections = SUGGEST_ALL_SECTION_KEYS.filter(
    (key) =>
      !visibleSet.has(key) &&
      sectionCounts[key] > 0 &&
      sectionCounts[key] < SUGGEST_SECONDARY_VISIBILITY_THRESHOLD,
  );
  const collapsedSmallSet = new Set(collapsedSmallSections);

  const exploreSections = SUGGEST_EXPLORE_SECTIONS.filter(
    (key) => !collapsedSmallSet.has(key) && sectionCounts[key] > 0,
  );
  const collapsedExploreSections = exploreSections.filter(
    (key) => !flags.showAllSections && !visibleSet.has(key),
  );
  const collapsedExploreSet = new Set(collapsedExploreSections);

  const shouldRenderSection = (key: SuggestSectionKey): boolean => {
    // deepCuts owns no collapse gate on the page; it renders when non-empty.
    if (key === "deepCuts") return sectionCounts[key] > 0;
    // nicheMatches owns no render block, so its cards never surface.
    if (key === "nicheMatches") return false;
    if (sectionCounts[key] === 0) return false;
    if (!flags.showAllSections && collapsedExploreSet.has(key)) return false;
    if (!flags.showCollapsedSmallSections && collapsedSmallSet.has(key)) {
      return false;
    }
    return true;
  };

  const renderedSectionKeys = SUGGEST_SECTION_RENDER_ORDER.filter((key) =>
    shouldRenderSection(key),
  );

  return {
    renderedSectionKeys,
    shouldRenderSection,
    exploreButtonCount: flags.showAllSections
      ? 0
      : collapsedExploreSections.length,
    smallSectionsButtonCount: flags.showCollapsedSmallSections
      ? 0
      : collapsedSmallSections.length,
  };
}

export type SuggestPresentationSectionKey = SuggestSectionKey | "palateCleanser";

export type SuggestPresentation<T extends { id: number }> =
  FinalizedPresentation<T> &
    Readonly<{
      renderedSectionKeys: readonly SuggestPresentationSectionKey[];
      shouldRenderSection: (
        key: SuggestPresentationSectionKey,
      ) => boolean;
      exploreButtonCount: number;
      smallSectionsButtonCount: number;
    }>;

export type CommittedExposurePresentation = Readonly<{
  orderedTmdbIds: readonly number[];
}>;

export type CommittedExposureEmissionScope = Readonly<{
  generation: number;
  owner: string;
}>;

export type CommittedExposureEmissionState = Readonly<{
  generation: number | null;
  owner: string | null;
  emittedIds: ReadonlySet<number>;
}>;

export type CommittedExposureEmission = Readonly<{
  state: CommittedExposureEmissionState;
  newlyVisibleIds: readonly number[];
}>;

/**
 * Create the empty state for a committed-presentation exposure emitter.
 * Keeping the state as an explicit value makes the emitter pure and lets
 * callers reset it synchronously when an account or generation changes.
 */
export function createCommittedExposureEmissionState(): CommittedExposureEmissionState {
  return {
    generation: null,
    owner: null,
    emittedIds: new Set<number>(),
  };
}

/**
 * Return only the cards that became visible since the previous committed
 * presentation for the same generation and owner. A changed scope starts a
 * fresh emission set; input state and presentation are never mutated.
 */
export function emitNewCommittedExposureIds(
  previousState: CommittedExposureEmissionState,
  scope: CommittedExposureEmissionScope,
  presentation: CommittedExposurePresentation | null | undefined,
): CommittedExposureEmission {
  const sameScope =
    previousState.generation === scope.generation &&
    previousState.owner === scope.owner;
  const emittedIds = new Set<number>(
    sameScope ? previousState.emittedIds : undefined,
  );
  const newlyVisibleIds: number[] = [];

  for (const tmdbId of presentation?.orderedTmdbIds ?? []) {
    if (
      !Number.isSafeInteger(tmdbId) ||
      tmdbId <= 0 ||
      emittedIds.has(tmdbId)
    ) {
      continue;
    }
    emittedIds.add(tmdbId);
    newlyVisibleIds.push(tmdbId);
  }

  return {
    state: {
      generation: scope.generation,
      owner: scope.owner,
      emittedIds,
    },
    newlyVisibleIds,
  };
}

/**
 * Build the final /suggest presentation after all committed presentation
 * inputs (including the async palate cleanser) are available. The palate
 * cleanser is intentionally placed between crowdPleasers and newReleases,
 * matching the JSX order.
 */
export function buildSuggestPresentation<T extends { id: number }>(
  sectionItems: SuggestSectionItems | null | undefined,
  palateCleanser: readonly T[],
  flags: SuggestSectionVisibilityFlags,
): SuggestPresentation<T> {
  const safeSectionItems = sectionItems ?? ({} as SuggestSectionItems);
  const visibility = computeSuggestSectionVisibility(
    safeSectionItems,
    flags,
  );
  const presentationOrder: readonly SuggestPresentationSectionKey[] = [
    "watchlistPicks",
    "seasonalPicks",
    "perfectMatches",
    "recentWatchMatches",
    "directorMatches",
    "studioMatches",
    "actorMatches",
    "genreMatches",
    "documentaries",
    "decadeMatches",
    "smartDiscovery",
    "hiddenGems",
    "cultClassics",
    "crowdPleasers",
    "palateCleanser",
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
    "moreRecommendations",
  ];

  const renderedSectionKeys = presentationOrder.filter((key) =>
    key === "palateCleanser"
      ? palateCleanser.length > 0
      : visibility.shouldRenderSection(key),
  );
  const finalized = buildFinalizedPresentation<T>(
    renderedSectionKeys.map((key) => ({
      key,
      items:
        key === "palateCleanser"
          ? palateCleanser
          : (safeSectionItems[key] as readonly T[] | undefined) ?? [],
    })),
  );

  return {
    ...finalized,
    renderedSectionKeys,
    shouldRenderSection: (key) =>
      key === "palateCleanser"
        ? palateCleanser.length > 0
        : visibility.shouldRenderSection(key),
    exploreButtonCount: visibility.exploreButtonCount,
    smallSectionsButtonCount: visibility.smallSectionsButtonCount,
  };
}

/**
 * Select the TMDB ids of the cards actually presented by the initial /suggest
 * render, in exact presentation order. Collapsed explore/small sections and
 * the never-rendered niche section are excluded; duplicated cards keep their
 * first (earliest rendered) occurrence.
 */
export function selectInitialSuggestExposureOrder(
  sectionItems: SuggestSectionItems,
): number[] {
  const { orderedTmdbIds } = buildSuggestPresentation(
    sectionItems,
    [],
    INITIAL_SUGGEST_SECTION_FLAGS,
  );
  return [...orderedTmdbIds];
}

export type V1RecommendationDetails = Readonly<{
  title?: string;
  consensusLevel?: "high" | "medium" | "low";
  sources?: readonly string[];
  reasons?: readonly string[];
  genres?: readonly string[];
  releaseDate?: string;
  posterPath?: string | null;
  voteCategory?: VoteCategory;
}>;

export type V1RecommendationTraceOptions = Readonly<{
  relaxation?: RecommendationTraceRelaxation;
  experimentBucket?: string;
  inputRevisionMaterial?: RecommendationInputRevisionMaterial | null;
}>;

export type WebRecommendationTraceOptions = V1RecommendationTraceOptions;

export function adaptV1RecommendationIntent(
  intent: V1RecommendationIntent,
): Readonly<{
  request: RecommendationRequest;
  options: V1RecommendationAdapterOptions;
}> {
  return {
    request: {
      userId: intent.userId,
      count: intent.limit,
      seeds: intent.seedTmdbIds.map((tmdbId) => ({
        tmdbId,
        weight: 1,
        source: "explicit" as const,
      })),
      excludeTmdbIds: [...intent.excludeTmdbIds],
      genres: [...(intent.genreNames ?? [])],
      context: { mode: "neutral", localHour: null },
      requestSeed: intent.requestSeed,
    },
    options: {
      ...(intent.genreIds !== undefined
        ? { genreIds: [...intent.genreIds] }
        : {}),
      ...(intent.filterRelaxation !== undefined
        ? { filterRelaxation: intent.filterRelaxation }
        : {}),
      debug: intent.debug,
    },
  };
}

export function adaptWebRecommendationIntent(
  intent: WebRecommendationIntent,
): Readonly<{ request: RecommendationRequest }> {
  return {
    request: {
      userId: intent.userId,
      count: intent.limit,
      seeds: intent.seedTmdbIds.map((tmdbId) => ({
        tmdbId,
        weight: 1,
        source: "explicit" as const,
      })),
      excludeTmdbIds: [...intent.excludeTmdbIds],
      genres: [...(intent.genreNames ?? [])],
      context: intent.context ?? { mode: "neutral", localHour: null },
      requestSeed: intent.requestSeed,
    },
  };
}

export function normalizeWebRecommendationCount(count: number): number {
  if (!Number.isFinite(count)) return 1;
  return Math.min(
    Math.max(1, Math.floor(count)),
    MAX_RECOMMENDATION_COUNT,
  );
}

export function adaptCanonicalResultToV1(
  result: RecommendationResult,
  detailsByTmdbId: ReadonlyMap<number, V1RecommendationDetails>,
  options?: V1RecommendationTraceOptions,
) {
  const data = result.results.map((candidate) => {
    const details = detailsByTmdbId.get(candidate.tmdbId);
    return {
      tmdb_id: candidate.tmdbId,
      title: details?.title ?? "",
      score: Math.round(candidate.score * 1000) / 1000,
      consensus_level: details?.consensusLevel ?? "low",
      sources: (details?.sources ?? candidate.evidence.providerFamilies).map(
        (source) => ({ source, confidence: 1 }),
      ),
      reasons: [...(details?.reasons ?? [])],
      genres: [...(details?.genres ?? [])],
      year: details?.releaseDate?.slice(0, 4) ?? null,
      poster_path: details?.posterPath ?? null,
      vote_category: details?.voteCategory ?? null,
    };
  });
  const diagnostics = result.diagnostics;
  const inputHealth = Object.fromEntries(
    Object.entries(diagnostics.inputHealth).map(([source, health]) => [
      source,
      { health: health.health, row_count: health.rowCount },
    ]),
  );

  return {
    data,
    meta: {
      mode: diagnostics.mode,
      failed_sources: [...diagnostics.failedSources],
      input_health: inputHealth,
      engine_version: diagnostics.engineVersion,
      context_mode: diagnostics.contextMode,
      request_seed_hash: diagnostics.requestSeedHash,
      stage_counts: { ...diagnostics.stageCounts },
      drop_reason_counts: { ...diagnostics.dropReasonCounts },
      trace: buildRecommendationTrace({
        result,
        relaxation: options?.relaxation,
        experimentBucket: options?.experimentBucket,
        inputRevisionMaterial: options?.inputRevisionMaterial ?? null,
      }),
    },
  };
}

export function adaptCanonicalResultToWeb(
  result: RecommendationResult,
  detailsByTmdbId: ReadonlyMap<number, WebRecommendationDetails>,
): WebRecommendationItem[] {
  return result.results.map((candidate) => {
    const details = detailsByTmdbId.get(candidate.tmdbId);
    const reasons = Array.from(
      new Set(
        [
          ...(candidate.reasons ?? []),
          ...(details?.reasons ?? []),
        ].filter(
          (reason): reason is string =>
            typeof reason === "string" && reason.trim().length > 0,
        ),
      ),
    );
    if (reasons.length === 0) {
      reasons.push("Recommended from your canonical taste profile");
    }

    return {
      id: candidate.tmdbId,
      title: details?.title ?? `#${candidate.tmdbId}`,
      year: details?.releaseDate?.slice(0, 4),
      reasons,
      ...(candidate.explanation || details?.explanation
        ? { explanation: candidate.explanation ?? details?.explanation }
        : {}),
      poster_path: details?.posterPath ?? null,
      score: candidate.score,
      trailerKey: details?.trailerKey ?? null,
      voteCategory: details?.voteCategory,
      collectionName: details?.collectionName,
      genres: details?.genres ? [...details.genres] : undefined,
      vote_average: details?.voteAverage,
      vote_count: details?.voteCount,
      overview: details?.overview,
      sources: [
        ...(details?.sources ?? candidate.evidence.providerFamilies),
      ],
      consensusLevel:
        details?.consensusLevel ??
        (candidate.evidence.providerFamilies.length >= 3
          ? "high"
          : candidate.evidence.providerFamilies.length >= 2
            ? "medium"
            : "low"),
      runtime: details?.runtime,
      original_language: details?.originalLanguage,
      critic_score: details?.criticScore,
      imdb_rating: details?.imdbRating,
      rotten_tomatoes: details?.rottenTomatoes,
      metacritic: details?.metacritic,
      spoken_languages: details?.spokenLanguages
        ? [...details.spokenLanguages]
        : undefined,
      production_countries: details?.productionCountries
        ? [...details.productionCountries]
        : undefined,
      keyword_names: details?.keywordNames ? [...details.keywordNames] : undefined,
    };
  });
}

export type CanonicalWebRecommendationEnvelope = Readonly<{
  items: WebRecommendationItem[];
  trace: RecommendationTrace;
}>;

/**
 * Wrap the real web adapter output with the same canonical bounded trace the
 * v1 adapter emits. The web item array contract is unchanged; the trace is
 * provided through an additive, type-safe envelope built by the shared builder.
 */
export function adaptCanonicalResultToWebEnvelope(
  result: RecommendationResult,
  detailsByTmdbId: ReadonlyMap<number, WebRecommendationDetails>,
  options?: WebRecommendationTraceOptions,
): CanonicalWebRecommendationEnvelope {
  return {
    items: adaptCanonicalResultToWeb(result, detailsByTmdbId),
    trace: buildRecommendationTrace({
      result,
      relaxation: options?.relaxation,
      experimentBucket: options?.experimentBucket,
      inputRevisionMaterial: options?.inputRevisionMaterial ?? null,
    }),
  };
}
