import { NextResponse } from "next/server";

import {
  applyNegativeFiltering,
  filterCandidatesByGenre,
  type FilterRelaxation,
} from "@/lib/advancedFiltering";
import { suggestByOverlap } from "@/lib/enrich";
import type { TMDBMovie } from "@/lib/enrich";
import type { EnhancedTasteProfile } from "@/lib/enhancedProfile";
import { TMDB_GENRE_MAP } from "@/lib/genreEnhancement";
import {
  adaptCanonicalResultToV1,
  adaptV1RecommendationIntent,
  type V1RecommendationDetails,
} from "@/lib/recommendationAdapters";
import { createDeterministicRng } from "@/lib/recommendationCandidates";
import { loadRecommendationContext } from "@/lib/recommendationContext";
import {
  buildAdjacentGenreMap,
  buildFeatureFeedbackFromRows,
  buildTasteProfileServer,
  generateServerCandidates,
  getUserContextDiagnostics,
  loadCachedTmdbDetails,
  loadUserContext,
  runCanonicalServerRecommendations,
} from "@/lib/serverSuggestionsEngine";
import {
  buildBlockedSourceFailureResponse,
  buildGenerationDiagnostics,
  deriveGenerateRequestSeed,
  filterGeneratedCandidateIds,
  validateFilterRelaxationRequest,
} from "@/app/api/v1/suggestions/generate/routeHelpers";

import { withApiAuth } from "../../_lib/apiKeyAuth";
import { isRecord } from "../../_lib/pagination";
import { ApiError, generateRequestId } from "../../_lib/responseEnvelope";

interface GenerateSuggestionsBody {
  seed_tmdb_ids: number[];
  limit: number;
  exclude_tmdb_ids: number[];
  genre_ids?: number[];
  filter_relaxation?: FilterRelaxation;
  debug: boolean;
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

function parseFilterRelaxation(value: unknown): FilterRelaxation | undefined {
  if (value === undefined) return undefined;
  if (value === "threshold" || value === "genre") return value;

  throw new ApiError(
    400,
    "BAD_REQUEST",
    'filter_relaxation must be either "threshold" or "genre"',
  );
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
    filter_relaxation: parseFilterRelaxation(body.filter_relaxation),
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
      const filterRelaxationValidation = validateFilterRelaxationRequest({
        genreIds: body.genre_ids,
        filterRelaxation: body.filter_relaxation,
      });
      if (!filterRelaxationValidation.valid) {
        throw new ApiError(
          400,
          "BAD_REQUEST",
          filterRelaxationValidation.message,
        );
      }
      const requestSeed = deriveGenerateRequestSeed({
        userId: auth.userId,
        seedTmdbIds: body.seed_tmdb_ids,
        limit: body.limit,
        excludeTmdbIds: body.exclude_tmdb_ids,
        genreIds: body.genre_ids,
        filterRelaxation: body.filter_relaxation,
      });

      console.log("[v1/suggestions/generate] Starting generation", {
        requestId,
        userId: auth.userId,
        hasSeedBias: body.seed_tmdb_ids.length > 0,
        excludeCount: body.exclude_tmdb_ids.length,
        limit: body.limit,
      });

      const userContext = await loadUserContext(auth.userId);
      const generationDiagnostics = buildGenerationDiagnostics({
        context: getUserContextDiagnostics(userContext),
        requestSeed,
        contextMode: "neutral",
      });
      const blockedSourceFailure = buildBlockedSourceFailureResponse(
        generationDiagnostics,
        {
          timestamp: new Date().toISOString(),
          requestId,
        },
      );
      if (blockedSourceFailure) {
        return NextResponse.json(
          blockedSourceFailure.body,
          { status: blockedSourceFailure.status },
        );
      }

      const adaptedIntent = adaptV1RecommendationIntent({
        userId: auth.userId,
        seedTmdbIds: body.seed_tmdb_ids,
        limit: body.limit,
        excludeTmdbIds: body.exclude_tmdb_ids,
        genreIds: body.genre_ids,
        genreNames:
          body.genre_ids?.map(
            (genreId) => TMDB_GENRE_MAP[genreId] ?? `unknown:${genreId}`,
          ) ?? [],
        filterRelaxation: body.filter_relaxation,
        debug,
        requestSeed,
      });
      const canonicalContext = await loadRecommendationContext(
        { loadUserContext: async () => userContext },
        auth.userId,
      );

      const tasteProfile = await buildTasteProfileServer(
        auth.userId,
        userContext,
      );
      const { candidateIds, sourceMetadata } = await generateServerCandidates(
        auth.userId,
        userContext,
        tasteProfile,
        body.seed_tmdb_ids,
        { requestSeed },
      );

      const filteredCandidates = filterGeneratedCandidateIds({
        candidateIds,
        seedTmdbIds: body.seed_tmdb_ids,
        excludeTmdbIds: body.exclude_tmdb_ids,
        blockedIds: userContext.blockedIds,
      });

      // Batch pre-load TMDB details for candidates + user's mapped films to avoid N+1 fetches
      // Covers: candidate scoring loop, subgenre analysis loop, liked/disliked movie fetches
      const allIdsToCache = [
        ...new Set([
          ...filteredCandidates,
          ...Array.from(userContext.mappings.values()),
        ]),
      ];
      const candidateTmdbCache = await loadCachedTmdbDetails(allIdsToCache);

      const warning =
        filteredCandidates.length === 0
          ? candidateIds.length === 0
            ? "no_candidates_generated"
            : "all_candidates_excluded"
          : undefined;
      if (warning) {
        console.warn("[v1/suggestions/generate] No candidates available", {
          requestId,
          candidateIds: candidateIds.length,
          warning,
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
        ...(film.last_date != null ? { lastDate: film.last_date } : {}),
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
          mode: "neutral" as const,
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

      // suggestByOverlap owns scoring-stage boosts and post-score ordering;
      // apply only the route's canonical negative eligibility filter here.
      const personalizationCandidates = qualityFiltered.filter((item) => {
        const candidate = buildFilteringCandidate(item, candidateTmdbCache);
        return !applyNegativeFiltering(candidate, minimalEnhancedProfile)
          .shouldFilter;
      });

      const genreFilterResult = filterCandidatesByGenre(
        personalizationCandidates,
        {
          requestedGenreNames:
            body.genre_ids?.map(
              (genreId) => TMDB_GENRE_MAP[genreId] ?? `unknown:${genreId}`,
            ) ?? [],
          requestedCount: body.limit,
          filterRelaxation: body.filter_relaxation,
        },
      );
      const personalizationFiltered = genreFilterResult.candidates;
      const filterDiagnostics = {
        reasons: [...genreFilterResult.diagnostics.reasons],
        applied_stages: [...genreFilterResult.diagnostics.appliedStages],
        strict_count: genreFilterResult.diagnostics.strictCount,
        threshold_count: genreFilterResult.diagnostics.thresholdCount,
        genre_count: genreFilterResult.diagnostics.genreCount,
      };

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

      const richCandidates = new Map(
        personalizationFiltered.map((item) => [item.tmdbId, item]),
      );
      const canonicalResult = await runCanonicalServerRecommendations(
        adaptedIntent.request,
        {
          loadContext: async () => canonicalContext,
          retrieveCandidates: async () =>
            personalizationFiltered.map((item) => ({ tmdbId: item.tmdbId })),
          scoreCandidates: async ({ candidates }) =>
            candidates.map(({ tmdbId }) => {
              const item = richCandidates.get(tmdbId);
              if (!item) {
                throw new Error("Missing scored v1 recommendation candidate");
              }
              const providerFamilies =
                sourceMetadata.get(tmdbId)?.sources ??
                item.sources ??
                ["overlap"];
              return {
                tmdbId,
                score: item.score,
                evidence: {
                  seedAnchors: [...body.seed_tmdb_ids],
                  providerFamilies: [...providerFamilies],
                  providerOccurrences: providerFamilies.length,
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
            }),
          rerankCandidates: async ({ candidates }) => candidates,
          rng: createDeterministicRng,
          telemetry: () => undefined,
        },
      );
      const responseDetails = new Map<number, V1RecommendationDetails>(
        personalizationFiltered.map((item) => [
          item.tmdbId,
          {
            title: item.title,
            consensusLevel: item.consensusLevel,
            sources:
              sourceMetadata.get(item.tmdbId)?.sources ?? item.sources ?? [],
            reasons: item.reasons,
            genres: item.genres,
            releaseDate: item.release_date,
            posterPath: item.poster_path,
            voteCategory: item.voteCategory,
          },
        ]),
      );
      const adaptedResult = adaptCanonicalResultToV1(
        canonicalResult,
        responseDetails,
      );
      const data = adaptedResult.data;

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
           ...generationDiagnostics,
           ...adaptedResult.meta,
           filter_diagnostics: filterDiagnostics,
           ...(warning ? { warning } : {}),
           ...(debug
             ? {
                 source_candidate_counts: sourceDebugSummary,
                 seeds_used: body.seed_tmdb_ids,
                 genre_filter_applied: body.genre_ids?.length
                   ? body.genre_ids
                   : null,
                 candidates_before_genre_filter: scored.length,
                 candidates_after_genre_filter: personalizationFiltered.length,
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
