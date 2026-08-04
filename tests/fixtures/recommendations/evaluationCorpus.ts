import {
  adaptCanonicalResultToV1,
  adaptCanonicalResultToWeb,
} from "@/lib/recommendationAdapters";
import {
  type FilterRelaxation,
} from "@/lib/advancedFiltering";
import {
  DEFAULT_VECTOR_CAPABILITY_REQUIREMENTS,
  evaluateVectorCapability,
  normalizeProviderFamilies,
  normalizeProviderFamily,
} from "@/lib/recommendationCandidates";
import {
  buildRecommendationPersonalization,
  buildRecommendationScoringInputs,
} from "@/lib/recommendationPersonalization";
import {
  scoreRecommendationsWithOverlapStaged,
} from "@/lib/recommendationScoring";
import {
  decideRecommendationInputPreflight,
  deriveRecommendationMode,
  RECOMMENDATION_SOURCE_NAMES,
  type RecommendationDiagnostics,
  type RecommendationEngineMode,
  type RecommendationInputHealth,
  type RecommendationPreflightDecision,
  type RecommendationPreflightOutcome,
  type RecommendationRequestInput,
  type RecommendationSourceName,
  type WeightedSeed,
} from "@/lib/recommendationTypes";
import {
  buildTasteProfile,
  suggestByOverlap,
  type TMDBMovie,
} from "@/lib/enrich";
import {
  buildV1RecommendationDependencies,
  buildWebRecommendationDependencies,
  runV1RecommendationGeneration,
  runWebRecommendationGeneration,
} from "@/lib/recommendationGeneration";
import type { FeatureFeedbackRow } from "@/lib/recommendationFeedback";
import type {
  RecommendationInputRevisionMaterial,
} from "@/lib/recommendationContext";
import type {
  RecommendationEngineDependencies,
  RecommendationEngineContext,
  RecommendationEngineResult,
} from "@/lib/recommendationEngine";
import {
  retrieveServerCandidates,
  type ServerCandidateProviderRow,
} from "@/lib/recommendationRetrieval";

type UserContext = Parameters<typeof buildRecommendationPersonalization>[0];
type FilmEventRow = UserContext["films"][number];
type SourceMetadata = Parameters<typeof buildRecommendationScoringInputs>[1];
type UserContextSourceName = RecommendationSourceName;

/** Frozen corpus version for checkpoint 2C.1. */
export const RECOMMENDATION_EVALUATION_CORPUS_VERSION = "2c.1" as const;

/**
 * Fixed bounded failure code for unexpected per-case evaluation errors. Error
 * names and messages are attacker/provider-controllable and may contain
 * secrets or paths, so they must never reach evaluation output.
 */
export const EVALUATION_CASE_ERROR = "EVALUATION_CASE_ERROR" as const;

const POPULARITY_CONCENTRATION_CUTOFF = 50_000;
const SCORE_TOLERANCE = 1e-9;
const MAX_REPORT_CASES = 32;
const MAX_REPORT_FAILURES = 64;
const MAX_FAILURES_PER_CASE = 12;
const MAX_REPORT_TEXT_LENGTH = 160;
const MAX_JSON_OUTPUT_LENGTH = 19_999;
const MAX_MARKDOWN_OUTPUT_LENGTH = 7_999;

type EvaluationFeedback = Readonly<{
  tmdbId: number;
  type: "negative" | "positive";
}>;

type EvaluationContextFixture = Readonly<{
  historyTmdbIds: readonly number[];
  historyGenres?: readonly string[];
  inputHealth: RecommendationInputHealth;
  feedback?: readonly EvaluationFeedback[];
  featureFeedback?: readonly FeatureFeedbackRow[];
  watchedTmdbIds?: readonly number[];
  blockedTmdbIds?: readonly number[];
  hasPersonalizedEvidence: boolean;
}>;

type RawProviderRow = Readonly<{
  tmdbId: number;
  title: string;
  source: string;
  confidence: number;
  reason: string;
}>;

export type EvaluationCandidateFixture = Readonly<{
  tmdbId: number;
  movie: TMDBMovie;
  rawProviderRows: readonly RawProviderRow[];
}>;

export type EvaluationThresholds = Readonly<{
  minResultCount: number;
  maxResultCount?: number;
  maxSourceConcentration: number;
  minGenreCoverage: number;
  maxPopularityConcentration: number;
  maxRankChurn: number;
  maxProviderDuplicationShare?: number;
  maxGenreViolations?: number;
  expectedMode?: RecommendationDiagnostics["mode"];
  expectedFailedSources?: readonly UserContextSourceName[];
  maxNegativeFeedbackResults?: number;
  /**
   * Expected bounded preflight rejection descriptors. Required for cases whose
   * input health stops generation before any surface runs.
   */
  expectedRejection?: Readonly<{
    web: RecommendationPreflightOutcome;
    v1: RecommendationPreflightOutcome;
  }>;
}>;

export type RecommendationEvaluationCase = Readonly<{
  id: string;
  request: RecommendationRequestInput;
  genreIds?: readonly number[];
  context: EvaluationContextFixture;
  candidates: readonly EvaluationCandidateFixture[];
  filterRelaxation?: FilterRelaxation;
  negativeFeedbackIds?: readonly number[];
  thresholds: EvaluationThresholds;
}>;

export type RecommendationEvaluationMetrics = Readonly<{
  requestedCount: number;
  resultCount: number;
  countFulfillment: number;
  seedViolations: number;
  exclusionViolations: number;
  genreViolations: number;
  sourceConcentration: number;
  uniqueGenreCount: number;
  availableGenreCount: number;
  genreCoverage: number;
  popularityConcentration: number;
  rankChurn: number;
  missingPreRanks: number;
  attributionFailures: number;
  evidenceFailures: number;
  providerDuplicationShare: number;
  negativeFeedbackResults: number;
  webDeterministicRepeats: boolean;
  v1DeterministicRepeats: boolean;
  deterministicRepeats: boolean;
  vectorResults: number;
  vectorRowsActivated: number;
  webV1Parity: boolean;
  mode: RecommendationDiagnostics["mode"] | "unknown";
  failedSourceCount: number;
}>;

export type RecommendationEvaluationCaseReport = Readonly<{
  id: string;
  passed: boolean;
  metrics: RecommendationEvaluationMetrics;
  failures: readonly string[];
}>;

export type RecommendationEvaluationReport = Readonly<{
  version: typeof RECOMMENDATION_EVALUATION_CORPUS_VERSION;
  passed: boolean;
  cases: readonly RecommendationEvaluationCaseReport[];
  failures: readonly string[];
  productionSeams: Readonly<{
    evidenceMerge: number;
    personalizationBuilder: number;
    scoringStage: number;
    productionReranker: number;
    strictGenreFiltering: number;
    vectorEvidenceRowsIgnored: number;
  }>;
}>;

type MovieDefinition = Readonly<{
  tmdbId: number;
  title?: string;
  genres: readonly string[];
  voteAverage?: number;
  voteCount?: number;
  keywords?: readonly string[];
  director?: string;
  releaseYear?: number;
}>;

type ProductionRuntime = {
  context: RecommendationEngineContext;
  userContext: UserContext;
  tasteProfile: Awaited<ReturnType<typeof buildTasteProfile>>;
  details: Map<number, TMDBMovie>;
  sourceMetadata: SourceMetadata;
  mergedEvidence: Map<
    number,
    Readonly<{
      familyCount: number;
      providerOccurrences: number;
      providerFamilies: readonly string[];
    }>
  >;
  ignoredVectorProviderRows: number;
  activeVectorProviderRows: number;
  vectorCandidateIds: ReadonlySet<number>;
  activeVectorCandidateIds: ReadonlySet<number>;
  activeProviderRows: readonly ServerCandidateProviderRow[];
};

type ProductionSeamCounters = {
  evidenceMerge: number;
  personalizationBuilder: number;
  scoringStage: number;
  productionReranker: number;
  strictGenreFiltering: number;
  vectorEvidenceRowsIgnored: number;
};

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;

  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (child !== null && typeof child === "object") deepFreeze(child);
  }

  return value;
}

const GENRE_IDS: Readonly<Record<string, number>> = {
  Action: 28,
  Animation: 16,
  Comedy: 35,
  Documentary: 99,
  Drama: 18,
  Fantasy: 14,
  History: 36,
  Horror: 27,
  Mystery: 9648,
  Romance: 10749,
  Thriller: 53,
};

function makeMovie(input: MovieDefinition): TMDBMovie {
  const genres = input.genres.map((name, index) => ({
    id: GENRE_IDS[name] ?? 1000 + index,
    name,
  }));
  const keywords = (input.keywords ?? input.genres).map((name, index) => ({
    id: 20_000 + index,
    name: name.toLowerCase(),
  }));
  const directorName = input.director ?? `Director ${input.genres[0] ?? "One"}`;
  const movie = {
    id: input.tmdbId,
    title: input.title ?? `Evaluation movie ${input.tmdbId}`,
    release_date: `${input.releaseYear ?? 2020}-01-01`,
    poster_path: `/evaluation/${input.tmdbId}.jpg`,
    backdrop_path: `/evaluation/${input.tmdbId}-backdrop.jpg`,
    overview:
      "A fixed offline evaluation movie with complete metadata for canonical scoring.",
    vote_average: input.voteAverage ?? 7.8,
    vote_count: input.voteCount ?? 2_500,
    genres,
    production_countries: [{ iso_3166_1: "US", name: "United States" }],
    spoken_languages: [
      { iso_639_1: "en", name: "English", english_name: "English" },
    ],
    production_companies: [
      { id: 30_000 + (input.tmdbId % 100), name: "Evaluation Pictures" },
    ],
    credits: {
      cast: [
        {
          id: 40_000 + (input.tmdbId % 100),
          name: `Actor ${input.genres[0] ?? "One"}`,
          order: 0,
        },
      ],
      crew: [{ id: 50_000 + (input.tmdbId % 100), name: directorName, job: "Director" }],
    },
    keywords: { keywords },
    videos: { results: [] },
  };

  return movie as TMDBMovie;
}

function makeCandidate(input: MovieDefinition & { sources: readonly string[] }): EvaluationCandidateFixture {
  const movie = makeMovie(input);
  return {
    tmdbId: input.tmdbId,
    movie,
    rawProviderRows: input.sources.map((source, index) => ({
      tmdbId: input.tmdbId,
      title: movie.title,
      source,
      confidence: Math.max(0.5, 0.96 - index * 0.07),
      reason: `${source} fixed evidence`,
    })),
  };
}

function makeInputHealth(
  overrides: Partial<RecommendationInputHealth> = {},
): RecommendationInputHealth {
  return {
    films: { health: "empty", rowCount: 0 },
    mappings: { health: "empty", rowCount: 0 },
    feedback: { health: "empty", rowCount: 0 },
    exploration: { health: "empty", rowCount: 0 },
    adjacent_genres: { health: "empty", rowCount: 0 },
    exposures: { health: "empty", rowCount: 0 },
    blocked: { health: "empty", rowCount: 0 },
    ...overrides,
  };
}

function personalizedHealth(
  films: number,
  mappings: number,
  overrides: Partial<RecommendationInputHealth> = {},
): RecommendationInputHealth {
  return makeInputHealth({
    films: { health: films > 0 ? "ok" : "empty", rowCount: films },
    mappings: { health: mappings > 0 ? "ok" : "empty", rowCount: mappings },
    blocked: { health: "ok", rowCount: 0 },
    ...overrides,
  });
}

function makeRequest(params: {
  userId: string;
  count: number;
  seeds?: readonly WeightedSeed[];
  excludeTmdbIds?: readonly number[];
  genres?: readonly string[];
  requestSeed: string;
}): RecommendationRequestInput {
  return {
    userId: params.userId,
    count: params.count,
    seeds: [...(params.seeds ?? [])],
    excludeTmdbIds: [...(params.excludeTmdbIds ?? [])],
    genres: [...(params.genres ?? [])],
    context: { mode: "neutral", localHour: null },
    requestSeed: params.requestSeed,
  };
}

function makeContextFixture(params: {
  historyTmdbIds: readonly number[];
  historyGenres?: readonly string[];
  inputHealth: RecommendationInputHealth;
  feedback?: readonly EvaluationFeedback[];
  featureFeedback?: readonly FeatureFeedbackRow[];
  watchedTmdbIds?: readonly number[];
  blockedTmdbIds?: readonly number[];
  hasPersonalizedEvidence: boolean;
}): EvaluationContextFixture {
  return {
    historyTmdbIds: [...params.historyTmdbIds],
    historyGenres: [...(params.historyGenres ?? ["Drama", "Mystery"])],
    inputHealth: params.inputHealth,
    feedback: [...(params.feedback ?? [])],
    featureFeedback: [...(params.featureFeedback ?? [])],
    watchedTmdbIds: [...(params.watchedTmdbIds ?? [])],
    blockedTmdbIds: [...(params.blockedTmdbIds ?? [])],
    hasPersonalizedEvidence: params.hasPersonalizedEvidence,
  };
}

function candidates(definitions: readonly (MovieDefinition & { sources: readonly string[] })[]): EvaluationCandidateFixture[] {
  return definitions.map(makeCandidate);
}

const sparseCandidates = candidates([
  { tmdbId: 1101, genres: ["Drama", "Mystery"], voteCount: 48_000, sources: ["tmdb"] },
  { tmdbId: 1102, genres: ["Mystery", "Thriller"], voteCount: 1_200, sources: ["tmdb", "tastedive"] },
  { tmdbId: 1103, genres: ["Comedy", "Drama"], voteCount: 650, sources: ["watchmode"] },
  { tmdbId: 1104, genres: ["Drama"], voteCount: 80_000, sources: ["tmdb"] },
  { tmdbId: 1105, genres: ["Documentary"], voteCount: 420, sources: ["letterboxd"] },
  { tmdbId: 1106, genres: ["Animation"], voteCount: 900, sources: ["watchmode-similar"] },
]);

const broadCandidates = candidates(
  [
    ["Drama", "Mystery"],
    ["Mystery", "Thriller"],
    ["Comedy", "Romance"],
    ["Documentary", "History"],
    ["Animation", "Fantasy"],
    ["Drama", "Romance"],
    ["Thriller", "Action"],
    ["Comedy", "Drama"],
    ["Fantasy", "Mystery"],
    ["History", "Drama"],
    ["Horror", "Mystery"],
    ["Romance", "Drama"],
  ].map((genres, index) => ({
    tmdbId: 1201 + index,
    genres,
    voteCount: 1_000 + index * 200,
    sources: [["tmdb", "tastedive", "watchmode", "letterboxd"][index % 4]],
  })),
);

const negativeCandidates = candidates([
  { tmdbId: 1301, genres: ["Mystery", "Drama"], voteCount: 2_000, sources: ["tmdb"] },
  {
    tmdbId: 1302,
    genres: ["Mystery", "Drama"],
    keywords: ["Mystery", "character"],
    voteCount: 70_000,
    sources: ["tmdb"],
  },
  { tmdbId: 1303, genres: ["Comedy", "Drama"], voteCount: 1_600, sources: ["watchmode"] },
  { tmdbId: 1304, genres: ["Action", "Thriller"], voteCount: 2_200, sources: ["tastedive"] },
  { tmdbId: 1305, genres: ["Documentary", "History"], voteCount: 700, sources: ["tuimdb"] },
  { tmdbId: 1306, genres: ["Romance", "Drama"], voteCount: 900, sources: ["letterboxd"] },
]);

const explicitSeedCandidates = candidates([
  { tmdbId: 1401, genres: ["Drama", "Romance"], voteCount: 80_000, sources: ["tmdb"] },
  { tmdbId: 1402, genres: ["Mystery", "Drama"], voteCount: 60_000, sources: ["tastedive"] },
  { tmdbId: 1403, genres: ["Comedy", "Drama"], voteCount: 1_300, sources: ["tmdb", "watchmode"] },
  { tmdbId: 1404, genres: ["Action", "Thriller"], voteCount: 2_000, sources: ["tmdb"] },
  { tmdbId: 1405, genres: ["Documentary", "History"], voteCount: 600, sources: ["letterboxd"] },
  { tmdbId: 1406, genres: ["Animation", "Fantasy"], voteCount: 900, sources: ["watchmode-similar"] },
]);

const strictGenreCandidates = candidates([
  { tmdbId: 1501, genres: ["Mystery", "Drama"], voteCount: 2_000, sources: ["tmdb"] },
  { tmdbId: 1502, genres: ["Drama"], voteCount: 80_000, sources: ["tmdb"] },
  { tmdbId: 1503, genres: ["Mystery", "Thriller"], voteCount: 1_800, sources: ["tastedive"] },
  { tmdbId: 1504, genres: ["Comedy"], voteCount: 1_000, sources: ["watchmode"] },
  {
    tmdbId: 1505,
    genres: ["Mystery", "Drama"],
    voteCount: 2_000,
    sources: ["letterboxd"],
  },
  { tmdbId: 1506, genres: ["Romance"], voteCount: 900, sources: ["tuimdb"] },
]);

const providerDuplicationCandidates = candidates([
  { tmdbId: 1601, genres: ["Drama", "Mystery"], voteCount: 2_000, sources: ["tmdb", "tmdb", "tmdb", "tmdb"] },
  { tmdbId: 1602, genres: ["Mystery", "Thriller"], voteCount: 2_200, sources: ["tmdb", "tastedive"] },
  {
    tmdbId: 1603,
    genres: ["Comedy", "Drama"],
    voteCount: 1_400,
    sources: ["watchmode", "vector-similarity"],
  },
  { tmdbId: 1604, genres: ["Documentary", "History"], voteCount: 1_100, sources: ["tastedive", "tastedive", "tastedive"] },
  { tmdbId: 1605, genres: ["Animation", "Fantasy"], voteCount: 800, sources: ["letterboxd"] },
  { tmdbId: 1606, genres: ["Romance", "Drama"], voteCount: 900, sources: ["tuimdb"] },
]);

const degradedCandidates = candidates([
  { tmdbId: 1701, genres: ["Drama", "Mystery"], voteCount: 2_000, sources: ["tmdb"] },
  { tmdbId: 1702, genres: ["Mystery", "Thriller"], voteCount: 1_700, sources: ["tastedive"] },
  { tmdbId: 1703, genres: ["Animation", "Fantasy"], voteCount: 900, sources: ["watchmode"] },
  { tmdbId: 1704, genres: ["Drama", "Romance"], voteCount: 80_000, sources: ["tmdb"] },
  { tmdbId: 1705, genres: ["Comedy", "Drama"], voteCount: 1_100, sources: ["letterboxd"] },
  { tmdbId: 1706, genres: ["Documentary", "History"], voteCount: 700, sources: ["tuimdb"] },
]);

const largeProviderFamilies = [
  "tmdb",
  "tastedive",
  "watchmode",
  "letterboxd",
  "tuimdb",
] as const;
const largeGenreNames = [
  "Drama",
  "Mystery",
  "Comedy",
  "Documentary",
  "Animation",
] as const;
const largeCandidates = candidates(
  Array.from({ length: 100 }, (_, index) => ({
    tmdbId: 1801 + index,
    genres: [largeGenreNames[index % largeGenreNames.length]],
    voteCount: 500 + (index % 20) * 100,
    sources: [largeProviderFamilies[index % largeProviderFamilies.length]],
  })),
);

const defaultThresholds: EvaluationThresholds = {
  minResultCount: 3,
  maxSourceConcentration: 0.8,
  minGenreCoverage: 0.4,
  maxPopularityConcentration: 0.8,
  maxRankChurn: 0.8,
  maxNegativeFeedbackResults: 0,
};

const sparseCase: RecommendationEvaluationCase = {
  id: "sparse-history",
  request: makeRequest({
    userId: "evaluation-sparse",
    count: 3,
    requestSeed: "evaluation-sparse-seed",
  }),
  context: makeContextFixture({
    historyTmdbIds: [9101],
    inputHealth: personalizedHealth(1, 1),
    hasPersonalizedEvidence: true,
  }),
  candidates: sparseCandidates,
  thresholds: defaultThresholds,
};

const broadCase: RecommendationEvaluationCase = {
  id: "broad-history",
  request: makeRequest({
    userId: "evaluation-broad",
    count: 5,
    requestSeed: "evaluation-broad-seed",
  }),
  context: makeContextFixture({
    historyTmdbIds: Array.from({ length: 12 }, (_, index) => 9201 + index),
    historyGenres: ["Drama", "Mystery", "Comedy", "Documentary", "Animation"],
    inputHealth: personalizedHealth(12, 12, {
      feedback: { health: "ok", rowCount: 3 },
      exploration: { health: "ok", rowCount: 1 },
      adjacent_genres: { health: "ok", rowCount: 2 },
    }),
    hasPersonalizedEvidence: true,
  }),
  candidates: broadCandidates,
  thresholds: {
    ...defaultThresholds,
    minResultCount: 5,
    minGenreCoverage: 0.7,
  },
};

const strongNegativesCase: RecommendationEvaluationCase = {
  id: "strong-negatives",
  request: makeRequest({
    userId: "evaluation-negatives",
    count: 3,
    requestSeed: "evaluation-negative-seed",
  }),
  context: makeContextFixture({
    historyTmdbIds: [9301, 9302, 9303],
    inputHealth: personalizedHealth(3, 3, {
      feedback: { health: "ok", rowCount: 2 },
    }),
    feedback: [
      { tmdbId: 1302, type: "negative" },
      { tmdbId: 1304, type: "negative" },
    ],
    hasPersonalizedEvidence: true,
  }),
  candidates: negativeCandidates,
  negativeFeedbackIds: [1302, 1304],
  thresholds: {
    ...defaultThresholds,
    minResultCount: 3,
    minGenreCoverage: 0.44,
  },
};

const explicitSeedsCase: RecommendationEvaluationCase = {
  id: "explicit-seeds",
  request: makeRequest({
    userId: "evaluation-explicit",
    count: 3,
    seeds: [
      { tmdbId: 1401, weight: 1, source: "explicit" },
      { tmdbId: 1402, weight: 1, source: "explicit" },
    ],
    excludeTmdbIds: [1404],
    requestSeed: "evaluation-explicit-seed",
  }),
  context: makeContextFixture({
    historyTmdbIds: [9401, 9402],
    inputHealth: personalizedHealth(2, 2),
    hasPersonalizedEvidence: true,
  }),
  candidates: explicitSeedCandidates,
  thresholds: {
    ...defaultThresholds,
    minResultCount: 3,
    minGenreCoverage: 0.6,
  },
};

const strictGenresCase: RecommendationEvaluationCase = {
  id: "strict-genres",
  request: makeRequest({
    userId: "evaluation-genres",
    count: 3,
    genres: ["Mystery"],
    requestSeed: "evaluation-genre-seed",
  }),
  genreIds: [9648],
  context: makeContextFixture({
    historyTmdbIds: [9501, 9502, 9503, 9504],
    historyGenres: ["Mystery", "Drama", "Thriller"],
    inputHealth: personalizedHealth(4, 4),
    hasPersonalizedEvidence: true,
  }),
  candidates: strictGenreCandidates,
  thresholds: {
    ...defaultThresholds,
    minResultCount: 3,
    minGenreCoverage: 0.6,
    maxGenreViolations: 0,
  },
};

const providerDuplicationCase: RecommendationEvaluationCase = {
  id: "provider-duplication",
  request: makeRequest({
    userId: "evaluation-providers",
    count: 4,
    requestSeed: "evaluation-provider-seed",
  }),
  context: makeContextFixture({
    historyTmdbIds: [9601, 9602, 9603, 9604],
    inputHealth: personalizedHealth(4, 4, {
      exposures: { health: "ok", rowCount: 2 },
    }),
    hasPersonalizedEvidence: true,
  }),
  candidates: providerDuplicationCandidates,
  thresholds: {
    ...defaultThresholds,
    minResultCount: 4,
    minGenreCoverage: 0.55,
    maxProviderDuplicationShare: 0.55,
  },
};

const degradedCase: RecommendationEvaluationCase = {
  id: "degraded-inputs",
  request: makeRequest({
    userId: "evaluation-degraded",
    count: 3,
    requestSeed: "evaluation-degraded-seed",
  }),
  context: makeContextFixture({
    historyTmdbIds: [9701, 9702, 9703],
    inputHealth: personalizedHealth(3, 3, {
      blocked: { health: "failed", rowCount: 0 },
    }),
    hasPersonalizedEvidence: true,
  }),
  candidates: degradedCandidates,
  thresholds: {
    ...defaultThresholds,
    // Generation stops at the shared input-health preflight, so no generated
    // IDs or genre coverage exist; the bounded rejection descriptors below are
    // the accepted outcome for both surfaces.
    minResultCount: 0,
    expectedMode: "degraded",
    expectedFailedSources: ["blocked"],
    expectedRejection: {
      web: { rejected: true, reason: "degraded_mode" },
      v1: { rejected: true, reason: "blocked_failed" },
    },
  },
};

const largeRequestedCountCase: RecommendationEvaluationCase = {
  id: "large-requested-count",
  request: makeRequest({
    userId: "evaluation-large-count",
    count: 100,
    requestSeed: "evaluation-large-count-seed",
  }),
  context: makeContextFixture({
    historyTmdbIds: Array.from({ length: 24 }, (_, index) => 9801 + index),
    historyGenres: largeGenreNames,
    inputHealth: personalizedHealth(24, 24),
    hasPersonalizedEvidence: true,
  }),
  candidates: largeCandidates,
  thresholds: {
    ...defaultThresholds,
    minResultCount: 100,
    maxResultCount: 100,
    minGenreCoverage: 1,
  },
};

/**
 * Small, deterministic, non-network corpus. Candidate scores and final order
 * are deliberately absent: raw TMDB-like metadata and provider rows are sent
 * through the production evidence merge, personalization, overlap scorer, and
 * reranker seams below.
 */
export const recommendationEvaluationCorpus: readonly RecommendationEvaluationCase[] =
  deepFreeze([
    sparseCase,
    broadCase,
    strongNegativesCase,
    explicitSeedsCase,
    strictGenresCase,
    providerDuplicationCase,
    degradedCase,
    largeRequestedCountCase,
  ]);

function buildHistoryMovies(
  fixture: EvaluationContextFixture,
): TMDBMovie[] {
  const genres = fixture.historyGenres ?? ["Drama", "Mystery"];
  return fixture.historyTmdbIds.map((tmdbId, index) =>
    makeMovie({
      tmdbId,
      title: `Evaluation history ${tmdbId}`,
      genres: [genres[index % genres.length], "Drama"],
      voteCount: 5_000,
      keywords: [genres[index % genres.length], "character"],
      releaseYear: 2000 + (index % 20),
    }),
  );
}

function buildContext(
  fixture: EvaluationContextFixture,
  userId: string,
  historyMovies: ReadonlyMap<number, TMDBMovie>,
): RecommendationEngineContext {
  const tuples = fixture.historyTmdbIds.map((tmdbId, index) => {
    const uri = `letterboxd://evaluation/${tmdbId}`;
    const movie = historyMovies.get(tmdbId);
    const film = {
      uri,
      title: movie?.title ?? `Evaluation history ${index + 1}`,
      year: movie?.release_date ? Number(movie.release_date.slice(0, 4)) : 2020,
      rating: 4.5,
      liked: true,
      rewatch: false,
      watch_count: 1,
      on_watchlist: false,
      last_date: "2026-01-01",
    };

    return {
      uri,
      tmdbId,
      film,
      rating: film.rating,
      watchDate: film.last_date,
      detailsHealth: "ok" as const,
      details: null,
      features: null,
      mapping: { uri, tmdbId },
      date: null,
      ratingRecord: null,
      metadata: null,
    };
  });
  const sourceHealth: RecommendationEngineContext["sourceHealth"] = {
    films: fixture.inputHealth.films,
    mappings: fixture.inputHealth.mappings,
    metadata: { health: "ok", rowCount: historyMovies.size },
    dates: { health: "empty", rowCount: 0 },
    ratings: { health: "empty", rowCount: 0 },
    features: { health: "empty", rowCount: 0 },
    feedback: fixture.inputHealth.feedback,
    exploration: fixture.inputHealth.exploration,
    adjacent_genres: fixture.inputHealth.adjacent_genres,
    exposures: fixture.inputHealth.exposures,
    blocked: fixture.inputHealth.blocked,
  };
  const historyRows = fixture.historyTmdbIds.map((tmdbId) => ({ tmdbId }));
  const revisionSources: RecommendationInputRevisionMaterial["sources"] = {
    films: historyRows,
    mappings: historyRows,
    metadata: historyRows,
    dates: [],
    ratings: [],
    features: [],
    feedback: [...(fixture.feedback ?? [])].map((row) => ({
      tmdbId: row.tmdbId,
      type: row.type,
    })),
    exploration: [],
    adjacent_genres: [],
    exposures: [],
    blocked: [...(fixture.blockedTmdbIds ?? [])].map((tmdbId) => ({ tmdbId })),
  };
  const revisionMaterial: RecommendationInputRevisionMaterial = {
    sources: revisionSources,
    sourceHealth,
    inputHealth: fixture.inputHealth,
    ...revisionSources,
  };
  const failedSources = Object.entries(fixture.inputHealth)
    .filter(([, health]) => health.health === "failed")
    .map(([source]) => source) as RecommendationEngineContext["failedSources"];

  return {
    userId,
    films: tuples,
    filmTuples: tuples,
    mappings: new Map(tuples.map((tuple) => [tuple.uri, tuple.mapping!])),
    metadata: new Map(),
    dates: new Map(),
    ratings: new Map(),
    features: new Map(),
    sourceHealth,
    inputHealth: fixture.inputHealth,
    feedbackMap: new Map(
      (fixture.feedback ?? []).map((row) => [row.tmdbId, row.type]),
    ),
    failedSources,
    mode: deriveRecommendationMode({
      inputHealth: fixture.inputHealth,
      hasPersonalizedEvidence: fixture.hasPersonalizedEvidence,
    }),
    hasPersonalizedEvidence: fixture.hasPersonalizedEvidence,
    watchedTmdbIds: new Set([
      ...fixture.historyTmdbIds,
      ...(fixture.watchedTmdbIds ?? []),
    ]),
    blockedTmdbIds: new Set(fixture.blockedTmdbIds ?? []),
    inputRevisionMaterial: revisionMaterial,
    revisionMaterial,
  };
}

function buildUserContext(
  fixture: EvaluationContextFixture,
  userId: string,
  historyMovies: ReadonlyMap<number, TMDBMovie>,
): UserContext {
  const films: FilmEventRow[] = fixture.historyTmdbIds.map((tmdbId) => {
    const movie = historyMovies.get(tmdbId);
    const uri = `letterboxd://evaluation/${tmdbId}`;
    return {
      uri,
      title: movie?.title ?? `Evaluation history ${tmdbId}`,
      year: movie?.release_date ? Number(movie.release_date.slice(0, 4)) : 2020,
      rating: 4.5,
      rewatch: false,
      last_date: "2026-01-01",
      watch_count: 1,
      liked: true,
      on_watchlist: false,
    };
  });
  const mappings = new Map(films.map((film, index) => [film.uri, fixture.historyTmdbIds[index]]));
  const failedSources = Object.entries(fixture.inputHealth)
    .filter(([, health]) => health.health === "failed")
    .map(([source]) => source) as UserContextSourceName[];

  return {
    films,
    mappings,
    mappingsArray: films.map((film) => ({ uri: film.uri, tmdb_id: mappings.get(film.uri)! })),
    feedback: [...(fixture.featureFeedback ?? [])],
    explorationRate: 0.15,
    adjacentGenres: [],
    recentExposures: new Map(),
    blockedIds: new Set(fixture.blockedTmdbIds ?? []),
    inputHealth: fixture.inputHealth as UserContext["inputHealth"],
    failedSources,
    mode: deriveRecommendationMode({
      inputHealth: fixture.inputHealth,
      hasPersonalizedEvidence: fixture.hasPersonalizedEvidence,
    }),
  };
}

type RecommendationEvaluationOptions = Readonly<{
  /** Test-only mutation switch; production vector retrieval remains disabled. */
  vectorProductionEnabled?: boolean;
}>;

type FixtureRetrievalRows = Readonly<{
  activeProviderRows: readonly ServerCandidateProviderRow[];
  ignoredVectorProviderRows: number;
  activeVectorProviderRows: number;
  vectorCandidateIds: ReadonlySet<number>;
  activeVectorCandidateIds: ReadonlySet<number>;
}>;

function buildFixtureRetrievalRows(
  evaluationCase: RecommendationEvaluationCase,
  options: RecommendationEvaluationOptions,
): FixtureRetrievalRows {
  // The corpus may contain raw vector rows to prove that fixture data cannot
  // activate the source. The production capability gate remains disabled even
  // when every readiness input is supplied, so those rows are not network
  // responses unless the explicit mutation switch is used by a test.
  const vectorResults = [
    { tmdbId: 1603, similarity: 0.91 },
    { tmdbId: 1602, similarity: 0.82 },
  ];
  const vectorCapability = evaluateVectorCapability({
    modelVersion: DEFAULT_VECTOR_CAPABILITY_REQUIREMENTS.modelVersion,
    dimensions: DEFAULT_VECTOR_CAPABILITY_REQUIREMENTS.dimensions,
    backfill: {
      status: "complete",
      modelVersion: DEFAULT_VECTOR_CAPABILITY_REQUIREMENTS.modelVersion,
      dimensions: DEFAULT_VECTOR_CAPABILITY_REQUIREMENTS.dimensions,
      expectedCount: vectorResults.length,
      completedCount: vectorResults.length,
      failureCount: 0,
    },
    cachedResults: vectorResults,
    uncachedResults: [...vectorResults],
  });
  if (
    !vectorCapability.capable ||
    !vectorCapability.eligible ||
    vectorCapability.productionEnabled
  ) {
    throw new Error("Vector capability gate contract changed");
  }

  const rawProviderRows = evaluationCase.candidates.flatMap(
    (candidate) => candidate.rawProviderRows,
  );
  const vectorCandidateIds = new Set(
    rawProviderRows
      .filter((row) => normalizeProviderFamily(row.source) === "vector-similarity")
      .map((row) => row.tmdbId),
  );
  const vectorProductionEnabled =
    options.vectorProductionEnabled ?? vectorCapability.productionEnabled;
  const activeRawProviderRows = rawProviderRows.filter((row) => {
    const isVectorRow = normalizeProviderFamily(row.source) === "vector-similarity";
    return !isVectorRow || vectorProductionEnabled;
  });
  const activeVectorCandidateIds = new Set(
    activeRawProviderRows
      .filter((row) => normalizeProviderFamily(row.source) === "vector-similarity")
      .map((row) => row.tmdbId),
  );

  return {
    activeProviderRows: activeRawProviderRows,
    ignoredVectorProviderRows:
      rawProviderRows.length - activeRawProviderRows.length,
    activeVectorProviderRows: activeRawProviderRows.filter(
      (row) => normalizeProviderFamily(row.source) === "vector-similarity",
    ).length,
    vectorCandidateIds,
    activeVectorCandidateIds,
  };
}

async function buildProductionRuntime(
  evaluationCase: RecommendationEvaluationCase,
  options: RecommendationEvaluationOptions,
): Promise<ProductionRuntime> {
  const historyMovies = buildHistoryMovies(evaluationCase.context);
  const details = new Map<number, TMDBMovie>(
    [
      ...historyMovies,
      ...evaluationCase.candidates.map((candidate) => candidate.movie),
    ].map((movie) => [movie.id, movie]),
  );
  const context = buildContext(
    evaluationCase.context,
    evaluationCase.request.userId,
    new Map(historyMovies.map((movie) => [movie.id, movie])),
  );
  const userContext = buildUserContext(
    evaluationCase.context,
    evaluationCase.request.userId,
    new Map(historyMovies.map((movie) => [movie.id, movie])),
  );
  const retrievalRows = buildFixtureRetrievalRows(evaluationCase, options);
  const tasteProfile = await buildTasteProfile({
    films: userContext.films.map((film) => ({
      uri: film.uri,
      ...(film.rating === null ? {} : { rating: film.rating }),
      ...(film.liked === null ? {} : { liked: film.liked ?? undefined }),
      ...(film.rewatch === null ? {} : { rewatch: film.rewatch ?? undefined }),
      ...(film.last_date === null ? {} : { lastDate: film.last_date ?? undefined }),
    })),
    mappings: userContext.mappings,
    topN: 10,
    negativeFeedbackIds: (evaluationCase.context.feedback ?? [])
      .filter((row) => row.type === "negative")
      .map((row) => row.tmdbId),
    tmdbDetails: details,
  });
  return {
    context,
    userContext,
    tasteProfile,
    details,
    sourceMetadata: new Map(),
    mergedEvidence: new Map(),
    ignoredVectorProviderRows: retrievalRows.ignoredVectorProviderRows,
    activeVectorProviderRows: retrievalRows.activeVectorProviderRows,
    vectorCandidateIds: retrievalRows.vectorCandidateIds,
    activeVectorCandidateIds: retrievalRows.activeVectorCandidateIds,
    activeProviderRows: retrievalRows.activeProviderRows,
  };
}

function detailsForIds(
  runtime: ProductionRuntime,
  ids: readonly number[],
): Map<number, TMDBMovie> {
  return new Map(
    ids.flatMap((tmdbId) => {
      const details = runtime.details.get(tmdbId);
      return details ? [[tmdbId, details] as const] : [];
    }),
  );
}

function fixtureRetrieveCandidates(
  evaluationCase: RecommendationEvaluationCase,
  runtime: ProductionRuntime,
  seamCounters: ProductionSeamCounters,
) {
  return async (params: {
    userId: string;
    userContext: UserContext;
    tasteProfile: ProductionRuntime["tasteProfile"];
    seeds: readonly WeightedSeed[];
    requestSeed: string;
  }) => {
    // Web applies this in its metadata eligibility stage; v1 applies it in
    // buildV1RecommendationDependencies. The callback replaces only network
    // responses; production retrieval still owns merge, exclusion, ordering,
    // and quota selection.
    if ((evaluationCase.request.genres ?? []).length > 0) {
      seamCounters.strictGenreFiltering += 1;
    }

    const retrieval = await retrieveServerCandidates(
      params.userId,
      params.userContext,
      params.tasteProfile,
      params.seeds,
      {
        requestSeed: params.requestSeed,
        providerRows: async ({ path }) =>
          path.startsWith("/trending/movie/")
            ? runtime.activeProviderRows
            : [],
      },
    );

    runtime.sourceMetadata.clear();
    for (const [tmdbId, metadata] of retrieval.sourceMetadata) {
      runtime.sourceMetadata.set(tmdbId, metadata);
    }
    runtime.mergedEvidence.clear();
    for (const [tmdbId, evidence] of retrieval.evidence) {
      runtime.mergedEvidence.set(tmdbId, evidence);
    }
    seamCounters.evidenceMerge += 1;

    return {
      candidateIds: retrieval.candidateIds,
      sourceMetadata: retrieval.sourceMetadata,
    };
  };
}

function buildWebFixturePreparation(
  evaluationCase: RecommendationEvaluationCase,
  runtime: ProductionRuntime,
  seamCounters: ProductionSeamCounters,
) {
  const request = evaluationCase.request;
  const intent = {
    userId: request.userId,
    seedTmdbIds: request.seeds.map((seed) => seed.tmdbId),
    limit: request.count,
    excludeTmdbIds: request.excludeTmdbIds,
    genreNames: request.genres ?? [],
    context: request.context ?? undefined,
    requestSeed: request.requestSeed,
  } as const;

  const preparation = buildWebRecommendationDependencies({
    intent,
    context: runtime.context,
    userContext: runtime.userContext,
    tasteProfile: runtime.tasteProfile,
    buildPersonalization: (userContext, tasteProfile) => {
      seamCounters.personalizationBuilder += 1;
      return buildRecommendationPersonalization(userContext, tasteProfile);
    },
    retrieveCandidates: fixtureRetrieveCandidates(
      evaluationCase,
      runtime,
      seamCounters,
    ),
    loadCachedDetails: async (ids) =>
      detailsForIds(runtime, [
        ...ids,
        ...runtime.userContext.mappings.values(),
      ]),
    ensureCompleteDetails: async (ids, existingDetails) => {
      const details = detailsForIds(runtime, ids);
      for (const [tmdbId, movie] of existingDetails) details.set(tmdbId, movie);
      const completed = ids.filter((tmdbId) => details.has(tmdbId)).length;
      return {
        details,
        requested: ids.length,
        completed,
        failed: ids.length - completed,
        deadlineExpired: false,
      };
    },
    isMetadataCompletionHealthy: (completion) =>
      completion.failed === 0 && !completion.deadlineExpired,
    scoreCandidates: async (params, details, personalization) => {
      seamCounters.scoringStage += 1;
      return scoreRecommendationsWithOverlapStaged(
        params,
        details,
        personalization,
      );
    },
    rng: () => () => 0.5,
    telemetry: () => undefined,
  });

  return {
    ...preparation,
    dependencies: {
      ...preparation.dependencies,
      rerankCandidates: async (
        params: Parameters<RecommendationEngineDependencies["rerankCandidates"]>[0],
      ) => {
        seamCounters.productionReranker += 1;
        return preparation.dependencies.rerankCandidates(params);
      },
    },
  };
}

async function buildV1FixturePreparation(
  evaluationCase: RecommendationEvaluationCase,
  runtime: ProductionRuntime,
  seamCounters: ProductionSeamCounters,
) {
  const request = evaluationCase.request;
  const intent = {
    userId: request.userId,
    seedTmdbIds: request.seeds.map((seed) => seed.tmdbId),
    limit: request.count,
    excludeTmdbIds: request.excludeTmdbIds,
    genreIds: evaluationCase.genreIds,
    genreNames: request.genres ?? [],
    filterRelaxation: evaluationCase.filterRelaxation,
    debug: false,
    requestSeed: request.requestSeed,
  } as const;

  const preparation = await buildV1RecommendationDependencies({
    intent,
    context: runtime.context,
    userContext: runtime.userContext,
    tasteProfile: runtime.tasteProfile,
    buildPersonalization: (userContext, tasteProfile) => {
      seamCounters.personalizationBuilder += 1;
      return buildRecommendationPersonalization(userContext, tasteProfile);
    },
    retrieveCandidates: fixtureRetrieveCandidates(
      evaluationCase,
      runtime,
      seamCounters,
    ),
    loadCachedDetails: async (ids) => detailsForIds(runtime, ids),
    scoreCandidates: async (params) => {
      seamCounters.scoringStage += 1;
      return suggestByOverlap(params);
    },
    rng: () => () => 0.5,
    telemetry: () => undefined,
  });

  return {
    ...preparation,
    dependencies: {
      ...preparation.dependencies,
      rerankCandidates: async (
        params: Parameters<RecommendationEngineDependencies["rerankCandidates"]>[0],
      ) => {
        seamCounters.productionReranker += 1;
        return preparation.dependencies.rerankCandidates(params);
      },
    },
  };
}

function serializeResult(result: RecommendationEngineResult): string {
  return JSON.stringify({
    results: result.results,
    diagnostics: result.diagnostics,
    trace: result.trace,
    preRanks: [...result.preRanksById.entries()],
  });
}

function calculateMetrics(params: {
  evaluationCase: RecommendationEvaluationCase;
  runtime: ProductionRuntime;
  result: RecommendationEngineResult;
  repeatedResult: RecommendationEngineResult;
  v1Result: RecommendationEngineResult;
  repeatedV1Result: RecommendationEngineResult;
  webV1Parity: boolean;
}): RecommendationEvaluationMetrics {
  const {
    evaluationCase,
    runtime,
    result,
    repeatedResult,
    v1Result,
    repeatedV1Result,
    webV1Parity,
  } = params;
  const resultIds = result.results.map((item) => item.tmdbId);
  const seedIds = new Set(evaluationCase.request.seeds.map((seed) => seed.tmdbId));
  const requestedExclusions = new Set(evaluationCase.request.excludeTmdbIds);
  const contextExclusions = new Set([
    ...(evaluationCase.context.watchedTmdbIds ?? []),
    ...(evaluationCase.context.blockedTmdbIds ?? []),
  ]);
  const requestedGenres = new Set(
    (evaluationCase.request.genres ?? []).map((genre) => genre.trim().toLowerCase()),
  );
  const seedViolations = resultIds.filter((tmdbId) => seedIds.has(tmdbId)).length;
  const exclusionViolations = resultIds.filter(
    (tmdbId) => requestedExclusions.has(tmdbId) || contextExclusions.has(tmdbId),
  ).length;
  const negativeFeedbackIds = new Set(evaluationCase.negativeFeedbackIds ?? []);
  const negativeFeedbackResults = resultIds.filter((tmdbId) =>
    negativeFeedbackIds.has(tmdbId),
  ).length;
  const genreViolations = result.results.filter((item) => {
    if (requestedGenres.size === 0) return false;
    const genres = runtime.details.get(item.tmdbId)?.genres ?? [];
    return !genres.some((genre) => requestedGenres.has(genre.name.trim().toLowerCase()));
  }).length;

  const sourceCounts = new Map<string, number>();
  const allGenres = new Set<string>();
  const availableGenres = new Set<string>();
  for (const candidate of evaluationCase.candidates) {
    for (const genre of candidate.movie.genres ?? []) {
      const normalized = genre.name.trim().toLowerCase();
      if (normalized) availableGenres.add(normalized);
    }
  }
  let highPopularityCount = 0;
  let attributionFailures = 0;
  let evidenceFailures = 0;
  // Duplication is the excess raw provider occurrences beyond one occurrence
  // per normalized provider family, divided by all raw occurrences.
  let totalProviderOccurrences = 0;
  let excessProviderOccurrences = 0;

  for (const item of result.results) {
    const families = new Set(
      normalizeProviderFamilies(item.evidence.providerFamilies),
    );
    if (families.size === 0) evidenceFailures += 1;
    for (const family of families) {
      sourceCounts.set(family, (sourceCounts.get(family) ?? 0) + 1);
    }
    const merged = runtime.mergedEvidence.get(item.tmdbId);
    const occurrences = merged?.providerOccurrences ?? item.evidence.providerOccurrences;
    const familyCount = merged?.familyCount ?? families.size;
    if (occurrences < familyCount) evidenceFailures += 1;
    totalProviderOccurrences += occurrences;
    excessProviderOccurrences += Math.max(0, occurrences - familyCount);

    for (const genre of runtime.details.get(item.tmdbId)?.genres ?? []) {
      const normalized = genre.name.trim().toLowerCase();
      if (normalized) allGenres.add(normalized);
    }
    if ((runtime.details.get(item.tmdbId)?.vote_count ?? 0) >= POPULARITY_CONCENTRATION_CUTOFF) {
      highPopularityCount += 1;
    }

    const attributionValues = [
      item.attribution.retrieval,
      item.attribution.preference,
      item.attribution.context,
      item.attribution.diversity,
    ];
    const attributionSum = attributionValues.reduce((total, value) => total + value, 0);
    if (
      attributionValues.some((value) => !Number.isFinite(value)) ||
      Math.abs(attributionSum - item.attribution.total) > SCORE_TOLERANCE ||
      Math.abs(item.attribution.total - item.score) > SCORE_TOLERANCE
    ) {
      attributionFailures += 1;
    }
  }

  const resultCount = result.results.length;
  const sourceConcentration =
    resultCount === 0 ? 0 : Math.max(...sourceCounts.values(), 0) / resultCount;
  // Coverage is the share of every normalized genre in the frozen candidate
  // pool represented by the result. Per-case thresholds account for list size
  // without changing the denominator or allowing multi-genre rows to force 1.
  const genreCoverage =
    availableGenres.size === 0
      ? 0
      : allGenres.size / availableGenres.size;
  const popularityConcentration =
    resultCount === 0 ? 0 : highPopularityCount / resultCount;
  const maxObservedRank = Math.max(
    resultCount,
    ...result.preRanksById.values(),
  );
  const rankDisplacement = result.results.reduce((total, item, index) => {
    const preRank = result.preRanksById.get(item.tmdbId);
    return preRank === undefined
      ? total
      : total + Math.abs(preRank - (index + 1)) / Math.max(1, maxObservedRank);
  }, 0);
  const webDeterministicRepeats =
    serializeResult(result) === serializeResult(repeatedResult);
  const v1DeterministicRepeats =
    serializeResult(v1Result) === serializeResult(repeatedV1Result);
  const vectorResults = resultIds.filter((tmdbId) =>
    runtime.activeVectorCandidateIds.has(tmdbId),
  ).length;

  return {
    requestedCount: evaluationCase.request.count,
    resultCount,
    countFulfillment:
      evaluationCase.request.count === 0 ? 0 : resultCount / evaluationCase.request.count,
    seedViolations,
    exclusionViolations,
    negativeFeedbackResults,
    genreViolations,
    sourceConcentration,
    uniqueGenreCount: allGenres.size,
    availableGenreCount: availableGenres.size,
    genreCoverage,
    popularityConcentration,
    // Rank churn is normalized mean absolute displacement from the canonical
    // score-order pre-rank baseline, using the largest observed rank as the
    // denominator, not a binary changed-position count.
    rankChurn: resultCount === 0 ? 0 : rankDisplacement / resultCount,
    missingPreRanks: result.results.filter((item) => !result.preRanksById.has(item.tmdbId)).length,
    attributionFailures,
    evidenceFailures,
    providerDuplicationShare:
      totalProviderOccurrences === 0
        ? 0
        : excessProviderOccurrences / totalProviderOccurrences,
    webDeterministicRepeats,
    v1DeterministicRepeats,
    deterministicRepeats: webDeterministicRepeats && v1DeterministicRepeats,
    vectorResults,
    vectorRowsActivated: runtime.activeVectorProviderRows,
    webV1Parity,
    mode: result.diagnostics.mode,
    failedSourceCount: result.diagnostics.failedSources.length,
  };
}

/**
 * Read the requested count without trusting case accessors. Poisoned getters
 * must not be able to escape the bounded per-case error path.
 */
function safeRequestedCount(
  evaluationCase: RecommendationEvaluationCase,
): number {
  try {
    const count = evaluationCase.request.count;
    return typeof count === "number" && Number.isFinite(count) && count >= 0
      ? count
      : 0;
  } catch {
    return 0;
  }
}

function emptyMetrics(
  requestedCount: number,
): RecommendationEvaluationMetrics {
  return {
    requestedCount,
    resultCount: 0,
    countFulfillment: 0,
    seedViolations: 0,
    exclusionViolations: 0,
    negativeFeedbackResults: 0,
    genreViolations: 0,
    sourceConcentration: 0,
    uniqueGenreCount: 0,
    availableGenreCount: 0,
    genreCoverage: 0,
    popularityConcentration: 0,
    rankChurn: 0,
    missingPreRanks: 0,
    attributionFailures: 0,
    evidenceFailures: 0,
    providerDuplicationShare: 0,
    webDeterministicRepeats: false,
    v1DeterministicRepeats: false,
    deterministicRepeats: false,
    vectorResults: 0,
    vectorRowsActivated: 0,
    webV1Parity: false,
    mode: "unknown",
    failedSourceCount: 0,
  };
}

function evaluateThresholds(
  evaluationCase: RecommendationEvaluationCase,
  metrics: RecommendationEvaluationMetrics,
  result: RecommendationEngineResult,
): string[] {
  const failures: string[] = [];
  const thresholds = evaluationCase.thresholds;
  const fail = (message: string) => {
    if (failures.length < MAX_FAILURES_PER_CASE) failures.push(message);
  };

  if (!metrics.webDeterministicRepeats) {
    fail("web deterministic repeats failed");
  }
  if (!metrics.v1DeterministicRepeats) {
    fail("v1 deterministic repeats failed");
  }
  if (metrics.vectorRowsActivated > 0) {
    fail("vector retrieval activated");
  }
  if (!metrics.webV1Parity) fail("web/v1 parity failed");
  if (metrics.resultCount < thresholds.minResultCount) fail("count fulfillment below minimum");
  if (thresholds.maxResultCount !== undefined && metrics.resultCount > thresholds.maxResultCount) {
    fail("result count exceeded maximum");
  }
  if (metrics.seedViolations > 0) fail("seed violation detected");
  if (metrics.exclusionViolations > 0) fail("exclusion violation detected");
  if (
    metrics.negativeFeedbackResults >
    (thresholds.maxNegativeFeedbackResults ?? 0)
  ) {
    fail("strong-negative feedback result detected");
  }
  if (metrics.genreViolations > (thresholds.maxGenreViolations ?? 0)) {
    fail("strict genre violation detected");
  }
  if (metrics.sourceConcentration > thresholds.maxSourceConcentration + SCORE_TOLERANCE) {
    fail("source concentration exceeded threshold");
  }
  if (metrics.genreCoverage < thresholds.minGenreCoverage - SCORE_TOLERANCE) {
    fail("all-genre coverage below threshold");
  }
  if (metrics.popularityConcentration > thresholds.maxPopularityConcentration + SCORE_TOLERANCE) {
    fail("popularity concentration exceeded threshold");
  }
  if (metrics.rankChurn > thresholds.maxRankChurn + SCORE_TOLERANCE) {
    fail("rank churn exceeded threshold");
  }
  if (metrics.missingPreRanks > 0) fail("missing pre-rank attribution");
  if (metrics.attributionFailures > 0) fail("score attribution failed");
  if (metrics.evidenceFailures > 0) fail("provider evidence failed");
  if (
    thresholds.maxProviderDuplicationShare !== undefined &&
    metrics.providerDuplicationShare > thresholds.maxProviderDuplicationShare + SCORE_TOLERANCE
  ) {
    fail("provider duplication concentration exceeded threshold");
  }
  if (thresholds.expectedMode !== undefined && result.diagnostics.mode !== thresholds.expectedMode) {
    fail("input mode did not match expected degraded/personalized state");
  }
  if (thresholds.expectedFailedSources !== undefined) {
    const actual = result.diagnostics.failedSources;
    const expected = thresholds.expectedFailedSources;
    if (actual.length !== expected.length || actual.some((source, index) => source !== expected[index])) {
      fail("failed source diagnostics did not match corpus expectation");
    }
  }

  return failures;
}

async function evaluateCase(
  evaluationCase: RecommendationEvaluationCase,
  seamCounters: ProductionSeamCounters,
  options: RecommendationEvaluationOptions,
): Promise<RecommendationEvaluationCaseReport> {
  try {
    // Shared production preflight: when either surface would reject the input
    // health, stop before any generation and compare the bounded rejection
    // descriptors/outcomes instead of generated IDs.
    const preflightMode = deriveRecommendationMode({
      inputHealth: evaluationCase.context.inputHealth,
      hasPersonalizedEvidence:
        evaluationCase.context.hasPersonalizedEvidence,
    });
    const preflight = decideRecommendationInputPreflight({
      mode: preflightMode,
      blockedHealth: evaluationCase.context.inputHealth.blocked.health,
    });
    if (preflight.web.rejected || preflight.v1.rejected) {
      return evaluateRejectedCase(evaluationCase, preflightMode, preflight);
    }

    const runtime = await buildProductionRuntime(evaluationCase, options);
    seamCounters.vectorEvidenceRowsIgnored += runtime.ignoredVectorProviderRows;
    const request = evaluationCase.request;
    const webPreparation = buildWebFixturePreparation(
      evaluationCase,
      runtime,
      seamCounters,
    );
    const webIntent = {
      userId: request.userId,
      seedTmdbIds: request.seeds.map((seed) => seed.tmdbId),
      limit: request.count,
      excludeTmdbIds: request.excludeTmdbIds,
      genreNames: request.genres ?? [],
      context: request.context ?? undefined,
      requestSeed: request.requestSeed,
    } satisfies Parameters<typeof runWebRecommendationGeneration>[0];
    const first = await runWebRecommendationGeneration(
      webIntent,
      webPreparation.dependencies,
    );
    const repeatedWebPreparation = buildWebFixturePreparation(
      evaluationCase,
      runtime,
      seamCounters,
    );
    const repeated = await runWebRecommendationGeneration(
      webIntent,
      repeatedWebPreparation.dependencies,
    );
    const v1Preparation = await buildV1FixturePreparation(
      evaluationCase,
      runtime,
      seamCounters,
    );
    const v1Intent = {
      userId: request.userId,
      seedTmdbIds: request.seeds.map((seed) => seed.tmdbId),
      limit: request.count,
      excludeTmdbIds: request.excludeTmdbIds,
      genreIds: evaluationCase.genreIds,
      genreNames: request.genres ?? [],
      filterRelaxation: evaluationCase.filterRelaxation,
      debug: false,
      requestSeed: request.requestSeed,
    } as const;
    const v1Result = await runV1RecommendationGeneration(
      v1Intent,
      v1Preparation.dependencies,
    );
    const repeatedV1Preparation = await buildV1FixturePreparation(
      evaluationCase,
      runtime,
      seamCounters,
    );
    const repeatedV1Result = await runV1RecommendationGeneration(
      v1Intent,
      repeatedV1Preparation.dependencies,
    );

    // Compare canonical IDs and stable request/input diagnostics before either
    // result is formatted for a surface-specific response envelope.
    const parityDiagnostics = (result: RecommendationEngineResult) => ({
      mode: result.diagnostics.mode,
      failedSources: result.diagnostics.failedSources,
      inputHealth: result.diagnostics.inputHealth,
      engineVersion: result.diagnostics.engineVersion,
      contextMode: result.diagnostics.contextMode,
      requestSeedHash: result.diagnostics.requestSeedHash,
    });
    const webV1Parity =
      JSON.stringify(first.results.map((item) => item.tmdbId)) ===
        JSON.stringify(v1Result.results.map((item) => item.tmdbId)) &&
      JSON.stringify(parityDiagnostics(first)) ===
        JSON.stringify(parityDiagnostics(v1Result));

    const completedWeb = await webPreparation.completeResult(first);
    const webDetails = new Map(
      first.results.map((item) => {
        const movie = completedWeb.details.get(item.tmdbId);
        const source = completedWeb.sourceMetadata.get(item.tmdbId);
        return [
          item.tmdbId,
          {
            title: movie?.title,
            sources: source?.sources,
            genres: movie?.genres?.map((genre) => genre.name),
            releaseDate: movie?.release_date,
            voteAverage: movie?.vote_average,
            voteCount: movie?.vote_count,
            voteCategory: "standard" as const,
          },
        ];
      }),
    );
    // Each canonical result is adapted exactly once, using details owned by
    // that surface's preparation boundary.
    adaptCanonicalResultToWeb(first, webDetails);
    adaptCanonicalResultToV1(v1Result, v1Preparation.responseDetails, {
      relaxation: v1Preparation.relaxation,
      inputRevisionMaterial: runtime.context.revisionMaterial,
    });
    const metrics = calculateMetrics({
      evaluationCase,
      runtime,
      result: first,
      repeatedResult: repeated,
      v1Result,
      repeatedV1Result,
      webV1Parity,
    });
    const failures = evaluateThresholds(evaluationCase, metrics, first);

    return {
      id: boundedReportText(evaluationCase.id),
      passed: failures.length === 0,
      metrics,
      failures,
    };
  } catch {
    // Keep unexpected per-case failures opaque. Error names and messages can
    // be attacker-controlled and may contain secrets, paths, or provider
    // payloads, so only the fixed bounded code is reported. Case accessors
    // are re-read defensively so poisoned fields cannot escape this path.
    let caseId = "unknown-case";
    try {
      if (typeof evaluationCase.id === "string") {
        caseId = evaluationCase.id;
      }
    } catch {
      // Keep the bounded fallback identifier.
    }
    return {
      id: boundedReportText(caseId),
      passed: false,
      metrics: emptyMetrics(safeRequestedCount(evaluationCase)),
      failures: [EVALUATION_CASE_ERROR],
    };
  }
}

function isSamePreflightOutcome(
  actual: RecommendationPreflightOutcome,
  expected: RecommendationPreflightOutcome,
): boolean {
  return actual.rejected === expected.rejected && actual.reason === expected.reason;
}

/**
 * Evaluate a case whose input health is rejected by the shared production
 * preflight. No generation runs for either surface; the bounded rejection
 * descriptors and failed-source diagnostics are compared against the corpus
 * expectation instead of generated IDs.
 */
function evaluateRejectedCase(
  evaluationCase: RecommendationEvaluationCase,
  mode: RecommendationEngineMode,
  preflight: RecommendationPreflightDecision,
): RecommendationEvaluationCaseReport {
  const failures: string[] = [];
  const fail = (message: string) => {
    if (failures.length < MAX_FAILURES_PER_CASE) failures.push(message);
  };
  const thresholds = evaluationCase.thresholds;
  const failedSources = RECOMMENDATION_SOURCE_NAMES.filter(
    (sourceName) =>
      evaluationCase.context.inputHealth[sourceName].health === "failed",
  );

  const expectedRejection = thresholds.expectedRejection;
  const rejectionDescriptorsMatch =
    expectedRejection !== undefined &&
    isSamePreflightOutcome(preflight.web, expectedRejection.web) &&
    isSamePreflightOutcome(preflight.v1, expectedRejection.v1);
  if (expectedRejection === undefined) {
    fail("unexpected preflight rejection");
  } else {
    if (!isSamePreflightOutcome(preflight.web, expectedRejection.web)) {
      fail("web preflight rejection did not match corpus expectation");
    }
    if (!isSamePreflightOutcome(preflight.v1, expectedRejection.v1)) {
      fail("v1 preflight rejection did not match corpus expectation");
    }
  }
  if (thresholds.expectedMode !== undefined && mode !== thresholds.expectedMode) {
    fail("input mode did not match expected degraded/personalized state");
  }
  if (thresholds.expectedFailedSources !== undefined) {
    const expected = thresholds.expectedFailedSources;
    if (
      failedSources.length !== expected.length ||
      failedSources.some((source, index) => source !== expected[index])
    ) {
      fail("failed source diagnostics did not match corpus expectation");
    }
  }

  return {
    id: boundedReportText(evaluationCase.id),
    passed: failures.length === 0,
    metrics: {
      ...emptyMetrics(safeRequestedCount(evaluationCase)),
      // The bounded rejection outcome is deterministic and identical for both
      // surfaces, so repeat/parity descriptors hold without generation.
      webDeterministicRepeats: true,
      v1DeterministicRepeats: true,
      deterministicRepeats: true,
      webV1Parity: rejectionDescriptorsMatch,
      mode,
      failedSourceCount: failedSources.length,
    },
    failures,
  };
}

function withSuppressedProductionLogs<T>(operation: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = () => undefined;
  console.warn = () => undefined;
  console.error = () => undefined;
  return operation().finally(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  });
}

export async function evaluateRecommendationCorpus(
  corpus: readonly RecommendationEvaluationCase[] = recommendationEvaluationCorpus,
  options: RecommendationEvaluationOptions = {},
): Promise<RecommendationEvaluationReport> {
  const seamCounters: ProductionSeamCounters = {
    evidenceMerge: 0,
    personalizationBuilder: 0,
    scoringStage: 0,
    productionReranker: 0,
    strictGenreFiltering: 0,
    vectorEvidenceRowsIgnored: 0,
  };
  const cases = await withSuppressedProductionLogs(async () => {
    const reports: RecommendationEvaluationCaseReport[] = [];
    for (const evaluationCase of corpus) {
      reports.push(await evaluateCase(evaluationCase, seamCounters, options));
    }
    return reports;
  });
  const failures = cases
    .flatMap((evaluationCase) =>
      evaluationCase.failures.map(
        (failure) =>
          `${boundedReportText(evaluationCase.id)}: ${boundedReportText(failure)}`,
      ),
    )
    .slice(0, MAX_REPORT_FAILURES);

  return {
    version: RECOMMENDATION_EVALUATION_CORPUS_VERSION,
    passed: failures.length === 0,
    cases,
    failures,
    productionSeams: { ...seamCounters },
  };
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function boundedReportText(value: string): string {
  return value
    .slice(0, MAX_REPORT_TEXT_LENGTH)
    .replace(/[\u0000-\u001f\u007f]/g, " ");
}

function boundedMetrics(
  metrics: RecommendationEvaluationMetrics,
): RecommendationEvaluationMetrics {
  return {
    requestedCount: metrics.requestedCount,
    resultCount: metrics.resultCount,
    countFulfillment: metrics.countFulfillment,
    seedViolations: metrics.seedViolations,
    exclusionViolations: metrics.exclusionViolations,
    negativeFeedbackResults: metrics.negativeFeedbackResults,
    genreViolations: metrics.genreViolations,
    sourceConcentration: metrics.sourceConcentration,
    uniqueGenreCount: metrics.uniqueGenreCount,
    availableGenreCount: metrics.availableGenreCount,
    genreCoverage: metrics.genreCoverage,
    popularityConcentration: metrics.popularityConcentration,
    rankChurn: metrics.rankChurn,
    missingPreRanks: metrics.missingPreRanks,
    attributionFailures: metrics.attributionFailures,
    evidenceFailures: metrics.evidenceFailures,
    providerDuplicationShare: metrics.providerDuplicationShare,
    webDeterministicRepeats: metrics.webDeterministicRepeats,
    v1DeterministicRepeats: metrics.v1DeterministicRepeats,
    deterministicRepeats: metrics.deterministicRepeats,
    vectorResults: metrics.vectorResults,
    vectorRowsActivated: metrics.vectorRowsActivated,
    webV1Parity: metrics.webV1Parity,
    mode: metrics.mode,
    failedSourceCount: metrics.failedSourceCount,
  };
}

/**
 * Keep report serialization aggregate-only. In particular, do not spread a
 * case/report object here: raw fixture candidates, provider rows, histories,
 * and future private fields must not become CI artifacts by accident.
 */
function boundedReport(report: RecommendationEvaluationReport) {
  return {
    version: boundedReportText(report.version),
    passed: report.passed,
    cases: report.cases.slice(0, MAX_REPORT_CASES).map((evaluationCase) => ({
      id: boundedReportText(evaluationCase.id),
      passed: evaluationCase.passed,
      metrics: boundedMetrics(evaluationCase.metrics),
      failures: evaluationCase.failures
        .slice(0, MAX_FAILURES_PER_CASE)
        .map(boundedReportText),
    })),
    failures: report.failures
      .slice(0, MAX_REPORT_FAILURES)
      .map(boundedReportText),
    productionSeams: {
      evidenceMerge: report.productionSeams.evidenceMerge,
      personalizationBuilder: report.productionSeams.personalizationBuilder,
      scoringStage: report.productionSeams.scoringStage,
      productionReranker: report.productionSeams.productionReranker,
      strictGenreFiltering: report.productionSeams.strictGenreFiltering,
      vectorEvidenceRowsIgnored: report.productionSeams.vectorEvidenceRowsIgnored,
    },
  };
}

/** Render only bounded aggregate metrics; no histories or candidate arrays. */
export function renderRecommendationEvaluationJson(
  report: RecommendationEvaluationReport,
): string {
  const payload = boundedReport(report);
  const json = JSON.stringify(payload, null, 2);
  if (json.length < MAX_JSON_OUTPUT_LENGTH) return json;

  return JSON.stringify(
    {
      version: payload.version,
      passed: payload.passed,
      failures: payload.failures.slice(0, 8),
      productionSeams: payload.productionSeams,
      truncated: true,
    },
    null,
    2,
  );
}

/** Render a bounded Markdown summary suitable for CI logs or a short artifact. */
export function renderRecommendationEvaluationMarkdown(
  report: RecommendationEvaluationReport,
): string {
  const payload = boundedReport(report);
  const lines = [
    `# Offline recommendation evaluation ${payload.version}`,
    "",
    `Status: **${payload.passed ? "PASS" : "FAIL"}**`,
    "",
    "| Case | Status | Results | Fulfillment | Source concentration | Genre coverage | Popularity concentration | Rank churn | Parity |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];

  for (const evaluationCase of payload.cases) {
    const metrics = evaluationCase.metrics;
    lines.push(
      `| ${evaluationCase.id.replaceAll("|", "/")} | ${evaluationCase.passed ? "PASS" : "FAIL"} | ${metrics.resultCount}/${metrics.requestedCount} | ${percentage(metrics.countFulfillment)} | ${percentage(metrics.sourceConcentration)} | ${percentage(metrics.genreCoverage)} | ${percentage(metrics.popularityConcentration)} | ${percentage(metrics.rankChurn)} | ${metrics.webV1Parity ? "yes" : "no"} |`,
    );
  }

  if (payload.failures.length > 0) {
    lines.push("", "Failures:");
    for (const failure of payload.failures) {
      lines.push(`- ${failure.replaceAll("|", "/")}`);
    }
  }

  const markdown = lines.join("\n");
  if (markdown.length < MAX_MARKDOWN_OUTPUT_LENGTH) return markdown;

  const suffix = "\n… output truncated";
  return `${markdown.slice(0, MAX_MARKDOWN_OUTPUT_LENGTH - suffix.length)}${suffix}`;
}
