import { describe, expect, it, vi } from "vitest";

import {
  createRecommendationEngine,
  type RecommendationCandidateInput,
  type RecommendationEngineContext,
  type RecommendationEngineDependencies,
  type RecommendationRerankParams,
  type RecommendationRetrieveParams,
  type RecommendationScoreParams,
} from "@/lib/recommendationEngine";
import type { RecommendationInputRevisionMaterial } from "@/lib/recommendationContext";
import { scoreRecommendationsWithOverlap } from "@/lib/enrich";
import {
  MAX_DIAGNOSTIC_COUNT,
  validateRecommendationDiagnostics,
  type RecommendationCandidate,
  type RecommendationDiagnostics,
} from "@/lib/recommendationTypes";

const overlapScorer: RecommendationEngineDependencies["scoreCandidates"] =
  scoreRecommendationsWithOverlap;

const inputHealth: RecommendationEngineContext["inputHealth"] = {
  films: { health: "ok" as const, rowCount: 1 },
  mappings: { health: "failed" as const, rowCount: 0 },
  feedback: { health: "empty" as const, rowCount: 0 },
  exploration: { health: "empty" as const, rowCount: 0 },
  adjacent_genres: { health: "empty" as const, rowCount: 0 },
  exposures: { health: "empty" as const, rowCount: 0 },
  blocked: { health: "ok" as const, rowCount: 0 },
};

const sourceHealth: RecommendationEngineContext["sourceHealth"] = {
  films: { health: "ok", rowCount: 1 },
  mappings: { health: "failed", rowCount: 0 },
  metadata: { health: "empty", rowCount: 0 },
  dates: { health: "empty", rowCount: 0 },
  ratings: { health: "empty", rowCount: 0 },
  features: { health: "empty", rowCount: 0 },
  feedback: { health: "empty", rowCount: 0 },
  exploration: { health: "empty", rowCount: 0 },
  adjacent_genres: { health: "empty", rowCount: 0 },
  exposures: { health: "empty", rowCount: 0 },
  blocked: { health: "ok", rowCount: 0 },
};

const revisionSources: RecommendationInputRevisionMaterial["sources"] = {
  films: [],
  mappings: [],
  metadata: [],
  dates: [],
  ratings: [],
  features: [],
  feedback: [],
  exploration: [],
  adjacent_genres: [],
  exposures: [],
  blocked: [],
};

const revisionMaterial: RecommendationInputRevisionMaterial = {
  sources: revisionSources,
  sourceHealth,
  inputHealth,
  ...revisionSources,
};

const request = {
  userId: "engine-user",
  count: 2,
  seeds: [{ tmdbId: 101, weight: 1, source: "explicit" as const }],
  excludeTmdbIds: [909],
  genres: ["Mystery"],
  context: { mode: "neutral" as const, localHour: null },
  requestSeed: "engine-fixture-seed",
};

const context: RecommendationEngineContext = {
  userId: request.userId,
  films: [],
  filmTuples: [],
  mappings: new Map(),
  metadata: new Map(),
  dates: new Map(),
  ratings: new Map(),
  features: new Map(),
  feedbackMap: new Map(),
  sourceHealth,
  inputHealth,
  failedSources: ["mappings" as const],
  mode: "personalized" as const,
  hasPersonalizedEvidence: true,
  watchedTmdbIds: new Set<number>(),
  blockedTmdbIds: new Set<number>(),
  inputRevisionMaterial: revisionMaterial,
  revisionMaterial,
};

function candidate(tmdbId: number, score: number): RecommendationCandidate {
  return {
    tmdbId,
    score,
    evidence: {
      seedAnchors: [],
      providerFamilies: ["fixture"],
      providerOccurrences: 1,
      retrievalScore: score,
    },
    attribution: {
      retrieval: score,
      preference: 0,
      context: 0,
      diversity: 0,
      total: score,
    },
  };
}

describe("recommendation engine", () => {
  it("accepts the overlap scorer directly as the scoring dependency", () => {
    expect(overlapScorer).toBe(scoreRecommendationsWithOverlap);
  });

  it("passes an explicit empty feedback map to the overlap scorer", async () => {
    const result = await scoreRecommendationsWithOverlap({
      request,
      context,
      mode: "degraded",
      candidates: [{ tmdbId: 303 }],
    });

    expect(result).toEqual([]);
  });

  it("orchestrates injected stages, excludes seeds, and emits one bounded trace", async () => {
    const calls: string[] = [];
    const loadContext = vi.fn(async (userId: string) => {
      calls.push("loadContext");
      expect(userId).toBe(request.userId);
      return context;
    });
    const injectedRng = () => 0.25;
    const rng = vi.fn((requestSeed: string) => {
      calls.push("rng");
      expect(requestSeed).toBe(request.requestSeed);
      return injectedRng;
    });
    const retrieveCandidates = vi.fn(async (
      params: RecommendationRetrieveParams,
    ) => {
      calls.push("retrieveCandidates");
      expect(params.request).toEqual(request);
      expect(params.context).toBe(context);
      expect(params.mode).toBe("degraded");
      expect(params.rng).toBe(injectedRng);
      return [
        { tmdbId: 101 },
        { tmdbId: 303 },
        { tmdbId: 909 },
        { tmdbId: 505 },
      ] satisfies RecommendationCandidateInput[];
    });
    const scoreCandidates = vi.fn(async (params: RecommendationScoreParams) => {
      calls.push("scoreCandidates");
      expect(params.request).toEqual(request);
      expect(params.context).toBe(context);
      expect(params.mode).toBe("degraded");
      expect(params.candidates.map((candidate: { tmdbId: number }) => candidate.tmdbId)).toEqual([
        303,
        505,
      ]);
      return rankedCandidates;
    });
    const rankedCandidates = [candidate(303, 1.2), candidate(505, 1.1)];
    const rerankCandidates = vi.fn(async (params: RecommendationRerankParams) => {
      calls.push("rerankCandidates");
      expect(params.request).toEqual(request);
      expect(params.context).toBe(context);
      expect(params.mode).toBe("degraded");
      return [rankedCandidates[1], rankedCandidates[0]];
    });
    const telemetry = vi.fn(async (
      trace: RecommendationDiagnostics,
    ) => {
      calls.push("telemetry");
      expect(Object.hasOwn(trace, "candidateIds")).toBe(false);
      expect(validateRecommendationDiagnostics(trace)).toBe(true);
      expect(trace.seedCount).toBeLessThanOrEqual(MAX_DIAGNOSTIC_COUNT);
      expect(trace.inputHealth).toEqual(inputHealth);
    });

    const dependencies: RecommendationEngineDependencies = {
      loadContext,
      retrieveCandidates,
      scoreCandidates,
      rerankCandidates,
      rng,
      telemetry,
    };
    const result = await createRecommendationEngine(dependencies).generate(
      request,
    );

    expect(calls).toEqual([
      "loadContext",
      "rng",
      "retrieveCandidates",
      "scoreCandidates",
      "rerankCandidates",
      "telemetry",
    ]);
    expect(result.results.map((item) => item.tmdbId)).toEqual([505, 303]);
    expect(result.results[0]).toBe(rankedCandidates[1]);
    expect(result.results.map((item) => item.tmdbId)).not.toContain(101);
    expect(result.diagnostics.mode).toBe("degraded");
    expect(result.diagnostics.failedSources).toEqual(["mappings"]);
    expect(result.diagnostics.resultCount).toBe(2);
    expect(result.diagnostics.stageCounts).toEqual({
      retrieval: 2,
      scoring: 2,
      reranking: 2,
      final: 2,
    });
    expect(telemetry).toHaveBeenCalledTimes(1);
    expect(telemetry.mock.calls[0]?.[0]).toEqual(result.diagnostics);
  });

  it("bounds the seed count in a complete validated trace", async () => {
    const manySeeds = Array.from(
      { length: MAX_DIAGNOSTIC_COUNT + 3 },
      (_, index) => ({ tmdbId: index + 1, weight: 1 }),
    );
    let trace: RecommendationDiagnostics | undefined;
    const result = await createRecommendationEngine({
      loadContext: async () => context,
      retrieveCandidates: async () => [],
      scoreCandidates: async () => [],
      rerankCandidates: async ({ candidates }) => candidates,
      rng: () => () => 0.5,
      telemetry: (value) => {
        trace = value;
      },
    }).generate({
      ...request,
      count: 1,
      seeds: manySeeds,
    });

    expect(result.diagnostics.seedCount).toBe(MAX_DIAGNOSTIC_COUNT);
    expect(trace).toBeDefined();
    expect(validateRecommendationDiagnostics(trace)).toBe(true);
  });

  it("fails closed on duplicate scorer candidates before telemetry", async () => {
    const telemetry = vi.fn();
    const generate = createRecommendationEngine({
      loadContext: async () => context,
      retrieveCandidates: async () => [{ tmdbId: 303 }],
      scoreCandidates: async () => [candidate(303, 1), candidate(303, 0.9)],
      rerankCandidates: async ({ candidates }) => candidates,
      rng: () => () => 0.5,
      telemetry,
    }).generate(request);

    await expect(generate).rejects.toThrow("Invalid scoring candidates");
    expect(telemetry).not.toHaveBeenCalled();
  });

  it("fails closed on duplicate reranker candidates before telemetry", async () => {
    const telemetry = vi.fn();
    const generate = createRecommendationEngine({
      loadContext: async () => context,
      retrieveCandidates: async () => [{ tmdbId: 303 }, { tmdbId: 505 }],
      scoreCandidates: async () => [candidate(303, 1), candidate(505, 0.9)],
      rerankCandidates: async ({ candidates }) => [candidates[0], candidates[0]],
      rng: () => () => 0.5,
      telemetry,
    }).generate(request);

    await expect(generate).rejects.toThrow("Invalid reranking candidates");
    expect(telemetry).not.toHaveBeenCalled();
  });

  it("fails closed on malformed final candidates without telemetry", async () => {
    const telemetry = vi.fn();
    const malformed = { tmdbId: 303, score: 1 } as unknown as RecommendationCandidate;
    const generate = createRecommendationEngine({
      loadContext: async () => context,
      retrieveCandidates: async () => [{ tmdbId: 303 }],
      scoreCandidates: async () => [malformed],
      rerankCandidates: async ({ candidates }) => candidates,
      rng: () => () => 0.5,
      telemetry,
    }).generate(request);

    await expect(generate).rejects.toThrow("Invalid recommendation result");
    expect(telemetry).not.toHaveBeenCalled();
  });
});
