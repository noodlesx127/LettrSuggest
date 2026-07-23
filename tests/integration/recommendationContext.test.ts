import { describe, expect, it } from "vitest";

import {
  loadRecommendationContext,
  type RecommendationContextRepository,
  type RecommendationContextSourceSnapshot,
} from "@/lib/recommendationContext";

const inputHealth = {
  films: { health: "ok" as const, rowCount: 3 },
  mappings: { health: "ok" as const, rowCount: 3 },
  feedback: { health: "failed" as const, rowCount: 0 },
  exploration: { health: "empty" as const, rowCount: 0 },
  adjacent_genres: { health: "ok" as const, rowCount: 1 },
  exposures: { health: "ok" as const, rowCount: 1 },
  blocked: { health: "ok" as const, rowCount: 1 },
};

const sourceSnapshot: RecommendationContextSourceSnapshot = {
  films: {
    data: [
      {
        uri: "letterboxd://film/beta",
        title: "Beta",
        year: 2021,
        sourceMarker: "films-beta",
      },
      {
        uri: "letterboxd://film/alpha",
        title: "Alpha",
        year: 2020,
        sourceMarker: "films-alpha",
      },
      {
        uri: "letterboxd://film/gamma",
        title: "Gamma",
        year: 2019,
        sourceMarker: "films-gamma",
      },
    ],
  },
  mappings: {
    data: [
      {
        uri: "letterboxd://film/beta",
        tmdbId: 202,
        sourceMarker: "mappings-beta",
      },
      {
        uri: "letterboxd://film/alpha",
        tmdbId: 101,
        sourceMarker: "mappings-alpha",
      },
      {
        uri: "letterboxd://film/gamma",
        tmdbId: 303,
        sourceMarker: "mappings-gamma",
      },
    ],
  },
  metadata: {
    data: [
      {
        tmdbId: 303,
        title: "Gamma metadata",
        metadataVersion: "m1",
        sourceMarker: "metadata-gamma",
      },
      {
        tmdbId: 101,
        title: "Alpha metadata",
        metadataVersion: "m1",
        sourceMarker: "metadata-alpha",
      },
    ],
  },
  dates: {
    data: [
      { tmdbId: 202, watchedAt: "2026-01-01", sourceMarker: "dates-beta" },
      { tmdbId: 303, watchedAt: "2026-03-01", sourceMarker: "dates-gamma" },
      { tmdbId: 101, watchedAt: "2026-02-01", sourceMarker: "dates-alpha" },
    ],
  },
  ratings: {
    data: [
      { tmdbId: 101, rating: 5, sourceMarker: "ratings-alpha" },
      { tmdbId: 303, rating: 4, sourceMarker: "ratings-gamma" },
      { tmdbId: 202, rating: 2, sourceMarker: "ratings-beta" },
    ],
  },
  features: {
    data: [
      {
        tmdbId: 303,
        features: { marker: "features-303" },
        sourceMarker: "features-gamma",
      },
      {
        tmdbId: 101,
        features: { marker: "features-101" },
        sourceMarker: "features-alpha",
      },
    ],
  },
  inputHealth,
};

function shuffledSnapshot(): RecommendationContextSourceSnapshot {
  return {
    ...sourceSnapshot,
    films: { data: [...sourceSnapshot.films.data!].reverse() },
    mappings: { data: [...sourceSnapshot.mappings.data!].reverse() },
    metadata: { data: [...sourceSnapshot.metadata.data!].reverse() },
    dates: { data: [...sourceSnapshot.dates.data!].reverse() },
    ratings: { data: [...sourceSnapshot.ratings.data!].reverse() },
    features: { data: [...sourceSnapshot.features.data!].reverse() },
  };
}

function repositoryFor(
  snapshot: RecommendationContextSourceSnapshot,
): RecommendationContextRepository {
  return {
    load: async () => snapshot,
  };
}

describe("recommendation context", () => {
  it("keeps atomic tuples, preserves health, and is order independent", async () => {
    const context = await loadRecommendationContext(
      repositoryFor(sourceSnapshot),
      "context-user",
    );
    const shuffledContext = await loadRecommendationContext(
      repositoryFor(shuffledSnapshot()),
      "context-user",
    );

    expect(context.inputHealth).toEqual(inputHealth);
    expect(context.sourceHealth.feedback).toEqual({
      health: "failed",
      rowCount: 0,
    });

    const tuplesById = new Map(
      context.films.map((tuple) => [tuple.tmdbId, tuple]),
    );
    expect(tuplesById.get(101)).toMatchObject({
      uri: "letterboxd://film/alpha",
      tmdbId: 101,
      rating: 5,
      watchDate: "2026-02-01",
      detailsHealth: "ok",
      metadata: { tmdbId: 101, title: "Alpha metadata" },
      details: { tmdbId: 101, title: "Alpha metadata" },
      date: { tmdbId: 101, watchedAt: "2026-02-01" },
      ratingRecord: { tmdbId: 101, rating: 5 },
      features: { tmdbId: 101, sourceMarker: "features-alpha" },
    });
    expect(tuplesById.get(202)).toMatchObject({
      uri: "letterboxd://film/beta",
      tmdbId: 202,
      rating: 2,
      watchDate: "2026-01-01",
      detailsHealth: "failed",
      metadata: null,
      details: null,
      date: { tmdbId: 202, watchedAt: "2026-01-01" },
      ratingRecord: { tmdbId: 202, rating: 2 },
      features: null,
    });
    expect(tuplesById.get(303)).toMatchObject({
      uri: "letterboxd://film/gamma",
      tmdbId: 303,
      rating: 4,
      watchDate: "2026-03-01",
      detailsHealth: "ok",
      metadata: { tmdbId: 303, title: "Gamma metadata" },
      details: { tmdbId: 303, title: "Gamma metadata" },
      date: { tmdbId: 303, watchedAt: "2026-03-01" },
      ratingRecord: { tmdbId: 303, rating: 4 },
      features: { tmdbId: 303, sourceMarker: "features-gamma" },
    });

    expect(Array.from(context.mappings.entries())).toEqual([
      ["letterboxd://film/alpha", expect.objectContaining({ tmdbId: 101 })],
      ["letterboxd://film/beta", expect.objectContaining({ tmdbId: 202 })],
      ["letterboxd://film/gamma", expect.objectContaining({ tmdbId: 303 })],
    ]);
    expect(context.films.map((tuple) => tuple.tmdbId)).toEqual([303, 101, 202]);
    expect(shuffledContext.films).toEqual(context.films);
    expect(shuffledContext.inputRevisionMaterial).toEqual(
      context.inputRevisionMaterial,
    );

    const loadedSources = [
      "films",
      "mappings",
      "metadata",
      "dates",
      "ratings",
      "features",
    ] as const;
    for (const sourceName of loadedSources) {
      expect(context.inputRevisionMaterial.sources[sourceName]).toBeDefined();
      expect(context.inputRevisionMaterial[sourceName]).toEqual(
        context.inputRevisionMaterial.sources[sourceName],
      );
    }
    expect(context.inputRevisionMaterial.sources.films).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceMarker: "films-alpha" }),
      ]),
    );
    expect(context.inputRevisionMaterial.sources.mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceMarker: "mappings-alpha" }),
      ]),
    );
    expect(context.inputRevisionMaterial.sources.metadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceMarker: "metadata-alpha" }),
      ]),
    );
    expect(context.inputRevisionMaterial.sources.dates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceMarker: "dates-alpha" }),
      ]),
    );
    expect(context.inputRevisionMaterial.sources.ratings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceMarker: "ratings-alpha" }),
      ]),
    );
    expect(context.inputRevisionMaterial.sources.features).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceMarker: "features-alpha" }),
      ]),
    );
  });

  it("keeps every Phase 0 adapter source in revision material", async () => {
    const legacyContext = {
      films: [
        {
          uri: "letterboxd://film/legacy",
          title: "Legacy",
          year: 2024,
          rating: 5,
          rewatch: false,
          last_date: "2026-07-01",
          watch_count: 1,
          liked: true,
          on_watchlist: false,
        },
      ],
      mappingsArray: [
        {
          uri: "letterboxd://film/legacy",
          tmdb_id: 808,
          sourceMarker: "mappings-legacy",
        },
      ],
      mappings: new Map([["letterboxd://film/legacy", 808]]),
      feedback: [{ sourceMarker: "feedback-legacy", feature_id: 1 }],
      explorationRate: 0.42,
      explorationMarker: "exploration-legacy",
      adjacentGenres: [{ sourceMarker: "adjacent-legacy", from: "Drama" }],
      recentExposures: new Map([[303, 4]]),
      blockedIds: new Set([909]),
      inputHealth: {
        ...inputHealth,
        films: { health: "ok" as const, rowCount: 1 },
        mappings: { health: "ok" as const, rowCount: 1 },
        feedback: { health: "ok" as const, rowCount: 1 },
        exploration: { health: "ok" as const, rowCount: 1 },
        adjacent_genres: { health: "ok" as const, rowCount: 1 },
        exposures: { health: "ok" as const, rowCount: 1 },
        blocked: { health: "ok" as const, rowCount: 1 },
      },
      mode: "personalized" as const,
    };

    const context = await loadRecommendationContext(
      { loadUserContext: async () => legacyContext },
      "phase0-adapter-user",
    );

    expect(context.inputHealth).toEqual(legacyContext.inputHealth);
    expect(context.sourceHealth).toMatchObject(legacyContext.inputHealth);
    expect(context.blockedTmdbIds).toEqual(new Set([909]));
    expect(context.inputRevisionMaterial.sources.feedback).toEqual([
      { sourceMarker: "feedback-legacy", feature_id: 1 },
    ]);
    expect(context.inputRevisionMaterial.sources.exploration).toEqual([
      { sourceMarker: "exploration-legacy", explorationRate: 0.42 },
    ]);
    expect(context.inputRevisionMaterial.sources.adjacent_genres).toEqual([
      { sourceMarker: "adjacent-legacy", from: "Drama" },
    ]);
    expect(context.inputRevisionMaterial.sources.exposures).toEqual([
      { tmdbId: 303, daysSince: 4 },
    ]);
    expect(context.inputRevisionMaterial.sources.blocked).toEqual([
      { tmdbId: 909 },
    ]);
  });
});
