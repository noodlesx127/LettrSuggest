import { beforeEach, describe, expect, it, vi } from "vitest";

const suggestByOverlap = vi.hoisted(() => vi.fn());

vi.mock("@/lib/enrich", () => ({ suggestByOverlap }));

import type { RecommendationEngineContext } from "@/lib/recommendationEngine";
import { scoreRecommendationsWithOverlap } from "@/lib/recommendationScoring";
import type { RecommendationPersonalization } from "@/lib/recommendationPersonalization";
import type { TMDBMovie } from "@/lib/enrich";

const sourceHealth = {
  films: { health: "ok", rowCount: 0 },
  mappings: { health: "empty", rowCount: 0 },
  metadata: { health: "empty", rowCount: 0 },
  dates: { health: "empty", rowCount: 0 },
  ratings: { health: "empty", rowCount: 0 },
  features: { health: "empty", rowCount: 0 },
  feedback: { health: "empty", rowCount: 0 },
  exploration: { health: "empty", rowCount: 0 },
  adjacent_genres: { health: "empty", rowCount: 0 },
  exposures: { health: "empty", rowCount: 0 },
  blocked: { health: "empty", rowCount: 0 },
} as const satisfies RecommendationEngineContext["sourceHealth"];

const inputHealth = {
  films: { health: "ok", rowCount: 0 },
  mappings: { health: "empty", rowCount: 0 },
  feedback: { health: "empty", rowCount: 0 },
  exploration: { health: "empty", rowCount: 0 },
  adjacent_genres: { health: "empty", rowCount: 0 },
  exposures: { health: "empty", rowCount: 0 },
  blocked: { health: "empty", rowCount: 0 },
} as const satisfies RecommendationEngineContext["inputHealth"];

const revisionRows = {
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
} as const;

const revisionMaterial = {
  sources: revisionRows,
  sourceHealth,
  inputHealth,
  ...revisionRows,
} as const satisfies RecommendationEngineContext["inputRevisionMaterial"];

const context = {
  userId: "scoring-user",
  films: [],
  filmTuples: [],
  mappings: new Map<string, { uri: string; tmdbId: number }>(),
  metadata: new Map<number, { tmdbId: number }>(),
  dates: new Map<number, { tmdbId: number }>(),
  ratings: new Map<number, { tmdbId: number; rating: number | null }>(),
  features: new Map<number, { tmdbId: number }>(),
  sourceHealth,
  inputHealth,
  feedbackMap: new Map<number, "negative" | "positive">(),
  failedSources: [],
  mode: "personalized",
  hasPersonalizedEvidence: true,
  watchedTmdbIds: new Set<number>(),
  blockedTmdbIds: new Set<number>(),
  inputRevisionMaterial: revisionMaterial,
  revisionMaterial,
} satisfies RecommendationEngineContext;

const personalization: RecommendationPersonalization = {
  enhancedProfile: {
    topActors: [{ id: 1, name: "Actor One", weight: 1 }],
    topStudios: [],
    topKeywords: [],
    topCountries: [],
    topLanguages: [],
    avoidGenres: [],
    avoidKeywords: [],
    avoidDirectors: [],
    preferredSubgenreKeywordIds: [],
    topDecades: [],
    adjacentGenres: new Map(),
    watchlistGenres: [],
    watchlistKeywords: [],
    watchlistDirectors: [],
  },
  featureFeedback: {
    avoidActors: [],
    avoidKeywords: [],
    avoidFranchises: [],
    avoidDirectors: [],
    avoidGenres: [],
    avoidSubgenres: [],
    preferActors: [],
    preferKeywords: [],
    preferDirectors: [],
    preferGenres: [],
    preferSubgenres: [],
  },
  watchlistEntries: [{ tmdbId: 707, addedAt: "2026-07-01" }],
  recentExposures: new Map([[808, 2]]),
  mmrLambda: 0.6,
};

const sourceMetadata = new Map([
  [707, { sources: ["fixture"], consensusLevel: "high" as const }],
]);

const movie: TMDBMovie = {
  id: 707,
  title: "Fixture Movie",
  release_date: "2020-01-01",
  poster_path: "/fixture.jpg",
  overview: "A complete fixture movie.",
  vote_average: 7.5,
  vote_count: 100,
  genres: [{ id: 18, name: "Drama" }],
  production_countries: [{ iso_3166_1: "US", name: "United States" }],
  spoken_languages: [{ iso_639_1: "en", name: "English" }],
  production_companies: [{ id: 1, name: "Fixture Studios" }],
};

describe("scoreRecommendationsWithOverlap", () => {
  beforeEach(() => {
    suggestByOverlap.mockReset();
    suggestByOverlap.mockResolvedValue([
      {
        tmdbId: 707,
        score: 12,
        reasons: ["watchlist intent"],
        sources: ["fixture"],
      },
    ]);
  });

  it("forwards rich personalization and source metadata to overlap scoring", async () => {
    const result = await scoreRecommendationsWithOverlap(
      {
        request: {
          userId: "scoring-user",
          count: 1,
          seeds: [],
          excludeTmdbIds: [],
          genres: [],
          context: { mode: "neutral", localHour: null },
          requestSeed: "scoring-seed",
        },
        context,
        mode: "personalized",
        candidates: [{ tmdbId: 707 }],
      },
      new Map([[707, movie]]),
      { ...personalization, sourceMetadata },
    );

    expect(suggestByOverlap).toHaveBeenCalledWith(
      expect.objectContaining({
        enhancedProfile: personalization.enhancedProfile,
        featureFeedback: personalization.featureFeedback,
        watchlistEntries: personalization.watchlistEntries,
        recentExposures: personalization.recentExposures,
        sourceMetadata,
        mmrLambda: personalization.mmrLambda,
        mmrTopKFactor: 2.5,
      }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        tmdbId: 707,
        score: 12,
        reasons: ["watchlist intent"],
        explanation: "watchlist intent",
      }),
    ]);
  });
});
