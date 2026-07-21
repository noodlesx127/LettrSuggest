import { describe, expect, it, vi } from "vitest";

import {
  generateServerCandidates,
  type TasteProfile,
  type UserContext,
} from "@/lib/serverSuggestionsEngine";
import {
  deriveGenerateRequestSeed,
  filterGeneratedCandidateIds,
} from "@/app/api/v1/suggestions/generate/routeHelpers";

vi.mock("@/app/api/v1/_lib/tmdb", () => ({
  fetchTmdb: vi.fn(async () => ({ results: [] })),
}));

type ProviderCall = {
  path: string;
  params?: Record<string, string | number | undefined>;
};

const userContext: UserContext = {
  films: [
    {
      uri: "letterboxd://film/history-a",
      title: "History A",
      year: 2020,
      rating: 5,
      rewatch: false,
      last_date: "2026-01-01",
      watch_count: 1,
      liked: true,
      on_watchlist: false,
    },
    {
      uri: "letterboxd://film/history-b",
      title: "History B",
      year: 2021,
      rating: 4,
      rewatch: false,
      last_date: "2026-01-02",
      watch_count: 1,
      liked: true,
      on_watchlist: false,
    },
  ],
  mappings: new Map([
    ["letterboxd://film/history-a", 303],
    ["letterboxd://film/history-b", 404],
  ]),
  mappingsArray: [],
  feedback: [],
  explorationRate: 0.15,
  adjacentGenres: [],
  recentExposures: new Map(),
  blockedIds: new Set(),
};

const tasteProfile = {
  topGenres: [{ id: 28, name: "Action", weight: 1 }],
} as TasteProfile;

function createProvider(calls: ProviderCall[]) {
  return async <T>(
    path: string,
    params?: Record<string, string | number | undefined>,
  ): Promise<T> => {
    calls.push({ path, params });

    if (path === "/trending/movie/day") {
      return { results: [{ id: 9101 }] } as T;
    }

    if (path === "/trending/movie/week") {
      return { results: [{ id: 9201 }] } as T;
    }

    if (path === "/discover/movie") {
      return {
        results: [{ id: 9300 + Number(params?.page ?? 0) }],
      } as T;
    }

    const match = path.match(/^\/movie\/(\d+)\/recommendations$/);
    if (match) {
      const tmdbId = Number(match[1]);
      return { results: [{ id: tmdbId + 1000 }, { id: tmdbId }] } as T;
    }

    return { results: [] } as T;
  };
}

function runGeneration(
  requestSeed: string,
  context: UserContext = userContext,
  seedTmdbIds = [101, 303, 202],
) {
  const calls: ProviderCall[] = [];

  return generateServerCandidates(
    "user-1",
    context,
    tasteProfile,
    seedTmdbIds,
    {
      requestSeed,
      provider: createProvider(calls),
    },
  ).then((result) => ({ calls, result }));
}

function createEqualScoreHistoryContext(
  tmdbIds: readonly number[],
  uriPrefix: string,
): UserContext {
  const films = tmdbIds.map((tmdbId) => ({
    uri: `letterboxd://${uriPrefix}/${tmdbId}`,
    title: `History ${tmdbId}`,
    year: 2020,
    rating: 4,
    rewatch: false,
    last_date: "2026-01-01",
    watch_count: 1,
    liked: true,
    on_watchlist: false,
  }));

  return {
    ...userContext,
    films,
    mappings: new Map(
      films.map((film, index) => [film.uri, tmdbIds[index]]),
    ),
  };
}

describe("explicit recommendation seeds", () => {
  it("uses explicit seeds as neighborhood anchors without returning them", async () => {
    const { calls, result } = await runGeneration("seed-1");

    expect(
      calls
        .filter((call) => call.path.includes("/recommendations"))
        .map((call) => Number(call.path.split("/")[2])),
    ).toEqual([101, 202, 303, 404]);
    const explicitSeeds = new Set([101, 303, 202]);
    expect(result.candidateIds.filter((id) => explicitSeeds.has(id))).toEqual(
      [],
    );
    expect(
      Array.from(result.sourceMetadata.keys()).filter((id) =>
        explicitSeeds.has(id),
      ),
    ).toEqual([]);
  });

  it("keeps explicit anchors first and history anchors deterministically deduped", async () => {
    const first = await runGeneration("seed-2");
    const second = await runGeneration("seed-2");

    const firstAnchors = first.calls
      .filter((call) => call.path.includes("/recommendations"))
      .map((call) => Number(call.path.split("/")[2]));
    const secondAnchors = second.calls
      .filter((call) => call.path.includes("/recommendations"))
      .map((call) => Number(call.path.split("/")[2]));

    expect(firstAnchors.slice(0, 3)).toEqual([101, 202, 303]);
    expect(new Set(firstAnchors).size).toBe(firstAnchors.length);
    expect(secondAnchors).toEqual(firstAnchors);
  });

  it("canonicalizes explicit seed order before neighborhood retrieval", async () => {
    const first = await runGeneration("canonical-seeds", userContext, [
      202,
      101,
      202,
    ]);
    const second = await runGeneration("canonical-seeds", userContext, [
      101,
      202,
    ]);

    expect(first.calls).toEqual(second.calls);
    expect(first.result.candidateIds).toEqual(second.result.candidateIds);
  });

  it("makes equal-score history input order independent before shuffling", async () => {
    const historyIds = [707, 808, 909, 1001, 1102];
    const first = await runGeneration(
      "equal-history-order",
      createEqualScoreHistoryContext(historyIds, "same-order"),
      [101, 202],
    );
    const second = await runGeneration(
      "equal-history-order",
      createEqualScoreHistoryContext([...historyIds].reverse(), "same-order"),
      [101, 202],
    );

    expect(first.calls).toEqual(second.calls);
    expect(first.result.candidateIds).toEqual(second.result.candidateIds);
  });

  it("makes provider choices and candidates repeatable for an equal request seed", async () => {
    const deterministicContext: UserContext = {
      ...userContext,
      films: [
        ...userContext.films,
        {
          uri: "letterboxd://film/history-c",
          title: "History C",
          year: 2022,
          rating: 4.5,
          rewatch: false,
          last_date: "2026-01-03",
          watch_count: 1,
          liked: true,
          on_watchlist: false,
        },
        {
          uri: "letterboxd://film/history-d",
          title: "History D",
          year: 2023,
          rating: 3.5,
          rewatch: false,
          last_date: "2026-01-04",
          watch_count: 1,
          liked: true,
          on_watchlist: false,
        },
      ],
      mappings: new Map([
        ...userContext.mappings,
        ["letterboxd://film/history-c", 505],
        ["letterboxd://film/history-d", 606],
      ]),
    };
    const mathRandom = vi.spyOn(Math, "random");

    try {
      mathRandom.mockReturnValue(0.01);
      const first = await runGeneration(
        "same-request",
        deterministicContext,
        [101, 202],
      );
      mathRandom.mockReturnValue(0.99);
      const second = await runGeneration(
        "same-request",
        deterministicContext,
        [101, 202],
      );

      const historyAnchors = first.calls
        .filter((call) => call.path.includes("/recommendations"))
        .map((call) => Number(call.path.split("/")[2]));
      const trendingCall = first.calls.find((call) =>
        call.path.startsWith("/trending/movie/"),
      );
      const discoverCall = first.calls.find(
        (call) => call.path === "/discover/movie",
      );

      expect(historyAnchors).toHaveLength(6);
      expect(new Set(historyAnchors).size).toBe(historyAnchors.length);
      expect(trendingCall?.path).toMatch(/^\/trending\/movie\/(day|week)$/);
      expect(discoverCall?.params?.page).toMatch(/^[1-5]$/);
      expect(second.calls).toEqual(first.calls);
      expect(second.result.candidateIds).toEqual(first.result.candidateIds);
      expect(Array.from(second.result.sourceMetadata.entries())).toEqual(
        Array.from(first.result.sourceMetadata.entries()),
      );
    } finally {
      mathRandom.mockRestore();
    }
  });

  it("keeps the global weak-seed blacklist active for history anchors", async () => {
    const weakSeedContext: UserContext = {
      ...userContext,
      films: [
        ...userContext.films,
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
      mappings: new Map([
        ...userContext.mappings,
        ["letterboxd://film/weak-seed", 9352],
      ]),
    };
    const { calls } = await runGeneration("weak-seed", weakSeedContext, []);

    expect(
      calls
        .filter((call) => call.path.includes("/recommendations"))
        .map((call) => Number(call.path.split("/")[2])),
    ).not.toContain(9352);
  });

  it("limits all provider calls without dropping explicit or history anchors", async () => {
    const explicitSeeds = Array.from({ length: 15 }, (_, index) => 1501 + index);
    const historyIds = Array.from({ length: 12 }, (_, index) => 3001 + index);
    const context = createEqualScoreHistoryContext(historyIds, "concurrency");
    const calls: ProviderCall[] = [];
    let active = 0;
    let maximumActive = 0;

    const provider = async <T>(
      path: string,
      params?: Record<string, string | number | undefined>,
    ): Promise<T> => {
      calls.push({ path, params });
      active += 1;
      maximumActive = Math.max(maximumActive, active);

      try {
        await new Promise((resolve) => setTimeout(resolve, 1));

        if (path.endsWith("/recommendations")) {
          return { results: [] } as T;
        }

        if (path.endsWith("/similar")) {
          const tmdbId = Number(path.split("/")[2]);
          return { results: [{ id: tmdbId + 50000 }] } as T;
        }

        return { results: [] } as T;
      } finally {
        active -= 1;
      }
    };

    const result = await generateServerCandidates(
      "user-1",
      context,
      tasteProfile,
      explicitSeeds,
      {
        requestSeed: "provider-concurrency",
        provider,
      },
    );
    const recommendationAnchors = calls
      .filter((call) => call.path.endsWith("/recommendations"))
      .map((call) => Number(call.path.split("/")[2]));
    const similarAnchors = calls
      .filter((call) => call.path.endsWith("/similar"))
      .map((call) => Number(call.path.split("/")[2]));

    expect(maximumActive).toBeGreaterThan(1);
    expect(maximumActive).toBeLessThanOrEqual(5);
    expect(recommendationAnchors.slice(0, explicitSeeds.length)).toEqual(
      explicitSeeds,
    );
    expect(new Set(recommendationAnchors.slice(explicitSeeds.length))).toEqual(
      new Set(historyIds),
    );
    expect(recommendationAnchors).toHaveLength(27);
    expect(similarAnchors).toHaveLength(27);
    expect(result.candidateIds).toHaveLength(27);
  });
});

describe("suggestion route seed boundaries", () => {
  const canonicalInputs = {
    userId: "user-1",
    seedTmdbIds: [101, 202],
    limit: 10,
    excludeTmdbIds: [900, 800],
    genreIds: [28, 18],
  };

  it("derives a canonical request seed independently of request IDs", () => {
    const deriveWithRequestId = (requestId: string) =>
      deriveGenerateRequestSeed({
        ...canonicalInputs,
        requestId,
      } as Parameters<typeof deriveGenerateRequestSeed>[0]);

    expect(deriveWithRequestId("random-request-a")).toBe(
      deriveWithRequestId("random-request-b"),
    );
    expect(
      deriveGenerateRequestSeed({
        ...canonicalInputs,
        seedTmdbIds: [202, 101, 202],
        excludeTmdbIds: [800, 900],
        genreIds: [18, 28],
      }),
    ).toBe(deriveWithRequestId("random-request-c"));
    expect(
      deriveGenerateRequestSeed({
        ...canonicalInputs,
        genreIds: undefined,
      }),
    ).toBe(
      deriveGenerateRequestSeed({
        ...canonicalInputs,
        genreIds: [],
      }),
    );
  });

  it("changes the request seed for every canonical request input", () => {
    const hashes = [
      deriveGenerateRequestSeed(canonicalInputs),
      deriveGenerateRequestSeed({ ...canonicalInputs, userId: "user-2" }),
      deriveGenerateRequestSeed({
        ...canonicalInputs,
        seedTmdbIds: [101, 203],
      }),
      deriveGenerateRequestSeed({ ...canonicalInputs, limit: 11 }),
      deriveGenerateRequestSeed({
        ...canonicalInputs,
        excludeTmdbIds: [900, 801],
      }),
      deriveGenerateRequestSeed({
        ...canonicalInputs,
        genreIds: [28, 35],
      }),
    ];

    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("defensively excludes explicit seeds at the route output boundary", () => {
    expect(
      filterGeneratedCandidateIds({
        candidateIds: [101, 700, 202, 900, 800],
        seedTmdbIds: [101, 202],
        excludeTmdbIds: [900],
        blockedIds: new Set([800]),
      }),
    ).toEqual([700]);
  });
});
