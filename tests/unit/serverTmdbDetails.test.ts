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
        await new Promise((resolve) => setTimeout(resolve, 5));
        return completeMovie(Number(path.split("/").at(-1)));
      } finally {
        activeRequests -= 1;
      }
    });

    const result = await ensureCompleteTmdbDetails(
      [101, 101, 202, 303, 404, 505, 606, 707],
      new Map(),
    );

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
  });
});
