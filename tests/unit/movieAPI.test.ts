import { afterEach, describe, expect, it, vi } from "vitest";

import { MovieAPIError, searchMovies } from "@/lib/movieAPI";

/**
 * These tests exercise the REAL searchMovies with global fetch mocked so the
 * TuiMDB/TMDB fallback policy is verified end-to-end. The critical contract:
 * a final TMDB failure (non-2xx, API error body, malformed body, or network
 * rejection) is a provider error and must REJECT. Only a genuinely successful
 * search with zero matches may resolve an empty array. Returning [] on an outage
 * would let callers (e.g. import enrichment) treat a provider failure as a
 * confirmed no-match and silently drop data.
 */

type MockResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

function jsonResponse(
  body: unknown,
  options: { ok?: boolean; status?: number } = {},
): MockResponse {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => body,
  };
}

function malformedJsonResponse(
  options: { ok?: boolean; status?: number } = {},
): MockResponse {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => {
      throw new SyntaxError("Unexpected token in JSON");
    },
  };
}

function stubFetch(
  handler: (url: string) => MockResponse | Promise<MockResponse>,
) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const isTmdb = (url: string) => url.includes("/api/tmdb/search");
const isTuiMDB = (url: string) => url.includes("/api/tuimdb/search");

const tmdbMovie = { id: 348, title: "Alien", release_date: "1979-05-25" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchMovies final TMDB failure policy", () => {
  it("rejects when the final TMDB search returns a non-2xx response", async () => {
    stubFetch((url) => {
      if (isTmdb(url)) {
        return jsonResponse(
          { ok: false, error: "rate limited" },
          { ok: false, status: 429 },
        );
      }
      throw new Error(`unexpected url ${url}`);
    });

    await expect(
      searchMovies({ query: "Alien", preferTuiMDB: false }),
    ).rejects.toThrow(MovieAPIError);
  });

  it("rejects when the final TMDB search reports an API error body", async () => {
    stubFetch((url) => {
      if (isTmdb(url)) {
        // HTTP 200 but the route reports an upstream API failure.
        return jsonResponse({ ok: false, error: "upstream timeout" });
      }
      throw new Error(`unexpected url ${url}`);
    });

    await expect(
      searchMovies({ query: "Alien", preferTuiMDB: false }),
    ).rejects.toThrow(MovieAPIError);
  });

  it("rejects when the final TMDB body is malformed JSON", async () => {
    stubFetch((url) => {
      if (isTmdb(url)) return malformedJsonResponse();
      throw new Error(`unexpected url ${url}`);
    });

    await expect(
      searchMovies({ query: "Alien", preferTuiMDB: false }),
    ).rejects.toThrow(MovieAPIError);
  });

  it("rejects when the final TMDB body is missing a results array", async () => {
    stubFetch((url) => {
      if (isTmdb(url)) return jsonResponse({ ok: true });
      throw new Error(`unexpected url ${url}`);
    });

    await expect(
      searchMovies({ query: "Alien", preferTuiMDB: false }),
    ).rejects.toThrow(MovieAPIError);
  });

  it("rejects when the network fetch itself rejects", async () => {
    stubFetch(() => {
      throw new Error("network down");
    });

    await expect(
      searchMovies({ query: "Alien", preferTuiMDB: false }),
    ).rejects.toThrow(/network down/);
  });

  it("resolves an empty array for a successful search with zero matches", async () => {
    stubFetch((url) => {
      if (isTmdb(url)) return jsonResponse({ ok: true, results: [] });
      throw new Error(`unexpected url ${url}`);
    });

    await expect(
      searchMovies({ query: "no-such-film", preferTuiMDB: false }),
    ).resolves.toEqual([]);
  });

  it("resolves results for a successful TMDB search", async () => {
    stubFetch((url) => {
      if (isTmdb(url)) return jsonResponse({ ok: true, results: [tmdbMovie] });
      throw new Error(`unexpected url ${url}`);
    });

    await expect(
      searchMovies({ query: "Alien", preferTuiMDB: false }),
    ).resolves.toEqual([tmdbMovie]);
  });
});

describe("searchMovies TuiMDB fallback policy", () => {
  it("falls back to TMDB and resolves results when TuiMDB fails", async () => {
    stubFetch((url) => {
      if (isTuiMDB(url)) throw new Error("tuimdb outage");
      if (isTmdb(url)) return jsonResponse({ ok: true, results: [tmdbMovie] });
      throw new Error(`unexpected url ${url}`);
    });

    await expect(
      searchMovies({ query: "Alien", preferTuiMDB: true }),
    ).resolves.toEqual([tmdbMovie]);
  });

  it("rejects when TuiMDB fails and the final TMDB fallback also fails", async () => {
    stubFetch((url) => {
      if (isTuiMDB(url)) throw new Error("tuimdb outage");
      if (isTmdb(url)) {
        return jsonResponse({ ok: false }, { ok: false, status: 500 });
      }
      throw new Error(`unexpected url ${url}`);
    });

    await expect(
      searchMovies({ query: "Alien", preferTuiMDB: true }),
    ).rejects.toThrow(MovieAPIError);
  });

  it("rejects when TuiMDB returns no results and the final TMDB fallback fails", async () => {
    stubFetch((url) => {
      if (isTuiMDB(url)) return jsonResponse({ ok: true, results: [] });
      if (isTmdb(url)) {
        return jsonResponse({ ok: false }, { ok: false, status: 503 });
      }
      throw new Error(`unexpected url ${url}`);
    });

    await expect(
      searchMovies({ query: "Alien", preferTuiMDB: true }),
    ).rejects.toThrow(MovieAPIError);
  });
});
