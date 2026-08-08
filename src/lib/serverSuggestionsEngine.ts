import { fetchTmdb } from "@/app/api/v1/_lib/tmdb";
import {
  buildTasteProfile,
  getAvoidedFeatures,
  type TMDBMovie,
} from "@/lib/enrich";
import { sortByFilmRecency } from "@/lib/recommendationNormalization";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  createRecommendationRevision,
  createTasteProfileCacheWritePayload,
  decideTasteProfileCache,
  TASTE_PROFILE_METADATA_VERSION,
  TASTE_PROFILE_MODEL_VERSION,
  type RecommendationRevisionQuizState,
} from "@/lib/recommendationRevision";
import {
  type WeightedRecommendationSeed,
} from "@/lib/recommendationCandidates";
import {
  type RecommendationEngineDependencies,
  type RecommendationEngineResult,
} from "@/lib/recommendationEngine";
import { resolveRecommendationExperimentAssignment } from "@/lib/recommendationExperimentEnrollment";
import { runCanonicalRecommendation } from "@/lib/recommendationGeneration";
import type { FeatureFeedbackRow } from "@/lib/recommendationFeedback";
import {
  retrieveServerCandidates,
  type ServerCandidateProvider,
  type ServerCandidateProviderRequest,
  type ServerCandidateRetrievalOptions,
  type ServerSeedInput,
  type SourceMetadata,
} from "@/lib/recommendationRetrieval";
import type {
  RecommendationExperimentAssignment,
  RecommendationRequestInput,
} from "@/lib/recommendationTypes";

export {
  buildAdjacentGenreMap,
  buildFeatureFeedbackFromRows,
} from "@/lib/recommendationFeedback";
export type { FeatureFeedbackRow } from "@/lib/recommendationFeedback";

export type TasteProfile = Awaited<ReturnType<typeof buildTasteProfile>>;
export type FeatureFeedback = Awaited<ReturnType<typeof getAvoidedFeatures>>;
type TasteProfileFilmInput = Parameters<
  typeof buildTasteProfile
>[0]["films"][number];

export type FilmEventRow = {
  uri: string;
  title: string;
  year: number | null;
  rating: number | null;
  rewatch: boolean | null;
  last_date: string | null;
  watch_count: number | null;
  liked: boolean | null;
  on_watchlist: boolean | null;
  watchlist_added_at?: string | null;
};

export type FilmMappingRow = {
  uri: string;
  tmdb_id: number;
};

export type AdjacentGenreRow = {
  from_genre_name: string;
  to_genre_name: string;
  success_rate: number;
  rating_count?: number;
};

type ExposureRow = {
  tmdb_id: number;
  exposed_at: string;
};

type BlockedSuggestionRow = {
  tmdb_id: number;
};

type QuizRevisionQueryRow = {
  id: number;
  created_at: string | null;
};

export const RECOMMENDATION_ENGINE_VERSION = "v1-phase0" as const;

export const USER_CONTEXT_SOURCE_NAMES = [
  "films",
  "mappings",
  "feedback",
  "exploration",
  "adjacent_genres",
  "exposures",
  "blocked",
] as const;

export type UserContextSourceName = (typeof USER_CONTEXT_SOURCE_NAMES)[number];
export type UserContextSourceHealth = "ok" | "empty" | "failed";
export type RecommendationInputMode =
  | "degraded"
  | "cold_start"
  | "personalized";

export type UserContextSourceDiagnostic = {
  health: UserContextSourceHealth;
  rowCount: number;
};

export type UserContextInputHealth = Record<
  UserContextSourceName,
  UserContextSourceDiagnostic
>;

export type UserContextSourceLoadResult<T> = {
  data: T | null;
  error?: unknown | null;
};

export type UserContextSourceLoaderResult = {
  films: UserContextSourceLoadResult<FilmEventRow[]>;
  mappings: UserContextSourceLoadResult<FilmMappingRow[]>;
  feedback: UserContextSourceLoadResult<FeatureFeedbackRow[]>;
  exploration: UserContextSourceLoadResult<{
    exploration_rate?: number | null;
  } | null>;
  adjacent_genres: UserContextSourceLoadResult<AdjacentGenreRow[]>;
  exposures: UserContextSourceLoadResult<ExposureRow[]>;
  blocked: UserContextSourceLoadResult<BlockedSuggestionRow[]>;
};

export type UserContextSourceLoader = (
  userId: string,
  exposureCutoff: string,
) => Promise<UserContextSourceLoaderResult>;

export async function runCanonicalServerRecommendations(
  request: RecommendationRequestInput,
  dependencies: RecommendationEngineDependencies,
): Promise<RecommendationEngineResult> {
  return runCanonicalRecommendation(request, dependencies);
}

/**
 * Checkpoint 3.1A shared web/v1 experiment assignment boundary.
 *
 * Both authenticated production surfaces resolve the frozen A/A assignment
 * exactly once per request through the fail-closed enrollment resolver. This
 * boundary only forwards the authenticated user id: it never chooses an arm,
 * caches, randomizes, or touches recommendation behavior. The resolver
 * absorbs every failure and returns DEFAULT_EXPERIMENT_ASSIGNMENT, so this
 * call can never block recommendation generation.
 */
export async function resolveServerRecommendationExperimentAssignment(
  userId: string | null | undefined,
): Promise<RecommendationExperimentAssignment> {
  return resolveRecommendationExperimentAssignment({ userId });
}

type CachedTasteProfileRow = {
  profile: TasteProfile;
  film_count: number;
  computed_at: string;
  input_revision: string | null;
  profile_model_version: string | null;
};

type TmdbMovieCacheRow = {
  tmdb_id: number;
  data: TMDBMovie | null;
  imdb_rating?: string | null;
  rotten_tomatoes?: string | null;
  metacritic?: string | null;
};

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

export type UserContextDiagnostics = {
  inputHealth: UserContextInputHealth;
  failedSources: UserContextSourceName[];
  mode: RecommendationInputMode;
};

type TmdbListResult = {
  results?: Array<{
    id: number;
    genre_ids?: number[];
    source?: string;
    intent?: string;
    confidence?: number;
    reason?: string;
    title?: string;
  }>;
};

const TMDB_BATCH_SIZE = 200;
const TMDB_METADATA_CONCURRENCY = 5;
/** Minimum positive signal count for explicit feedback to override a pattern-analysis "avoid" classification. */
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
  return (
    completion.completed >=
    getRequiredMetadataCount(completion.requested, resultCount)
  );
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isTmdbProfileComplete(
  movie: TMDBMovie | null | undefined,
): movie is TMDBMovie {
  if (!movie) return false;

  const hasCredits =
    Array.isArray(movie.credits?.cast) && Array.isArray(movie.credits?.crew);
  const hasKeywords =
    Array.isArray(movie.keywords?.keywords) ||
    Array.isArray(movie.keywords?.results);

  return hasCredits && hasKeywords;
}

function buildExposureMap(
  rows: ExposureRow[],
  now = Date.now(),
): Map<number, number> {
  const map = new Map<number, number>();

  for (const row of rows) {
    if (!isFiniteNumber(row.tmdb_id) || !row.exposed_at) continue;

    const exposedAt = new Date(row.exposed_at).getTime();
    if (Number.isNaN(exposedAt)) continue;

    const daysSince = (now - exposedAt) / (1000 * 60 * 60 * 24);
    map.set(row.tmdb_id, daysSince);
  }

  return map;
}

function scoreSeedFilm(film: FilmEventRow, now: number): number {
  const ratingScore = film.rating ?? 0;
  const likedBonus = film.liked ? 1.5 : 0;
  const rewatchBonus = film.rewatch ? 1.25 : 0;
  const watchCountBonus = Math.min((film.watch_count ?? 0) * 0.1, 0.5);

  let recencyBonus = 0;
  if (film.last_date) {
    const timestamp = new Date(film.last_date).getTime();
    if (!Number.isNaN(timestamp)) {
      const daysAgo = (now - timestamp) / (1000 * 60 * 60 * 24);
      if (daysAgo <= 90) recencyBonus = 0.5;
      else if (daysAgo <= 365) recencyBonus = 0.25;
    }
  }

  return (
    ratingScore + likedBonus + rewatchBonus + watchCountBonus + recencyBonus
  );
}

function parseFilmDate(value: string | null): number | null {
  if (!value) return null;

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function compareSeedFilms(
  left: FilmEventRow,
  right: FilmEventRow,
  mappings: ReadonlyMap<string, number>,
  now: number,
): number {
  const scoreDifference =
    scoreSeedFilm(right, now) - scoreSeedFilm(left, now);
  if (scoreDifference !== 0) return scoreDifference;

  const leftDate = parseFilmDate(left.last_date);
  const rightDate = parseFilmDate(right.last_date);
  if (leftDate !== rightDate) {
    if (leftDate === null) return 1;
    if (rightDate === null) return -1;
    return rightDate - leftDate;
  }

  const leftTmdbId = mappings.get(left.uri);
  const rightTmdbId = mappings.get(right.uri);
  if (leftTmdbId !== rightTmdbId) {
    if (leftTmdbId === undefined) return 1;
    if (rightTmdbId === undefined) return -1;
    return leftTmdbId - rightTmdbId;
  }

  return left.uri.localeCompare(right.uri);
}

function getTopSeedTmdbIds(
  userContext: UserContext,
  limit: number,
  now: number,
): WeightedRecommendationSeed[] {
  const scoredFilms = [...userContext.films]
    .filter(
      (film) =>
        userContext.mappings.has(film.uri) &&
        ((film.rating ?? 0) >= 3.5 || film.liked || film.rewatch),
    )
    .sort((left, right) =>
      compareSeedFilms(left, right, userContext.mappings, now),
    );

  const scored: WeightedRecommendationSeed[] = [];
  for (const film of scoredFilms) {
    const tmdbId = userContext.mappings.get(film.uri);
    if (tmdbId === undefined) continue;
    scored.push({
      tmdbId,
      weight: Math.max(0.01, scoreSeedFilm(film, now)),
      source: "history",
    });
  }

  const seen = new Set<number>();
  return scored
    .filter((seed) => {
      if (seen.has(seed.tmdbId)) return false;
      seen.add(seed.tmdbId);
      return true;
    })
    .slice(0, limit);
}

export function getRelevantTasteTmdbIds(userContext: UserContext): number[] {
  const now = Date.now();
  const relevant = userContext.films
    .filter(
      (film) =>
        userContext.mappings.has(film.uri) &&
        (film.liked ||
          film.rewatch ||
          film.on_watchlist ||
          (film.rating ?? 0) >= 3.5 ||
           ((film.rating ?? 0) > 0 && (film.rating ?? 0) <= 1.5)),
    )
    .sort((left, right) =>
      compareSeedFilms(left, right, userContext.mappings, now),
    );

  const seen = new Set<number>();
  const relevantIds: number[] = [];
  for (const film of relevant) {
    const tmdbId = userContext.mappings.get(film.uri);
    if (!isFiniteNumber(tmdbId) || tmdbId <= 0 || seen.has(tmdbId)) {
      continue;
    }

    seen.add(tmdbId);
    relevantIds.push(tmdbId);
  }

  return relevantIds.slice(0, 300);
}

function buildTasteProfileFilms(
  films: FilmEventRow[],
  mappings: ReadonlyMap<string, number>,
): TasteProfileFilmInput[] {
  return sortByFilmRecency(films, (film) => ({
    uri: film.uri,
    tmdbId: mappings.get(film.uri) ?? Number.MAX_SAFE_INTEGER,
    rating: film.rating,
    watchDate: film.last_date,
  })).map((film) => ({
    uri: film.uri,
    rating: film.rating ?? undefined,
    liked: film.liked ?? undefined,
    rewatch: film.rewatch ?? undefined,
    lastDate: film.last_date ?? undefined,
  }));
}

export async function loadCachedTmdbDetails(
  tmdbIds: number[],
): Promise<Map<number, TMDBMovie>> {
  const db = getSupabaseAdmin();
  const tmdbDetailsMap = new Map<number, TMDBMovie>();

  for (const batch of chunkArray(tmdbIds, TMDB_BATCH_SIZE)) {
    const { data, error } = await db
      .from("tmdb_movies")
      .select("tmdb_id, data, imdb_rating, rotten_tomatoes, metacritic")
      .in("tmdb_id", batch);

    if (error) {
      console.error("[ServerEngine] tmdb_movies load error:", error);
      continue;
    }

    for (const row of (data ?? []) as TmdbMovieCacheRow[]) {
      if (row.data) {
        const movie = row.data;
        // Only cache entries with complete metadata — consistent with fetchTmdbMovieCached behavior
        if (movie.credits?.cast && movie.credits?.crew && movie.keywords) {
          Object.assign(movie, {
            ...(row.imdb_rating == null
              ? {}
              : { imdb_rating: row.imdb_rating }),
            ...(row.rotten_tomatoes == null
              ? {}
              : { rotten_tomatoes: row.rotten_tomatoes }),
            ...(row.metacritic == null
              ? {}
              : { metacritic: row.metacritic }),
          });
          tmdbDetailsMap.set(row.tmdb_id, movie);
        }
      }
    }
  }

  return tmdbDetailsMap;
}

async function fetchTmdbMovieDetails(
  tmdbId: number,
): Promise<TMDBMovie | null> {
  try {
    return await fetchTmdb<TMDBMovie>(`/movie/${tmdbId}`, {
      append_to_response: "credits,keywords",
    });
  } catch (error) {
    console.error("[ServerEngine] TMDB details fetch error:", {
      tmdbId,
      error,
    });
    return null;
  }
}

function persistTmdbDetailsBestEffort(
  db: ReturnType<typeof getSupabaseAdmin>,
  tmdbId: number,
  movie: TMDBMovie,
): void {
  try {
    const upsertRequest = db
      .from("tmdb_movies")
      .upsert({ tmdb_id: tmdbId, data: movie }, { onConflict: "tmdb_id" });

    void Promise.resolve(upsertRequest)
      .then(({ error }) => {
        if (error) {
          console.error("[ServerEngine] tmdb_movies upsert error:", {
            tmdbId,
            error,
          });
        }
      })
      .catch((error) => {
        console.error("[ServerEngine] tmdb_movies upsert error:", {
          tmdbId,
          error,
        });
      });
  } catch (error) {
    console.error("[ServerEngine] tmdb_movies upsert error:", {
      tmdbId,
      error,
    });
  }
}

export async function ensureCompleteTmdbDetails(
  tmdbIds: number[],
  existingMap: Map<number, TMDBMovie>,
  options: { deadlineMs?: number } = {},
): Promise<TmdbMetadataCompletion> {
  const requestedIds = Array.from(new Set(tmdbIds));
  const detailsById = new Map<number, TMDBMovie>();
  const idsToFetch: number[] = [];

  for (const tmdbId of requestedIds) {
    const cachedMovie = existingMap.get(tmdbId);
    if (isTmdbProfileComplete(cachedMovie)) {
      detailsById.set(tmdbId, cachedMovie);
    } else {
      idsToFetch.push(tmdbId);
    }
  }

  const deadlineMs =
    typeof options.deadlineMs === "number" && Number.isFinite(options.deadlineMs)
      ? Math.max(0, options.deadlineMs)
      : undefined;
  const deadlineAt =
    deadlineMs === undefined ? undefined : Date.now() + deadlineMs;

  if (idsToFetch.length === 0) {
    return Promise.resolve({
      details: detailsById,
      requested: requestedIds.length,
      completed: detailsById.size,
      failed: requestedIds.length - detailsById.size,
      deadlineExpired: false,
    });
  }

  let deadlineExpired =
    deadlineAt !== undefined && Date.now() >= deadlineAt;
  let nextIndex = 0;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveDeadline: (() => void) | undefined;
  const deadlineReached = new Promise<void>((resolve) => {
    resolveDeadline = resolve;
  });

  const markDeadlineExpired = () => {
    if (deadlineExpired) return;
    deadlineExpired = true;
    resolveDeadline?.();
  };

  if (deadlineMs !== undefined && deadlineMs > 0) {
    deadlineTimer = setTimeout(markDeadlineExpired, deadlineMs);
  } else if (deadlineExpired) {
    resolveDeadline?.();
  }

  const db = getSupabaseAdmin();
  let completed = detailsById.size;

  const runWorker = async (): Promise<void> => {
    while (true) {
      if (deadlineExpired) return;
      if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
        markDeadlineExpired();
        return;
      }

      const index = nextIndex;
      nextIndex += 1;
      const tmdbId = idsToFetch[index];
      if (tmdbId === undefined) return;

      const movie = await fetchTmdbMovieDetails(tmdbId);
      if (!movie) continue;

      existingMap.set(tmdbId, movie);
      detailsById.set(tmdbId, movie);
      completed += 1;

      persistTmdbDetailsBestEffort(db, tmdbId, movie);
    }
  };

  const workerCompletion = Promise.all(
    Array.from(
      { length: Math.min(TMDB_METADATA_CONCURRENCY, idsToFetch.length) },
      () => runWorker(),
    ),
  );

  try {
    if (deadlineMs !== undefined) {
      await Promise.race([workerCompletion, deadlineReached]);
    }
    await workerCompletion;
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
  }

  const orderedDetails = new Map<number, TMDBMovie>();
  for (const tmdbId of requestedIds) {
    const movie = detailsById.get(tmdbId);
    if (movie) orderedDetails.set(tmdbId, movie);
  }

  return {
    details: orderedDetails,
    requested: requestedIds.length,
    completed,
    failed: requestedIds.length - completed,
    deadlineExpired,
  };
}

const CONTEXT_DIAGNOSTIC_ROW_LIMIT = 10_000;
const REQUIRED_CONTEXT_SOURCES = new Set<UserContextSourceName>([
  "films",
  "mappings",
  "blocked",
]);

type LoadedSource<T> = {
  data: T | null;
  diagnostic: UserContextSourceDiagnostic;
  failureCode?: string;
};

type SourceValidator<T> = (value: unknown) => value is T;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isNullableBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean";
}

function isNullableDateString(value: unknown): value is string | null {
  return (
    value === null ||
    (isNonEmptyString(value) && !Number.isNaN(Date.parse(value)))
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isNumericString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    Number.isFinite(Number(value))
  );
}

function isFilmEventRow(value: unknown): value is FilmEventRow {
  if (!isRecord(value)) return false;

  return (
    isNonEmptyString(value.uri) &&
    typeof value.title === "string" &&
    isNullableFiniteNumber(value.year) &&
    isNullableFiniteNumber(value.rating) &&
    isNullableBoolean(value.rewatch) &&
    isNullableDateString(value.last_date) &&
    (value.watch_count === null ||
      isNonNegativeFiniteNumber(value.watch_count)) &&
    isNullableBoolean(value.liked) &&
    isNullableBoolean(value.on_watchlist) &&
    (value.watchlist_added_at === undefined ||
      isNullableDateString(value.watchlist_added_at))
  );
}

function isFilmMappingRow(value: unknown): value is FilmMappingRow {
  return (
    isRecord(value) &&
    isNonEmptyString(value.uri) &&
    isPositiveSafeInteger(value.tmdb_id)
  );
}

function isFeatureFeedbackRow(value: unknown): value is FeatureFeedbackRow {
  if (!isRecord(value)) return false;

  const inferredPreference = value.inferred_preference;
  const validInferredPreference =
    inferredPreference === null ||
    isFiniteNumber(inferredPreference) ||
    isNumericString(inferredPreference);

  return (
    isFiniteNumber(value.feature_id) &&
    isNonEmptyString(value.feature_name) &&
    isNonEmptyString(value.feature_type) &&
    validInferredPreference &&
    isNonNegativeFiniteNumber(value.positive_count) &&
    isNonNegativeFiniteNumber(value.negative_count)
  );
}

function isAdjacentGenreRow(value: unknown): value is AdjacentGenreRow {
  if (!isRecord(value)) return false;

  return (
    isNonEmptyString(value.from_genre_name) &&
    isNonEmptyString(value.to_genre_name) &&
    isFiniteNumber(value.success_rate) &&
    (value.rating_count === undefined ||
      isNonNegativeFiniteNumber(value.rating_count))
  );
}

function isExposureRow(value: unknown): value is ExposureRow {
  return (
    isRecord(value) &&
    isPositiveSafeInteger(value.tmdb_id) &&
    isNonEmptyString(value.exposed_at) &&
    !Number.isNaN(Date.parse(value.exposed_at))
  );
}

function isBlockedSuggestionRow(
  value: unknown,
): value is BlockedSuggestionRow {
  return isRecord(value) && isPositiveSafeInteger(value.tmdb_id);
}

function isExplorationData(
  value: unknown,
): value is { exploration_rate?: number | null } | null {
  if (value === null) return true;
  return (
    isRecord(value) &&
    (value.exploration_rate === undefined ||
      value.exploration_rate === null ||
      isFiniteNumber(value.exploration_rate))
  );
}

function isArrayOf<T>(value: unknown, validator: SourceValidator<T>): value is T[] {
  return Array.isArray(value) && value.every(validator);
}

function stableErrorIdentity(error: unknown): string {
  const sanitizeToken = (value: unknown, fallback: string): string => {
    if (
      typeof value === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(value)
    ) {
      return value;
    }
    return fallback;
  };

  if (error instanceof Error) return sanitizeToken(error.name, "ERROR");

  if (isRecord(error)) {
    if (isNonEmptyString(error.code)) {
      return sanitizeToken(error.code, "ERROR_CODE");
    }
    if (isNonEmptyString(error.name)) {
      return sanitizeToken(error.name, "ERROR_NAME");
    }
  }

  if (typeof error === "string") return "STRING_ERROR";
  return "UNKNOWN_ERROR";
}

function boundedRowCount(value: unknown): number {
  const count = Array.isArray(value)
    ? value.length
    : value instanceof Map || value instanceof Set
      ? value.size
      : value == null
        ? 0
        : 1;
  return Math.min(CONTEXT_DIAGNOSTIC_ROW_LIMIT, Math.max(0, count));
}

function inspectSource<T>(
  result: UserContextSourceLoadResult<T> | undefined,
  validator: SourceValidator<T>,
): LoadedSource<T> {
  if (!result) {
    return {
      data: null,
      diagnostic: { health: "failed", rowCount: 0 },
      failureCode: "MISSING_SOURCE_RESULT",
    };
  }

  if (result.error != null) {
    return {
      data: null,
      diagnostic: { health: "failed", rowCount: 0 },
      failureCode: stableErrorIdentity(result.error),
    };
  }

  if (!validator(result.data)) {
    return {
      data: null,
      diagnostic: { health: "failed", rowCount: 0 },
      failureCode: "INVALID_SOURCE_PAYLOAD",
    };
  }

  const rowCount = boundedRowCount(result.data);
  return {
    data: result.data,
    diagnostic: {
      health: rowCount > 0 ? "ok" : "empty",
      rowCount,
    },
  };
}

function hasMappedHistoryEvidence(
  films: FilmEventRow[],
  mappings: ReadonlyMap<string, number>,
): boolean {
  return films.some((film) => {
    const tmdbId = mappings.get(film.uri);
    if (!isFiniteNumber(tmdbId) || tmdbId <= 0) return false;

    return (
      film.liked === true ||
      film.rewatch === true ||
      film.on_watchlist === true ||
      (film.rating != null &&
        film.rating > 0 &&
        (film.rating >= 3.5 || film.rating <= 1.5))
    );
  });
}

function buildInputHealth(
  diagnostics: Partial<
    Record<UserContextSourceName, UserContextSourceDiagnostic>
  > = {},
): UserContextInputHealth {
  return Object.fromEntries(
    USER_CONTEXT_SOURCE_NAMES.map((sourceName) => [
      sourceName,
      (() => {
        const diagnostic = diagnostics[sourceName];
        const rowCount = diagnostic?.rowCount;
        return {
          health: diagnostic?.health ?? "failed",
          rowCount:
            typeof rowCount === "number" && Number.isFinite(rowCount)
              ? Math.min(
                  CONTEXT_DIAGNOSTIC_ROW_LIMIT,
                  Math.max(0, Math.floor(rowCount)),
                )
              : 0,
        };
      })(),
    ]),
  ) as UserContextInputHealth;
}

function buildMode(
  inputHealth: UserContextInputHealth,
  films: FilmEventRow[],
  mappings: ReadonlyMap<string, number>,
): RecommendationInputMode {
  if (
    USER_CONTEXT_SOURCE_NAMES.some(
      (sourceName) =>
        REQUIRED_CONTEXT_SOURCES.has(sourceName) &&
        inputHealth[sourceName].health === "failed",
    )
  ) {
    return "degraded";
  }

  return hasMappedHistoryEvidence(films, mappings)
    ? "personalized"
    : "cold_start";
}

export function getUserContextDiagnostics(
  userContext: UserContext,
): UserContextDiagnostics {
  const baseHealth = userContext.inputHealth
    ? buildInputHealth(userContext.inputHealth)
    : buildInputHealth(
        Object.fromEntries(
          USER_CONTEXT_SOURCE_NAMES.map((sourceName) => [
            sourceName,
            { health: "failed", rowCount: 0 },
          ]),
        ) as Partial<
          Record<UserContextSourceName, UserContextSourceDiagnostic>
        >,
      );
  const failedSourceSet = new Set(userContext.failedSources ?? []);
  const inputHealth = buildInputHealth(
    Object.fromEntries(
      USER_CONTEXT_SOURCE_NAMES.map((sourceName) => [
        sourceName,
        failedSourceSet.has(sourceName)
          ? { health: "failed", rowCount: 0 }
          : baseHealth[sourceName],
      ]),
    ) as Partial<
      Record<UserContextSourceName, UserContextSourceDiagnostic>
    >,
  );
  const failedSources = USER_CONTEXT_SOURCE_NAMES.filter(
    (sourceName) => inputHealth[sourceName].health === "failed",
  );

  return {
    inputHealth,
    failedSources,
    mode: buildMode(inputHealth, userContext.films, userContext.mappings),
  };
}

function emptyUserContext(
  diagnostics: UserContextDiagnostics,
): UserContext {
  return {
    films: [],
    mappings: new Map<string, number>(),
    mappingsArray: [],
    feedback: [],
    explorationRate: 0.15,
    adjacentGenres: [],
    recentExposures: new Map<number, number>(),
    blockedIds: new Set<number>(),
    inputHealth: diagnostics.inputHealth,
    failedSources: diagnostics.failedSources,
    mode: diagnostics.mode,
  };
}

async function loadDefaultUserContextSources(
  userId: string,
  exposureCutoff: string,
): Promise<UserContextSourceLoaderResult> {
  const db = getSupabaseAdmin();

  const [
    filmsResult,
    mappingsResult,
    feedbackResult,
    explorationResult,
    adjacentResult,
    exposuresResult,
    blockedResult,
  ] = await Promise.all([
    db
      .from("film_events")
      .select(
        "uri, title, year, rating, rewatch, last_date, watch_count, liked, on_watchlist, watchlist_added_at",
      )
      .eq("user_id", userId)
      .limit(10000)
      .order("last_date", { ascending: false, nullsFirst: false }),
    db
      .from("film_tmdb_map")
      .select("uri, tmdb_id")
      .eq("user_id", userId)
      .limit(10000),
    db
      .from("user_feature_feedback")
      .select(
        "feature_id, feature_name, feature_type, inferred_preference, positive_count, negative_count",
      )
      .eq("user_id", userId)
      .limit(10000),
    db
      .from("user_exploration_stats")
      .select("exploration_rate")
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("user_adjacent_preferences")
      .select("from_genre_name, to_genre_name, success_rate, rating_count")
      .eq("user_id", userId)
      .gte("rating_count", 3)
      .gte("success_rate", 0.5),
    db
      .from("suggestion_exposure_log")
      .select("tmdb_id, exposed_at")
      .eq("user_id", userId)
      .gte("exposed_at", exposureCutoff)
      .limit(5000),
    db
      .from("blocked_suggestions")
      .select("tmdb_id")
      .eq("user_id", userId)
      .limit(5000),
  ]);

  return {
    films: filmsResult as UserContextSourceLoadResult<FilmEventRow[]>,
    mappings: mappingsResult as UserContextSourceLoadResult<FilmMappingRow[]>,
    feedback: feedbackResult as UserContextSourceLoadResult<
      FeatureFeedbackRow[]
    >,
    exploration: explorationResult as UserContextSourceLoadResult<{
      exploration_rate?: number | null;
    } | null>,
    adjacent_genres: adjacentResult as UserContextSourceLoadResult<
      AdjacentGenreRow[]
    >,
    exposures: exposuresResult as UserContextSourceLoadResult<ExposureRow[]>,
    blocked: blockedResult as UserContextSourceLoadResult<BlockedSuggestionRow[]>,
  };
}

export async function loadUserContext(
  userId: string,
  options: {
    sourceLoader?: UserContextSourceLoader;
    now?: () => number;
  } = {},
): Promise<UserContext> {
  const currentTime = options.now?.() ?? Date.now();
  const exposureCutoff = new Date(
    currentTime - 14 * 24 * 60 * 60 * 1000,
  ).toISOString();

  try {
    const sourceLoader =
      options.sourceLoader ?? loadDefaultUserContextSources;
    const loadedSources = (await sourceLoader(
      userId,
      exposureCutoff,
    )) as Partial<UserContextSourceLoaderResult>;
    const loaded = {
      films: inspectSource(
        loadedSources.films,
        (value): value is FilmEventRow[] =>
          isArrayOf(value, isFilmEventRow),
      ),
      mappings: inspectSource(
        loadedSources.mappings,
        (value): value is FilmMappingRow[] =>
          isArrayOf(value, isFilmMappingRow),
      ),
      feedback: inspectSource(
        loadedSources.feedback,
        (value): value is FeatureFeedbackRow[] =>
          isArrayOf(value, isFeatureFeedbackRow),
      ),
      exploration: inspectSource(
        loadedSources.exploration,
        isExplorationData,
      ),
      adjacent_genres: inspectSource(
        loadedSources.adjacent_genres,
        (value): value is AdjacentGenreRow[] =>
          isArrayOf(value, isAdjacentGenreRow),
      ),
      exposures: inspectSource(
        loadedSources.exposures,
        (value): value is ExposureRow[] =>
          isArrayOf(value, isExposureRow),
      ),
      blocked: inspectSource(
        loadedSources.blocked,
        (value): value is BlockedSuggestionRow[] =>
          isArrayOf(value, isBlockedSuggestionRow),
      ),
    };

    for (const sourceName of USER_CONTEXT_SOURCE_NAMES) {
      if (loaded[sourceName].diagnostic.health === "failed") {
        const sourceResult = loadedSources[sourceName] as
          | UserContextSourceLoadResult<unknown>
          | undefined;
        console.error("[ServerEngine] user context source failed", {
          source: sourceName,
          code:
            loaded[sourceName].failureCode ??
            stableErrorIdentity(sourceResult?.error),
        });
      }
    }

    const inputHealth = buildInputHealth(
      Object.fromEntries(
        USER_CONTEXT_SOURCE_NAMES.map((sourceName) => [
          sourceName,
          loaded[sourceName].diagnostic,
        ]),
      ) as Partial<
        Record<UserContextSourceName, UserContextSourceDiagnostic>
      >,
    );
    const failedSources = USER_CONTEXT_SOURCE_NAMES.filter(
      (sourceName) => inputHealth[sourceName].health === "failed",
    );

    const films = (Array.isArray(loaded.films.data)
      ? loaded.films.data
      : []
    ).map((row) => ({
      ...row,
      rating: row.rating ?? null,
      rewatch: row.rewatch ?? null,
      last_date: row.last_date ?? null,
      watch_count: row.watch_count ?? null,
      liked: row.liked ?? null,
      on_watchlist: row.on_watchlist ?? null,
      watchlist_added_at: row.watchlist_added_at ?? null,
    }));

    const mappingsArray = Array.isArray(loaded.mappings.data)
      ? loaded.mappings.data
      : [];
    const mappings = new Map<string, number>();
    for (const row of mappingsArray) {
      mappings.set(row.uri, row.tmdb_id);
    }

    const diagnostics: UserContextDiagnostics = {
      inputHealth,
      failedSources,
      mode: buildMode(inputHealth, films, mappings),
    };

    return {
      films,
      mappings,
      mappingsArray,
      feedback: Array.isArray(loaded.feedback.data)
        ? loaded.feedback.data
        : [],
      explorationRate:
        loaded.exploration.data?.exploration_rate ?? 0.15,
      adjacentGenres: Array.isArray(loaded.adjacent_genres.data)
        ? loaded.adjacent_genres.data
        : [],
      recentExposures: buildExposureMap(
        Array.isArray(loaded.exposures.data) ? loaded.exposures.data : [],
        currentTime,
      ),
      blockedIds: new Set(
        (Array.isArray(loaded.blocked.data) ? loaded.blocked.data : []).map(
          (row) => row.tmdb_id,
        ),
      ),
      inputHealth,
      failedSources,
      mode: diagnostics.mode,
    };
  } catch (error) {
    console.error("[ServerEngine] loadUserContext fatal error", {
      code: stableErrorIdentity(error),
    });
    const inputHealth = buildInputHealth(
      Object.fromEntries(
        USER_CONTEXT_SOURCE_NAMES.map((sourceName) => [
          sourceName,
          { health: "failed", rowCount: 0 },
        ]),
      ) as Partial<
        Record<UserContextSourceName, UserContextSourceDiagnostic>
      >,
    );
    return emptyUserContext({
      inputHealth,
      failedSources: [...USER_CONTEXT_SOURCE_NAMES],
      mode: "degraded",
    });
  }
}

function isQuizRevisionQueryRow(
  value: unknown,
): value is QuizRevisionQueryRow {
  if (!isRecord(value)) return false;

  return (
    isPositiveSafeInteger(value.id) &&
    (value.created_at === null || typeof value.created_at === "string")
  );
}

async function loadQuizStateForRevision(
  db: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
): Promise<RecommendationRevisionQuizState> {
  try {
    const { data, error, count } = await db
      .from("user_quiz_responses")
      .select("id, created_at", {
        count: "exact",
      })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1);

    if (
      error ||
      !Array.isArray(data) ||
      data.length > 1 ||
      !data.every(isQuizRevisionQueryRow) ||
      !isNonNegativeSafeInteger(count)
    ) {
      console.error("[ServerEngine] quiz revision source failed", {
        code: error ? stableErrorIdentity(error) : "INVALID_SOURCE_PAYLOAD",
      });
      return { status: "unavailable" };
    }

    return {
      status: "ok",
      responseCount: count,
      latestResponseId: data[0]?.id ?? null,
      latestResponseAt: data[0]?.created_at ?? null,
    };
  } catch (error) {
    console.error("[ServerEngine] quiz revision source exception", {
      code: stableErrorIdentity(error),
    });
    return { status: "unavailable" };
  }
}

export function buildTasteProfileCacheRevision(
  userContext: UserContext,
  quizState: RecommendationRevisionQuizState,
): { inputRevision: string; profileModelVersion: string } {
  return {
    inputRevision: createRecommendationRevision({
      films: userContext.films.map((film) => ({
        uri: film.uri,
        title: film.title,
        year: film.year,
        rating: film.rating,
        rewatch: film.rewatch,
        lastDate: film.last_date,
        watchCount: film.watch_count,
        liked: film.liked,
        onWatchlist: film.on_watchlist,
      })),
      mappings: userContext.mappingsArray.map((mapping) => ({
        uri: mapping.uri,
        tmdbId: mapping.tmdb_id,
      })),
      watchlist: userContext.films
        .filter((film) => film.on_watchlist === true)
        .map((film) => ({
          uri: film.uri,
          watchlistAddedAt: film.watchlist_added_at ?? null,
        })),
      feedback: userContext.feedback.map((row) => ({
        featureId: row.feature_id,
        featureName: row.feature_name,
        featureType: row.feature_type,
        inferredPreference: row.inferred_preference,
        positiveCount: row.positive_count,
        negativeCount: row.negative_count,
      })),
      quizState,
      blockedIds: Array.from(userContext.blockedIds),
      metadataVersion: TASTE_PROFILE_METADATA_VERSION,
      profileModelVersion: TASTE_PROFILE_MODEL_VERSION,
    }),
    profileModelVersion: TASTE_PROFILE_MODEL_VERSION,
  };
}

export async function buildTasteProfileServer(
  userId: string,
  userContext: UserContext,
): Promise<TasteProfile> {
  const emptyProfile = await buildTasteProfile({
    films: [],
    mappings: new Map<string, number>(),
    tmdbDetails: new Map<number, TMDBMovie>(),
    userId,
  });

  try {
    const db = getSupabaseAdmin();
    const currentFilmCount = userContext.films.length;
    const quizState = await loadQuizStateForRevision(db, userId);
    const currentRevision = buildTasteProfileCacheRevision(
      userContext,
      quizState,
    );

    const { data: cachedRow, error: cacheError } = await db
      .from("user_taste_profile_cache")
      .select(
        "profile, film_count, computed_at, input_revision, profile_model_version",
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (cacheError) {
      console.error(
        "[ServerEngine] taste profile cache read error:",
        cacheError,
      );
    }

    const cache = (cachedRow ?? null) as CachedTasteProfileRow | null;
    if (
      quizState.status === "ok" &&
      cache &&
      decideTasteProfileCache(cache, currentRevision) === "hit"
    ) {
      return cache.profile;
    }

    const relevantTmdbIds = getRelevantTasteTmdbIds(userContext);
    const cachedTmdbDetails = await loadCachedTmdbDetails(relevantTmdbIds);
    const completion = await ensureCompleteTmdbDetails(
      relevantTmdbIds,
      cachedTmdbDetails,
      { deadlineMs: WEB_METADATA_DEADLINE_MS },
    );
    const tmdbDetailsMap = completion.details;

    const tasteProfile = await buildTasteProfile({
      films: buildTasteProfileFilms(userContext.films, userContext.mappings),
      mappings: userContext.mappings,
      tmdbDetails: tmdbDetailsMap,
      negativeFeedbackIds: Array.from(userContext.blockedIds),
      watchlistFilms: userContext.films
        .filter((film) => film.on_watchlist)
        .map((film) => ({
          uri: film.uri,
          watchlistAddedAt: film.watchlist_added_at ?? undefined,
        })),
      userId,
    });

    if (quizState.status === "ok") {
      const { error: upsertError } = await db
        .from("user_taste_profile_cache")
        .upsert(
          createTasteProfileCacheWritePayload({
            userId,
            profile: tasteProfile,
            filmCount: currentFilmCount,
            computedAt: new Date().toISOString(),
            revision: currentRevision,
          }),
          { onConflict: "user_id" },
        );

      if (upsertError) {
        console.error(
          "[ServerEngine] taste profile cache upsert error:",
          upsertError,
        );
      }
    } else {
      console.warn(
        "[ServerEngine] skipping taste profile cache write because quiz state is unavailable",
      );
    }

    return tasteProfile;
  } catch (error) {
    console.error("[ServerEngine] buildTasteProfileServer error:", error);
    return emptyProfile;
  }
}

export async function generateServerCandidates(
  userId: string,
  userContext: UserContext,
  tasteProfile: TasteProfile,
  seedTmdbIds: readonly ServerSeedInput[] = [],
  options: ServerCandidateGenerationOptions = {},
): Promise<{ candidateIds: number[]; sourceMetadata: SourceMetadata }> {
  const provider = options.provider ?? fetchTmdb;
  const providerRows =
    options.providerRows ??
    (async ({ path, params, source, intent }: ServerCandidateProviderRequest) => {
      const result = await provider<TmdbListResult>(path, params);
      return (result.results ?? []).map((movie) => ({
        tmdbId: movie.id,
        source: movie.source ?? source,
        ...(movie.intent ?? intent
          ? { intent: movie.intent ?? intent }
          : {}),
        ...(movie.title ? { title: movie.title } : {}),
        ...(movie.confidence !== undefined
          ? { confidence: movie.confidence }
          : {}),
        ...(movie.reason ? { reason: movie.reason } : {}),
      }));
    });

  const retrieved = await retrieveServerCandidates(
    userId,
    userContext,
    tasteProfile,
    seedTmdbIds,
    {
      requestSeed: options.requestSeed,
      providerRows,
      now: options.now,
      limits: options.limits,
    },
  );

  return {
    candidateIds: retrieved.candidateIds,
    sourceMetadata: retrieved.sourceMetadata,
  };
}

export type {
  ServerCandidateProvider,
  ServerCandidateProviderRequest,
  ServerCandidateProviderRow,
  ServerCandidateRetrievalLimits,
  ServerCandidateRetrievalOptions,
  ServerCandidateRetrievalResult,
  ServerSeedInput,
  SourceMetadata,
} from "@/lib/recommendationRetrieval";

export type ServerCandidateGenerationOptions = Omit<
  ServerCandidateRetrievalOptions,
  "providerRows"
> & {
  provider?: typeof fetchTmdb;
  providerRows?: ServerCandidateProvider;
};
