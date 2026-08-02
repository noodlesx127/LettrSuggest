import type { RecommendationContext } from "@/lib/recommendationContext";
import {
  deriveRecommendationMode,
  MAX_DIAGNOSTIC_COUNT,
  normalizeRecommendationRequest,
  RECOMMENDATION_ENGINE_VERSION,
  RECOMMENDATION_SOURCE_NAMES,
  validateRecommendationResult,
  validateRecommendationDiagnostics,
  type RecommendationCandidate,
  type RecommendationDiagnostics,
  type RecommendationInputHealth,
  type RecommendationRequest,
  type RecommendationRequestInput,
  type RecommendationResult,
  type RecommendationTrace,
} from "@/lib/recommendationTypes";
import { buildRecommendationTrace } from "@/lib/recommendationTelemetry";

export type RecommendationEngineContext = RecommendationContext;
export type RecommendationRng = () => number;
export type RecommendationRngFactory = (
  requestSeed: string,
) => RecommendationRng;

export type RecommendationCandidateInput = Readonly<{
  tmdbId: number;
}>;

export type RecommendationRetrieveParams = Readonly<{
  request: RecommendationRequest;
  context: RecommendationEngineContext;
  mode: RecommendationDiagnostics["mode"];
  rng: RecommendationRng;
}>;

export type RecommendationScoreParams = Readonly<{
  request: RecommendationRequest;
  context: RecommendationEngineContext;
  mode: RecommendationDiagnostics["mode"];
  candidates: readonly RecommendationCandidateInput[];
}>;

export type RecommendationRerankParams = Readonly<{
  request: RecommendationRequest;
  context: RecommendationEngineContext;
  mode: RecommendationDiagnostics["mode"];
  candidates: readonly RecommendationCandidate[];
}>;

export type RecommendationTelemetry =
  | ((trace: RecommendationDiagnostics) => void | Promise<void>)
  | Readonly<{
      trace?: (
        trace: RecommendationDiagnostics,
      ) => void | Promise<void>;
      record?: (
        trace: RecommendationDiagnostics,
      ) => void | Promise<void>;
    }>;

export type RecommendationEngineDependencies = Readonly<{
  loadContext: (
    userId: string,
  ) => Promise<RecommendationEngineContext>;
  retrieveCandidates: (
    params: RecommendationRetrieveParams,
  ) =>
    | readonly RecommendationCandidateInput[]
    | Promise<readonly RecommendationCandidateInput[]>;
  scoreCandidates: (
    params: RecommendationScoreParams,
  ) =>
    | readonly RecommendationCandidate[]
    | Promise<readonly RecommendationCandidate[]>;
  rerankCandidates: (
    params: RecommendationRerankParams,
  ) =>
    | readonly RecommendationCandidate[]
    | Promise<readonly RecommendationCandidate[]>;
  rng: RecommendationRngFactory;
  telemetry: RecommendationTelemetry;
}>;

export type RecommendationEngineResult = RecommendationResult &
  Readonly<{ trace: RecommendationTrace }>;

type CandidateWithId = Readonly<{ tmdbId: number }>;

function assertCandidateIds(
  candidates: readonly unknown[],
  stage: string,
): asserts candidates is readonly CandidateWithId[] {
  if (
    !Array.isArray(candidates) ||
    candidates.some(
      (candidate) =>
        typeof candidate !== "object" ||
        candidate === null ||
        !Number.isSafeInteger((candidate as { tmdbId?: unknown }).tmdbId) ||
        ((candidate as { tmdbId: number }).tmdbId ?? 0) <= 0,
    )
  ) {
    throw new Error(`Invalid ${stage} candidates`);
  }

  const ids = (candidates as readonly CandidateWithId[]).map(
    (candidate) => candidate.tmdbId,
  );
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Invalid ${stage} candidates`);
  }
}

function filterByReason<T extends CandidateWithId>(
  candidates: readonly T[],
  request: RecommendationRequest,
  context: RecommendationEngineContext,
): {
  candidates: T[];
  seedDrops: number;
  exclusionDrops: number;
} {
  const seedIds = new Set(request.seeds.map((seed) => seed.tmdbId));
  const requestExclusions = new Set(request.excludeTmdbIds);
  const contextExclusions = new Set([
    ...Array.from(context.watchedTmdbIds),
    ...Array.from(context.blockedTmdbIds),
  ]);
  const retained: T[] = [];
  let seedDrops = 0;
  let exclusionDrops = 0;

  for (const candidate of candidates) {
    if (seedIds.has(candidate.tmdbId)) {
      seedDrops += 1;
    } else if (
      requestExclusions.has(candidate.tmdbId) ||
      contextExclusions.has(candidate.tmdbId)
    ) {
      exclusionDrops += 1;
    } else {
      retained.push(candidate);
    }
  }

  return { candidates: retained, seedDrops, exclusionDrops };
}

function hashRequestSeed(requestSeed: string): string {
  let hash = 2166136261;
  for (const character of requestSeed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(16, "0");
}

function deriveEngineMode(
  context: RecommendationEngineContext,
): RecommendationDiagnostics["mode"] {
  return deriveRecommendationMode({
    inputHealth: context.inputHealth,
    hasPersonalizedEvidence: context.hasPersonalizedEvidence,
  });
}

function buildDiagnostics(params: {
  request: RecommendationRequest;
  context: RecommendationEngineContext;
  mode: RecommendationDiagnostics["mode"];
  candidateCount: number;
  scoringCount: number;
  rerankingCount: number;
  resultCount: number;
  seedDrops: number;
  exclusionDrops: number;
}): RecommendationDiagnostics {
  const inputHealth: RecommendationInputHealth = params.context.inputHealth;
  const failedSources = RECOMMENDATION_SOURCE_NAMES.filter(
    (sourceName) => inputHealth[sourceName].health === "failed",
  );
  const boundedCount = (count: number) =>
    Math.min(Math.max(0, count), MAX_DIAGNOSTIC_COUNT);

  return {
    mode: params.mode,
    engineVersion: RECOMMENDATION_ENGINE_VERSION,
    contextMode: params.request.context.mode,
    inputHealth,
    failedSources,
    requestSeedHash: hashRequestSeed(params.request.requestSeed),
    seedCount: boundedCount(params.request.seeds.length),
    candidateCount: boundedCount(params.candidateCount),
    resultCount: boundedCount(params.resultCount),
    stageCounts: {
      retrieval: boundedCount(params.candidateCount),
      scoring: boundedCount(params.scoringCount),
      reranking: boundedCount(params.rerankingCount),
      final: boundedCount(params.resultCount),
    },
    dropReasonCounts: {
      ...(params.seedDrops > 0
        ? { seed: boundedCount(params.seedDrops) }
        : {}),
      ...(params.exclusionDrops > 0
        ? { excluded: boundedCount(params.exclusionDrops) }
        : {}),
    },
  };
}

async function emitTelemetry(
  telemetry: RecommendationTelemetry,
  trace: RecommendationDiagnostics,
): Promise<void> {
  try {
    if (typeof telemetry === "function") {
      await telemetry(trace);
    } else if (telemetry.trace) {
      await telemetry.trace(trace);
    } else if (telemetry.record) {
      await telemetry.record(trace);
    }
  } catch (error) {
    console.error("[RecommendationEngine] telemetry failed", {
      code: error instanceof Error ? error.name : "UNKNOWN_ERROR",
    });
  }
}

export function createRecommendationEngine(
  dependencies: RecommendationEngineDependencies,
): Readonly<{
  generate: (
    request: RecommendationRequestInput,
  ) => Promise<RecommendationEngineResult>;
}> {
  return {
    async generate(
      input: RecommendationRequestInput,
    ): Promise<RecommendationEngineResult> {
      const request = normalizeRecommendationRequest(input);
      const context = await dependencies.loadContext(request.userId);
      const mode = deriveEngineMode(context);
      const rng = dependencies.rng(request.requestSeed);
      const retrieved = await dependencies.retrieveCandidates({
        request,
        context,
        mode,
        rng,
      });
      assertCandidateIds(retrieved, "retrieval");
      const eligibleRetrieved = filterByReason(retrieved, request, context);
      const scored = await dependencies.scoreCandidates({
        request,
        context,
        mode,
        candidates: eligibleRetrieved.candidates,
      });
      assertCandidateIds(scored, "scoring");
      const eligibleScored = filterByReason(scored, request, context);
      const reranked = await dependencies.rerankCandidates({
        request,
        context,
        mode,
        candidates: eligibleScored.candidates,
      });
      assertCandidateIds(reranked, "reranking");
      const eligibleReranked = filterByReason(reranked, request, context);
      const results = eligibleReranked.candidates.slice(0, request.count);
      const diagnostics = buildDiagnostics({
        request,
        context,
        mode,
        candidateCount: eligibleRetrieved.candidates.length,
        scoringCount: eligibleScored.candidates.length,
        rerankingCount: reranked.length,
        resultCount: results.length,
        seedDrops:
          eligibleRetrieved.seedDrops +
          eligibleScored.seedDrops +
          eligibleReranked.seedDrops,
        exclusionDrops:
          eligibleRetrieved.exclusionDrops +
          eligibleScored.exclusionDrops +
          eligibleReranked.exclusionDrops,
      });

      const result = { results, diagnostics };
      if (!validateRecommendationDiagnostics(diagnostics)) {
        throw new Error("Invalid recommendation diagnostics");
      }
      if (!validateRecommendationResult(result, request)) {
        throw new Error("Invalid recommendation result");
      }
      const trace = buildRecommendationTrace({
        result,
        inputRevisionMaterial: context.revisionMaterial,
      });
      await emitTelemetry(dependencies.telemetry, diagnostics);

      return { results, diagnostics, trace };
    },
  };
}
