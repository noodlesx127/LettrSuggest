import { describe, expect, it } from "vitest";

import {
  adaptCanonicalResultToV1,
  adaptV1RecommendationIntent,
} from "@/lib/recommendationAdapters";
import type {
  RecommendationCandidate,
  RecommendationResult,
} from "@/lib/recommendationTypes";

const candidate = (tmdbId: number, score: number): RecommendationCandidate => ({
  tmdbId,
  score,
  evidence: {
    seedAnchors: [101],
    providerFamilies: ["tmdb", "tastedive"],
    providerOccurrences: 2,
    retrievalScore: score,
  },
  attribution: {
    retrieval: score,
    preference: 0,
    context: 0,
    diversity: 0,
    total: score,
  },
});

describe("v1 canonical recommendation adapter", () => {
  it("maps every parsed v1 intent field into canonical request and adapter options", () => {
    const adapted = adaptV1RecommendationIntent({
      userId: "v1-user",
      seedTmdbIds: [202, 101],
      limit: 7,
      excludeTmdbIds: [909, 808],
      genreIds: [28, 9648],
      genreNames: ["Action", "Mystery"],
      filterRelaxation: "threshold",
      debug: true,
      requestSeed: "v1-adapter-seed",
    });

    expect(adapted.request).toEqual({
      userId: "v1-user",
      count: 7,
      seeds: [
        { tmdbId: 202, weight: 1, source: "explicit" },
        { tmdbId: 101, weight: 1, source: "explicit" },
      ],
      excludeTmdbIds: [909, 808],
      genres: ["Action", "Mystery"],
      context: { mode: "neutral", localHour: null },
      requestSeed: "v1-adapter-seed",
    });
    expect(adapted.options).toEqual({
      genreIds: [28, 9648],
      filterRelaxation: "threshold",
      debug: true,
    });
  });

  it("maps canonical order into the compatible v1 payload plus additive diagnostics", () => {
    const result: RecommendationResult = {
      results: [candidate(22, 9.1254), candidate(11, 8.5)],
      diagnostics: {
        mode: "personalized",
        engineVersion: "v1-canonical-1",
        contextMode: "neutral",
        inputHealth: {
          films: { health: "ok", rowCount: 12 },
          mappings: { health: "ok", rowCount: 12 },
          feedback: { health: "empty", rowCount: 0 },
          exploration: { health: "empty", rowCount: 0 },
          adjacent_genres: { health: "empty", rowCount: 0 },
          exposures: { health: "empty", rowCount: 0 },
          blocked: { health: "ok", rowCount: 1 },
        },
        failedSources: [],
        requestSeedHash: "00000000deadbeef",
        seedCount: 1,
        candidateCount: 9,
        resultCount: 2,
        stageCounts: { retrieval: 9, scoring: 5, reranking: 2, final: 2 },
        dropReasonCounts: { excluded: 2, genre: 2 },
      },
    };
    const details = new Map([
      [
        22,
        {
          title: "Second by ID, first by canonical rank",
          consensusLevel: "high" as const,
          sources: ["tmdb", "tastedive"],
          reasons: ["Strong match"],
          genres: ["Mystery"],
          releaseDate: "2024-04-03",
          posterPath: "/22.jpg",
          voteCategory: "hidden-gem" as const,
        },
      ],
      [11, { title: "Eleven", sources: ["tmdb"] }],
    ]);

    const adapted = adaptCanonicalResultToV1(result, details);

    expect(adapted.data.map((item) => item.tmdb_id)).toEqual([22, 11]);
    expect(adapted.data[0]).toEqual({
      tmdb_id: 22,
      title: "Second by ID, first by canonical rank",
      score: 9.125,
      consensus_level: "high",
      sources: [
        { source: "tmdb", confidence: 1 },
        { source: "tastedive", confidence: 1 },
      ],
      reasons: ["Strong match"],
      genres: ["Mystery"],
      year: "2024",
      poster_path: "/22.jpg",
      vote_category: "hidden-gem",
    });
    expect(adapted.meta).toEqual(
      expect.objectContaining({
        mode: "personalized",
        engine_version: "v1-canonical-1",
        context_mode: "neutral",
        failed_sources: [],
        request_seed_hash: "00000000deadbeef",
        stage_counts: { retrieval: 9, scoring: 5, reranking: 2, final: 2 },
        drop_reason_counts: { excluded: 2, genre: 2 },
      }),
    );
    expect(adapted.meta.input_health.films).toEqual({
      health: "ok",
      row_count: 12,
    });
  });
});
