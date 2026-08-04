import { describe, expect, it, vi } from "vitest";

import type { TMDBMovie } from "@/lib/enrich";
import {
  buildV1RecommendationDependencies,
  buildWebRecommendationDependencies,
  runV1RecommendationGeneration,
  runWebRecommendationGeneration,
  type RecommendationMetadataCompletion,
} from "@/lib/recommendationGeneration";
import type {
  RecommendationEngineContext,
  RecommendationScoreParams,
} from "@/lib/recommendationEngine";
import type { TasteProfile, UserContext } from "@/lib/serverSuggestionsEngine";
import type {
  RecommendationCandidate,
  RecommendationInputHealth,
} from "@/lib/recommendationTypes";

const inputHealth: RecommendationInputHealth = {
  films: { health: "empty", rowCount: 0 },
  mappings: { health: "empty", rowCount: 0 },
  feedback: { health: "empty", rowCount: 0 },
  exploration: { health: "empty", rowCount: 0 },
  adjacent_genres: { health: "empty", rowCount: 0 },
  exposures: { health: "empty", rowCount: 0 },
  blocked: { health: "ok", rowCount: 0 },
};

const context = {
  userId: "generation-test-user",
  films: [],
  filmTuples: [],
  mappings: new Map(),
  metadata: new Map(),
  dates: new Map(),
  ratings: new Map(),
  features: new Map(),
  sourceHealth: inputHealth,
  inputHealth,
  feedbackMap: new Map(),
  failedSources: [],
  mode: "cold_start",
  hasPersonalizedEvidence: false,
  watchedTmdbIds: new Set<number>(),
  blockedTmdbIds: new Set<number>(),
  inputRevisionMaterial: null,
  revisionMaterial: null,
} as unknown as RecommendationEngineContext;

const userContext = {
  films: [],
  mappings: new Map(),
  mappingsArray: [],
  feedback: [],
  explorationRate: 0.15,
  adjacentGenres: [],
  recentExposures: new Map(),
  blockedIds: new Set<number>(),
  inputHealth,
  failedSources: [],
  mode: "cold_start",
} as unknown as UserContext;

const tasteProfile = {
  topGenres: [],
  topActors: [],
  topStudios: [],
  topKeywords: [],
  topCountries: [],
  topLanguages: [],
  avoidGenres: [],
  avoidKeywords: [],
  avoidDirectors: [],
  topDecades: [],
  watchlistGenres: [],
  watchlistKeywords: [],
  watchlistDirectors: [],
} as unknown as TasteProfile;

function movie(id: number, genres: string[]): TMDBMovie {
  return {
    id,
    title: `Movie ${id}`,
    genres: genres.map((name, index) => ({ id: index + 1, name })),
    keywords: { keywords: [] },
    credits: { cast: [], crew: [] },
  } as TMDBMovie;
}

function scoredCandidate(id: number, score: number): RecommendationCandidate {
  return {
    tmdbId: id,
    score,
    evidence: {
      seedAnchors: [],
      providerFamilies: ["tmdb"],
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

function completeDetails(details: Map<number, TMDBMovie>): RecommendationMetadataCompletion {
  return {
    details,
    requested: details.size,
    completed: details.size,
    failed: 0,
    deadlineExpired: false,
  };
}

describe("surface-specific recommendation generation builders", () => {
  it("keeps web genre retrieval and metadata eligibility inside the reusable builder", async () => {
    const retrieveCandidates = vi.fn(async (params: { tasteProfile: TasteProfile }) => {
      expect(params.tasteProfile.topGenres).toEqual([
        { id: 28, name: "Action", weight: 1, count: 1 },
      ]);
      return {
        candidateIds: [1, 2],
        sourceMetadata: new Map(),
      };
    });
    const details = new Map([
      [1, movie(1, ["Action"])],
      [2, movie(2, ["Drama"])],
    ]);
    const scoreCandidates = vi.fn(
      async (params: RecommendationScoreParams) => ({
        candidates: params.candidates.map(({ tmdbId }, index) =>
          scoredCandidate(tmdbId, 10 - index),
        ),
        rerankCandidates: () =>
          params.candidates.map(({ tmdbId }, index) =>
            scoredCandidate(tmdbId, 10 - index),
          ),
      }),
    );
    const intent = {
      userId: "generation-test-user",
      seedTmdbIds: [],
      limit: 2,
      excludeTmdbIds: [],
      genreNames: ["Action"],
      requestSeed: "web-builder-test",
    } as const;

    const preparation = buildWebRecommendationDependencies({
      intent,
      context,
      userContext,
      tasteProfile,
      retrieveCandidates,
      loadCachedDetails: async () => new Map(),
      ensureCompleteDetails: async () => completeDetails(details),
      isMetadataCompletionHealthy: () => true,
      scoreCandidates,
      rng: () => () => 0.5,
      telemetry: () => undefined,
    });

    const result = await runWebRecommendationGeneration(
      intent,
      preparation.dependencies,
    );

    expect(result.results.map((candidate) => candidate.tmdbId)).toEqual([1]);
    expect(scoreCandidates.mock.calls[0]?.[0].candidates.map(({ tmdbId }) => tmdbId)).toEqual([
      1,
    ]);
  });

  it("keeps v1 discovery threshold, negative filtering, and canonical pass-through in its builder", async () => {
    const v1Intent = {
      userId: "generation-test-user",
      seedTmdbIds: [],
      limit: 2,
      excludeTmdbIds: [],
      genreNames: [],
      debug: false,
      requestSeed: "v1-builder-test",
    } as const;
    const sourceMetadata = new Map([
      [10, { sources: ["discover-top-genres"], consensusLevel: "low" as const }],
      [11, { sources: ["tmdb"], consensusLevel: "low" as const }],
    ]);
    const scoreCandidates = vi.fn(async (params: { candidates: number[] }) =>
      params.candidates.map((tmdbId) => ({
        tmdbId,
        score: tmdbId === 10 ? 10 : 20,
        title: `Movie ${tmdbId}`,
        reasons: [],
        genres: ["Drama"],
        sources: sourceMetadata.get(tmdbId)?.sources,
      })),
    );
    const details = new Map([
      [10, movie(10, ["Drama"])],
      [11, movie(11, ["Drama"])],
    ]);

    const preparation = await buildV1RecommendationDependencies({
      intent: v1Intent,
      context,
      userContext,
      tasteProfile,
      retrieveCandidates: async () => ({
        candidateIds: [10, 11],
        sourceMetadata,
      }),
      loadCachedDetails: async () => details,
      scoreCandidates,
      rng: () => () => 0.5,
      telemetry: () => undefined,
    });

    const result = await runV1RecommendationGeneration(
      v1Intent,
      preparation.dependencies,
    );

    expect(scoreCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ candidates: [10, 11] }),
    );
    expect(preparation.personalizationFiltered.map((item) => item.tmdbId)).toEqual([
      11,
    ]);
    expect(result.results.map((candidate) => candidate.tmdbId)).toEqual([11]);
  });
});
