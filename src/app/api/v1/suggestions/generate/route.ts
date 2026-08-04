import { NextResponse } from "next/server";

import type { FilterRelaxation } from "@/lib/advancedFiltering";
import { suggestByOverlap } from "@/lib/enrich";
import { TMDB_GENRE_MAP } from "@/lib/genreEnhancement";
import { adaptCanonicalResultToV1 } from "@/lib/recommendationAdapters";
import {
  createLazyExposureWriter,
  deriveAppliedRelaxation,
  recordRecommendationExposures,
} from "@/lib/recommendationTelemetry";
import { createDeterministicRng } from "@/lib/recommendationCandidates";
import { loadRecommendationContext } from "@/lib/recommendationContext";
import {
  buildV1RecommendationDependencies,
  runV1RecommendationGeneration,
} from "@/lib/recommendationGeneration";
import {
  buildTasteProfileServer,
  generateServerCandidates,
  getUserContextDiagnostics,
  loadCachedTmdbDetails,
  loadUserContext,
} from "@/lib/serverSuggestionsEngine";
import {
  buildBlockedSourceFailureResponse,
  buildGenerationDiagnostics,
  deriveGenerateRequestSeed,
  validateFilterRelaxationRequest,
} from "@/app/api/v1/suggestions/generate/routeHelpers";

import { withApiAuth } from "../../_lib/apiKeyAuth";
import { isRecord } from "../../_lib/pagination";
import { ApiError, generateRequestId } from "../../_lib/responseEnvelope";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin";

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

      const v1Intent = {
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
      } as const;
      const canonicalContext = await loadRecommendationContext(
        { loadUserContext: async () => userContext },
        auth.userId,
      );

      const tasteProfile = await buildTasteProfileServer(
        auth.userId,
        userContext,
      );
      const preparation = await buildV1RecommendationDependencies({
        intent: v1Intent,
        context: canonicalContext,
        userContext,
        tasteProfile,
        retrieveCandidates: ({
          userId,
          userContext: retrievalUserContext,
          tasteProfile: retrievalTasteProfile,
          seeds,
          requestSeed: retrievalRequestSeed,
        }) =>
          generateServerCandidates(
            userId,
            retrievalUserContext,
            retrievalTasteProfile,
            seeds,
            { requestSeed: retrievalRequestSeed },
          ),
        loadCachedDetails: loadCachedTmdbDetails,
        scoreCandidates: suggestByOverlap,
        rng: createDeterministicRng,
        telemetry: () => undefined,
      });
      const { filterDiagnostics, warning } = preparation;
      if (warning) {
        console.warn("[v1/suggestions/generate] No candidates available", {
          requestId,
          candidateIds: preparation.candidateIds.length,
          warning,
        });
      }
      const canonicalResult = await runV1RecommendationGeneration(
        v1Intent,
        preparation.dependencies,
      );
      const adaptedResult = adaptCanonicalResultToV1(
        canonicalResult,
        preparation.responseDetails,
        {
          relaxation: deriveAppliedRelaxation(
            filterDiagnostics.applied_stages,
          ),
          inputRevisionMaterial: canonicalContext.revisionMaterial,
        },
      );
      const data = adaptedResult.data;

      // Record bounded versioned exposures for the final adapted output through
      // the single telemetry sink. Ownership is the authenticated request user;
      // the lazy service-role writer keeps client construction inside the
      // sink's fail-safe boundary, and the sink never throws into the route.
      // Pre-ranks come from the engine's canonical scoring-before-rerank map.
      await recordRecommendationExposures({
        userId: auth.userId,
        trace: adaptedResult.meta.trace,
        orderedTmdbIds: data.map((item) => item.tmdb_id),
        preRanksById: canonicalResult.preRanksById,
        providerFamiliesByTmdbId: new Map(
          canonicalResult.results.map((candidate) => [
            candidate.tmdbId,
            candidate.evidence.providerFamilies,
          ]),
        ),
        writer: createLazyExposureWriter(() => getSupabaseAdmin()),
      });

      console.log("[v1/suggestions/generate] Generation completed", {
        requestId,
        candidateCount: preparation.filteredCandidateIds.length,
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
            candidate_count: preparation.filteredCandidateIds.length,
           engine: "personalized",
           ...generationDiagnostics,
           ...adaptedResult.meta,
           filter_diagnostics: filterDiagnostics,
           ...(warning ? { warning } : {}),
           ...(debug
             ? {
                  source_candidate_counts: preparation.sourceCandidateCounts,
                 seeds_used: body.seed_tmdb_ids,
                 genre_filter_applied: body.genre_ids?.length
                   ? body.genre_ids
                   : null,
                  candidates_before_genre_filter:
                    preparation.scoredCandidates.length,
                  candidates_after_genre_filter:
                    preparation.personalizationFiltered.length,
                  candidates_after_personalization_filter:
                    preparation.personalizationFiltered.length,
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
