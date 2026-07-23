import { describe, expect, it, vi } from "vitest";

import {
  createRecommendationEngine,
  type RecommendationEngineContext,
  type RecommendationEngineDependencies,
} from "@/lib/recommendationEngine";
import type { RecommendationCandidate } from "@/lib/recommendationTypes";

const inputHealth = {
  films: { health: "ok" as const, rowCount: 1 },
  mappings: { health: "failed" as const, rowCount: 0 },
  feedback: { health: "empty" as const, rowCount: 0 },
  exploration: { health: "empty" as const, rowCount: 0 },
  adjacent_genres: { health: "empty" as const, rowCount: 0 },
  exposures: { health: "empty" as const, rowCount: 0 },
  blocked: { health: "ok" as const, rowCount: 0 },
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

const context = {
  userId: request.userId,
  films: [],
  filmTuples: [],
  mappings: new Map(),
  metadata: new Map(),
  dates: new Map(),
  ratings: new Map(),
  features: new Map(),
  sourceHealth: {},
  inputHealth,
  failedSources: ["mappings" as const],
  mode: "personalized" as const,
  hasPersonalizedEvidence: true,
  watchedTmdbIds: new Set<number>(),
  blockedTmdbIds: new Set<number>(),
  inputRevisionMaterial: { sources: {}, sourceHealth: {} },
  revisionMaterial: { sources: {}, sourceHealth: {} },
} as unknown as RecommendationEngineContext;

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
  it("orchestrates injected stages, excludes seeds, and emits one bounded trace", async () => {
    const calls: string[] = [];
    const loadContext = vi.fn(async (userId: string) => {
      calls.push("loadContext");
      expect(userId).toBe(request.userId);
      return context;
    });
    const rng = vi.fn((requestSeed: string) => {
      calls.push("rng");
      expect(requestSeed).toBe(request.requestSeed);
      return () => 0.25;
    });
    const retrieveCandidates = vi.fn(async (params) => {
      calls.push("retrieveCandidates");
      expect(params.request).toEqual(request);
      expect(params.context).toBe(context);
      return [101, 303, 909, 505];
    });
    const scoreCandidates = vi.fn(async (params) => {
      calls.push("scoreCandidates");
      expect(params.request).toEqual(request);
      expect(params.context).toBe(context);
      expect(params.candidates.map((candidate: { tmdbId: number }) => candidate.tmdbId)).toEqual([
        303,
        505,
      ]);
      return [candidate(303, 1.2), candidate(505, 1.1)];
    });
    const rerankCandidates = vi.fn(async (params) => {
      calls.push("rerankCandidates");
      expect(params.request).toEqual(request);
      expect(params.context).toBe(context);
      return [params.candidates[1], params.candidates[0]];
    });
    const telemetry = vi.fn(async (trace) => {
      calls.push("telemetry");
      expect(trace.candidateIds).toBeUndefined();
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
});
