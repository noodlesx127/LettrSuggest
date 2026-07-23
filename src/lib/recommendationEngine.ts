import {
  scoreRecommendationsWithOverlap,
  type OverlapScoringContext,
} from "@/lib/enrich";
import {
  deriveRecommendationMode,
  normalizeRecommendationRequest,
  RECOMMENDATION_ENGINE_VERSION,
  RECOMMENDATION_SOURCE_NAMES,
  MAX_DIAGNOSTIC_COUNT,
  type RecommendationCandidate,
  type RecommendationDiagnostics,
  type RecommendationInputHealth,
  type RecommendationRequest,
  type RecommendationRequestInput,
  type RecommendationResult,
  type RecommendationSourceName,
} from "@/lib/recommendationTypes";
import type { RecommendationContext } from "@/lib/recommendationContext";

export type RecommendationEngineContext = RecommendationContext;
export type RecommendationRng = () => number;
export type RecommendationRngFactory = (
  requestSeed: string,
) => RecommendationRng | number;

export type RecommendationCandidateInput = Readonly<{
  tmdbId: number;
  retrievalScore?: number;
  seedAnchors?: readonly number[];
  providerFamilies?: readonly string[];
  providerOccurrences?: number;
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
    | readonly (number | RecommendationCandidateInput)[]
    | Promise<readonly (number | RecommendationCandidateInput)[]>;
  scoreCandidates?: (
    params: RecommendationScoreParams,
  ) => readonly RecommendationCandidate[] | Promise<readonly RecommendationCandidate[]>;
  rerankCandidates?: (
    params: RecommendationRerankParams,
  ) => readonly RecommendationCandidate[] | Promise<readonly RecommendationCandidate[]>;
  rng?: RecommendationRngFactory;
  telemetry?: RecommendationTelemetry;
}>;

const EMPTY_PROVIDER_FAMILY = "canonical";

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function getCandidateId(value: unknown): number | null {
  if (isPositiveSafeInteger(value)) return value;
  if (typeof value !== "object" || value === null) return null;

  const record = value as Record<string, unknown>;
  const id = record.tmdbId ?? record.tmdb_id ?? record.id;
  return isPositiveSafeInteger(id) ? id : null;
}

function toCandidateInput(value: number | RecommendationCandidateInput): RecommendationCandidateInput | null {
  const tmdbId = getCandidateId(value);
  return tmdbId === null
    ? null
    : typeof value === "number"
      ? { tmdbId }
      : { ...value, tmdbId };
}

function toCandidateInputs(
  values: readonly (number | RecommendationCandidateInput)[],
): RecommendationCandidateInput[] {
  const seen = new Set<number>();
  const candidates: RecommendationCandidateInput[] = [];
  for (const value of values) {
    const candidate = toCandidateInput(value);
    if (!candidate || seen.has(candidate.tmdbId)) continue;
    seen.add(candidate.tmdbId);
    candidates.push(candidate);
  }
  return candidates;
}

function getExcludedIds(
  request: RecommendationRequest,
  context: RecommendationEngineContext,
): Set<number> {
  return new Set([
    ...request.seeds.map((seed) => seed.tmdbId),
    ...request.excludeTmdbIds,
    ...Array.from(context.watchedTmdbIds ?? []),
    ...Array.from(context.blockedTmdbIds ?? []),
  ]);
}

function filterByReason(
  candidates: readonly RecommendationCandidateInput[],
  request: RecommendationRequest,
  context: RecommendationEngineContext,
): {
  candidates: RecommendationCandidateInput[];
  seedDrops: number;
  exclusionDrops: number;
} {
  const seedIds = new Set(request.seeds.map((seed) => seed.tmdbId));
  const requestExclusions = new Set(request.excludeTmdbIds);
  const contextExclusions = new Set([
    ...Array.from(context.watchedTmdbIds ?? []),
    ...Array.from(context.blockedTmdbIds ?? []),
  ]);
  const retained: RecommendationCandidateInput[] = [];
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

function candidateFromUnknown(
  value: unknown,
): RecommendationCandidate | null {
  const tmdbId = getCandidateId(value);
  if (tmdbId === null) return null;

  const record =
    typeof value === "object" && value !== null
      ? (value as Partial<RecommendationCandidate>)
      : undefined;
  const score = isFiniteNumber(record?.score) ? record.score : 0;
  const evidence = record?.evidence;
  const attribution = record?.attribution;
  const providerFamilies = evidence?.providerFamilies?.length
    ? [...evidence.providerFamilies]
    : [EMPTY_PROVIDER_FAMILY];
  const retrievalScore = isFiniteNumber(evidence?.retrievalScore)
    ? evidence.retrievalScore
    : score;

  return {
    tmdbId,
    score,
    evidence: {
      seedAnchors: evidence?.seedAnchors ? [...evidence.seedAnchors] : [],
      providerFamilies,
      providerOccurrences:
        typeof evidence?.providerOccurrences === "number" &&
        Number.isSafeInteger(evidence.providerOccurrences) &&
        evidence.providerOccurrences >= 0
          ? evidence.providerOccurrences
          : 1,
      retrievalScore,
    },
    attribution: {
      retrieval: isFiniteNumber(attribution?.retrieval)
        ? attribution.retrieval
        : retrievalScore,
      preference: isFiniteNumber(attribution?.preference)
        ? attribution.preference
        : 0,
      context: isFiniteNumber(attribution?.context) ? attribution.context : 0,
      diversity: isFiniteNumber(attribution?.diversity)
        ? attribution.diversity
        : 0,
      total: isFiniteNumber(attribution?.total) ? attribution.total : score,
    },
  };
}

function normalizeCandidates(values: readonly unknown[]): RecommendationCandidate[] {
  const seen = new Set<number>();
  const candidates: RecommendationCandidate[] = [];
  values.forEach((value) => {
    const candidate = candidateFromUnknown(value);
    if (!candidate || seen.has(candidate.tmdbId)) return;
    seen.add(candidate.tmdbId);
    candidates.push(candidate);
  });
  return candidates;
}

function deterministicRng(requestSeed: string): RecommendationRng {
  let state = 2166136261;
  for (const character of requestSeed) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  if (state === 0) state = 1;

  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

function resolveRng(
  factory: RecommendationRngFactory | undefined,
  requestSeed: string,
): RecommendationRng {
  if (!factory) return deterministicRng(requestSeed);
  const value = factory(requestSeed);
  return typeof value === "function" ? value : () => value;
}

function hashRequestSeed(requestSeed: string): string {
  let hash = 2166136261;
  for (const character of requestSeed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(16, "0");
}

function getInputHealth(
  context: RecommendationEngineContext,
): RecommendationInputHealth {
  return context.inputHealth;
}

function getMode(
  context: RecommendationEngineContext,
): RecommendationDiagnostics["mode"] {
  return deriveRecommendationMode({
    inputHealth: getInputHealth(context),
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
  const { request, context, mode } = params;
  const inputHealth = getInputHealth(context);
  const failedSources = RECOMMENDATION_SOURCE_NAMES.filter(
    (sourceName) => inputHealth[sourceName].health === "failed",
  );

  return {
    mode,
    engineVersion: RECOMMENDATION_ENGINE_VERSION,
    contextMode: request.context.mode,
    inputHealth,
    failedSources,
    requestSeedHash: hashRequestSeed(request.requestSeed),
    seedCount: request.seeds.length,
    candidateCount: Math.min(params.candidateCount, MAX_DIAGNOSTIC_COUNT),
    resultCount: params.resultCount,
    stageCounts: {
      retrieval: Math.min(params.candidateCount, MAX_DIAGNOSTIC_COUNT),
      scoring: Math.min(params.scoringCount, MAX_DIAGNOSTIC_COUNT),
      reranking: Math.min(params.rerankingCount, MAX_DIAGNOSTIC_COUNT),
      final: Math.min(params.resultCount, MAX_DIAGNOSTIC_COUNT),
    },
    dropReasonCounts: {
      ...(params.seedDrops > 0
        ? { seed: Math.min(params.seedDrops, MAX_DIAGNOSTIC_COUNT) }
        : {}),
      ...(params.exclusionDrops > 0
        ? { excluded: Math.min(params.exclusionDrops, MAX_DIAGNOSTIC_COUNT) }
        : {}),
    },
  };
}

async function emitTelemetry(
  telemetry: RecommendationTelemetry | undefined,
  trace: RecommendationDiagnostics,
): Promise<void> {
  if (!telemetry) return;
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

function asOverlapContext(
  context: RecommendationEngineContext,
): OverlapScoringContext {
  return context;
}

export function createRecommendationEngine(
  dependencies: RecommendationEngineDependencies,
): Readonly<{
  generate: (request: RecommendationRequestInput) => Promise<RecommendationResult>;
}> {
  return {
    async generate(input: RecommendationRequestInput): Promise<RecommendationResult> {
      const request = normalizeRecommendationRequest(input);
      const context = await dependencies.loadContext(request.userId);
      const mode = getMode(context);
      const rng = resolveRng(dependencies.rng, request.requestSeed);
      const retrievedRaw = await dependencies.retrieveCandidates({
        request,
        context,
        mode,
        rng,
      });
      const retrieved = toCandidateInputs(retrievedRaw);
      const filteredRetrieval = filterByReason(retrieved, request, context);

      const scoreCandidates = dependencies.scoreCandidates ?? (async (params) =>
        scoreRecommendationsWithOverlap({
          request: params.request,
          context: asOverlapContext(params.context),
          candidates: params.candidates.map((candidate) => candidate.tmdbId),
        }));
      const scoredRaw = await scoreCandidates({
        request,
        context,
        mode,
        candidates: filteredRetrieval.candidates,
      });
      const scored = normalizeCandidates(scoredRaw);
      const filteredScored = filterByReason(
        scored.map((candidate) => ({
          tmdbId: candidate.tmdbId,
          retrievalScore: candidate.score,
        })),
        request,
        context,
      );
      const scoredById = new Map(scored.map((candidate) => [candidate.tmdbId, candidate]));
      const eligibleScored = filteredScored.candidates
        .map((candidate) => scoredById.get(candidate.tmdbId))
        .filter((candidate): candidate is RecommendationCandidate => Boolean(candidate));

      const rerankCandidates = dependencies.rerankCandidates ?? (async (params) =>
        params.candidates);
      const rerankedRaw = await rerankCandidates({
        request,
        context,
        mode,
        candidates: eligibleScored,
      });
      const reranked = normalizeCandidates(rerankedRaw);
      const finalExcludedIds = getExcludedIds(request, context);
      const finalCandidates = reranked
        .filter((candidate) => !finalExcludedIds.has(candidate.tmdbId))
        .slice(0, request.count);

      const diagnostics = buildDiagnostics({
        request,
        context,
        mode,
        candidateCount: filteredRetrieval.candidates.length,
        scoringCount: eligibleScored.length,
        rerankingCount: reranked.length,
        resultCount: finalCandidates.length,
        seedDrops:
          filteredRetrieval.seedDrops + filteredScored.seedDrops,
        exclusionDrops:
          filteredRetrieval.exclusionDrops + filteredScored.exclusionDrops,
      });
      await emitTelemetry(dependencies.telemetry, diagnostics);

      return {
        results: finalCandidates,
        diagnostics,
      };
    },
  };
}
