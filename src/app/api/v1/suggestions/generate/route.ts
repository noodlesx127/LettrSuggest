import { NextResponse } from "next/server";

import { aggregateRecommendations } from "@/lib/recommendationAggregator";

import { withApiAuth } from "../../_lib/apiKeyAuth";
import { isRecord } from "../../_lib/pagination";
import { ApiError, generateRequestId } from "../../_lib/responseEnvelope";
import { fetchTmdb } from "../../_lib/tmdb";

interface GenerateSuggestionsBody {
  seed_tmdb_ids: number[];
  limit: number;
  exclude_tmdb_ids: number[];
}

interface ResolvedSeedMovie {
  tmdbId: number;
  title: string;
  imdbId?: string;
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
        required: true,
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

async function resolveSeedMovie(tmdbId: number): Promise<ResolvedSeedMovie> {
  const movie = await fetchTmdb<Record<string, unknown>>(`/movie/${tmdbId}`);

  if (typeof movie.title !== "string" || movie.title.trim() === "") {
    throw new ApiError(
      422,
      "UNPROCESSABLE_ENTITY",
      `TMDB movie ${tmdbId} is missing a valid title`,
    );
  }

  const imdbId = typeof movie.imdb_id === "string" ? movie.imdb_id : undefined;

  return {
    tmdbId,
    title: movie.title.trim(),
    ...(imdbId ? { imdbId } : {}),
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
        seedCount: body.seed_tmdb_ids.length,
        excludeCount: body.exclude_tmdb_ids.length,
        limit: body.limit,
      });

      const resolvedSeedResults = await Promise.allSettled(
        body.seed_tmdb_ids.map((tmdbId) => resolveSeedMovie(tmdbId)),
      );

      const seedMovies = resolvedSeedResults.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );

      const failedSeedIds = resolvedSeedResults.flatMap((result, index) =>
        result.status === "rejected" ? [body.seed_tmdb_ids[index]] : [],
      );

      console.log("[v1/suggestions/generate] Seed resolution completed", {
        requestId,
        resolvedCount: seedMovies.length,
        failedCount: failedSeedIds.length,
        failedSeedIds,
      });

      if (seedMovies.length === 0) {
        throw new ApiError(
          422,
          "UNPROCESSABLE_ENTITY",
          "None of the provided seed_tmdb_ids could be resolved",
        );
      }

      const excludeSet = new Set(body.exclude_tmdb_ids);
      const seedSet = new Set(body.seed_tmdb_ids);
      const internalLimit = Math.min(body.limit + excludeSet.size + 20, 200);

      const recommendations = await aggregateRecommendations({
        seedMovies,
        limit: internalLimit,
      });

      const data = recommendations
        .filter(
          (recommendation) =>
            !excludeSet.has(recommendation.tmdbId) &&
            !seedSet.has(recommendation.tmdbId),
        )
        .slice(0, body.limit)
        .map((recommendation) => ({
          tmdb_id: recommendation.tmdbId,
          title: recommendation.title,
          score: Math.round(recommendation.score * 1000) / 1000,
          consensus_level: recommendation.consensusLevel,
          sources: recommendation.sources.map((source) => ({
            source: source.source,
            confidence: source.confidence,
            ...(source.reason ? { reason: source.reason } : {}),
          })),
        }));

      console.log("[v1/suggestions/generate] Generation completed", {
        requestId,
        requestedLimit: body.limit,
        internalLimit,
        resultCount: data.length,
      });

      return NextResponse.json({
        data,
        meta: {
          timestamp: new Date().toISOString(),
          requestId,
          seed_count: seedMovies.length,
          result_count: data.length,
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
