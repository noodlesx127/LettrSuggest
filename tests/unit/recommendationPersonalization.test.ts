import { describe, expect, it } from "vitest";

import { buildRecommendationPersonalization } from "@/lib/recommendationPersonalization";
import type {
  TasteProfile,
  UserContext,
} from "@/lib/serverSuggestionsEngine";

function makeTasteProfile(
  overrides: Partial<TasteProfile> = {},
): TasteProfile {
  return {
    topGenres: [],
    topKeywords: [],
    topDirectors: [],
    topDecades: [],
    topActors: [],
    topStudios: [],
    topCountries: [],
    topLanguages: [],
    avoidGenres: [],
    avoidKeywords: [],
    avoidDirectors: [],
    watchlistGenres: [],
    watchlistKeywords: [],
    watchlistDirectors: [],
    userStats: {
      avgRating: 0,
      stdDevRating: 0,
      totalFilms: 0,
      rewatchRate: 0,
    },
    nichePreferences: {
      likesAnime: false,
      likesStandUp: false,
      likesFoodDocs: false,
      likesTravelDocs: false,
    },
    preferredSubgenreKeywordIds: [],
    tasteBins: {
      absoluteFavorites: 0,
      highlyRated: 0,
      liked: 0,
      guiltyPleasures: 0,
    },
    mixedGenres: [],
    mixedKeywords: [],
    mixedDirectors: [],
    topSubgenres: [],
    ...overrides,
  };
}

function makeUserContext(overrides: Partial<UserContext> = {}): UserContext {
  return {
    films: [],
    mappings: new Map(),
    mappingsArray: [],
    feedback: [],
    explorationRate: 0.15,
    adjacentGenres: [],
    recentExposures: new Map(),
    blockedIds: new Set(),
    inputHealth: {} as UserContext["inputHealth"],
    failedSources: [],
    mode: "cold_start",
    ...overrides,
  };
}

describe("buildRecommendationPersonalization", () => {
  it("normalizes every shared scorer input", () => {
    const recentExposures = new Map([[202, 3]]);
    const result = buildRecommendationPersonalization(
      makeUserContext({
        films: [
          {
            uri: "film/a/",
            title: "A",
            year: 2020,
            rating: 4.5,
            rewatch: false,
            last_date: "2026-07-01",
            watch_count: 1,
            liked: true,
            on_watchlist: true,
          },
        ],
        mappings: new Map([["film/a/", 101]]),
        mappingsArray: [{ uri: "film/a/", tmdb_id: 101 }],
        feedback: [
          {
            feature_id: 7,
            feature_name: "Director Seven",
            feature_type: "director",
            inferred_preference: 0.9,
            positive_count: 3,
            negative_count: 0,
          },
          {
            feature_id: 8,
            feature_name: "Keyword Eight",
            feature_type: "keyword",
            inferred_preference: 0.1,
            positive_count: 0,
            negative_count: 2,
          },
        ],
        explorationRate: 0.15,
        adjacentGenres: [
          {
            from_genre_name: "Drama",
            to_genre_name: "Mystery",
            success_rate: 0.8,
          },
        ],
        recentExposures,
        mode: "personalized",
      }),
      makeTasteProfile({
        topActors: [{ id: 1, name: "Actor One", weight: 1, count: 2 }],
        preferredSubgenreKeywordIds: [99],
        topDecades: [{ decade: 1990, weight: 1 }],
        watchlistGenres: [{ name: "Drama", count: 1 }],
        watchlistKeywords: [{ name: "Mystery", count: 1 }],
        watchlistDirectors: [{ name: "Director Seven", count: 1 }],
      }),
    );

    expect(result.enhancedProfile).toEqual(
      expect.objectContaining({
        topActors: [expect.objectContaining({ id: 1 })],
        preferredSubgenreKeywordIds: [99],
        watchlistGenres: ["Drama"],
        adjacentGenres: new Map([
          ["Drama", [{ genre: "Mystery", weight: 0.8 }]],
        ]),
      }),
    );
    expect(result.featureFeedback.preferDirectors).toEqual([
      expect.objectContaining({ id: 7 }),
    ]);
    expect(result.featureFeedback.avoidKeywords).toEqual([
      expect.objectContaining({ id: 8 }),
    ]);
    expect(result.watchlistEntries).toEqual([
      { tmdbId: 101, addedAt: "2026-07-01" },
    ]);
    expect(result.recentExposures).toBe(recentExposures);
    expect(result.mmrLambda).toBe(0.5);
  });

  it.each([
    [Number.NaN, 0.5],
    [-1, 0.3],
    [1, 0.7],
  ])("bounds exploration %s to MMR lambda %s", (rate, expected) => {
    const result = buildRecommendationPersonalization(
      makeUserContext({ explorationRate: rate }),
      makeTasteProfile(),
    );

    expect(result.mmrLambda).toBe(expected);
  });
});
