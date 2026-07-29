import { describe, expect, it, vi } from "vitest";

import {
  generateServerCandidates,
  type TasteProfile,
  type UserContext,
} from "@/lib/serverSuggestionsEngine";
import { discoverMoviesByProfile } from "@/lib/trending";

type ProviderCall = {
  path: string;
  params?: Record<string, string | number | undefined>;
};

const emptyInputHealth: UserContext["inputHealth"] = {
  films: { health: "empty", rowCount: 0 },
  mappings: { health: "empty", rowCount: 0 },
  feedback: { health: "empty", rowCount: 0 },
  exploration: { health: "empty", rowCount: 0 },
  adjacent_genres: { health: "empty", rowCount: 0 },
  exposures: { health: "empty", rowCount: 0 },
  blocked: { health: "empty", rowCount: 0 },
};

const emptyContext: UserContext = {
  films: [],
  mappings: new Map(),
  mappingsArray: [],
  feedback: [],
  explorationRate: 0.15,
  adjacentGenres: [],
  recentExposures: new Map(),
  blockedIds: new Set(),
  inputHealth: emptyInputHealth,
  failedSources: [],
  mode: "cold_start",
};

const tasteProfile = {
  topGenres: [],
} as unknown as TasteProfile;

function createProvider(calls: ProviderCall[]) {
  return async <T>(
    path: string,
    params?: Record<string, string | number | undefined>,
  ): Promise<T> => {
    calls.push({ path, params });

    if (path.startsWith("/trending/movie/")) {
      return { results: [{ id: 7002 }, { id: 7001 }] } as T;
    }

    return { results: [] } as T;
  };
}

describe("deterministic recommendation retrieval", () => {
  it("uses the request seed instead of ambient randomness for provider pages", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, results: [] }),
      } as Response);
    const mathRandom = vi.spyOn(Math, "random");

    const run = async (ambientRandom: number) => {
      mathRandom.mockReturnValue(ambientRandom);
      const calls: string[] = [];
      const beforeCallCount = fetchMock.mock.calls.length;
      await discoverMoviesByProfile({
        genres: [28],
        limit: 10,
        randomizePage: true,
        requestSeed: "same-request",
      } as never);
      for (const call of fetchMock.mock.calls.slice(beforeCallCount)) {
        calls.push(String(call[0]));
      }
      return calls;
    };

    try {
      const first = await run(0.01);
      const second = await run(0.99);

      expect(second).toEqual(first);
      expect(first[0]).toMatch(/[?&]page=(?:[1-9]|10)(?:&|$)/);
    } finally {
      mathRandom.mockRestore();
      fetchMock.mockRestore();
    }
  });

  it("breaks equal retrieval ties by ascending TMDB ID", async () => {
    const calls: ProviderCall[] = [];
    const result = await generateServerCandidates(
      "tie-user",
      emptyContext,
      tasteProfile,
      [101],
      {
        requestSeed: "stable-tie",
        provider: createProvider(calls),
      },
    );

    expect(result.candidateIds).toEqual([7001, 7002]);
  });

  it("uses weights when choosing a bounded seed subset", async () => {
    const { selectWeightedSeeds } = await import(
      "@/lib/recommendationCandidates"
    );
    const selected = selectWeightedSeeds(
      [
        { tmdbId: 30, weight: 1, source: "history" },
        { tmdbId: 20, weight: 3, source: "feedback" },
        { tmdbId: 10, weight: 2, source: "watchlist" },
      ],
      2,
      () => 0.5,
    );

    expect(selected).toEqual([
      { tmdbId: 20, weight: 3, source: "feedback" },
      { tmdbId: 10, weight: 2, source: "watchlist" },
    ]);
  });

  it("retains high-intent candidates while applying source quotas before truncation", async () => {
    const { applySourceIntentQuotas } = await import(
      "@/lib/recommendationCandidates"
    );
    const retained = applySourceIntentQuotas(
      [
        { tmdbId: 10, source: "tmdb", intent: "exploration", score: 100 },
        { tmdbId: 20, source: "tmdb", intent: "exploration", score: 99 },
        { tmdbId: 30, source: "tmdb", intent: "explicit", score: 1 },
        { tmdbId: 40, source: "tastedive", intent: "watchlist", score: 0.9 },
      ],
      {
        limit: 3,
        sourceQuotas: { tmdb: 2, tastedive: 1 },
        intentQuotas: { explicit: 1, watchlist: 1 },
      },
    );

    expect(retained.map((candidate) => candidate.tmdbId)).toEqual([10, 30, 40]);
  });

  it("treats intent quotas as reservations and preserves multi-source supply", async () => {
    const { applySourceIntentQuotas } = await import(
      "@/lib/recommendationCandidates"
    );
    const retained = applySourceIntentQuotas(
      [
        { tmdbId: 10, sources: ["trending", "similar:1"], score: 100 },
        { tmdbId: 20, source: "trending", score: 99 },
        { tmdbId: 30, source: "similar:2", intent: "explicit", score: 98 },
        { tmdbId: 40, source: "similar:3", intent: "explicit", score: 97 },
      ],
      {
        limit: 3,
        sourceQuotas: { trending: 1 },
        intentQuotas: { explicit: 1 },
      },
    );

    expect(retained.map((candidate) => candidate.tmdbId)).toEqual([10, 30, 40]);
  });

  it("does not apply a global taste-specific weak-seed blacklist", async () => {
    const weakSeedContext: UserContext = {
      ...emptyContext,
      films: [
        {
          uri: "letterboxd://film/weak-seed",
          title: "Weak Seed",
          year: 2024,
          rating: 5,
          rewatch: false,
          last_date: "2026-01-03",
          watch_count: 1,
          liked: true,
          on_watchlist: false,
        },
      ],
      mappings: new Map([["letterboxd://film/weak-seed", 9352]]),
    };
    const calls: ProviderCall[] = [];

    await generateServerCandidates(
      "weak-seed-user",
      weakSeedContext,
      tasteProfile,
      [],
      {
        requestSeed: "weak-seed-request",
        provider: createProvider(calls),
      },
    );

    expect(
      calls
        .filter((call) => call.path.endsWith("/recommendations"))
        .map((call) => Number(call.path.split("/")[2])),
    ).toContain(9352);
  });

  it("allows watchlist-only mapped films into candidates without re-recommending watched films", async () => {
    const watchlistOnlyContext: UserContext = {
      ...emptyContext,
      films: [
        {
          uri: "letterboxd://film/watchlist-only",
          title: "Watchlist Only",
          year: 2024,
          rating: null,
          rewatch: false,
          last_date: null,
          watch_count: null,
          liked: false,
          on_watchlist: true,
        },
        {
          uri: "letterboxd://film/watched",
          title: "Watched",
          year: 2023,
          rating: 4,
          rewatch: false,
          last_date: "2026-01-03",
          watch_count: 1,
          liked: false,
          on_watchlist: false,
        },
      ],
      mappings: new Map([
        ["letterboxd://film/watchlist-only", 10],
        ["letterboxd://film/watched", 20],
      ]),
    };
    const calls: ProviderCall[] = [];
    const provider = async <T>(
      path: string,
      params?: Record<string, string | number | undefined>,
    ): Promise<T> => {
      calls.push({ path, params });
      if (path.startsWith("/trending/movie/")) {
        return { results: [{ id: 10 }, { id: 20 }] } as T;
      }
      return { results: [] } as T;
    };

    const result = await generateServerCandidates(
      "watchlist-candidate-user",
      watchlistOnlyContext,
      tasteProfile,
      [],
      { requestSeed: "watchlist-candidate", provider },
    );

    expect(result.candidateIds).toContain(10);
    expect(result.candidateIds).not.toContain(20);
  });
});
