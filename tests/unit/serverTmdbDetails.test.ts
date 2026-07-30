import { describe, expect, it, vi } from "vitest";

import type { TMDBMovie } from "@/lib/enrich";

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

import { ensureCompleteTmdbDetails } from "@/lib/serverSuggestionsEngine";

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
    expect(Array.from(result.keys())).toEqual([
      101, 202, 303, 404, 505, 606, 707,
    ]);
    expect(maximumActiveRequests).toBeLessThanOrEqual(5);
    expect(maximumActiveRequests).toBe(5);
  });
});
