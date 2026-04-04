import pLimit from "p-limit";
import { fetchTmdb } from "@/app/api/v1/_lib/tmdb";
import {
  buildTasteProfile,
  getAvoidedFeatures,
  type TMDBMovie,
} from "@/lib/enrich";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type TasteProfile = Awaited<ReturnType<typeof buildTasteProfile>>;
type FeatureFeedback = Awaited<ReturnType<typeof getAvoidedFeatures>>;
type TasteProfileFilmInput = Parameters<
  typeof buildTasteProfile
>[0]["films"][number];

type FilmEventRow = {
  uri: string;
  title: string;
  year: number | null;
  rating: number | null;
  rewatch: boolean | null;
  last_date: string | null;
  watch_count: number | null;
  liked: boolean | null;
  on_watchlist: boolean | null;
};

type FilmMappingRow = {
  uri: string;
  tmdb_id: number;
};

type FeatureFeedbackRow = {
  feature_id: number;
  feature_name: string;
  feature_type: string;
  inferred_preference: number | string | null;
  positive_count: number;
  negative_count: number;
};

type AdjacentGenreRow = {
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

type CachedTasteProfileRow = {
  profile: TasteProfile;
  film_count: number;
  computed_at: string;
};

type TmdbMovieCacheRow = {
  tmdb_id: number;
  data: TMDBMovie | null;
};

type UserContext = {
  films: FilmEventRow[];
  mappings: Map<string, number>;
  mappingsArray: FilmMappingRow[];
  feedback: FeatureFeedbackRow[];
  explorationRate: number;
  adjacentGenres: AdjacentGenreRow[];
  recentExposures: Map<number, number>;
  blockedIds: Set<number>;
};

type TmdbListResult = {
  results?: Array<{
    id: number;
    genre_ids?: number[];
  }>;
};

type SourceMetadata = Map<
  number,
  { sources: string[]; consensusLevel: "high" | "medium" | "low" }
>;

const TMDB_BATCH_SIZE = 200;
const TASTE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function createEmptyFeatureFeedback(): FeatureFeedback {
  return {
    avoidActors: [],
    avoidKeywords: [],
    avoidFranchises: [],
    avoidDirectors: [],
    avoidGenres: [],
    avoidSubgenres: [],
    preferActors: [],
    preferKeywords: [],
    preferDirectors: [],
    preferGenres: [],
    preferSubgenres: [],
  };
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

function isPositivePreference(
  value: FeatureFeedbackRow["inferred_preference"],
): boolean | null {
  if (typeof value === "number" && Number.isFinite(value) && value !== 0) {
    return value > 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "positive") return true;
    if (normalized === "negative") return false;
  }

  return null;
}

function buildWeight(
  row: FeatureFeedbackRow,
  direction: "positive" | "negative",
): number {
  const signal = row.inferred_preference;
  if (typeof signal === "number" && Number.isFinite(signal) && signal !== 0) {
    return Math.abs(signal);
  }

  const delta = Math.abs(row.positive_count - row.negative_count);
  const directionalCount =
    direction === "positive" ? row.positive_count : row.negative_count;

  return Math.max(0.25, delta, directionalCount);
}

function buildCount(
  row: FeatureFeedbackRow,
  direction: "positive" | "negative",
): number {
  return direction === "positive" ? row.positive_count : row.negative_count;
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

function buildExposureMap(rows: ExposureRow[]): Map<number, number> {
  const map = new Map<number, number>();
  const now = Date.now();

  for (const row of rows) {
    if (!isFiniteNumber(row.tmdb_id) || !row.exposed_at) continue;

    const exposedAt = new Date(row.exposed_at).getTime();
    if (Number.isNaN(exposedAt)) continue;

    const daysSince = (now - exposedAt) / (1000 * 60 * 60 * 24);
    map.set(row.tmdb_id, daysSince);
  }

  return map;
}

function addCandidateSource(
  sourceMetadata: SourceMetadata,
  candidateOrder: number[],
  candidateSet: Set<number>,
  tmdbId: number,
  source: string,
  options?: { allowSeen?: boolean; seenIds?: Set<number> },
): void {
  if (!isFiniteNumber(tmdbId) || tmdbId <= 0) return;

  if (!options?.allowSeen && options?.seenIds?.has(tmdbId)) {
    return;
  }

  if (!candidateSet.has(tmdbId)) {
    candidateSet.add(tmdbId);
    candidateOrder.push(tmdbId);
  }

  const existing = sourceMetadata.get(tmdbId);
  const sources = new Set(existing?.sources ?? []);
  sources.add(source);

  const sourceCount = sources.size;
  const consensusLevel: "high" | "medium" | "low" =
    sourceCount >= 3 ? "high" : sourceCount >= 2 ? "medium" : "low";

  sourceMetadata.set(tmdbId, {
    sources: Array.from(sources),
    consensusLevel,
  });
}

function scoreSeedFilm(film: FilmEventRow): number {
  const ratingScore = film.rating ?? 0;
  const likedBonus = film.liked ? 1.5 : 0;
  const rewatchBonus = film.rewatch ? 1.25 : 0;
  const watchCountBonus = Math.min((film.watch_count ?? 0) * 0.1, 0.5);

  let recencyBonus = 0;
  if (film.last_date) {
    const timestamp = new Date(film.last_date).getTime();
    if (!Number.isNaN(timestamp)) {
      const daysAgo = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
      if (daysAgo <= 90) recencyBonus = 0.5;
      else if (daysAgo <= 365) recencyBonus = 0.25;
    }
  }

  return (
    ratingScore + likedBonus + rewatchBonus + watchCountBonus + recencyBonus
  );
}

function getTopSeedTmdbIds(userContext: UserContext, limit = 8): number[] {
  return userContext.films
    .filter(
      (film) =>
        userContext.mappings.has(film.uri) &&
        ((film.rating ?? 0) >= 3.5 || film.liked || film.rewatch),
    )
    .sort((left, right) => scoreSeedFilm(right) - scoreSeedFilm(left))
    .map((film) => userContext.mappings.get(film.uri))
    .filter((tmdbId): tmdbId is number => isFiniteNumber(tmdbId))
    .filter((tmdbId, index, ids) => ids.indexOf(tmdbId) === index)
    .slice(0, limit);
}

function getRelevantTasteTmdbIds(userContext: UserContext): number[] {
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
    .map((film) => userContext.mappings.get(film.uri))
    .filter((tmdbId): tmdbId is number => isFiniteNumber(tmdbId));

  return Array.from(new Set(relevant));
}

function buildTasteProfileFilms(
  films: FilmEventRow[],
): TasteProfileFilmInput[] {
  return films.map((film) => ({
    uri: film.uri,
    rating: film.rating ?? undefined,
    liked: film.liked ?? undefined,
    rewatch: film.rewatch ?? undefined,
    lastDate: film.last_date ?? undefined,
  }));
}

async function loadCachedTmdbDetails(
  tmdbIds: number[],
): Promise<Map<number, TMDBMovie>> {
  const db = getSupabaseAdmin();
  const tmdbDetailsMap = new Map<number, TMDBMovie>();

  for (const batch of chunkArray(tmdbIds, TMDB_BATCH_SIZE)) {
    const { data, error } = await db
      .from("tmdb_movies")
      .select("tmdb_id, data")
      .in("tmdb_id", batch);

    if (error) {
      console.error("[ServerEngine] tmdb_movies load error:", error);
      continue;
    }

    for (const row of (data ?? []) as TmdbMovieCacheRow[]) {
      if (row.data) {
        tmdbDetailsMap.set(row.tmdb_id, row.data);
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

async function ensureCompleteTmdbDetails(
  tmdbIds: number[],
  existingMap: Map<number, TMDBMovie>,
): Promise<Map<number, TMDBMovie>> {
  const idsToFetch = tmdbIds.filter(
    (tmdbId) => !isTmdbProfileComplete(existingMap.get(tmdbId)),
  );

  if (idsToFetch.length === 0) {
    return existingMap;
  }

  const limit = pLimit(5); // TMDB rate limit protection
  const db = getSupabaseAdmin();

  const fetchResults = await Promise.allSettled(
    idsToFetch.map((tmdbId) =>
      limit(async () => {
        const movie = await fetchTmdbMovieDetails(tmdbId);
        if (!movie) return null;

        existingMap.set(tmdbId, movie);

        const { error } = await db
          .from("tmdb_movies")
          .upsert({ tmdb_id: tmdbId, data: movie }, { onConflict: "tmdb_id" });

        if (error) {
          console.error("[ServerEngine] tmdb_movies upsert error:", {
            tmdbId,
            error,
          });
        }

        return movie;
      }),
    ),
  );

  for (const result of fetchResults) {
    if (result.status === "rejected") {
      console.error(
        "[ServerEngine] ensure TMDB details failed:",
        result.reason,
      );
    }
  }

  return existingMap;
}

export function buildFeatureFeedbackFromRows(
  rows: FeatureFeedbackRow[],
): FeatureFeedback {
  const feedback = createEmptyFeatureFeedback();

  for (const row of rows) {
    const preference = isPositivePreference(row.inferred_preference);
    const fallbackPreference =
      row.positive_count > row.negative_count
        ? true
        : row.negative_count > row.positive_count
          ? false
          : null;
    const isPositive = preference ?? fallbackPreference;

    if (isPositive == null) continue;

    const direction = isPositive ? "positive" : "negative";
    const weight = buildWeight(row, direction);
    const count = buildCount(row, direction);

    if (row.feature_type === "subgenre") {
      const target = isPositive
        ? feedback.preferSubgenres
        : feedback.avoidSubgenres;
      target.push({
        key: row.feature_name,
        weight,
        count,
      });
      continue;
    }

    const numericId = row.feature_id;
    if (!isFiniteNumber(numericId)) continue;

    const item = {
      id: numericId,
      name: row.feature_name,
      weight,
      count,
    };

    switch (row.feature_type) {
      case "actor":
        if (isPositive) feedback.preferActors.push(item);
        else feedback.avoidActors.push(item);
        break;
      case "keyword":
        if (isPositive) feedback.preferKeywords.push(item);
        else feedback.avoidKeywords.push(item);
        break;
      case "director":
        if (isPositive) feedback.preferDirectors.push(item);
        else feedback.avoidDirectors.push(item);
        break;
      case "genre":
        if (isPositive) feedback.preferGenres.push(item);
        else feedback.avoidGenres.push(item);
        break;
      // franchise/collection: only negative (avoid) preference is supported
      case "franchise":
      case "collection":
        if (!isPositive) {
          feedback.avoidFranchises.push(item);
        }
        break;
      default:
        break;
    }
  }

  feedback.avoidActors.sort((a, b) => b.weight - a.weight);
  feedback.avoidKeywords.sort((a, b) => b.weight - a.weight);
  feedback.avoidFranchises.sort((a, b) => b.weight - a.weight);
  feedback.avoidDirectors.sort((a, b) => b.weight - a.weight);
  feedback.avoidGenres.sort((a, b) => b.weight - a.weight);
  feedback.avoidSubgenres.sort((a, b) => b.weight - a.weight);
  feedback.preferActors.sort((a, b) => b.weight - a.weight);
  feedback.preferKeywords.sort((a, b) => b.weight - a.weight);
  feedback.preferDirectors.sort((a, b) => b.weight - a.weight);
  feedback.preferGenres.sort((a, b) => b.weight - a.weight);
  feedback.preferSubgenres.sort((a, b) => b.weight - a.weight);

  return feedback;
}

export function buildAdjacentGenreMap(
  rows: Array<{
    from_genre_name: string;
    to_genre_name: string;
    success_rate: number;
  }>,
): Map<string, Array<{ genre: string; weight: number }>> {
  const map = new Map<string, Array<{ genre: string; weight: number }>>();

  for (const row of rows) {
    if (!map.has(row.from_genre_name)) map.set(row.from_genre_name, []);
    map.get(row.from_genre_name)!.push({
      genre: row.to_genre_name,
      weight: row.success_rate,
    });
  }

  return map;
}

export async function loadUserContext(userId: string): Promise<UserContext> {
  try {
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
          "uri, title, year, rating, rewatch, last_date, watch_count, liked, on_watchlist",
        )
        .eq("user_id", userId)
        .order("last_date", { ascending: false, nullsFirst: false }),
      db.from("film_tmdb_map").select("uri, tmdb_id").eq("user_id", userId),
      db
        .from("user_feature_feedback")
        .select(
          "feature_id, feature_name, feature_type, inferred_preference, positive_count, negative_count",
        )
        .eq("user_id", userId),
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
        .gte(
          "exposed_at",
          new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
        ),
      db.from("blocked_suggestions").select("tmdb_id").eq("user_id", userId),
    ]);

    if (filmsResult.error)
      console.error("[ServerEngine] films error:", filmsResult.error);
    if (mappingsResult.error) {
      console.error("[ServerEngine] mappings error:", mappingsResult.error);
    }
    if (feedbackResult.error) {
      console.error("[ServerEngine] feedback error:", feedbackResult.error);
    }
    if (explorationResult.error) {
      console.error(
        "[ServerEngine] exploration error:",
        explorationResult.error,
      );
    }
    if (adjacentResult.error) {
      console.error(
        "[ServerEngine] adjacent genres error:",
        adjacentResult.error,
      );
    }
    if (exposuresResult.error) {
      console.error("[ServerEngine] exposures error:", exposuresResult.error);
    }
    if (blockedResult.error) {
      console.error(
        "[ServerEngine] blocked suggestions error:",
        blockedResult.error,
      );
    }

    const films = ((filmsResult.data ?? []) as FilmEventRow[]).map((row) => ({
      ...row,
      rating: row.rating ?? null,
      rewatch: row.rewatch ?? null,
      last_date: row.last_date ?? null,
      watch_count: row.watch_count ?? null,
      liked: row.liked ?? null,
      on_watchlist: row.on_watchlist ?? null,
    }));

    const mappingsArray = (mappingsResult.data ?? []) as FilmMappingRow[];
    const mappings = new Map<string, number>();
    for (const row of mappingsArray) {
      mappings.set(row.uri, row.tmdb_id);
    }

    return {
      films,
      mappings,
      mappingsArray,
      feedback: (feedbackResult.data ?? []) as FeatureFeedbackRow[],
      explorationRate:
        (
          (explorationResult.data ?? null) as {
            exploration_rate?: number;
          } | null
        )?.exploration_rate ?? 0.15,
      adjacentGenres: (adjacentResult.data ?? []) as AdjacentGenreRow[],
      recentExposures: buildExposureMap(
        (exposuresResult.data ?? []) as ExposureRow[],
      ),
      blockedIds: new Set(
        ((blockedResult.data ?? []) as BlockedSuggestionRow[]).map(
          (row) => row.tmdb_id,
        ),
      ),
    };
  } catch (error) {
    console.error("[ServerEngine] loadUserContext fatal error:", error);
    return {
      films: [],
      mappings: new Map<string, number>(),
      mappingsArray: [],
      feedback: [],
      explorationRate: 0.15,
      adjacentGenres: [],
      recentExposures: new Map<number, number>(),
      blockedIds: new Set<number>(),
    };
  }
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

    const { data: cachedRow, error: cacheError } = await db
      .from("user_taste_profile_cache")
      .select("profile, film_count, computed_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (cacheError) {
      console.error(
        "[ServerEngine] taste profile cache read error:",
        cacheError,
      );
    }

    const cache = (cachedRow ?? null) as CachedTasteProfileRow | null;
    if (cache) {
      const computedAtMs = new Date(cache.computed_at).getTime();
      const isFresh =
        !Number.isNaN(computedAtMs) &&
        Date.now() - computedAtMs < TASTE_CACHE_TTL_MS;
      const filmCountMatches = cache.film_count === currentFilmCount;

      if (isFresh && filmCountMatches) {
        return cache.profile;
      }
    }

    const relevantTmdbIds = getRelevantTasteTmdbIds(userContext);
    const cachedTmdbDetails = await loadCachedTmdbDetails(relevantTmdbIds);
    const tmdbDetailsMap = await ensureCompleteTmdbDetails(
      relevantTmdbIds,
      cachedTmdbDetails,
    );

    const tasteProfile = await buildTasteProfile({
      films: buildTasteProfileFilms(userContext.films),
      mappings: userContext.mappings,
      tmdbDetails: tmdbDetailsMap,
      negativeFeedbackIds: Array.from(userContext.blockedIds),
      watchlistFilms: userContext.films
        .filter((film) => film.on_watchlist)
        .map((film) => ({
          uri: film.uri,
          watchlistAddedAt: film.last_date ?? undefined,
        })),
      userId,
    });

    const { error: upsertError } = await db
      .from("user_taste_profile_cache")
      .upsert(
        {
          user_id: userId,
          profile: tasteProfile,
          film_count: currentFilmCount,
          computed_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

    if (upsertError) {
      console.error(
        "[ServerEngine] taste profile cache upsert error:",
        upsertError,
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
  seedTmdbIds: number[] = [],
): Promise<{ candidateIds: number[]; sourceMetadata: SourceMetadata }> {
  console.log("[ServerEngine] generateServerCandidates", {
    userId,
    seedCount: seedTmdbIds.length,
  });

  const sourceMetadata: SourceMetadata = new Map();
  const candidateOrder: number[] = [];
  const candidateSet = new Set<number>();
  const seenIds = new Set<number>([
    ...Array.from(userContext.mappings.values()),
    ...Array.from(userContext.blockedIds.values()),
  ]);

  // Seeds are explicitly allowed through the seenIds filter — they serve as discovery anchors.
  // The downstream ranking engine and/or API consumer should strip them before final display
  // if the user has already watched the seeded film.
  for (const tmdbId of seedTmdbIds) {
    if (userContext.blockedIds.has(tmdbId)) continue;
    addCandidateSource(
      sourceMetadata,
      candidateOrder,
      candidateSet,
      tmdbId,
      "seed",
      {
        allowSeen: true,
      },
    );
  }

  const topSeedTmdbIds = getTopSeedTmdbIds(userContext, 8);
  const discoverGenreIds = tasteProfile.topGenres
    .slice(0, 3)
    .map((genre) => genre.id);

  const requests: Array<Promise<{ source: string; ids: number[] }>> = [
    fetchTmdb<TmdbListResult>("/trending/movie/day")
      .then((result) => ({
        source: "trending-day",
        ids: (result.results ?? []).map((movie) => movie.id),
      }))
      .catch((error) => {
        console.error("[ServerEngine] trending/day error:", error);
        return { source: "trending-day", ids: [] };
      }),
    fetchTmdb<TmdbListResult>("/trending/movie/week")
      .then((result) => ({
        source: "trending-week",
        ids: (result.results ?? []).map((movie) => movie.id),
      }))
      .catch((error) => {
        console.error("[ServerEngine] trending/week error:", error);
        return { source: "trending-week", ids: [] };
      }),
  ];

  if (discoverGenreIds.length > 0) {
    requests.push(
      fetchTmdb<TmdbListResult>("/discover/movie", {
        with_genres: discoverGenreIds.join("|"),
        include_adult: "false",
        sort_by: "popularity.desc",
        "vote_count.gte": 150,
        page: 1,
      })
        .then((result) => ({
          source: "discover-top-genres",
          ids: (result.results ?? []).map((movie) => movie.id),
        }))
        .catch((error) => {
          console.error("[ServerEngine] discover error:", error);
          return { source: "discover-top-genres", ids: [] };
        }),
    );
  }

  for (const tmdbId of topSeedTmdbIds) {
    requests.push(
      fetchTmdb<TmdbListResult>(`/movie/${tmdbId}/similar`, { page: 1 })
        .then((result) => ({
          source: `similar:${tmdbId}`,
          ids: (result.results ?? []).map((movie) => movie.id),
        }))
        .catch((error) => {
          console.error("[ServerEngine] similar fetch error:", {
            tmdbId,
            error,
          });
          return { source: `similar:${tmdbId}`, ids: [] };
        }),
    );
  }

  const settled = await Promise.allSettled(requests);

  for (const result of settled) {
    if (result.status === "rejected") {
      console.error("[ServerEngine] candidate source failed:", result.reason);
      continue;
    }

    for (const tmdbId of result.value.ids) {
      if (userContext.blockedIds.has(tmdbId)) continue;
      addCandidateSource(
        sourceMetadata,
        candidateOrder,
        candidateSet,
        tmdbId,
        result.value.source,
        { seenIds },
      );
    }
  }

  const orderedCandidates = [...candidateOrder].sort((left, right) => {
    const leftMeta = sourceMetadata.get(left);
    const rightMeta = sourceMetadata.get(right);
    const leftSeedBoost = leftMeta?.sources.includes("seed") ? 100 : 0;
    const rightSeedBoost = rightMeta?.sources.includes("seed") ? 100 : 0;
    const leftScore = (leftMeta?.sources.length ?? 0) + leftSeedBoost;
    const rightScore = (rightMeta?.sources.length ?? 0) + rightSeedBoost;

    return rightScore - leftScore;
  });

  return {
    candidateIds: orderedCandidates,
    sourceMetadata,
  };
}

export type { FeatureFeedback, SourceMetadata, TasteProfile, UserContext };
