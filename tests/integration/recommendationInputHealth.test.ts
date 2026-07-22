import { describe, expect, it } from "vitest";

import {
  getUserContextDiagnostics,
  loadUserContext,
  type UserContextSourceLoadResult,
  type UserContextSourceLoaderResult,
  type UserContextSourceName,
  type UserContextInputHealth,
  type UserContext,
} from "@/lib/serverSuggestionsEngine";
import { deriveContextMode } from "@/lib/enrich";
import {
  buildBlockedSourceFailureResponse,
  buildGenerationDiagnostics,
} from "@/app/api/v1/suggestions/generate/routeHelpers";

const SOURCE_NAMES: UserContextSourceName[] = [
  "films",
  "mappings",
  "feedback",
  "exploration",
  "adjacent_genres",
  "exposures",
  "blocked",
];

const now = Date.parse("2026-07-21T12:00:00.000Z");

const film = {
  uri: "letterboxd://film/example",
  title: "Example",
  year: 2020,
  rating: 5,
  rewatch: false,
  last_date: "2026-07-01",
  watch_count: 1,
  liked: true,
  on_watchlist: false,
};

function sourceData(): UserContextSourceLoaderResult {
  return {
    films: { data: [film] },
    mappings: { data: [{ uri: film.uri, tmdb_id: 123 }] },
    feedback: {
      data: [
        {
          feature_id: 1,
          feature_name: "Example",
          feature_type: "keyword",
          inferred_preference: 1,
          positive_count: 1,
          negative_count: 0,
        },
      ],
    },
    exploration: { data: { exploration_rate: 0.15 } },
    adjacent_genres: {
      data: [
        {
          from_genre_name: "Drama",
          to_genre_name: "Mystery",
          success_rate: 0.8,
          rating_count: 3,
        },
      ],
    },
    exposures: { data: [{ tmdb_id: 456, exposed_at: "2026-07-20T12:00:00.000Z" }] },
    blocked: { data: [{ tmdb_id: 789 }] },
  };
}

function sourceLoader(
  overrides: Partial<UserContextSourceLoaderResult> = {},
  onCutoff?: (cutoff: string) => void,
) {
  return async (
    _userId: string,
    exposureCutoff: string,
  ): Promise<UserContextSourceLoaderResult> => {
    onCutoff?.(exposureCutoff);
    return { ...sourceData(), ...overrides };
  };
}

function failed(error = new Error("private source failure")): UserContextSourceLoadResult<never> {
  return { data: null, error };
}

const wrongContainerCases: Array<[UserContextSourceName, unknown]> = [
  ["films", {}],
  ["mappings", {}],
  ["feedback", {}],
  ["exploration", []],
  ["adjacent_genres", {}],
  ["exposures", {}],
  ["blocked", {}],
];

describe("recommendation input health", () => {
  it("reports bounded ok and empty health for all seven sources", async () => {
    const context = await loadUserContext("user-1", {
      now: () => now,
      sourceLoader: sourceLoader(),
    });

    expect(context.mode).toBe("personalized");
    expect(context.failedSources).toEqual([]);
    expect(Object.keys(context.inputHealth ?? {})).toEqual(SOURCE_NAMES);
    expect(context.inputHealth).toMatchObject({
      films: { health: "ok", rowCount: 1 },
      mappings: { health: "ok", rowCount: 1 },
      feedback: { health: "ok", rowCount: 1 },
      exploration: { health: "ok", rowCount: 1 },
      adjacent_genres: { health: "ok", rowCount: 1 },
      exposures: { health: "ok", rowCount: 1 },
      blocked: { health: "ok", rowCount: 1 },
    });

    const emptyContext = await loadUserContext("user-1", {
      now: () => now,
      sourceLoader: sourceLoader({
        films: { data: [] },
        mappings: { data: [] },
        feedback: { data: [] },
        exploration: { data: null },
        adjacent_genres: { data: [] },
        exposures: { data: [] },
        blocked: { data: [] },
      }),
    });

    expect(emptyContext.mode).toBe("cold_start");
    expect(emptyContext.failedSources).toEqual([]);
    expect(
      SOURCE_NAMES.every(
        (name) => emptyContext.inputHealth?.[name].health === "empty",
      ),
    ).toBe(true);
  });

  it.each(SOURCE_NAMES)(
    "preserves a %s failure after normalizing that source to an empty fallback",
    async (sourceName) => {
      const context = await loadUserContext("user-1", {
        now: () => now,
        sourceLoader: sourceLoader({
          [sourceName]: failed(),
        }),
      });

      expect(context.inputHealth?.[sourceName]).toEqual({
        health: "failed",
        rowCount: 0,
      });
      expect(context.failedSources).toEqual([sourceName]);
      expect(context.mode).toBe(
        ["films", "mappings", "blocked"].includes(sourceName)
          ? "degraded"
          : "personalized",
      );
      expect(JSON.stringify(context.inputHealth)).not.toContain(
        "private source failure",
      );
    },
  );

  it.each(["films", "mappings", "blocked"] as const)(
    "marks a failed required source (%s) as degraded",
    async (sourceName) => {
      const context = await loadUserContext("user-1", {
        sourceLoader: sourceLoader({ [sourceName]: failed() }),
      });

      expect(context.mode).toBe("degraded");
      expect(context.failedSources).toContain(sourceName);
    },
  );

  it("reports cold_start when required sources are healthy but mapped history is unusable", async () => {
    const context = await loadUserContext("user-1", {
      sourceLoader: sourceLoader({
        films: {
          data: [
            {
              ...film,
              rating: null,
              liked: false,
              rewatch: false,
              on_watchlist: false,
            },
          ],
        },
        mappings: { data: [{ uri: "letterboxd://film/unrelated", tmdb_id: 123 }] },
      }),
    });

    expect(context.mode).toBe("cold_start");
    expect(context.failedSources).toEqual([]);
  });

  it("reports personalized when mapped history evidence is available", async () => {
    const context = await loadUserContext("user-1", {
      sourceLoader: sourceLoader(),
    });

    expect(context.mode).toBe("personalized");
    expect(context.inputHealth?.films.health).toBe("ok");
    expect(context.inputHealth?.mappings.health).toBe("ok");
  });

  it("marks every source failed when the injected loader fails fatally", async () => {
    const context = await loadUserContext("user-1", {
      sourceLoader: async () => {
        throw new Error("fatal loader failure");
      },
    });

    expect(context.mode).toBe("degraded");
    expect(context.failedSources).toEqual(SOURCE_NAMES);
    expect(
      SOURCE_NAMES.every(
        (name) => context.inputHealth?.[name].health === "failed",
      ),
    ).toBe(true);
    expect(JSON.stringify(context)).not.toContain("fatal loader failure");
  });

  it.each(wrongContainerCases)(
    "marks a wrong %s source container as failed instead of healthy-empty",
    async (sourceName, invalidContainer) => {
      const context = await loadUserContext("user-1", {
        sourceLoader: sourceLoader({
          [sourceName]: { data: invalidContainer } as never,
        }),
      });

      expect(context.inputHealth?.[sourceName]).toEqual({
        health: "failed",
        rowCount: 0,
      });
      expect(context.failedSources).toContain(sourceName);
    },
  );

  it.each([
    ["mappings", { uri: film.uri, tmdb_id: 0 }],
    ["mappings", { uri: film.uri, tmdb_id: Number.MAX_SAFE_INTEGER + 1 }],
    ["blocked", { tmdb_id: 0 }],
    ["blocked", { tmdb_id: 1.5 }],
  ] as const)(
    "marks malformed %s TMDB rows as failed",
    async (sourceName, invalidRow) => {
      const context = await loadUserContext("user-1", {
        sourceLoader: sourceLoader({
          [sourceName]: { data: [invalidRow] } as never,
        }),
      });

      expect(context.inputHealth?.[sourceName].health).toBe("failed");
      expect(context.failedSources).toContain(sourceName);
      expect(context.mode).toBe("degraded");
    },
  );

  it("fails closed with a bounded 503 response when blocked input is unavailable", async () => {
    const context = await loadUserContext("user-1", {
      sourceLoader: sourceLoader({ blocked: failed() }),
    });
    const diagnostics = buildGenerationDiagnostics({
      context: getUserContextDiagnostics(context),
      requestSeed: "fixed-request-seed",
      contextMode: "neutral",
    });
    const failure = buildBlockedSourceFailureResponse(diagnostics);

    expect(failure).toMatchObject({
      status: 503,
      body: {
        data: [],
        meta: {
          mode: "degraded",
          failed_sources: ["blocked"],
          engine_version: "v1-phase0",
          request_seed: "fixed-request-seed",
          context_mode: "neutral",
          input_health: {
            blocked: { health: "failed", row_count: 0 },
          },
        },
        error: {
          code: "RECOMMENDATION_INPUT_UNAVAILABLE",
          message: "Recommendation inputs are temporarily unavailable.",
        },
      },
    });
    expect(failure?.body.data).toEqual([]);
  });

  it("merges contradictory health and failure fields before deriving mode", async () => {
    const context = await loadUserContext("user-1", {
      sourceLoader: sourceLoader(),
    });
    const contradictoryContext = {
      ...context,
      inputHealth: {
        ...context.inputHealth!,
        blocked: { health: "empty" as const, rowCount: 0 },
      },
      failedSources: ["blocked" as const],
      mode: "personalized" as const,
    };

    const diagnostics = getUserContextDiagnostics(contradictoryContext);

    expect(diagnostics.failedSources).toEqual(["blocked"]);
    expect(diagnostics.mode).toBe("degraded");
  });

  it("treats a missing blocked health entry as failed and degraded", async () => {
    const context = await loadUserContext("user-1", {
      sourceLoader: sourceLoader(),
    });
    const partialHealth = {
      ...context.inputHealth,
    } as Partial<UserContextInputHealth>;
    delete partialHealth.blocked;
    const incompleteContext = {
      ...context,
      inputHealth: partialHealth as UserContextInputHealth,
    } as UserContext;

    const diagnostics = getUserContextDiagnostics(incompleteContext);

    expect(diagnostics.inputHealth.blocked).toEqual({
      health: "failed",
      rowCount: 0,
    });
    expect(diagnostics.failedSources).toEqual(["blocked"]);
    expect(diagnostics.mode).toBe("degraded");
  });

  it.each([
    { exploration_rate: null },
    {},
  ])(
    "accepts nullable/optional exploration payload %j and applies the default",
    async (explorationPayload) => {
      const context = await loadUserContext("user-1", {
        sourceLoader: sourceLoader({
          exploration: { data: explorationPayload },
        }),
      });

      expect(context.explorationRate).toBe(0.15);
      expect(context.inputHealth.exploration.health).toBe("ok");
      expect(context.failedSources).not.toContain("exploration");
    },
  );

  it("includes trace metadata in the blocked-source 503 response", async () => {
    const context = await loadUserContext("user-1", {
      sourceLoader: sourceLoader({ blocked: failed() }),
    });
    const diagnostics = buildGenerationDiagnostics({
      context: getUserContextDiagnostics(context),
      requestSeed: "fixed-request-seed",
      contextMode: "neutral",
    });
    const failure = buildBlockedSourceFailureResponse(diagnostics, {
      timestamp: "2026-07-21T12:00:00.000Z",
      requestId: "req_0123456789abcdef",
    });

    expect(failure?.body.meta.timestamp).toBe("2026-07-21T12:00:00.000Z");
    expect(failure?.body.meta.requestId).toBe("req_0123456789abcdef");
  });

  it("uses injected time for the exposure cutoff", async () => {
    let cutoff: string | undefined;
    await loadUserContext("user-1", {
      now: () => now,
      sourceLoader: sourceLoader({}, (value) => {
        cutoff = value;
      }),
    });

    expect(cutoff).toBe(
      new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString(),
    );
  });
});

describe("recommendation context mode", () => {
  it("resolves omitted context to neutral without a wall-clock fallback", () => {
    expect(deriveContextMode()).toEqual({ mode: "neutral", hour: null });
  });

  it("keeps explicit background and uses neutral for an unmatched auto hour", () => {
    expect(deriveContextMode({ mode: "background", localHour: null })).toEqual({
      mode: "background",
      hour: null,
    });
    expect(deriveContextMode({ mode: "auto", localHour: 12 })).toEqual({
      mode: "neutral",
      hour: 12,
    });
  });
});
