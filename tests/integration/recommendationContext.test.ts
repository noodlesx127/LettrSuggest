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
      { uri: "letterboxd://film/beta", title: "Beta", year: 2021 },
      { uri: "letterboxd://film/alpha", title: "Alpha", year: 2020 },
      { uri: "letterboxd://film/gamma", title: "Gamma", year: 2019 },
    ],
  },
  mappings: {
    data: [
      { uri: "letterboxd://film/beta", tmdbId: 202 },
      { uri: "letterboxd://film/alpha", tmdbId: 101 },
      { uri: "letterboxd://film/gamma", tmdbId: 303 },
    ],
  },
  metadata: {
    data: [
      { tmdbId: 303, title: "Gamma metadata", metadataVersion: "m1" },
      { tmdbId: 101, title: "Alpha metadata", metadataVersion: "m1" },
    ],
  },
  dates: {
    data: [
      { tmdbId: 202, watchedAt: "2026-01-01" },
      { tmdbId: 303, watchedAt: "2026-03-01" },
      { tmdbId: 101, watchedAt: "2026-02-01" },
    ],
  },
  ratings: {
    data: [
      { tmdbId: 101, rating: 5 },
      { tmdbId: 303, rating: 4 },
      { tmdbId: 202, rating: 2 },
    ],
  },
  features: {
    data: [
      { tmdbId: 303, features: { marker: "features-303" } },
      { tmdbId: 101, features: { marker: "features-101" } },
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
      metadata: { tmdbId: 101, title: "Alpha metadata" },
      date: { tmdbId: 101, watchedAt: "2026-02-01" },
      rating: { tmdbId: 101, rating: 5 },
      features: { tmdbId: 101, features: { marker: "features-101" } },
    });
    expect(tuplesById.get(202)).toMatchObject({
      uri: "letterboxd://film/beta",
      metadata: null,
      date: { tmdbId: 202, watchedAt: "2026-01-01" },
      rating: { tmdbId: 202, rating: 2 },
      features: null,
    });
    expect(tuplesById.get(303)).toMatchObject({
      uri: "letterboxd://film/gamma",
      metadata: { tmdbId: 303, title: "Gamma metadata" },
      date: { tmdbId: 303, watchedAt: "2026-03-01" },
      rating: { tmdbId: 303, rating: 4 },
      features: { tmdbId: 303, features: { marker: "features-303" } },
    });

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
    }
  });
});
