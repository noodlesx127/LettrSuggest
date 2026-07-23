import type {
  RecommendationDiagnostics,
  RecommendationRequestInput,
  RecommendationResult,
} from "@/lib/recommendationTypes";

export type CanonicalRecommendationFixture = {
  request: RecommendationRequestInput;
  result: RecommendationResult;
};

function deepFreeze<T>(value: T): Readonly<T> {
  if (value === null || typeof value !== "object") return value;

  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === "object") deepFreeze(child);
  }

  return value;
}

const diagnostics: RecommendationDiagnostics = {
  mode: "personalized",
  engineVersion: "v1-canonical-1",
  contextMode: "neutral",
  inputHealth: {
    films: { health: "ok", rowCount: 12 },
    mappings: { health: "ok", rowCount: 12 },
    feedback: { health: "ok", rowCount: 4 },
    exploration: { health: "empty", rowCount: 0 },
    adjacent_genres: { health: "ok", rowCount: 2 },
    exposures: { health: "ok", rowCount: 3 },
    blocked: { health: "ok", rowCount: 1 },
  },
  failedSources: [],
  requestSeedHash: "0123456789abcdef",
  seedCount: 2,
  candidateCount: 5,
  resultCount: 3,
  stageCounts: {
    retrieval: 5,
    scoring: 5,
    reranking: 3,
    final: 3,
  },
  dropReasonCounts: {
    seed: 2,
    excluded: 1,
  },
};

export const canonicalFixture = deepFreeze({
  request: {
    userId: "fixture-user",
    count: 3,
    seeds: [
      { tmdbId: 101, weight: 1, source: "explicit" },
      { tmdbId: 202, weight: 0.5, source: "history" },
    ],
    excludeTmdbIds: [909],
    genres: ["Mystery"],
    requestSeed: "canonical-fixture-seed",
  },
  result: {
    results: [
      {
        tmdbId: 303,
        score: 1.71,
        evidence: {
          seedAnchors: [101],
          providerFamilies: ["tmdb"],
          providerOccurrences: 1,
          retrievalScore: 0.91,
        },
        attribution: {
          retrieval: 0.91,
          preference: 0.7,
          context: 0,
          diversity: 0.1,
          total: 1.71,
        },
      },
      {
        tmdbId: 404,
        score: 1.42,
        evidence: {
          seedAnchors: [202],
          providerFamilies: ["tmdb"],
          providerOccurrences: 1,
          retrievalScore: 0.82,
        },
        attribution: {
          retrieval: 0.82,
          preference: 0.55,
          context: 0,
          diversity: 0.05,
          total: 1.42,
        },
      },
      {
        tmdbId: 505,
        score: 1.18,
        evidence: {
          seedAnchors: [101, 202],
          providerFamilies: ["tmdb", "letterboxd"],
          providerOccurrences: 2,
          retrievalScore: 0.74,
        },
        attribution: {
          retrieval: 0.74,
          preference: 0.4,
          context: 0,
          diversity: 0.04,
          total: 1.18,
        },
      },
    ],
    diagnostics,
  },
} satisfies CanonicalRecommendationFixture);
