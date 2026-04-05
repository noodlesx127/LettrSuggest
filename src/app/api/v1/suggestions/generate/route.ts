import { NextResponse } from "next/server";

import {
  applyAdvancedFiltering,
  applyNegativeFiltering,
} from "@/lib/advancedFiltering";
import { suggestByOverlap } from "@/lib/enrich";
import type { TMDBMovie } from "@/lib/enrich";
import type { EnhancedTasteProfile } from "@/lib/enhancedProfile";
import { TMDB_GENRE_MAP } from "@/lib/genreEnhancement";
import {
  buildAdjacentGenreMap,
  buildFeatureFeedbackFromRows,
  buildTasteProfileServer,
  generateServerCandidates,
  loadCachedTmdbDetails,
  loadUserContext,
} from "@/lib/serverSuggestionsEngine";

import { withApiAuth } from "../../_lib/apiKeyAuth";
import { isRecord } from "../../_lib/pagination";
import { ApiError, generateRequestId } from "../../_lib/responseEnvelope";

interface GenerateSuggestionsBody {
  seed_tmdb_ids: number[];
  limit: number;
  exclude_tmdb_ids: number[];
  genre_ids?: number[];
  debug?: boolean;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parsePositiveIntegerArray(
  value: unknown,
  fieldName: string,
  options?: { required?: boolean; maxItems?: number },
): number[] {
  if (value === undefined) {
    if (options?.required) {
      throw new ApiError(400, "BAD_REQUEST", `${fieldName} is required`);
    }

    return [];
  }

  if (!Array.isArray(value)) {
    throw new ApiError(400, "BAD_REQUEST", `${fieldName} must be an array`);
  }

  if (options?.required && value.length === 0) {
    throw new ApiError(400, "BAD_REQUEST", `${fieldName} must not be empty`);
  }

  if (options?.maxItems !== undefined && value.length > options.maxItems) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      `${fieldName} must contain at most ${options.maxItems} items`,
    );
  }

  if (!value.every(isPositiveInteger)) {
    throw new ApiError(
      400,
      "BAD_REQUEST",
      `${fieldName} must contain only positive integers`,
    );
  }

  return [...new Set(value)];
}

function parseLimit(value: unknown): number {
  if (value === undefined) {
    return 25;
  }

  if (!isPositiveInteger(value)) {
    throw new ApiError(400, "BAD_REQUEST", "limit must be a positive integer");
  }

  return Math.min(value, 50);
}

async function parseGenerateSuggestionsBody(
  req: Request,
): Promise<GenerateSuggestionsBody> {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "Invalid JSON body");
  }

  if (!isRecord(body) || Array.isArray(body)) {
    throw new ApiError(400, "BAD_REQUEST", "Request body must be an object");
  }

  const debug = typeof body.debug === "boolean" ? body.debug : false;

  return {
    seed_tmdb_ids: parsePositiveIntegerArray(
      body.seed_tmdb_ids,
      "seed_tmdb_ids",
      {
        required: false,
        maxItems: 15,
      },
    ),
    limit: parseLimit(body.limit),
    exclude_tmdb_ids: parsePositiveIntegerArray(
      body.exclude_tmdb_ids,
      "exclude_tmdb_ids",
      { maxItems: 500 },
    ),
    genre_ids:
      body.genre_ids !== undefined
        ? parsePositiveIntegerArray(body.genre_ids, "genre_ids", {
            maxItems: 5,
          })
        : undefined,
    debug,
  };
}

function buildMinimalEnhancedTasteProfile(params: {
  tasteProfile: Awaited<ReturnType<typeof buildTasteProfileServer>>;
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
  item: {
    tmdbId: number;
    title?: string;
    genres?: string[];
  },
  tmdbDetailsCache: Map<number, TMDBMovie>,
): TMDBMovie {
  const cachedMovie = tmdbDetailsCache.get(item.tmdbId);

  if (cachedMovie) {
    return cachedMovie;
  }

  return {
    id: item.tmdbId,
    title: item.title ?? "",
    genres: (item.genres ?? []).map((genreName) => ({
      id: 0,
      name: genreName,
    })),
    keywords: { results: [] },
  };
}

export async function POST(req: Request) {
  return withApiAuth(req, async (auth) => {
    try {
      const requestId = generateRequestId();
      const body = await parseGenerateSuggestionsBody(req);
      const { debug } = body;

      console.log("[v1/suggestions/generate] Starting generation", {
        requestId,
        userId: auth.userId,
        hasSeedBias: body.seed_tmdb_ids.length > 0,
        excludeCount: body.exclude_tmdb_ids.length,
        limit: body.limit,
      });

      const userContext = await loadUserContext(auth.userId);
      const tasteProfile = await buildTasteProfileServer(
        auth.userId,
        userContext,
      );
      const { candidateIds, sourceMetadata } = await generateServerCandidates(
        auth.userId,
        userContext,
        tasteProfile,
        body.seed_tmdb_ids,
      );

      const excludeSet = new Set([
        ...body.exclude_tmdb_ids,
        ...Array.from(userContext.blockedIds),
      ]);
      const filteredCandidates = candidateIds.filter(
        (id) => !excludeSet.has(id),
      );

      // Batch pre-load TMDB details for candidates + user's mapped films to avoid N+1 fetches
      // Covers: candidate scoring loop, subgenre analysis loop, liked/disliked movie fetches
      const allIdsToCache = [
        ...new Set([
          ...filteredCandidates,
          ...Array.from(userContext.mappings.values()),
        ]),
      ];
      const candidateTmdbCache = await loadCachedTmdbDetails(allIdsToCache);

      if (filteredCandidates.length === 0) {
        const warning =
          candidateIds.length === 0
            ? "no_candidates_generated"
            : "all_candidates_excluded";

        console.warn("[v1/suggestions/generate] No candidates available", {
          requestId,
          candidateIds: candidateIds.length,
          warning,
        });

        return NextResponse.json({
          data: [],
          meta: {
            timestamp: new Date().toISOString(),
            requestId,
            seed_count: body.seed_tmdb_ids.length,
            result_count: 0,
            candidate_count: 0,
            engine: "personalized",
            warning,
          },
          error: null,
        });
      }

      const adjacentGenresMap = buildAdjacentGenreMap(
        userContext.adjacentGenres,
      );
      const enhancedProfile = {
        topActors: tasteProfile.topActors ?? [],
        topStudios: tasteProfile.topStudios ?? [],
        topKeywords: tasteProfile.topKeywords,
        topCountries: tasteProfile.topCountries,
        topLanguages: tasteProfile.topLanguages,
        avoidGenres: tasteProfile.avoidGenres ?? [],
        avoidKeywords: tasteProfile.avoidKeywords ?? [],
        avoidDirectors: tasteProfile.avoidDirectors ?? [],
        preferredSubgenreKeywordIds:
          tasteProfile.preferredSubgenreKeywordIds ?? [],
        topDecades: tasteProfile.topDecades,
        adjacentGenres: adjacentGenresMap,
        watchlistGenres: (tasteProfile.watchlistGenres ?? []).map(
          (genre: { name: string }) => genre.name,
        ),
        watchlistKeywords: (tasteProfile.watchlistKeywords ?? []).map(
          (keyword: { name: string }) => keyword.name,
        ),
        watchlistDirectors: (tasteProfile.watchlistDirectors ?? []).map(
          (director: { name: string }) => director.name,
        ),
      };

      const featureFeedback = buildFeatureFeedbackFromRows(
        userContext.feedback,
      );

      const watchlistEntries = userContext.films
        .filter((film) => film.on_watchlist)
        .map((film) => ({
          tmdbId: userContext.mappings.get(film.uri),
          addedAt: film.last_date ?? null,
        }))
        .filter(
          (
            entry,
          ): entry is {
            tmdbId: number;
            addedAt: string | null;
          } => typeof entry.tmdbId === "number" && entry.tmdbId > 0,
        );

      const liteFilms = userContext.films.map((film) => ({
        uri: film.uri,
        title: film.title,
        year: film.year,
        ...(film.rating != null ? { rating: film.rating } : {}),
        ...(film.liked != null ? { liked: film.liked } : {}),
      }));

      const minimalEnhancedProfile = buildMinimalEnhancedTasteProfile({
        tasteProfile,
        watchedFilms: userContext.films.map((film) => ({
          rating: film.rating ?? undefined,
          liked: film.liked,
        })),
      });

      const explorationRate = Number.isFinite(userContext.explorationRate)
        ? userContext.explorationRate
        : 0.15;
      const mmrLambda = Math.max(
        0.3,
        Math.min(0.7, 0.3 + (explorationRate / 0.3) * 0.4),
      );

      const scored = await suggestByOverlap({
        userId: auth.userId,
        films: liteFilms,
        mappings: userContext.mappings,
        candidates: filteredCandidates,
        maxCandidates: Math.min(filteredCandidates.length, 1200),
        concurrency: 6,
        excludeWatchedIds: new Set(userContext.mappings.values()),
        desiredResults: Math.min(body.limit * 4, 200),
        sourceMetadata,
        mmrLambda,
        mmrTopKFactor: 2.5,
        featureFeedback,
        watchlistEntries,
        context: {
          mode: "background" as const,
          localHour: null,
        },
        recentExposures: userContext.recentExposures,
        enhancedProfile,
        tmdbDetailsCache: candidateTmdbCache,
      });

      // Apply a minimum score to candidates that arrived ONLY via genre discovery
      // (no seed-similar or trending backing). Prevents low-relevance genre matches
      // like "A Dog's Will" from passing through in default (no genre filter) runs.
      const MIN_DISCOVERY_SCORE = 15.0;
      const qualityFiltered = scored.filter((item) => {
        const meta = sourceMetadata.get(item.tmdbId);
        if (!meta) return true; // No metadata — pass through conservatively

        const isDiscoveryOnly = meta.sources.every(
          (s) => s === "discover-top-genres",
        );
        return isDiscoveryOnly ? item.score >= MIN_DISCOVERY_SCORE : true;
      });

      // Apply genre filter if requested — filter before slicing to limit
      let genreFiltered = qualityFiltered;
      if (body.genre_ids?.length) {
        const filtered = qualityFiltered.filter((item) => {
          const itemGenres = (item.genres ?? []).map((g: string) =>
            g.toLowerCase(),
          );
          return body.genre_ids!.some((gid) => {
            const canonicalName = TMDB_GENRE_MAP[gid]?.toLowerCase();
            return canonicalName ? itemGenres.includes(canonicalName) : false;
          });
        });

        if (filtered.length > 0) {
          genreFiltered = filtered;
        } else {
          console.warn(
            "[GenreFilter] Genre filter removed all results, returning unfiltered",
          );
        }
      }

      // Apply minimum score threshold when genre filter is active.
      // Prevents low-relevance genre-discovery candidates from padding filtered results.
      // Threshold of 15 is calibrated from live data: legitimate matches score 19+,
      // filler films (no taste connection beyond genre tag) score 8–14.
      if (body.genre_ids?.length && genreFiltered !== qualityFiltered) {
        const MIN_GENRE_SCORE = 15.0;
        const thresholded = genreFiltered.filter(
          (item) => item.score >= MIN_GENRE_SCORE,
        );
        // Only apply if threshold leaves at least 3 results — prevents empty responses
        if (thresholded.length >= 3) {
          genreFiltered = thresholded;
        } else {
          console.warn(
            `[GenreFilter] Score threshold would leave ${thresholded.length} results — skipping threshold`,
          );
        }
      }

      const personalizationFiltered = genreFiltered.filter((item) => {
        const candidate = buildFilteringCandidate(item, candidateTmdbCache);

        const negativeFilter = applyNegativeFiltering(
          candidate,
          minimalEnhancedProfile,
        );
        if (negativeFilter.shouldFilter) {
          return false;
        }

        const advancedFilter = applyAdvancedFiltering(
          candidate,
          minimalEnhancedProfile,
          featureFeedback.preferSubgenres,
        );

        return !advancedFilter.shouldFilter;
      });

      // Debug: summarize candidate counts by source
      const sourceDebugSummary = debug
        ? (() => {
            const counts: Record<string, number> = {};
            for (const [, meta] of sourceMetadata.entries()) {
              for (const source of meta.sources) {
                counts[source] = (counts[source] ?? 0) + 1;
              }
            }
            return counts;
          })()
        : undefined;

      const data = personalizationFiltered.slice(0, body.limit).map((item) => ({
        tmdb_id: item.tmdbId,
        title: item.title ?? "",
        score: Math.round(item.score * 1000) / 1000,
        consensus_level: item.consensusLevel ?? "low",
        sources: (
          sourceMetadata.get(item.tmdbId)?.sources ??
          item.sources ??
          []
        ).map((source: string) => ({ source, confidence: 1.0 })),
        reasons: item.reasons ?? [],
        genres: item.genres ?? [],
        year: item.release_date?.slice(0, 4) ?? null,
        poster_path: item.poster_path ?? null,
        vote_category: item.voteCategory ?? null,
      }));

      console.log("[v1/suggestions/generate] Generation completed", {
        requestId,
        candidateCount: filteredCandidates.length,
        requestedLimit: body.limit,
        resultCount: data.length,
      });

      return NextResponse.json({
        data,
        meta: {
          timestamp: new Date().toISOString(),
          requestId,
          seed_count: body.seed_tmdb_ids.length,
          result_count: data.length,
          candidate_count: filteredCandidates.length,
          engine: "personalized",
          ...(debug
            ? {
                source_candidate_counts: sourceDebugSummary,
                seeds_used: body.seed_tmdb_ids,
                genre_filter_applied: body.genre_ids?.length
                  ? body.genre_ids
                  : null,
                candidates_before_genre_filter: scored.length,
                candidates_after_genre_filter: genreFiltered.length,
                candidates_after_personalization_filter:
                  personalizationFiltered.length,
              }
            : {}),
        },
        error: null,
      });
    } catch (error) {
      console.error("[v1/suggestions/generate] Error:", error);

      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
