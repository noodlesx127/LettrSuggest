import {
  applyNegativeFiltering,
  filterCandidatesByGenre,
  type FilterRelaxation,
  type GenreFilterDiagnostics,
} from "@/lib/advancedFiltering";
import {
  adaptV1RecommendationIntent,
  adaptWebRecommendationIntent,
  getWebTmdbGenreFilterNames,
  getWebTmdbRetrievalGenreNames,
  matchesWebTmdbGenreFilter,
  type V1RecommendationAdapterOptions,
  type V1RecommendationDetails,
  type V1RecommendationIntent,
  type WebRecommendationIntent,
} from "@/lib/recommendationAdapters";
import {
  createRecommendationEngine,
  type RecommendationEngineDependencies,
  type RecommendationEngineContext,
  type RecommendationEngineResult,
  type RecommendationRngFactory,
  type RecommendationScoreParams,
  type RecommendationTelemetry,
} from "@/lib/recommendationEngine";
import type {
  FilmEventLite,
  OverlapScoredResult,
  SuggestByOverlapParams,
  TMDBMovie,
} from "@/lib/enrich";
import type {
  RecommendationPersonalization,
  RecommendationScoringInputs,
} from "@/lib/recommendationPersonalization";
import {
  buildRecommendationPersonalization,
  buildRecommendationScoringInputs,
} from "@/lib/recommendationPersonalization";
import { scoreRecommendationsWithOverlapStaged } from "@/lib/recommendationScoring";
import type {
  TasteProfile,
  UserContext,
} from "@/lib/serverSuggestionsEngine";
import { TMDB_GENRE_MAP } from "@/lib/genreEnhancement";
import { normalizeProviderFamilies } from "@/lib/recommendationCandidates";
import type {
  RecommendationCandidate,
  RecommendationRequest,
  RecommendationRequestInput,
  WeightedSeed,
} from "@/lib/recommendationTypes";
import type { EnhancedTasteProfile } from "@/lib/enhancedProfile";

/** A source map returned by the production candidate retrieval boundary. */
export type RecommendationSourceMetadata = NonNullable<
  SuggestByOverlapParams["sourceMetadata"]
>;

/** The metadata completion contract required by the web preparation stage. */
export type RecommendationMetadataCompletion = Readonly<{
  details: Map<number, TMDBMovie>;
  requested: number;
  completed: number;
  failed: number;
  deadlineExpired: boolean;
}>;

export class RecommendationMetadataUnavailableError extends Error {
  constructor() {
    super(
      "Movie metadata is temporarily unavailable. Please retry suggestions.",
    );
    this.name = "RecommendationMetadataUnavailableError";
  }
}

type GeneratedCandidateSet = Readonly<{
  candidateIds: readonly number[];
  sourceMetadata: RecommendationSourceMetadata;
}>;

type CandidateRetrievalParams = Readonly<{
  userId: string;
  userContext: UserContext;
  tasteProfile: TasteProfile;
  seeds: readonly WeightedSeed[];
  seedTmdbIds: readonly number[];
  requestSeed: string;
}>;

type CandidateRetrieval = (
  params: CandidateRetrievalParams,
) => GeneratedCandidateSet | Promise<GeneratedCandidateSet>;

type MetadataLoader = (
  tmdbIds: number[],
) => Map<number, TMDBMovie> | Promise<Map<number, TMDBMovie>>;

type MetadataCompleter = (
  tmdbIds: number[],
  existingDetails: Map<number, TMDBMovie>,
  options: { deadlineMs: number },
) => RecommendationMetadataCompletion | Promise<RecommendationMetadataCompletion>;

type PersonalizationBuilder = (
  userContext: UserContext,
  tasteProfile: TasteProfile,
) => RecommendationPersonalization;

type SharedBuilderParams = Readonly<{
  context: RecommendationEngineContext;
  userContext: UserContext;
  tasteProfile: TasteProfile;
  retrieveCandidates: CandidateRetrieval;
  buildPersonalization?: PersonalizationBuilder;
  rng: RecommendationRngFactory;
  telemetry: RecommendationTelemetry;
}>;

export type WebRecommendationBuilderParams = SharedBuilderParams &
  Readonly<{
    intent: WebRecommendationIntent;
    loadCachedDetails: MetadataLoader;
    ensureCompleteDetails: MetadataCompleter;
    isMetadataCompletionHealthy: (
      completion: RecommendationMetadataCompletion,
      resultCount: number,
    ) => boolean;
    scoreCandidates?: (
      params: RecommendationScoreParams,
      details: Map<number, TMDBMovie>,
      personalization: RecommendationScoringInputs,
    ) =>
      | OverlapScoringOutcome
      | Promise<OverlapScoringOutcome>;
    metadataDeadlineMs?: number;
  }>;

export type V1RecommendationBuilderParams = SharedBuilderParams &
  Readonly<{
    intent: V1RecommendationIntent;
    loadCachedDetails: MetadataLoader;
    scoreCandidates: (
      params: SuggestByOverlapParams,
    ) => readonly OverlapScoredResult[] | Promise<readonly OverlapScoredResult[]>;
  }>;

export type WebRecommendationPreparation = Readonly<{
  dependencies: RecommendationEngineDependencies;
  completeResult: (
    result: RecommendationEngineResult,
  ) => Promise<Readonly<{ details: Map<number, TMDBMovie>; sourceMetadata: RecommendationSourceMetadata }>>;
}>;

export type V1RecommendationPreparation = Readonly<{
  dependencies: RecommendationEngineDependencies;
  candidateIds: readonly number[];
  filteredCandidateIds: readonly number[];
  sourceMetadata: RecommendationSourceMetadata;
  scoredCandidates: readonly OverlapScoredResult[];
  personalizationFiltered: readonly OverlapScoredResult[];
  responseDetails: ReadonlyMap<number, V1RecommendationDetails>;
  filterDiagnostics: Readonly<{
    reasons: readonly GenreFilterDiagnostics["reasons"][number][];
    applied_stages: readonly FilterRelaxation[];
    strict_count: number;
    threshold_count: number;
    genre_count: number;
  }>;
  sourceCandidateCounts: Readonly<Record<string, number>>;
  warning?: "no_candidates_generated" | "all_candidates_excluded";
  relaxation?: FilterRelaxation;
}>;

export type OverlapScoringOutcome = Readonly<{
  /** Score-ordered candidates before the production overlap rerank. */
  candidates: RecommendationCandidate[];
  /** The production overlap rerank applied to the score-ordered candidates. */
  rerankCandidates: () => RecommendationCandidate[];
}>;

/**
 * The pure production generation boundary.
 *
 * Web Actions and the v1 route still own authentication, persistence, and
 * presentation. This module owns intent adaptation and canonical engine
 * invocation, so a caller can provide the exact same network/DB-backed
 * dependencies to two distinct surfaces without adapting one result twice.
 */
export type RecommendationDependencyFactory<TOptions = undefined> = (params: {
  request: RecommendationRequest;
  options: TOptions;
}) =>
  | RecommendationEngineDependencies
  | Promise<RecommendationEngineDependencies>;

type RecommendationDependencyInput<TOptions> =
  | RecommendationEngineDependencies
  | RecommendationDependencyFactory<TOptions>;

async function resolveDependencies<TOptions>(
  input: RecommendationDependencyInput<TOptions>,
  request: RecommendationRequest,
  options: TOptions,
): Promise<RecommendationEngineDependencies> {
  return typeof input === "function"
    ? input({ request, options })
    : input;
}

function buildMinimalEnhancedTasteProfile(params: {
  tasteProfile: TasteProfile;
  watchedFilms: Array<{ rating?: number; liked?: boolean | null }>;
}): EnhancedTasteProfile {
  const { tasteProfile, watchedFilms } = params;
  const genreProfile: EnhancedTasteProfile["genreProfile"] = {
    coreGenres: (tasteProfile.topGenres ?? []).map((genre) => ({
      id: genre.id,
      name: genre.name,
      weight: genre.weight,
      source: "tmdb" as const,
    })),
    holidayGenres: [],
    nicheGenres: [],
    avoidedGenres: (tasteProfile.avoidGenres ?? []).map((genre) => ({
      id: genre.id,
      name: genre.name,
      reason: "User avoidance signal",
    })),
    avoidedHolidays: [],
    currentSeason: "unknown",
    seasonalGenres: [],
  };

  return {
    topGenres: (tasteProfile.topGenres ?? []).map((genre) => ({
      id: genre.id,
      name: genre.name,
      weight: genre.weight,
      source: "tmdb" as const,
    })),
    topKeywords: (tasteProfile.topKeywords ?? []).map((keyword) => ({
      id: keyword.id,
      name: keyword.name,
      weight: keyword.weight,
    })),
    topDirectors: (tasteProfile.topDirectors ?? []).map((director) => ({
      id: director.id,
      name: director.name,
      weight: director.weight,
    })),
    topCast: (tasteProfile.topActors ?? []).map((actor) => ({
      id: actor.id,
      name: actor.name,
      weight: actor.weight,
    })),
    genreProfile,
    preferredEras: (tasteProfile.topDecades ?? []).map((decade) => ({
      decade: `${decade.decade}s`,
      weight: decade.weight,
    })),
    runtimePreferences: { min: 0, max: 0, avg: 0 },
    languagePreferences: (tasteProfile.topLanguages ?? []).map((language) => ({
      language: language.name,
      weight: language.count,
    })),
    avoidedGenres: new Set(
      (tasteProfile.avoidGenres ?? []).map((genre) => genre.name.toLowerCase()),
    ),
    avoidedKeywords: new Set(
      (tasteProfile.avoidKeywords ?? []).map((keyword) =>
        keyword.name.toLowerCase(),
      ),
    ),
    avoidedGenreCombos: new Set<string>(),
    seasonalBoost: { genres: [], weight: 1 },
    holidayPreferences: {
      likesHolidays: false,
      likedHolidays: [],
      avoidHolidays: [],
    },
    nichePreferences: {
      likesAnime: tasteProfile.nichePreferences?.likesAnime ?? false,
      likesStandUp: tasteProfile.nichePreferences?.likesStandUp ?? false,
      likesFoodDocs: tasteProfile.nichePreferences?.likesFoodDocs ?? false,
      likesTravelDocs: tasteProfile.nichePreferences?.likesTravelDocs ?? false,
    },
    watchlistGenres: tasteProfile.watchlistGenres ?? [],
    watchlistDirectors: tasteProfile.watchlistDirectors ?? [],
    subgenrePatterns: new Map(),
    crossGenrePatterns: new Map(),
    totalWatched: tasteProfile.userStats?.totalFilms ?? watchedFilms.length,
    totalRated: watchedFilms.filter((film) => film.rating != null).length,
    totalLiked: watchedFilms.filter((film) => film.liked === true).length,
    avgRating: tasteProfile.userStats?.avgRating ?? 0,
    highlyRatedCount: tasteProfile.tasteBins?.highlyRated ?? 0,
    absoluteFavorites: tasteProfile.tasteBins?.absoluteFavorites ?? 0,
  };
}

function buildFilteringCandidate(
  item: Pick<OverlapScoredResult, "tmdbId" | "title" | "genres">,
  tmdbDetailsCache: Map<number, TMDBMovie>,
): TMDBMovie {
  const cachedMovie = tmdbDetailsCache.get(item.tmdbId);
  if (cachedMovie) return cachedMovie;

  return {
    id: item.tmdbId,
    title: item.title ?? "",
    genres: (item.genres ?? []).map((genreName) => ({
      id: 0,
      name: genreName,
    })),
    keywords: { results: [] },
  } as TMDBMovie;
}

function filterGeneratedCandidateIds(params: {
  candidateIds: readonly number[];
  seedTmdbIds: readonly number[];
  excludeTmdbIds: readonly number[];
  blockedIds: ReadonlySet<number>;
}): number[] {
  const excludedIds = new Set<number>([
    ...params.seedTmdbIds,
    ...params.excludeTmdbIds,
    ...params.blockedIds,
  ]);
  return params.candidateIds.filter((id) => !excludedIds.has(id));
}

function buildSourceCandidateCounts(
  sourceMetadata: RecommendationSourceMetadata,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const metadata of sourceMetadata.values()) {
    for (const source of metadata.sources) {
      counts[source] = (counts[source] ?? 0) + 1;
    }
  }
  return counts;
}

function buildLiteFilms(userContext: UserContext): FilmEventLite[] {
  return userContext.films.map((film) => ({
    uri: film.uri,
    title: film.title,
    year: film.year,
    ...(film.rating != null ? { rating: film.rating } : {}),
    ...(film.liked != null ? { liked: film.liked } : {}),
    ...(film.last_date != null ? { lastDate: film.last_date } : {}),
  }));
}

function normalizeSourceMetadata(
  candidate: RecommendationCandidate,
  sourceMetadata: RecommendationSourceMetadata,
): RecommendationCandidate {
  const rawSources = sourceMetadata.get(candidate.tmdbId)?.sources;
  if (!rawSources?.length) return candidate;

  return {
    ...candidate,
    evidence: {
      ...candidate.evidence,
      providerFamilies: normalizeProviderFamilies(rawSources),
      providerOccurrences: rawSources.length,
    },
  };
}

function sourceMetadataForCandidate(
  candidate: OverlapScoredResult,
  sourceMetadata: RecommendationSourceMetadata,
): string[] {
  return sourceMetadata.get(candidate.tmdbId)?.sources ?? candidate.sources ?? ["overlap"];
}

/**
 * Build the exact web retrieval, metadata-gating, staged scoring, and rerank
 * dependencies used by the production Action. No network, database, or
 * framework object is created here; each side effect is an injected callback.
 */
export function buildWebRecommendationDependencies(
  params: WebRecommendationBuilderParams,
): WebRecommendationPreparation {
  const adapted = adaptWebRecommendationIntent(params.intent);
  const personalization =
    (params.buildPersonalization ?? buildRecommendationPersonalization)(
      params.userContext,
      params.tasteProfile,
    );
  const scoringWindowSize = Math.min(
    300,
    Math.max(adapted.request.count * 3, 100),
  );
  const requestedGenreFilterNames = getWebTmdbGenreFilterNames(
    adapted.request.genres,
  );
  const requestedRetrievalGenreNames = getWebTmdbRetrievalGenreNames(
    adapted.request.genres,
  );
  const requestedTopGenres = Object.entries(TMDB_GENRE_MAP)
    .filter(([, name]) =>
      requestedRetrievalGenreNames.includes(name.toLowerCase()),
    )
    .map(([id, name]) => ({
      id: Number(id),
      name,
      weight: 1,
      count: 1,
    }));
  const requestedGenreIds = new Set(
    requestedTopGenres.map((genre) => genre.id),
  );
  const retrievalTasteProfile =
    requestedTopGenres.length > 0
      ? {
          ...params.tasteProfile,
          topGenres: [
            ...requestedTopGenres,
            ...(params.tasteProfile.topGenres ?? []).filter(
              (genre) => !requestedGenreIds.has(genre.id),
            ),
          ],
        }
      : params.tasteProfile;
  const excludedCandidateIds = new Set<number>([
    ...adapted.request.seeds.map((seed) => seed.tmdbId),
    ...adapted.request.excludeTmdbIds,
    ...params.context.watchedTmdbIds,
    ...params.context.blockedTmdbIds,
  ]);
  const metadataDeadlineMs = params.metadataDeadlineMs ?? 20_000;

  let sourceMetadata: RecommendationSourceMetadata = new Map();
  let requestDetails = new Map<number, TMDBMovie>();
  let metadataDeadlineAt: number | undefined;
  let overlapRerankCandidates:
    | ((eligibleCandidates: readonly RecommendationCandidate[]) => RecommendationCandidate[])
    | null = null;

  const getRemainingMetadataMs = () =>
    metadataDeadlineAt === undefined
      ? metadataDeadlineMs
      : Math.max(0, metadataDeadlineAt - Date.now());

  const dependencies: RecommendationEngineDependencies = {
    loadContext: async () => params.context,
    retrieveCandidates: async () => {
      const generated = await params.retrieveCandidates({
        userId: params.intent.userId,
        userContext: params.userContext,
        tasteProfile: retrievalTasteProfile,
        seeds: adapted.request.seeds,
        seedTmdbIds: params.intent.seedTmdbIds,
        requestSeed: params.intent.requestSeed,
      });
      sourceMetadata = generated.sourceMetadata;

      const scoringWindowIds = Array.from(new Set(generated.candidateIds))
        .filter((tmdbId) => !excludedCandidateIds.has(tmdbId))
        .slice(0, scoringWindowSize);
      metadataDeadlineAt = Date.now() + metadataDeadlineMs;
      const cachedCandidateDetails = await params.loadCachedDetails(
        scoringWindowIds,
      );
      const completion = await params.ensureCompleteDetails(
        scoringWindowIds,
        cachedCandidateDetails,
        { deadlineMs: getRemainingMetadataMs() },
      );
      if (
        !params.isMetadataCompletionHealthy(
          completion,
          adapted.request.count,
        )
      ) {
        throw new RecommendationMetadataUnavailableError();
      }

      requestDetails = completion.details;
      return scoringWindowIds
        .filter((tmdbId) => requestDetails.has(tmdbId))
        .filter((tmdbId) => {
          if (requestedGenreFilterNames.length === 0) return true;
          return matchesWebTmdbGenreFilter(
            (requestDetails.get(tmdbId)?.genres ?? []).map(
              (genre) => genre.name,
            ),
            requestedGenreFilterNames,
          );
        })
        .map((tmdbId) => ({ tmdbId }));
    },
    scoreCandidates: async (scoreParams) => {
      const outcome = await (params.scoreCandidates ??
        scoreRecommendationsWithOverlapStaged)(
        scoreParams,
        requestDetails,
        buildRecommendationScoringInputs(personalization, sourceMetadata),
      );
      const scored = outcome.candidates.map((candidate) =>
        normalizeSourceMetadata(candidate, sourceMetadata),
      );
      const scoredById = new Map(
        scored.map((candidate) => [candidate.tmdbId, candidate]),
      );
      overlapRerankCandidates = (eligibleCandidates) => {
        const eligibleIds = new Set(
          eligibleCandidates.map((candidate) => candidate.tmdbId),
        );
        return outcome
          .rerankCandidates()
          .filter((candidate) => eligibleIds.has(candidate.tmdbId))
          .map(
            (candidate) =>
              scoredById.get(candidate.tmdbId) ??
              normalizeSourceMetadata(candidate, sourceMetadata),
          );
      };
      return scored;
    },
    rerankCandidates: async ({ candidates }) =>
      overlapRerankCandidates
        ? overlapRerankCandidates(candidates)
        : [...candidates],
    rng: params.rng,
    telemetry: params.telemetry,
  };

  return {
    dependencies,
    completeResult: async (result) => {
      const finalTmdbIds = result.results.map((candidate) => candidate.tmdbId);
      const unresolvedFinalTmdbIds = finalTmdbIds.filter(
        (tmdbId) => !requestDetails.has(tmdbId),
      );
      if (unresolvedFinalTmdbIds.length > 0) {
        const cachedDetails = await params.loadCachedDetails(
          unresolvedFinalTmdbIds,
        );
        const completedDetails = await params.ensureCompleteDetails(
          unresolvedFinalTmdbIds,
          cachedDetails,
          { deadlineMs: getRemainingMetadataMs() },
        );
        for (const [tmdbId, movie] of completedDetails.details) {
          requestDetails.set(tmdbId, movie);
        }
      }
      return { details: requestDetails, sourceMetadata };
    },
  };
}

/**
 * Build the exact v1 pre-score, discovery threshold, negative/genre filter,
 * and canonical pass-through dependencies used by the production route.
 */
export async function buildV1RecommendationDependencies(
  params: V1RecommendationBuilderParams,
): Promise<V1RecommendationPreparation> {
  const adapted = adaptV1RecommendationIntent(params.intent);
  const personalization =
    (params.buildPersonalization ?? buildRecommendationPersonalization)(
      params.userContext,
      params.tasteProfile,
    );
  const generated = await params.retrieveCandidates({
    userId: params.intent.userId,
    userContext: params.userContext,
    tasteProfile: params.tasteProfile,
    seeds: adapted.request.seeds,
    seedTmdbIds: params.intent.seedTmdbIds,
    requestSeed: params.intent.requestSeed,
  });
  const filteredCandidateIds = filterGeneratedCandidateIds({
    candidateIds: generated.candidateIds,
    seedTmdbIds: params.intent.seedTmdbIds,
    excludeTmdbIds: params.intent.excludeTmdbIds,
    blockedIds: params.userContext.blockedIds,
  });
  const allIdsToCache = [
    ...new Set([
      ...filteredCandidateIds,
      ...Array.from(params.userContext.mappings.values()),
    ]),
  ];
  const candidateTmdbCache = await params.loadCachedDetails(allIdsToCache);
  const minimalEnhancedProfile = buildMinimalEnhancedTasteProfile({
    tasteProfile: params.tasteProfile,
    watchedFilms: params.userContext.films.map((film) => ({
      rating: film.rating ?? undefined,
      liked: film.liked,
    })),
  });
  const scored = [
    ...(await params.scoreCandidates({
      userId: params.intent.userId,
      films: buildLiteFilms(params.userContext),
      mappings: params.userContext.mappings,
      candidates: filteredCandidateIds,
      ...buildRecommendationScoringInputs(
        personalization,
        generated.sourceMetadata,
      ),
      maxCandidates: Math.min(filteredCandidateIds.length, 1200),
      concurrency: 6,
      excludeWatchedIds: new Set(params.userContext.mappings.values()),
      desiredResults: Math.min(params.intent.limit * 4, 200),
      feedbackMap: new Map(params.context.feedbackMap),
      sourceMetadata: generated.sourceMetadata,
      mmrTopKFactor: 2.5,
      context: {
        mode: "neutral",
        localHour: null,
      },
      tmdbDetailsCache: candidateTmdbCache,
    })),
  ];

  const qualityFiltered = scored.filter((item) => {
    const metadata = generated.sourceMetadata.get(item.tmdbId);
    if (!metadata) return true;

    const isDiscoveryOnly = metadata.sources.every(
      (source) => source === "discover-top-genres",
    );
    return !isDiscoveryOnly || item.score >= 15;
  });
  const personalizationCandidates = qualityFiltered.filter((item) => {
    const candidate = buildFilteringCandidate(item, candidateTmdbCache);
    return !applyNegativeFiltering(candidate, minimalEnhancedProfile)
      .shouldFilter;
  });
  const genreFilterResult = filterCandidatesByGenre(personalizationCandidates, {
    requestedGenreNames: params.intent.genreNames ?? [],
    requestedCount: params.intent.limit,
    filterRelaxation: params.intent.filterRelaxation,
  });
  const personalizationFiltered = genreFilterResult.candidates;
  const richCandidates = new Map(
    personalizationFiltered.map((item) => [item.tmdbId, item]),
  );
  let rerankCalled = false;
  const dependencies: RecommendationEngineDependencies = {
    loadContext: async () => params.context,
    retrieveCandidates: async () =>
      personalizationFiltered.map((item) => ({ tmdbId: item.tmdbId })),
    scoreCandidates: async () => {
      rerankCalled = false;
      return personalizationFiltered.map((item) => {
        const rawSources = sourceMetadataForCandidate(
          item,
          generated.sourceMetadata,
        );
        return {
          tmdbId: item.tmdbId,
          score: item.score,
          evidence: {
            seedAnchors: [...params.intent.seedTmdbIds],
            providerFamilies: normalizeProviderFamilies(rawSources),
            providerOccurrences: rawSources.length,
            retrievalScore: item.score,
          },
          attribution: {
            retrieval: item.score,
            preference: 0,
            context: 0,
            diversity: 0,
            total: item.score,
          },
        };
      });
    },
    rerankCandidates: async ({ candidates }) => {
      rerankCalled = true;
      return [...candidates];
    },
    rng: params.rng,
    telemetry: params.telemetry,
  };
  // Keep the local reference observable during debugging without changing the
  // pass-through stage: this is intentionally a no-op marker for the exact
  // canonical stage used by the route.
  void rerankCalled;

  const responseDetails = new Map<number, V1RecommendationDetails>(
    personalizationFiltered.map((item) => [
      item.tmdbId,
      {
        title: item.title,
        consensusLevel: item.consensusLevel,
        sources: sourceMetadataForCandidate(item, generated.sourceMetadata),
        reasons: item.reasons,
        genres: item.genres,
        releaseDate: item.release_date,
        posterPath: item.poster_path,
        voteCategory: item.voteCategory,
      },
    ]),
  );
  const filterDiagnostics = {
    reasons: [...genreFilterResult.diagnostics.reasons],
    applied_stages: [...genreFilterResult.diagnostics.appliedStages],
    strict_count: genreFilterResult.diagnostics.strictCount,
    threshold_count: genreFilterResult.diagnostics.thresholdCount,
    genre_count: genreFilterResult.diagnostics.genreCount,
  } as const;
  const warning =
    filteredCandidateIds.length === 0
      ? generated.candidateIds.length === 0
        ? "no_candidates_generated"
        : "all_candidates_excluded"
      : undefined;

  return {
    dependencies,
    candidateIds: [...generated.candidateIds],
    filteredCandidateIds,
    sourceMetadata: generated.sourceMetadata,
    scoredCandidates: scored,
    personalizationFiltered,
    responseDetails,
    filterDiagnostics,
    sourceCandidateCounts: buildSourceCandidateCounts(
      generated.sourceMetadata,
    ),
    ...(warning ? { warning } : {}),
    ...(genreFilterResult.diagnostics.appliedStages.length > 0
      ? {
          relaxation:
            genreFilterResult.diagnostics.appliedStages[
              genreFilterResult.diagnostics.appliedStages.length - 1
            ],
        }
      : {}),
  };
}

/** Run the shared canonical engine without importing a route or framework API. */
export async function runCanonicalRecommendation(
  request: RecommendationRequestInput,
  dependencies: RecommendationEngineDependencies,
): Promise<RecommendationEngineResult> {
  return createRecommendationEngine(dependencies).generate(request);
}

/**
 * Production web boundary: adapt web intent, then create one canonical run.
 * The dependency factory receives the normalized request produced by this
 * surface, which lets production callers keep their retrieval wiring honest.
 */
export async function runWebRecommendationGeneration(
  intent: WebRecommendationIntent,
  dependencies: RecommendationDependencyInput<undefined>,
): Promise<RecommendationEngineResult> {
  const adapted = adaptWebRecommendationIntent(intent);
  const resolvedDependencies = await resolveDependencies(
    dependencies,
    adapted.request,
    undefined,
  );
  return runCanonicalRecommendation(adapted.request, resolvedDependencies);
}

/**
 * Production v1 boundary: adapt v1 intent/options, then create an independent
 * canonical run. It intentionally does not accept a result from the web
 * boundary, which keeps parity evaluation from becoming presentation replay.
 */
export async function runV1RecommendationGeneration(
  intent: V1RecommendationIntent,
  dependencies: RecommendationDependencyInput<V1RecommendationAdapterOptions>,
): Promise<RecommendationEngineResult> {
  const adapted = adaptV1RecommendationIntent(intent);
  const resolvedDependencies = await resolveDependencies(
    dependencies,
    adapted.request,
    adapted.options,
  );
  return runCanonicalRecommendation(adapted.request, resolvedDependencies);
}
