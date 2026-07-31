import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TMDBMovie } from "@/lib/enrich";
import type { UserContext } from "@/lib/serverSuggestionsEngine";

const serverTmdbMocks = vi.hoisted(() => ({
  fetchTmdb: vi.fn(),
  getSupabaseAdmin: vi.fn(),
}));

vi.mock("@/app/api/v1/_lib/tmdb", () => ({
  fetchTmdb: serverTmdbMocks.fetchTmdb,
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: serverTmdbMocks.getSupabaseAdmin,
}));

import {
  ensureCompleteTmdbDetails,
  getRelevantTasteTmdbIds,
  getRequiredMetadataCount,
  isMetadataCompletionHealthy,
  type TmdbMetadataCompletion,
} from "@/lib/serverSuggestionsEngine";

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  serverTmdbMocks.fetchTmdb.mockReset();
  serverTmdbMocks.getSupabaseAdmin.mockReset();
});

function completeMovie(id: number): TMDBMovie {
  return {
    id,
    title: `Movie ${id}`,
    credits: { cast: [], crew: [] },
    keywords: { keywords: [] },
  };
}

describe("ensureCompleteTmdbDetails", () => {
  it("fetches each unique missing ID once, preserves order, and limits concurrency", async () => {
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    const releaseCallbacks: Array<() => void> = [];
    let startedRequests = 0;
    const requestWaiters: Array<{
      target: number;
      resolve: () => void;
    }> = [];
    const waitForStartedRequests = (target: number) => {
      if (startedRequests >= target) return Promise.resolve();

      return new Promise<void>((resolve) => {
        requestWaiters.push({ target, resolve });
      });
    };
    const recordStartedRequest = () => {
      startedRequests += 1;

      for (let index = requestWaiters.length - 1; index >= 0; index -= 1) {
        if (startedRequests >= requestWaiters[index].target) {
          requestWaiters[index].resolve();
          requestWaiters.splice(index, 1);
        }
      }
    };
    const upsert = vi.fn(
      async (
        _payload: { tmdb_id: number; data: TMDBMovie },
        _options: { onConflict: string },
      ) => ({ error: null }),
    );
    const from = vi.fn(() => ({ upsert }));

    serverTmdbMocks.getSupabaseAdmin.mockReturnValue({ from });
    serverTmdbMocks.fetchTmdb.mockImplementation(async (path: string) => {
      activeRequests += 1;
      maximumActiveRequests = Math.max(
        maximumActiveRequests,
        activeRequests,
      );

      try {
        await new Promise<void>((resolve) => {
          releaseCallbacks.push(resolve);
          recordStartedRequest();
        });
        return completeMovie(Number(path.split("/").at(-1)));
      } finally {
        activeRequests -= 1;
      }
    });

    const resultPromise = ensureCompleteTmdbDetails(
      [101, 101, 202, 303, 404, 505, 606, 707],
      new Map(),
    );

    await waitForStartedRequests(5);
    expect(releaseCallbacks).toHaveLength(5);
    releaseCallbacks.splice(0, 5).forEach((release) => release());

    await waitForStartedRequests(7);
    expect(releaseCallbacks).toHaveLength(2);
    releaseCallbacks.splice(0, 2).forEach((release) => release());

    const result = await resultPromise;

    expect(
      serverTmdbMocks.fetchTmdb.mock.calls.map(([path]) =>
        Number(String(path).split("/").at(-1)),
      ),
    ).toEqual([101, 202, 303, 404, 505, 606, 707]);
    expect(upsert.mock.calls.map(([payload]) => payload.tmdb_id)).toEqual([
      101, 202, 303, 404, 505, 606, 707,
    ]);
    expect(result).toMatchObject({
      requested: 7,
      completed: 7,
      failed: 0,
      deadlineExpired: false,
    });
    expect(Array.from(result.details.keys())).toEqual([
      101, 202, 303, 404, 505, 606, 707,
    ]);
    expect(maximumActiveRequests).toBeLessThanOrEqual(5);
    expect(maximumActiveRequests).toBe(5);
  });

  it("counts complete cache hits in the unique request totals", async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    const from = vi.fn(() => ({ upsert }));
    serverTmdbMocks.getSupabaseAdmin.mockReturnValue({ from });
    serverTmdbMocks.fetchTmdb.mockImplementation(async (path: string) =>
      completeMovie(Number(path.split("/").at(-1))),
    );

    const result = await ensureCompleteTmdbDetails(
      [101, 101, 202],
      new Map([[101, completeMovie(101)]]),
    );

    expect(result).toMatchObject({
      requested: 2,
      completed: 2,
      failed: 0,
      deadlineExpired: false,
    });
    expect(Array.from(result.details.keys())).toEqual([101, 202]);
    expect(serverTmdbMocks.fetchTmdb).toHaveBeenCalledTimes(1);
  });

  it("reports failed metadata and rejects an unhealthy completion", async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    const from = vi.fn(() => ({ upsert }));
    serverTmdbMocks.getSupabaseAdmin.mockReturnValue({ from });
    serverTmdbMocks.fetchTmdb.mockImplementation(async (path: string) => {
      const tmdbId = Number(path.split("/").at(-1));
      if (tmdbId === 202) throw new Error("metadata unavailable");
      return completeMovie(tmdbId);
    });

    const result = await ensureCompleteTmdbDetails(
      [101, 202, 303],
      new Map(),
    );

    expect(result).toMatchObject({
      requested: 3,
      completed: 2,
      failed: 1,
      deadlineExpired: false,
    });
    expect(Array.from(result.details.keys())).toEqual([101, 303]);
    expect(isMetadataCompletionHealthy(result, 3)).toBe(false);
  });

  it("uses the bounded completion threshold for healthy and unhealthy pools", () => {
    expect(getRequiredMetadataCount(300, 100)).toBe(180);
    expect(getRequiredMetadataCount(70, 100)).toBe(70);
    expect(getRequiredMetadataCount(100, 20)).toBe(60);

    const healthy: TmdbMetadataCompletion = {
      details: new Map(),
      requested: 100,
      completed: 60,
      failed: 40,
      deadlineExpired: true,
    };
    const unhealthy: TmdbMetadataCompletion = {
      ...healthy,
      completed: 59,
      failed: 41,
    };

    expect(isMetadataCompletionHealthy(healthy, 20)).toBe(true);
    expect(isMetadataCompletionHealthy(unhealthy, 20)).toBe(false);
  });

  it("stops queued metadata work at the shared deadline", async () => {
    vi.useFakeTimers();

    let startedRequests = 0;
    const releaseCallbacks: Array<() => void> = [];
    const upsert = vi.fn(async () => ({ error: null }));
    const from = vi.fn(() => ({ upsert }));
    serverTmdbMocks.getSupabaseAdmin.mockReturnValue({ from });
    serverTmdbMocks.fetchTmdb.mockImplementation((path: string) => {
      startedRequests += 1;
      const tmdbId = Number(path.split("/").at(-1));
      return new Promise<TMDBMovie>((resolve) => {
        releaseCallbacks.push(() => resolve(completeMovie(tmdbId)));
      });
    });

    const resultPromise = ensureCompleteTmdbDetails(
      [101, 202, 303, 404, 505, 606, 707],
      new Map(),
      { deadlineMs: 20_000 },
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(startedRequests).toBe(5);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(startedRequests).toBe(5);

    releaseCallbacks.forEach((release) => release());
    const result = await resultPromise;

    expect(result).toMatchObject({
      requested: 7,
      completed: 5,
      failed: 2,
      deadlineExpired: true,
    });
    expect(Array.from(result.details.keys())).toEqual([
      101, 202, 303, 404, 505,
    ]);
  });

  it("caps relevant taste metadata IDs in deterministic seed order", () => {
    const films = Array.from({ length: 350 }, (_, index) => ({
      uri: `letterboxd://film/${index + 1}`,
      title: `Film ${index + 1}`,
      year: null,
      rating: 4,
      rewatch: false,
      last_date: new Date(Date.UTC(2020, 0, index + 1)).toISOString(),
      watch_count: 1,
      liked: false,
      on_watchlist: false,
    })).reverse();
    const mappings = new Map(
      films.map((film) => [
        film.uri,
        Number(film.uri.split("/").at(-1)),
      ]),
    );
    const context: UserContext = {
      films,
      mappings,
      mappingsArray: Array.from(mappings, ([uri, tmdb_id]) => ({
        uri,
        tmdb_id,
      })),
      feedback: [],
      explorationRate: 0.15,
      adjacentGenres: [],
      recentExposures: new Map(),
      blockedIds: new Set(),
      inputHealth: {} as UserContext["inputHealth"],
      failedSources: [],
      mode: "personalized",
    };

    expect(getRelevantTasteTmdbIds(context)).toEqual(
      Array.from({ length: 300 }, (_, index) => 350 - index),
    );
  });
});
