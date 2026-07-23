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
        tmdbId: 202,
        title: "Beta metadata",
        metadataVersion: "m1",
        sourceMarker: "metadata-beta",
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
        tmdbId: 202,
        features: { marker: "features-202" },
        sourceMarker: "features-beta",
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
  return { load: async () => snapshot };
}

describe("recommendation context", () => {
  it("keeps complete atomic tuples, health, mappings, and exact revision rows order-independent", async () => {
    const context = await loadRecommendationContext(
      repositoryFor(sourceSnapshot),
      "context-user",
    );
    const shuffledContext = await loadRecommendationContext(
      repositoryFor(shuffledSnapshot()),
      "context-user",
    );
    const tuplesById = new Map(
      context.films.map((tuple) => [tuple.tmdbId, tuple]),
    );

    expect(context.inputHealth).toEqual(inputHealth);
    expect(context.sourceHealth.feedback).toEqual({
      health: "failed",
      rowCount: 0,
    });
    expect(tuplesById.get(101)).toEqual({
      uri: "letterboxd://film/alpha",
      tmdbId: 101,
      film: {
        uri: "letterboxd://film/alpha",
        title: "Alpha",
        year: 2020,
        sourceMarker: "films-alpha",
      },
      mapping: {
        uri: "letterboxd://film/alpha",
        tmdbId: 101,
        sourceMarker: "mappings-alpha",
      },
      details: {
        tmdbId: 101,
        title: "Alpha metadata",
        metadataVersion: "m1",
        sourceMarker: "metadata-alpha",
      },
      metadata: {
        tmdbId: 101,
        title: "Alpha metadata",
        metadataVersion: "m1",
        sourceMarker: "metadata-alpha",
      },
      date: {
        tmdbId: 101,
        watchedAt: "2026-02-01",
        sourceMarker: "dates-alpha",
      },
      ratingRecord: {
        tmdbId: 101,
        rating: 5,
        sourceMarker: "ratings-alpha",
      },
      features: {
        tmdbId: 101,
        features: { marker: "features-101" },
        sourceMarker: "features-alpha",
      },
      rating: 5,
      watchDate: "2026-02-01",
      detailsHealth: "ok",
    });
    expect(tuplesById.get(202)).toEqual({
      uri: "letterboxd://film/beta",
      tmdbId: 202,
      film: {
        uri: "letterboxd://film/beta",
        title: "Beta",
        year: 2021,
        sourceMarker: "films-beta",
      },
      mapping: {
        uri: "letterboxd://film/beta",
        tmdbId: 202,
        sourceMarker: "mappings-beta",
      },
      details: {
        tmdbId: 202,
        title: "Beta metadata",
        metadataVersion: "m1",
        sourceMarker: "metadata-beta",
      },
      metadata: {
        tmdbId: 202,
        title: "Beta metadata",
        metadataVersion: "m1",
        sourceMarker: "metadata-beta",
      },
      date: {
        tmdbId: 202,
        watchedAt: "2026-01-01",
        sourceMarker: "dates-beta",
      },
      ratingRecord: {
        tmdbId: 202,
        rating: 2,
        sourceMarker: "ratings-beta",
      },
      features: {
        tmdbId: 202,
        features: { marker: "features-202" },
        sourceMarker: "features-beta",
      },
      rating: 2,
      watchDate: "2026-01-01",
      detailsHealth: "ok",
    });
    expect(tuplesById.get(303)).toEqual({
      uri: "letterboxd://film/gamma",
      tmdbId: 303,
      film: {
        uri: "letterboxd://film/gamma",
        title: "Gamma",
        year: 2019,
        sourceMarker: "films-gamma",
      },
      mapping: {
        uri: "letterboxd://film/gamma",
        tmdbId: 303,
        sourceMarker: "mappings-gamma",
      },
      details: {
        tmdbId: 303,
        title: "Gamma metadata",
        metadataVersion: "m1",
        sourceMarker: "metadata-gamma",
      },
      metadata: {
        tmdbId: 303,
        title: "Gamma metadata",
        metadataVersion: "m1",
        sourceMarker: "metadata-gamma",
      },
      date: {
        tmdbId: 303,
        watchedAt: "2026-03-01",
        sourceMarker: "dates-gamma",
      },
      ratingRecord: {
        tmdbId: 303,
        rating: 4,
        sourceMarker: "ratings-gamma",
      },
      features: {
        tmdbId: 303,
        features: { marker: "features-303" },
        sourceMarker: "features-gamma",
      },
      rating: 4,
      watchDate: "2026-03-01",
      detailsHealth: "ok",
    });

    expect(Array.from(context.mappings.entries())).toEqual([
      [
        "letterboxd://film/alpha",
        {
          uri: "letterboxd://film/alpha",
          tmdbId: 101,
          sourceMarker: "mappings-alpha",
        },
      ],
      [
        "letterboxd://film/beta",
        {
          uri: "letterboxd://film/beta",
          tmdbId: 202,
          sourceMarker: "mappings-beta",
        },
      ],
      [
        "letterboxd://film/gamma",
        {
          uri: "letterboxd://film/gamma",
          tmdbId: 303,
          sourceMarker: "mappings-gamma",
        },
      ],
    ]);
    expect(context.films.map((tuple) => tuple.tmdbId)).toEqual([303, 101, 202]);
    expect(shuffledContext.films).toEqual(context.films);
    expect(shuffledContext.inputRevisionMaterial).toEqual(
      context.inputRevisionMaterial,
    );
    expect(context.inputRevisionMaterial.sources.films).toEqual([
      {
        uri: "letterboxd://film/alpha",
        title: "Alpha",
        year: 2020,
        sourceMarker: "films-alpha",
      },
      {
        uri: "letterboxd://film/beta",
        title: "Beta",
        year: 2021,
        sourceMarker: "films-beta",
      },
      {
        uri: "letterboxd://film/gamma",
        title: "Gamma",
        year: 2019,
        sourceMarker: "films-gamma",
      },
    ]);
    expect(context.inputRevisionMaterial.sources.mappings).toEqual([
      {
        uri: "letterboxd://film/alpha",
        tmdbId: 101,
        sourceMarker: "mappings-alpha",
      },
      {
        uri: "letterboxd://film/beta",
        tmdbId: 202,
        sourceMarker: "mappings-beta",
      },
      {
        uri: "letterboxd://film/gamma",
        tmdbId: 303,
        sourceMarker: "mappings-gamma",
      },
    ]);
    expect(context.inputRevisionMaterial.sources.metadata).toEqual([
      {
        tmdbId: 101,
        title: "Alpha metadata",
        metadataVersion: "m1",
        sourceMarker: "metadata-alpha",
      },
      {
        tmdbId: 202,
        title: "Beta metadata",
        metadataVersion: "m1",
        sourceMarker: "metadata-beta",
      },
      {
        tmdbId: 303,
        title: "Gamma metadata",
        metadataVersion: "m1",
        sourceMarker: "metadata-gamma",
      },
    ]);
    expect(context.inputRevisionMaterial.sources.dates).toEqual([
      { tmdbId: 101, watchedAt: "2026-02-01", sourceMarker: "dates-alpha" },
      { tmdbId: 202, watchedAt: "2026-01-01", sourceMarker: "dates-beta" },
      { tmdbId: 303, watchedAt: "2026-03-01", sourceMarker: "dates-gamma" },
    ]);
    expect(context.inputRevisionMaterial.sources.ratings).toEqual([
      { tmdbId: 202, rating: 2, sourceMarker: "ratings-beta" },
      { tmdbId: 303, rating: 4, sourceMarker: "ratings-gamma" },
      { tmdbId: 101, rating: 5, sourceMarker: "ratings-alpha" },
    ]);
    expect(context.inputRevisionMaterial.sources.features).toEqual([
      {
        tmdbId: 101,
        features: { marker: "features-101" },
        sourceMarker: "features-alpha",
      },
      {
        tmdbId: 202,
        features: { marker: "features-202" },
        sourceMarker: "features-beta",
      },
      {
        tmdbId: 303,
        features: { marker: "features-303" },
        sourceMarker: "features-gamma",
      },
    ]);
    for (const sourceName of [
      "films",
      "mappings",
      "metadata",
      "dates",
      "ratings",
      "features",
    ] as const) {
      expect(context.inputRevisionMaterial[sourceName]).toEqual(
        context.inputRevisionMaterial.sources[sourceName],
      );
    }
  });

  it("keeps a missing metadata tuple failed without shifting later records", async () => {
    const missingMiddleMetadata = {
      ...sourceSnapshot,
      metadata: {
        data: sourceSnapshot.metadata.data!.filter((row) => row.tmdbId !== 202),
      },
      features: {
        data: sourceSnapshot.features.data!.filter((row) => row.tmdbId !== 202),
      },
    };
    const context = await loadRecommendationContext(
      repositoryFor(missingMiddleMetadata),
      "atomic-user",
    );
    const tuplesById = new Map(
      context.films.map((tuple) => [tuple.tmdbId, tuple]),
    );

    expect(tuplesById.get(202)).toMatchObject({
      detailsHealth: "failed",
      details: null,
      metadata: null,
      features: null,
    });
    expect(tuplesById.get(303)).toMatchObject({
      detailsHealth: "ok",
      details: { sourceMarker: "metadata-gamma" },
      features: { sourceMarker: "features-gamma" },
    });
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
