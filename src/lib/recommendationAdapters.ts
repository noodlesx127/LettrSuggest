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
