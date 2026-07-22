import { describe, expect, it } from "vitest";

import { applyNegativeFiltering } from "@/lib/advancedFiltering";
import type { EnhancedTasteProfile } from "@/lib/enhancedProfile";
import type { TMDBMovie } from "@/lib/enrich";
import {
  boostForCrossGenreMatch,
  type CrossGenrePattern,
} from "@/lib/subgenreDetection";
import * as advancedFiltering from "@/lib/advancedFiltering";

type Candidate = {
  tmdbId: number;
  score: number;
  genres: string[];
  reasons: string[];
};

type FilteringModule = typeof advancedFiltering & {
  stableScoreOrder: (candidates: readonly Candidate[]) => Candidate[];
  filterCandidatesByGenre: (
    candidates: readonly Candidate[],
    options: {
      requestedGenreNames: readonly string[];
      requestedCount: number;
      filterRelaxation?: "threshold" | "genre";
    },
  ) => {
    candidates: Candidate[];
    diagnostics: {
      reasons: string[];
      appliedStages: Array<"threshold" | "genre">;
    };
  };
};

const filtering = advancedFiltering as FilteringModule;

function candidate(
  tmdbId: number,
  score: number,
  genres: string[],
): Candidate {
  return { tmdbId, score, genres, reasons: [] };
}

function negativeProfile(avoidedKeywords: string[]): EnhancedTasteProfile {
  return {
    avoidedKeywords: new Set(avoidedKeywords),
    avoidedGenreCombos: new Set(),
  } as EnhancedTasteProfile;
}

function movie(keywords: string[]): TMDBMovie {
  return {
    id: 1,
    title: "Example",
    genres: [],
    keywords: {
      results: keywords.map((name, id) => ({ id: id + 1, name })),
    },
  };
}

describe("advanced filtering contracts", () => {
  it("strictly excludes nonmatching genres and reports insufficient supply", () => {
    const input = [
      candidate(1, 40, ["Action"]),
      candidate(2, 90, ["Comedy"]),
    ];

    const result = filtering.filterCandidatesByGenre(input, {
      requestedGenreNames: ["Action"],
      requestedCount: 2,
    });

    expect(result.candidates.map((item) => item.tmdbId)).toEqual([1]);
    expect(result.diagnostics.reasons).toEqual([
      "insufficient_eligible_supply",
    ]);
  });

  it("does not silently re-admit a below-threshold genre match", () => {
    const result = filtering.filterCandidatesByGenre(
      [candidate(1, 14.99, ["Action"]), candidate(2, 90, ["Comedy"])],
      { requestedGenreNames: ["Action"], requestedCount: 1 },
    );

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.reasons).toContain(
      "insufficient_eligible_supply",
    );
  });

  it("reports a strict shortage when every available candidate is eligible", () => {
    const result = filtering.filterCandidatesByGenre(
      [candidate(1, 40, ["Action"])],
      { requestedGenreNames: ["Action"], requestedCount: 2 },
    );

    expect(result.candidates.map((item) => item.tmdbId)).toEqual([1]);
    expect(result.diagnostics.reasons).toEqual([
      "insufficient_eligible_supply",
    ]);
  });

  it("reports a strict shortage when no candidates are available", () => {
    const result = filtering.filterCandidatesByGenre([], {
      requestedGenreNames: ["Action"],
      requestedCount: 2,
    });

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.reasons).toEqual([
      "insufficient_eligible_supply",
    ]);
  });

  it("matches avoided keywords canonically while preserving the two-keyword threshold", () => {
    const profile = negativeProfile(["  SPY ", " time travel "]);

    expect(applyNegativeFiltering(movie([" spy ", "TIME TRAVEL"]), profile)).toEqual(
      expect.objectContaining({ shouldFilter: true }),
    );
    expect(
      applyNegativeFiltering(movie([" spy "]), profile).shouldFilter,
    ).toBe(false);
  });

  it("orders a real cross-genre boost before the lower unboosted score", () => {
    const crossGenrePatterns = new Map<string, CrossGenrePattern>([
      [
        "Action+Thriller",
        {
          combination: "Action+Thriller",
          keywords: new Set(["spy"]),
          watched: 3,
          liked: 3,
          avgRating: 4.5,
          weight: 15,
          examples: ["Example Spy Film"],
        },
      ],
    ]);
    const crossGenreBoost = boostForCrossGenreMatch(
      ["Action", "Thriller"],
      ["Spy"],
      crossGenrePatterns,
    );
    const input = [
      {
        ...candidate(2, 10, ["Action", "Thriller"]),
        score: 10 + Math.min(crossGenreBoost.boost, 4),
      },
      candidate(1, 12, ["Action"]),
    ] as const;
    const snapshot = structuredClone(input);

    const ranked = filtering.stableScoreOrder(input);

    expect(crossGenreBoost.boost).toBeGreaterThan(0);
    expect(ranked.map((item) => item.tmdbId)).toEqual([2, 1]);
    expect(input).toEqual(snapshot);
  });

  it("ties effective scores by ascending TMDB ID", () => {
    const ranked = filtering.stableScoreOrder(
      [candidate(20, 10, ["Action"]), candidate(10, 10, ["Action"])],
    );

    expect(ranked.map((item) => item.tmdbId)).toEqual([10, 20]);
  });

  it("opts into threshold relaxation only when strict supply is insufficient", () => {
    const result = filtering.filterCandidatesByGenre(
      [
        candidate(1, 20, ["Action"]),
        candidate(2, 10, ["Action"]),
        candidate(3, 100, ["Comedy"]),
      ],
      {
        requestedGenreNames: [" Action "],
        requestedCount: 2,
        filterRelaxation: "threshold",
      },
    );

    expect(result.candidates.map((item) => item.tmdbId)).toEqual([1, 2]);
    expect(result.diagnostics.appliedStages).toEqual(["threshold"]);
    expect(result.diagnostics.reasons).toEqual([]);
  });

  it("keeps strict matches ahead of relaxed matches in incoming order", () => {
    const result = filtering.filterCandidatesByGenre(
      [
        candidate(1, 10, ["Action"]),
        candidate(2, 20, ["Action"]),
        candidate(3, 5, ["Action"]),
      ],
      {
        requestedGenreNames: ["Action"],
        requestedCount: 2,
        filterRelaxation: "threshold",
      },
    );

    expect(result.candidates.map((item) => item.tmdbId)).toEqual([2, 1]);
    expect(result.diagnostics.appliedStages).toEqual(["threshold"]);
  });

  it("excludes non-finite scores from strict and relaxed genre stages", () => {
    const input = [
      candidate(10, Number.NaN, ["Action"]),
      candidate(11, Number.POSITIVE_INFINITY, ["Action"]),
      candidate(12, Number.NEGATIVE_INFINITY, ["Action"]),
      candidate(1, 20, ["Action"]),
      candidate(2, 7, ["Action"]),
      candidate(3, 50, ["Comedy"]),
    ];

    const strict = filtering.filterCandidatesByGenre(input, {
      requestedGenreNames: ["Action"],
      requestedCount: 5,
    });
    const threshold = filtering.filterCandidatesByGenre(input, {
      requestedGenreNames: ["Action"],
      requestedCount: 5,
      filterRelaxation: "threshold",
    });
    const genre = filtering.filterCandidatesByGenre(input, {
      requestedGenreNames: ["Action"],
      requestedCount: 5,
      filterRelaxation: "genre",
    });

    expect(strict.candidates.map((item) => item.tmdbId)).toEqual([1]);
    expect(threshold.candidates.map((item) => item.tmdbId)).toEqual([1, 2]);
    expect(genre.candidates.map((item) => item.tmdbId)).toEqual([1, 2, 3]);
    for (const result of [strict, threshold, genre]) {
      expect(result.candidates.every((item) => Number.isFinite(item.score))).toBe(
        true,
      );
    }
  });

  it("excludes non-finite scores without a genre request", () => {
    const result = filtering.filterCandidatesByGenre(
      [
        candidate(10, Number.NaN, ["Action"]),
        candidate(11, Number.POSITIVE_INFINITY, ["Action"]),
        candidate(1, 20, ["Drama"]),
      ],
      { requestedGenreNames: [], requestedCount: 3 },
    );

    expect(result.candidates.map((item) => item.tmdbId)).toEqual([1]);
  });

  it("stages genre relaxation after threshold-relaxed matching supply", () => {
    const result = filtering.filterCandidatesByGenre(
      [
        candidate(1, 20, ["Action"]),
        candidate(2, 10, ["Action"]),
        candidate(3, 100, ["Comedy"]),
      ],
      {
        requestedGenreNames: ["Action"],
        requestedCount: 3,
        filterRelaxation: "genre",
      },
    );

    expect(result.candidates.map((item) => item.tmdbId)).toEqual([1, 2, 3]);
    expect(result.diagnostics.appliedStages).toEqual(["threshold", "genre"]);
    expect(result.diagnostics.reasons).toEqual([]);
  });

  it("preserves duplicate entries and incoming order at the genre boundary", () => {
    const result = filtering.filterCandidatesByGenre(
      [
        candidate(2, 20, ["Action"]),
        candidate(1, 30, ["Action"]),
        candidate(2, 99, ["Action"]),
      ],
      { requestedGenreNames: ["Action"], requestedCount: 3 },
    );

    expect(result.candidates.map((item) => item.tmdbId)).toEqual([2, 1, 2]);
  });
});
