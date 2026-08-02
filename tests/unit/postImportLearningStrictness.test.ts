import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Post-import learning must fail closed.
 *
 * `seedPreferencesFromHistory`, `learnFromHistoricalData`, and
 * `updateAdjacentPreferences` run as required post-import work. A Supabase
 * read/write failure in any of them must reject so the import cannot be
 * reported complete, while legitimate no-op paths (no signal, too few films,
 * no mappings, empty genre list) still resolve.
 */

type Op = "select" | "insert" | "update" | "upsert" | "delete";

type QueryResult = { data: unknown; error: unknown; count?: number | null };

type ChainCtx = {
  op: Op;
  single: boolean;
  filters: Record<string, unknown>;
  order: Array<[string, unknown]>;
  range: [number, number] | null;
  limit: number | null;
  payload: unknown;
  upsertOpts: unknown;
};

type Resolver = (table: string, op: Op, ctx: ChainCtx) => QueryResult;

const mockState = vi.hoisted(() => ({
  client: null as unknown,
  resolver: null as Resolver | null,
  calls: [] as Array<{ table: string; op: Op; ctx: ChainCtx }>,
}));

function defaultResult(op: Op, ctx: ChainCtx): QueryResult {
  if (op === "select") {
    return { data: ctx.single ? null : [], error: null };
  }
  return { data: null, error: null };
}

function snapshotCtx(ctx: ChainCtx): ChainCtx {
  return {
    ...ctx,
    filters: { ...ctx.filters },
    order: ctx.order.map((entry) => [entry[0], entry[1]]),
  };
}

/**
 * A permissive, fully chainable Supabase query-builder fake. Every method
 * returns the same thenable proxy; awaiting it dispatches to the configured
 * resolver (or an empty success default) and records the call. This lets each
 * test inject per-table read/write failures without caring about the exact
 * query shape.
 */
function makeChain(table: string) {
  const ctx: ChainCtx = {
    op: "select",
    single: false,
    filters: {},
    order: [],
    range: null,
    limit: null,
    payload: undefined,
    upsertOpts: undefined,
  };

  const dispatch = (): Promise<QueryResult> => {
    mockState.calls.push({ table, op: ctx.op, ctx: snapshotCtx(ctx) });
    const result = mockState.resolver
      ? mockState.resolver(table, ctx.op, ctx)
      : defaultResult(ctx.op, ctx);
    return Promise.resolve(result);
  };

  const chain: any = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (onFulfilled?: any, onRejected?: any) =>
            dispatch().then(onFulfilled, onRejected);
        }
        return (...args: any[]) => {
          switch (prop) {
            case "select":
              ctx.op = "select";
              break;
            case "insert":
              ctx.op = "insert";
              ctx.payload = args[0];
              break;
            case "update":
              ctx.op = "update";
              ctx.payload = args[0];
              break;
            case "upsert":
              ctx.op = "upsert";
              ctx.payload = args[0];
              ctx.upsertOpts = args[1];
              break;
            case "delete":
              ctx.op = "delete";
              break;
            case "eq":
            case "neq":
            case "gt":
            case "gte":
            case "lt":
            case "lte":
            case "like":
            case "ilike":
            case "is":
            case "contains":
            case "containedBy":
            case "in":
            case "match":
            case "not":
            case "filter":
              if (typeof args[0] === "string") ctx.filters[args[0]] = args[1];
              break;
            case "order":
              ctx.order.push([args[0], args[1]]);
              break;
            case "range":
              ctx.range = [args[0], args[1]];
              break;
            case "limit":
              ctx.limit = args[0];
              break;
            case "maybeSingle":
            case "single":
              ctx.single = true;
              break;
            default:
              break;
          }
          return chain;
        };
      },
    },
  );

  return chain;
}

function createClient() {
  return { from: (table: string) => makeChain(table) };
}

vi.mock("@/lib/supabaseClient", () => ({
  get supabase() {
    return mockState.client;
  },
}));

import { seedPreferencesFromHistory } from "@/lib/quizLearning";
import {
  learnFromHistoricalData,
  updateAdjacentPreferences,
} from "@/lib/enrich";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function dbError(message: string, code = "XX000") {
  return { message, code, details: "", hint: "" };
}

function tableResolver(
  map: Record<string, (op: Op, ctx: ChainCtx) => QueryResult>,
): Resolver {
  return (table, op, ctx) => {
    const handler = map[table];
    if (handler) return handler(op, ctx);
    return defaultResult(op, ctx);
  };
}

function callsFor(table: string, op?: Op) {
  return mockState.calls.filter(
    (c) => c.table === table && (op == null || c.op === op),
  );
}

beforeEach(() => {
  mockState.client = createClient();
  mockState.resolver = null;
  mockState.calls = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// seedPreferencesFromHistory
// ---------------------------------------------------------------------------

const SEED_MOVIE = {
  title: "Seed Movie",
  overview: "A seeded film",
  release_date: "2019-05-01",
  genres: [
    { id: 28, name: "Action" },
    { id: 18, name: "Drama" },
  ],
  keywords: { keywords: [{ id: 1, name: "hero" }] },
  credits: {
    cast: [{ id: 100, name: "Lead Actor", order: 0 }],
    crew: [{ id: 200, name: "The Director", job: "Director" }],
  },
};

describe("seedPreferencesFromHistory (fail closed)", () => {
  it("throws when Supabase is absent", async () => {
    mockState.client = null;

    await expect(
      seedPreferencesFromHistory(USER_ID, [{ tmdbId: 1, rating: 5 }]),
    ).rejects.toThrow(/supabase not initialized/i);
  });

  it("rejects on a tmdb_movies read error", async () => {
    const readError = dbError("tmdb read boom");
    mockState.resolver = tableResolver({
      tmdb_movies: () => ({ data: null, error: readError }),
    });

    await expect(
      seedPreferencesFromHistory(USER_ID, [{ tmdbId: 1, rating: 5 }]),
    ).rejects.toBe(readError);
  });

  it("rejects on a user_feature_feedback upsert error", async () => {
    const upsertError = dbError("feedback upsert boom");
    mockState.resolver = tableResolver({
      tmdb_movies: () => ({ data: { data: SEED_MOVIE }, error: null }),
      user_feature_feedback: (op) =>
        op === "upsert"
          ? { data: null, error: upsertError }
          : { data: [], error: null },
    });

    await expect(
      seedPreferencesFromHistory(USER_ID, [{ tmdbId: 1, rating: 5 }]),
    ).rejects.toBe(upsertError);
  });

  it("reports success only after writes succeed", async () => {
    mockState.resolver = tableResolver({
      tmdb_movies: () => ({ data: { data: SEED_MOVIE }, error: null }),
      user_feature_feedback: () => ({ data: null, error: null }),
    });

    const result = await seedPreferencesFromHistory(USER_ID, [
      { tmdbId: 1, rating: 5 },
    ]);

    expect(result.success).toBe(true);
    expect(result.genresSeeded).toBeGreaterThan(0);
    expect(callsFor("user_feature_feedback", "upsert").length).toBeGreaterThan(
      0,
    );
  });

  it("resolves a legitimate no-op when films carry no signal", async () => {
    // rating 2.5 and an unrated film both yield zero delta -> no reads, no writes.
    const result = await seedPreferencesFromHistory(USER_ID, [
      { tmdbId: 1, rating: 2.5 },
      { tmdbId: 2 },
    ]);

    expect(result.success).toBe(true);
    expect(result.genresSeeded).toBe(0);
    expect(callsFor("tmdb_movies").length).toBe(0);
    expect(callsFor("user_feature_feedback", "upsert").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// learnFromHistoricalData
// ---------------------------------------------------------------------------

type LearnGenre = { id: number; name: string };

const GENRE_NAMES: Record<number, string> = {
  18: "Drama",
  28: "Action",
  35: "Comedy",
  99: "Western",
};

function makeLearnWorld(filmCount: number, genrePlan?: number[]) {
  const films: Array<{
    uri: string;
    title: string;
    rating: number | null;
    liked: boolean | null;
  }> = [];
  const mappings: Array<{ uri: string; tmdb_id: number }> = [];
  const details = new Map<number, { genres: LearnGenre[]; title: string }>();

  for (let i = 0; i < filmCount; i++) {
    const uri = `https://letterboxd.com/film/f${i}/`;
    const tmdbId = 1000 + i;
    films.push({ uri, title: `Film ${i}`, rating: 4, liked: false });
    mappings.push({ uri, tmdb_id: tmdbId });
    const genreId = genrePlan ? genrePlan[i] : 18;
    details.set(tmdbId, {
      title: `Film ${i}`,
      genres: [{ id: genreId, name: GENRE_NAMES[genreId] ?? "Drama" }],
    });
  }
  return { films, mappings, details };
}

function learnResolver(
  world: ReturnType<typeof makeLearnWorld>,
  overrides: Record<string, (op: Op, ctx: ChainCtx) => QueryResult> = {},
): Resolver {
  return tableResolver({
    film_events: () => ({ data: world.films, error: null }),
    film_tmdb_map: () => ({ data: world.mappings, error: null }),
    tmdb_movies: (_op, ctx) => {
      const filter = ctx.filters.tmdb_id;
      const ids = Array.isArray(filter)
        ? (filter as number[])
        : filter != null
          ? [filter as number]
          : [];
      const rows = ids
        .map((id) => ({ tmdb_id: id, data: world.details.get(Number(id)) }))
        .filter((row) => row.data);
      return { data: rows, error: null };
    },
    user_exploration_stats: (op) =>
      op === "select" ? { data: null, error: null } : { data: null, error: null },
    ...overrides,
  });
}

// Drama x4, Action x3, Comedy x2, Western x1 -> top 3 are Drama/Action/Comedy,
// Western is exploratory.
const DEEP_GENRE_PLAN = [18, 18, 18, 18, 28, 28, 28, 35, 35, 99];

describe("learnFromHistoricalData (fail closed)", () => {
  it("throws when Supabase is absent", async () => {
    mockState.client = null;

    await expect(learnFromHistoricalData(USER_ID)).rejects.toThrow(
      /supabase not initialized/i,
    );
  });

  it("resolves an early no-op when there are fewer than 10 films", async () => {
    const world = makeLearnWorld(5);
    mockState.resolver = learnResolver(world);

    await expect(learnFromHistoricalData(USER_ID)).resolves.toBeUndefined();
    expect(callsFor("film_tmdb_map").length).toBe(0);
  });

  it("rejects on a film_events pagination error", async () => {
    const world = makeLearnWorld(10);
    const pageError = dbError("film events page boom");
    mockState.resolver = learnResolver(world, {
      film_events: () => ({ data: null, error: pageError }),
    });

    await expect(learnFromHistoricalData(USER_ID)).rejects.toBe(pageError);
  });

  it("resolves an early no-op when there are no mappings", async () => {
    const world = makeLearnWorld(10);
    mockState.resolver = learnResolver(world, {
      film_tmdb_map: () => ({ data: [], error: null }),
    });

    await expect(learnFromHistoricalData(USER_ID)).resolves.toBeUndefined();
    expect(callsFor("tmdb_movies").length).toBe(0);
  });

  it("rejects on a film_tmdb_map pagination error", async () => {
    const world = makeLearnWorld(10);
    const pageError = dbError("mappings page boom");
    mockState.resolver = learnResolver(world, {
      film_tmdb_map: () => ({ data: null, error: pageError }),
    });

    await expect(learnFromHistoricalData(USER_ID)).rejects.toBe(pageError);
  });

  it("rejects on a tmdb_movies batch read error", async () => {
    const world = makeLearnWorld(10);
    const batchError = dbError("tmdb batch boom");
    mockState.resolver = learnResolver(world, {
      tmdb_movies: () => ({ data: null, error: batchError }),
    });

    await expect(learnFromHistoricalData(USER_ID)).rejects.toBe(batchError);
  });

  it("rejects on a current exploration stats read error", async () => {
    const world = makeLearnWorld(10, DEEP_GENRE_PLAN);
    const statsError = dbError("exploration stats read boom");
    mockState.resolver = learnResolver(world, {
      user_exploration_stats: (op) =>
        op === "select"
          ? { data: null, error: statsError }
          : { data: null, error: null },
    });

    await expect(learnFromHistoricalData(USER_ID)).rejects.toBe(statsError);
  });

  it("rejects on an exploration stats upsert error", async () => {
    const world = makeLearnWorld(10, DEEP_GENRE_PLAN);
    const upsertError = dbError("exploration upsert boom");
    mockState.resolver = learnResolver(world, {
      user_exploration_stats: (op) =>
        op === "upsert"
          ? { data: null, error: upsertError }
          : { data: null, error: null },
    });

    await expect(learnFromHistoricalData(USER_ID)).rejects.toBe(upsertError);
    expect(callsFor("user_exploration_stats", "upsert").length).toBeGreaterThan(
      0,
    );
  });

  it("orders paginated film and mapping reads by uri ascending", async () => {
    const world = makeLearnWorld(10);
    mockState.resolver = learnResolver(world, {
      film_tmdb_map: () => ({ data: [], error: null }),
    });

    await learnFromHistoricalData(USER_ID);

    const filmSelects = callsFor("film_events", "select");
    const mappingSelects = callsFor("film_tmdb_map", "select");
    expect(filmSelects.length).toBeGreaterThan(0);
    expect(mappingSelects.length).toBeGreaterThan(0);
    for (const call of [...filmSelects, ...mappingSelects]) {
      expect(call.ctx.order).toContainEqual(["uri", { ascending: true }]);
    }
  });
});

// ---------------------------------------------------------------------------
// updateAdjacentPreferences
// ---------------------------------------------------------------------------

const TOP_GENRES = [
  { id: 1, name: "Drama" },
  { id: 2, name: "Action" },
];
const ADJACENT_FILM_GENRES = [{ id: 99, name: "Western" }];

describe("updateAdjacentPreferences (fail closed)", () => {
  it("resolves a no-op for an empty genre list without touching Supabase", async () => {
    await expect(
      updateAdjacentPreferences(USER_ID, [], TOP_GENRES, 4),
    ).resolves.toBeUndefined();
    expect(mockState.calls.length).toBe(0);
  });

  it("throws when Supabase is absent but there is work to do", async () => {
    mockState.client = null;

    await expect(
      updateAdjacentPreferences(USER_ID, ADJACENT_FILM_GENRES, TOP_GENRES, 4),
    ).rejects.toThrow(/supabase not initialized/i);
  });

  it("rejects on an existing-row read error", async () => {
    const readError = dbError("adjacent read boom");
    mockState.resolver = tableResolver({
      user_adjacent_preferences: (op) =>
        op === "select"
          ? { data: null, error: readError }
          : { data: null, error: null },
    });

    await expect(
      updateAdjacentPreferences(USER_ID, ADJACENT_FILM_GENRES, TOP_GENRES, 4),
    ).rejects.toBe(readError);
  });

  it("rejects on an update error for an existing transition", async () => {
    const updateError = dbError("adjacent update boom");
    mockState.resolver = tableResolver({
      user_adjacent_preferences: (op) => {
        if (op === "select") {
          return {
            data: {
              id: 7,
              rating_count: 2,
              avg_rating: 3.5,
              success_rate: 0.5,
            },
            error: null,
          };
        }
        if (op === "update") return { data: null, error: updateError };
        return { data: null, error: null };
      },
    });

    await expect(
      updateAdjacentPreferences(USER_ID, ADJACENT_FILM_GENRES, TOP_GENRES, 4),
    ).rejects.toBe(updateError);
  });

  it("rejects on an insert error for a new transition", async () => {
    const insertError = dbError("adjacent insert boom");
    mockState.resolver = tableResolver({
      user_adjacent_preferences: (op) => {
        if (op === "select") return { data: null, error: null };
        if (op === "insert") return { data: null, error: insertError };
        return { data: null, error: null };
      },
    });

    await expect(
      updateAdjacentPreferences(USER_ID, ADJACENT_FILM_GENRES, TOP_GENRES, 4),
    ).rejects.toBe(insertError);
  });

  it("resolves when a new transition is written successfully", async () => {
    mockState.resolver = tableResolver({
      user_adjacent_preferences: () => ({ data: null, error: null }),
    });

    await expect(
      updateAdjacentPreferences(USER_ID, ADJACENT_FILM_GENRES, TOP_GENRES, 4),
    ).resolves.toBeUndefined();
    expect(
      callsFor("user_adjacent_preferences", "insert").length,
    ).toBeGreaterThan(0);
  });
});
