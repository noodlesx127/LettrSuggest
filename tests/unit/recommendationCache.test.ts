import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRecommendationRevision,
  createTasteProfileCacheWritePayload,
  decideTasteProfileCache,
  getBoundedTasteProfileCacheDiagnostics,
  isTasteProfileCacheValid,
  stableCanonicalSerialize,
  type RecommendationRevisionInput,
} from "@/lib/recommendationRevision";
import {
  buildTasteProfileCacheRevision,
  buildTasteProfileServer,
  type UserContext,
} from "@/lib/serverSuggestionsEngine";

const cachePathMocks = vi.hoisted(() => ({
  buildTasteProfile: vi.fn(),
  getSupabaseAdmin: vi.fn(),
  fetchTmdb: vi.fn(),
}));

vi.mock("@/lib/enrich", () => ({
  buildTasteProfile: cachePathMocks.buildTasteProfile,
  getAvoidedFeatures: vi.fn(),
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: cachePathMocks.getSupabaseAdmin,
}));

vi.mock("@/app/api/v1/_lib/tmdb", () => ({
  fetchTmdb: cachePathMocks.fetchTmdb,
}));

const NOW = Date.parse("2026-07-28T12:00:00.000Z");

const baseInput: RecommendationRevisionInput = {
  films: [
    {
      uri: "letterboxd://film/alpha",
      title: "Alpha",
      year: 2020,
      rating: 4,
      rewatch: false,
      lastDate: "2026-07-01",
      watchCount: 1,
      liked: true,
      onWatchlist: true,
    },
    {
      uri: "letterboxd://film/beta",
      title: "Beta",
      year: 2021,
      rating: 3,
      rewatch: true,
      lastDate: "2026-06-01",
      watchCount: 2,
      liked: false,
      onWatchlist: true,
    },
  ],
  mappings: [
    { uri: "letterboxd://film/alpha", tmdbId: 101 },
    { uri: "letterboxd://film/beta", tmdbId: 202 },
  ],
  watchlist: [
    {
      uri: "letterboxd://film/alpha",
      watchlistAddedAt: "2026-06-20T12:00:00.000Z",
    },
    {
      uri: "letterboxd://film/beta",
      watchlistAddedAt: "2026-06-21T12:00:00.000Z",
    },
  ],
  feedback: [
    {
      featureId: 7,
      featureName: "Mystery",
      featureType: "genre",
      inferredPreference: 0.8,
      positiveCount: 4,
      negativeCount: 1,
    },
    {
      featureId: 8,
      featureName: "Noir",
      featureType: "keyword",
      inferredPreference: 0.2,
      positiveCount: 1,
      negativeCount: 3,
    },
  ],
  quizState: {
    status: "ok",
    responseCount: 2,
    latestResponseId: 12,
    latestResponseAt: "2026-07-03T12:00:00.000Z",
  },
  blockedIds: [909, 910],
  metadataVersion: "tmdb-metadata-v1",
  profileModelVersion: "taste-profile-v1",
};

type OkQuizState = Extract<
  RecommendationRevisionInput["quizState"],
  { status: "ok" }
>;
const baseQuizState = baseInput.quizState as OkQuizState;

const productionRevisionInput: RecommendationRevisionInput = {
  films: [
    {
      uri: "letterboxd://film/cache",
      title: "Cache Fixture",
      year: 2020,
      rating: 2,
      rewatch: false,
      lastDate: "2026-07-01",
      watchCount: 1,
      liked: false,
      onWatchlist: false,
    },
  ],
  mappings: [{ uri: "letterboxd://film/cache", tmdbId: 404 }],
  watchlist: [],
  feedback: [],
  quizState: baseQuizState,
  blockedIds: [],
  metadataVersion: "tmdb-metadata-v1",
  profileModelVersion: "taste-profile-v1",
};

const productionContext: UserContext = {
  films: [
    {
      uri: "letterboxd://film/cache",
      title: "Cache Fixture",
      year: 2020,
      rating: 2,
      rewatch: false,
      last_date: "2026-07-01",
      watch_count: 1,
      liked: false,
      on_watchlist: false,
    },
  ],
  mappings: new Map([["letterboxd://film/cache", 404]]),
  mappingsArray: [{ uri: "letterboxd://film/cache", tmdb_id: 404 }],
  feedback: [],
  explorationRate: 0.15,
  adjacentGenres: [],
  recentExposures: new Map(),
  blockedIds: new Set(),
  inputHealth: {
    films: { health: "ok", rowCount: 1 },
    mappings: { health: "ok", rowCount: 1 },
    feedback: { health: "empty", rowCount: 0 },
    exploration: { health: "empty", rowCount: 0 },
    adjacent_genres: { health: "empty", rowCount: 0 },
    exposures: { health: "empty", rowCount: 0 },
    blocked: { health: "empty", rowCount: 0 },
  },
  failedSources: [],
  mode: "personalized",
};

const productionQuizRows = [
  {
    id: 12,
    created_at: "2026-07-03T12:00:00.000Z",
  },
];

const productionQuizResponseCount = 2;

type QueryTrace = {
  select: unknown[][];
  order: unknown[][];
  limit: unknown[][];
};

type QueryChain = {
  select: (...args: unknown[]) => QueryChain;
  eq: (...args: unknown[]) => QueryChain;
  order: (...args: unknown[]) => QueryChain;
  limit: (...args: unknown[]) => Promise<unknown>;
  in: (...args: unknown[]) => Promise<unknown>;
  maybeSingle: () => Promise<unknown>;
  upsert: (...args: unknown[]) => Promise<unknown>;
};

function createQueryChain(
  result: unknown,
  upsertPayloads: unknown[],
  trace?: QueryTrace,
): QueryChain {
  const chain = {} as QueryChain;
  chain.select = vi.fn((...args: unknown[]) => {
    trace?.select.push(args);
    return chain;
  });
  chain.eq = vi.fn(() => chain);
  chain.order = vi.fn((...args: unknown[]) => {
    trace?.order.push(args);
    return chain;
  });
  chain.limit = vi.fn(async (...args: unknown[]) => {
    trace?.limit.push(args);
    return result;
  });
  chain.in = vi.fn(async () => result);
  chain.maybeSingle = vi.fn(async () => result);
  chain.upsert = vi.fn(async (payload: unknown) => {
    upsertPayloads.push(payload);
    return { error: null };
  });
  return chain;
}

function createMockDb(
  cacheRow: unknown,
  upsertPayloads: unknown[],
  options: { quizTrace?: QueryTrace } = {},
) {
  return {
    from: vi.fn((table: string) => {
      if (table === "user_quiz_responses") {
        return createQueryChain(
          {
            data: productionQuizRows,
            count: productionQuizResponseCount,
            error: null,
          },
          upsertPayloads,
          options.quizTrace,
        );
      }

      if (table === "user_taste_profile_cache") {
        return createQueryChain(
          { data: cacheRow, error: null },
          upsertPayloads,
        );
      }

      return createQueryChain({ data: [], error: null }, upsertPayloads);
    }),
  };
}

function revision(input: RecommendationRevisionInput = baseInput): string {
  return createRecommendationRevision(input);
}

describe("recommendation profile cache revision", () => {
  beforeEach(() => {
    cachePathMocks.buildTasteProfile.mockReset();
    cachePathMocks.getSupabaseAdmin.mockReset();
    cachePathMocks.fetchTmdb.mockReset();
    cachePathMocks.buildTasteProfile.mockImplementation(
      async ({ films }: { films: unknown[] }) =>
        films.length === 0 ? { marker: "empty" } : { marker: "rebuilt" },
    );
    // Keep the rebuild path offline: a rejected fetch resolves to a null movie
    // immediately, so no real TMDB network call is made for relevant films.
    cachePathMocks.fetchTmdb.mockRejectedValue(new Error("offline"));
  });

  it("uses the production cache decision and write-payload contract", () => {
    const inputRevision = revision();
    const current = {
      inputRevision,
      profileModelVersion: baseInput.profileModelVersion,
    };
    const computedAt = new Date(NOW).toISOString();

    expect(
      decideTasteProfileCache(
        {
          input_revision: inputRevision,
          profile_model_version: current.profileModelVersion,
          computed_at: computedAt,
        },
        current,
        { now: NOW },
      ),
    ).toBe("hit");
    expect(
      decideTasteProfileCache(
        {
          input_revision: "0000000000000000",
          profile_model_version: current.profileModelVersion,
          computed_at: computedAt,
        },
        current,
        { now: NOW },
      ),
    ).toBe("miss");

    expect(
      createTasteProfileCacheWritePayload({
        userId: "cache-user",
        profile: { marker: "rebuilt" },
        filmCount: 2,
        computedAt,
        revision: current,
      }),
    ).toEqual({
      user_id: "cache-user",
      profile: { marker: "rebuilt" },
      film_count: 2,
      computed_at: computedAt,
      input_revision: inputRevision,
      profile_model_version: current.profileModelVersion,
    });
  });

  it("hits the buildTasteProfileServer cache for matching revision, model, and TTL", async () => {
    const inputRevision = createRecommendationRevision(productionRevisionInput);
    const upsertPayloads: unknown[] = [];
    cachePathMocks.getSupabaseAdmin.mockReturnValue(
      createMockDb(
        {
          profile: { marker: "cached" },
          film_count: 1,
          computed_at: new Date(Date.now() - 1_000).toISOString(),
          input_revision: inputRevision,
          profile_model_version: productionRevisionInput.profileModelVersion,
        },
        upsertPayloads,
      ),
    );

    const result = await buildTasteProfileServer(
      "cache-user",
      productionContext,
    );

    expect(result).toEqual({ marker: "cached" });
    expect(cachePathMocks.buildTasteProfile).toHaveBeenCalledTimes(1);
    expect(upsertPayloads).toEqual([]);
  });

  it("uses only bounded scalar quiz state with exact count and latest-row ordering", async () => {
    const inputRevision = createRecommendationRevision(productionRevisionInput);
    const upsertPayloads: unknown[] = [];
    const quizTrace: QueryTrace = { select: [], order: [], limit: [] };
    cachePathMocks.getSupabaseAdmin.mockReturnValue(
      createMockDb(
        {
          profile: { marker: "cached" },
          film_count: 1,
          computed_at: new Date(Date.now() - 1_000).toISOString(),
          input_revision: inputRevision,
          profile_model_version: productionRevisionInput.profileModelVersion,
        },
        upsertPayloads,
        { quizTrace },
      ),
    );

    await buildTasteProfileServer("cache-user", productionContext);

    expect(quizTrace.select).toEqual([
      ["id, created_at", { count: "exact" }],
    ]);
    expect(quizTrace.order).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(quizTrace.limit).toEqual([[1]]);
  });

  it("misses a stale DB revision, rebuilds, and persists current revision/model", async () => {
    const inputRevision = createRecommendationRevision(productionRevisionInput);
    const upsertPayloads: unknown[] = [];
    cachePathMocks.getSupabaseAdmin.mockReturnValue(
      createMockDb(
        {
          profile: { marker: "stale" },
          film_count: 1,
          computed_at: new Date(Date.now() - 1_000).toISOString(),
          input_revision: "0000000000000000",
          profile_model_version: productionRevisionInput.profileModelVersion,
        },
        upsertPayloads,
      ),
    );

    const result = await buildTasteProfileServer(
      "cache-user",
      productionContext,
    );

    expect(result).toEqual({ marker: "rebuilt" });
    expect(cachePathMocks.buildTasteProfile).toHaveBeenCalledTimes(2);
    expect(upsertPayloads).toEqual([
      expect.objectContaining({
        input_revision: inputRevision,
        profile_model_version: productionRevisionInput.profileModelVersion,
      }),
    ]);
  });

  it("changes for every profile input category independently", () => {
    const baseRevision = revision();
    const variants: Array<[string, RecommendationRevisionInput]> = [
      [
        "ratings",
        {
          ...baseInput,
          films: baseInput.films.map((film) =>
            film.uri === "letterboxd://film/alpha"
              ? { ...film, rating: 4.5 }
              : film,
          ),
        },
      ],
      [
        "dates",
        {
          ...baseInput,
          films: baseInput.films.map((film) =>
            film.uri === "letterboxd://film/alpha"
              ? { ...film, lastDate: "2026-07-03" }
              : film,
          ),
        },
      ],
      [
        "mappings",
        {
          ...baseInput,
          mappings: baseInput.mappings.map((mapping) =>
            mapping.uri === "letterboxd://film/alpha"
              ? { ...mapping, tmdbId: 1001 }
              : mapping,
          ),
        },
      ],
      [
        "watchlist",
        {
          ...baseInput,
          watchlist: baseInput.watchlist.map((item) =>
            item.uri === "letterboxd://film/beta"
              ? { ...item, watchlistAddedAt: "2026-07-04T12:00:00.000Z" }
              : item,
          ),
        },
      ],
      [
        "feedback",
        {
          ...baseInput,
          feedback: baseInput.feedback.map((row) => ({
            ...row,
            positiveCount: row.positiveCount + 1,
          })),
        },
      ],
      [
        "quiz state",
        {
          ...baseInput,
          quizState: {
            ...baseQuizState,
            responseCount: baseQuizState.responseCount + 1,
          },
        },
      ],
      [
        "blocks",
        { ...baseInput, blockedIds: [...baseInput.blockedIds, 1002] },
      ],
      [
        "metadata version",
        { ...baseInput, metadataVersion: "tmdb-metadata-v2" },
      ],
      [
        "profile model version",
        { ...baseInput, profileModelVersion: "taste-profile-v2" },
      ],
    ];

    for (const [category, variant] of variants) {
      expect(revision(variant), category).not.toBe(baseRevision);
    }
  });

  it("changes the revision for each bounded quiz scalar", () => {
    const baseRevision = revision();

    expect(
      revision({
        ...baseInput,
        quizState: {
          ...baseQuizState,
          responseCount: baseQuizState.responseCount + 1,
        },
      }),
    ).not.toBe(baseRevision);
    expect(
      revision({
        ...baseInput,
        quizState: {
          ...baseQuizState,
          latestResponseId: 13,
        },
      }),
    ).not.toBe(baseRevision);
    expect(
      revision({
        ...baseInput,
        quizState: {
          ...baseQuizState,
          latestResponseAt: "2026-07-04T12:00:00.000Z",
        },
      }),
    ).not.toBe(baseRevision);
  });

  it("is independent of ordering within each input collection", () => {
    const shuffled: RecommendationRevisionInput = {
      ...baseInput,
      films: [...baseInput.films].reverse(),
      mappings: [...baseInput.mappings].reverse(),
      feedback: [...baseInput.feedback].reverse(),
      blockedIds: [...baseInput.blockedIds].reverse(),
      watchlist: [...baseInput.watchlist].reverse(),
    };

    expect(revision(shuffled)).toBe(revision());
  });

  it("serializes object keys canonically and rejects stale revisions", () => {
    expect(stableCanonicalSerialize({ b: 2, a: { d: 4, c: 3 } })).toBe(
      stableCanonicalSerialize({ a: { c: 3, d: 4 }, b: 2 }),
    );

    const currentRevision = revision();
    const changedRevision = revision({
      ...baseInput,
      films: baseInput.films.map((film) => ({
        ...film,
        rating: film.rating === 4 ? 4.5 : film.rating,
      })),
    });

    expect(
      isTasteProfileCacheValid(
        {
          input_revision: currentRevision,
          profile_model_version: baseInput.profileModelVersion,
          computed_at: new Date(NOW).toISOString(),
          film_count: 999,
        },
        {
          inputRevision: currentRevision,
          profileModelVersion: baseInput.profileModelVersion,
        },
        { now: NOW },
      ),
    ).toBe(true);

    expect(
      isTasteProfileCacheValid(
        {
          input_revision: currentRevision,
          profile_model_version: baseInput.profileModelVersion,
          computed_at: new Date(NOW).toISOString(),
          film_count: 2,
        },
        {
          inputRevision: changedRevision,
          profileModelVersion: baseInput.profileModelVersion,
        },
        { now: NOW },
      ),
    ).toBe(false);

    expect(
      isTasteProfileCacheValid(
        {
          input_revision: currentRevision,
          profile_model_version: "taste-profile-v0",
          computed_at: new Date(NOW).toISOString(),
          film_count: 2,
        },
        {
          inputRevision: currentRevision,
          profileModelVersion: baseInput.profileModelVersion,
        },
        { now: NOW },
      ),
    ).toBe(false);
  });

  it("rejects future timestamps and invalid TTL values", () => {
    const inputRevision = revision();
    const current = {
      inputRevision,
      profileModelVersion: baseInput.profileModelVersion,
    };
    const cache = {
      input_revision: inputRevision,
      profile_model_version: current.profileModelVersion,
      computed_at: new Date(NOW).toISOString(),
    };

    expect(
      isTasteProfileCacheValid(
        { ...cache, computed_at: new Date(NOW + 1).toISOString() },
        current,
        { now: NOW },
      ),
    ).toBe(false);

    for (const ttlMs of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(
        isTasteProfileCacheValid(cache, current, { now: NOW, ttlMs }),
      ).toBe(false);
    }
  });

  it("defines a safe migration/backfill contract for existing cache rows", () => {
    const migration = readFileSync(
      new URL(
        "../../supabase/migrations/20260729225228_version_taste_profile_cache.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toMatch(/add column if not exists input_revision/i);
    expect(migration).toMatch(
      /add column if not exists profile_model_version/i,
    );
    expect(migration).toMatch(/update public\.user_taste_profile_cache/i);
    expect(migration).toContain("legacy-v0");
    expect(migration).toMatch(/set not null/i);
  });

  it("bounds cache revision diagnostics without exposing profile inputs", () => {
    const diagnostics = getBoundedTasteProfileCacheDiagnostics({
      input_revision: revision(),
      profile_model_version: "taste-profile-v1",
    });
    expect(diagnostics).toEqual({
      revision: revision(),
      modelVersion: "taste-profile-v1",
    });

    expect(
      getBoundedTasteProfileCacheDiagnostics({
        input_revision: JSON.stringify(baseInput),
        profile_model_version: "raw profile input and secret",
      }),
    ).toEqual({ revision: null, modelVersion: null });
  });

  it("derives the watchlist revision from persisted watchlist_added_at, not last_date", () => {
    const quizState = { status: "unavailable" } as const;
    const watchlistFilm = {
      uri: "letterboxd://film/watchlist",
      title: "Watchlist Film",
      year: 2020,
      rating: null,
      rewatch: false,
      last_date: "2026-07-01",
      watch_count: 0,
      liked: false,
      on_watchlist: true,
      watchlist_added_at: "2026-06-20T12:00:00.000Z",
    };
    const context: UserContext = {
      ...productionContext,
      films: [watchlistFilm],
      mappings: new Map([["letterboxd://film/watchlist", 404]]),
      mappingsArray: [{ uri: "letterboxd://film/watchlist", tmdb_id: 404 }],
    };

    const base = buildTasteProfileCacheRevision(context, quizState);
    const movedTimestamp = buildTasteProfileCacheRevision(
      {
        ...context,
        films: [
          { ...watchlistFilm, watchlist_added_at: "2026-06-25T12:00:00.000Z" },
        ],
      },
      quizState,
    );

    // The persisted watchlist timestamp is a genuine profile input: moving it
    // (with last_date unchanged) must move the cache revision so stale taste
    // profiles invalidate. Deriving it from last_date would leave these equal.
    expect(movedTimestamp.inputRevision).not.toBe(base.inputRevision);
  });

  it("passes persisted watchlist_added_at (not last_date) into buildTasteProfile", async () => {
    const upsertPayloads: unknown[] = [];
    // Stale stored revision forces a cache miss so the production rebuild path
    // (the second buildTasteProfile call) actually runs.
    cachePathMocks.getSupabaseAdmin.mockReturnValue(
      createMockDb(
        {
          profile: { marker: "stale" },
          film_count: 1,
          computed_at: new Date(Date.now() - 1_000).toISOString(),
          input_revision: "0000000000000000",
          profile_model_version: "taste-profile-v1",
        },
        upsertPayloads,
      ),
    );

    // watchlist_added_at is deliberately distinct from last_date so a buggy
    // `film.last_date` derivation is observable.
    const watchlistFilm = {
      uri: "letterboxd://film/watchlist",
      title: "Watchlist Film",
      year: 2020,
      rating: null,
      rewatch: false,
      last_date: "2026-07-01",
      watch_count: 0,
      liked: false,
      on_watchlist: true,
      watchlist_added_at: "2026-06-20T12:00:00.000Z",
    };
    const context: UserContext = {
      ...productionContext,
      films: [watchlistFilm],
      mappings: new Map([["letterboxd://film/watchlist", 404]]),
      mappingsArray: [{ uri: "letterboxd://film/watchlist", tmdb_id: 404 }],
    };

    await buildTasteProfileServer("cache-user", context);

    // The first call builds the empty fallback profile; the rebuild call is the
    // one carrying real films and watchlistFilms.
    const rebuildCall = cachePathMocks.buildTasteProfile.mock.calls.find(
      (call: unknown[]) =>
        Array.isArray((call[0] as { films?: unknown[] })?.films) &&
        ((call[0] as { films: unknown[] }).films.length > 0),
    );
    expect(rebuildCall).toBeDefined();
    expect((rebuildCall![0] as { watchlistFilms: unknown }).watchlistFilms).toEqual(
      [
        {
          uri: "letterboxd://film/watchlist",
          watchlistAddedAt: "2026-06-20T12:00:00.000Z",
        },
      ],
    );
  });
});
