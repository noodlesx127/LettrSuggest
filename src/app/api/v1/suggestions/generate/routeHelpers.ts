import {
  RECOMMENDATION_ENGINE_VERSION,
  USER_CONTEXT_SOURCE_NAMES,
  type UserContextDiagnostics,
  type UserContextSourceHealth,
  type UserContextSourceName,
} from "@/lib/serverSuggestionsEngine";
import { decideRecommendationInputPreflight } from "@/lib/recommendationTypes";
import type { FilterRelaxation } from "@/lib/advancedFiltering";

type GenerateRequestSeedInput = {
  userId: string;
  seedTmdbIds: readonly number[];
  limit: number;
  excludeTmdbIds: readonly number[];
  genreIds?: readonly number[];
  filterRelaxation?: FilterRelaxation;
};

export type GenerationDiagnostics = {
  mode: UserContextDiagnostics["mode"];
  failed_sources: UserContextSourceName[];
  input_health: Record<
    UserContextSourceName,
    { health: UserContextSourceHealth; row_count: number }
  >;
  engine_version: typeof RECOMMENDATION_ENGINE_VERSION;
  request_seed: string;
  context_mode: string;
};

const DIAGNOSTIC_ROW_LIMIT = 10_000;

export const RECOMMENDATION_INPUT_UNAVAILABLE_ERROR = {
  code: "RECOMMENDATION_INPUT_UNAVAILABLE",
  message: "Recommendation inputs are temporarily unavailable.",
} as const;

export type GenerationFailureResponse = {
  status: 503;
  body: {
    data: [];
    meta: GenerationDiagnostics & {
      warning: "blocked_source_unavailable";
    } & Partial<GenerationTraceMetadata>;
    error: typeof RECOMMENDATION_INPUT_UNAVAILABLE_ERROR;
  };
};

export type GenerationTraceMetadata = {
  timestamp: string;
  requestId: string;
};

export type FilterRelaxationValidation =
  | { valid: true }
  | { valid: false; message: string };

export function validateFilterRelaxationRequest(input: {
  genreIds?: readonly number[];
  filterRelaxation?: FilterRelaxation;
}): FilterRelaxationValidation {
  if (
    input.filterRelaxation !== undefined &&
    (input.genreIds === undefined || input.genreIds.length === 0)
  ) {
    return {
      valid: false,
      message: "filter_relaxation requires at least one genre_id",
    };
  }

  return { valid: true };
}

export function buildGenerationDiagnostics(params: {
  context: UserContextDiagnostics;
  requestSeed: string;
  contextMode: string;
}): GenerationDiagnostics {
  const inputHealth = Object.fromEntries(
    USER_CONTEXT_SOURCE_NAMES.map((sourceName) => {
      const source = params.context.inputHealth[sourceName];
      const rowCount = Number.isFinite(source.rowCount)
        ? Math.max(0, Math.min(DIAGNOSTIC_ROW_LIMIT, Math.floor(source.rowCount)))
        : 0;

      return [
        sourceName,
        { health: source.health, row_count: rowCount },
      ];
    }),
  ) as GenerationDiagnostics["input_health"];

  return {
    mode: params.context.mode,
    failed_sources: [...params.context.failedSources],
    input_health: inputHealth,
    engine_version: RECOMMENDATION_ENGINE_VERSION,
    request_seed: params.requestSeed,
    context_mode: params.contextMode,
  };
}

export function buildBlockedSourceFailureResponse(
  diagnostics: GenerationDiagnostics,
  trace?: GenerationTraceMetadata,
): GenerationFailureResponse | null {
  const preflight = decideRecommendationInputPreflight({
    mode: diagnostics.mode,
    blockedHealth: diagnostics.input_health.blocked.health,
  });
  if (!preflight.v1.rejected) return null;

  return {
    status: 503,
    body: {
      data: [],
      meta: {
        ...diagnostics,
        ...(trace ?? {}),
        warning: "blocked_source_unavailable",
      },
      error: RECOMMENDATION_INPUT_UNAVAILABLE_ERROR,
    },
  };
}

function canonicalizeIds(ids: readonly number[] | undefined): number[] {
  return Array.from(new Set(ids ?? [])).sort((left, right) => left - right);
}

export function deriveGenerateRequestSeed(
  input: GenerateRequestSeedInput,
): string {
  const genreIds = canonicalizeIds(input.genreIds);
  const canonicalInputs = JSON.stringify({
    userId: input.userId,
    seed_tmdb_ids: canonicalizeIds(input.seedTmdbIds),
    limit: input.limit,
    exclude_tmdb_ids: canonicalizeIds(input.excludeTmdbIds),
    genre_ids: genreIds.length > 0 ? genreIds : null,
    filter_relaxation:
      genreIds.length > 0 ? (input.filterRelaxation ?? null) : null,
  });
  let hash = 2166136261;

  for (let index = 0; index < canonicalInputs.length; index += 1) {
    hash ^= canonicalInputs.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16);
}

export function filterGeneratedCandidateIds(params: {
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
