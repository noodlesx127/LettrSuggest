import { NextResponse } from "next/server";

import { suggestByOverlap } from "@/lib/enrich";
import {
  buildAdjacentGenreMap,
  buildFeatureFeedbackFromRows,
  buildTasteProfileServer,
  generateServerCandidates,
  loadUserContext,
} from "@/lib/serverSuggestionsEngine";

import { withApiAuth } from "../../_lib/apiKeyAuth";
import { isRecord } from "../../_lib/pagination";
import { ApiError, generateRequestId } from "../../_lib/responseEnvelope";

interface GenerateSuggestionsBody {
  seed_tmdb_ids: number[];
  limit: number;
  exclude_tmdb_ids: number[];
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
  };
}

export async function POST(req: Request) {
  return withApiAuth(req, async (auth) => {
    try {
      const requestId = generateRequestId();
      const body = await parseGenerateSuggestionsBody(req);

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
      });

      const data = scored.slice(0, body.limit).map((item) => ({
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
