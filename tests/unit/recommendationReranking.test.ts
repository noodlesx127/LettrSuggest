import { describe, expect, it } from "vitest";

import { calibrateRecommendationWindow } from "@/lib/calibration";
import {
  calculateMmrScore,
  lambdaFromExploration,
  rerankRecommendations,
  type RecommendationRerankingCandidate,
} from "@/lib/recommendationReranking";

type Candidate = RecommendationRerankingCandidate & { label?: string };

const candidate = (
  tmdbId: number,
  score: number,
  overrides: Partial<Candidate> = {},
): Candidate => ({
  tmdbId,
  score,
  genres: [`genre-${tmdbId}`],
  directors: [`director-${tmdbId}`],
  studios: [`studio-${tmdbId}`],
  actors: [`actor-${tmdbId}`],
  release_date: `${1980 + tmdbId}-01-01`,
  voteCount: 2_000,
  ...overrides,
});

describe("constrained recommendation reranking", () => {
  it("uses lambda * relevance - (1 - lambda) * similarity", () => {
    expect(calculateMmrScore(0.8, 0.25, 0.6)).toBeCloseTo(0.38);
  });

  it("maps more exploration to lower relevance weight and monotonically more diversity", () => {
    const candidates = [
      candidate(1, 10, { genres: ["Drama"], directors: ["A"] }),
      candidate(2, 9.8, { genres: ["Drama"], directors: ["A"] }),
      candidate(3, 7, { genres: ["Comedy"], directors: ["B"] }),
    ];
    const lowExplorationLambda = lambdaFromExploration(0);
    const highExplorationLambda = lambdaFromExploration(1);

    expect(highExplorationLambda).toBeLessThan(lowExplorationLambda);
    expect(
      rerankRecommendations(candidates, {
        count: 2,
        lambda: lowExplorationLambda,
      }).candidates.map((item) => item.tmdbId),
    ).toEqual([1, 2]);
    expect(
      rerankRecommendations(candidates, {
        count: 2,
        lambda: highExplorationLambda,
      }).candidates.map((item) => item.tmdbId),
    ).toEqual([1, 3]);
  });

  it("uses ascending TMDB ID for stable ties", () => {
    const result = rerankRecommendations(
      [candidate(30, 5), candidate(10, 5), candidate(20, 5)],
      { count: 3, lambda: 1 },
    );

    expect(result.candidates.map((item) => item.tmdbId)).toEqual([10, 20, 30]);
  });

  it("applies strict eligibility before reranking and names relaxation/backfill stages", () => {
    const candidates = Array.from({ length: 6 }, (_, index) =>
      candidate(index + 1, 10 - index, {
        genres: ["Drama"],
        eligible: index !== 1,
      }),
    );

    const result = rerankRecommendations(candidates, {
      count: 4,
      lambda: 1,
      diversityStages: [
        { name: "strict", limits: { maxSameGenre: 1 } },
        { name: "relaxed", limits: { maxSameGenre: 2 } },
      ],
    });

    expect(result.candidates).toHaveLength(4);
    expect(result.candidates.map((item) => item.tmdbId)).not.toContain(2);
    expect(result.diagnostics.eligibilityDrops).toEqual([
      { tmdbId: 2, reason: "ineligible" },
    ]);
    expect(result.diagnostics.stages.map((stage) => stage.name)).toEqual([
      "strict",
      "relaxed",
      "backfill",
    ]);
    expect(result.diagnostics.stages[0].dropReasons).toContain("genre");
    expect(result.diagnostics.stages.at(-1)?.added).toBeGreaterThan(0);
  });

  it("meets a score-aware niche target from the candidate window", () => {
    const result = rerankRecommendations(
      [
        candidate(1, 10),
        candidate(2, 9),
        candidate(3, 8),
        candidate(4, 7),
        candidate(5, 6, { voteCount: 100 }),
        candidate(6, 5, { voteCount: 200 }),
      ],
      { count: 4, lambda: 1, nicheRatio: 0.5 },
    );

    expect(result.candidates.map((item) => item.tmdbId)).toEqual([1, 2, 5, 6]);
    expect(result.diagnostics.nicheTarget).toBe(2);
    expect(result.diagnostics.nicheSelected).toBe(2);
  });

  it("lets calibration replace displayed results from a larger window", () => {
    const candidates = [
      { id: 1, score: 10, genres: ["Drama"] },
      { id: 2, score: 9, genres: ["Drama"] },
      { id: 3, score: 8, genres: ["Drama"] },
      { id: 4, score: 7, genres: ["Comedy"] },
    ];

    const calibrated = calibrateRecommendationWindow(
      candidates,
      { Drama: 0.5, Comedy: 0.5 },
      { targetCount: 2, windowSize: 4, strength: 1 },
    );

    expect(calibrated.slice(0, 2).map((item) => item.id)).toEqual([1, 4]);
    expect(calibrated.map((item) => item.id).sort()).toEqual([1, 2, 3, 4]);
  });
});
