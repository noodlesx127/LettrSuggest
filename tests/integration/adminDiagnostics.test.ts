import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type QueryResult = {
    data?: unknown;
    error: unknown;
    count?: number | null;
  };

  function makeQuery(result: QueryResult): Record<string, unknown> {
    const promise = Promise.resolve(result);
    const query: Record<string, unknown> = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.is = vi.fn(() => query);
    query.gte = vi.fn(() => query);
    query.maybeSingle = vi.fn(() => query);
    query.then = promise.then.bind(promise);
    return query;
  }

  const tableQueues = new Map<string, QueryResult[]>();
  const setTableResults = (queues: Record<string, QueryResult[]>) => {
    tableQueues.clear();
    for (const [table, results] of Object.entries(queues)) {
      tableQueues.set(table, [...results]);
    }
  };

  const from = vi.fn((table: string) => {
    const result = tableQueues.get(table)?.shift() ?? {
      data: null,
      error: null,
      count: null,
    };
    return makeQuery(result);
  });
  const rpc = vi.fn();
  const getCacheTableStats = vi.fn();
  const requireAdmin = vi.fn();
  const withApiAuth = vi.fn(
    async (
      _request: Request,
      handler: (auth: unknown) => Promise<unknown>,
    ) =>
      handler({
        userId: "admin-user",
        keyId: "admin-key",
        keyType: "admin",
        userRole: "admin",
        scopes: [],
      }),
  );

  return {
    from,
    rpc,
    getCacheTableStats,
    requireAdmin,
    withApiAuth,
    setTableResults,
  };
});

vi.mock("@/app/api/v1/_lib/apiKeyAuth", () => ({
  withApiAuth: mocks.withApiAuth,
}));
vi.mock("@/app/api/v1/_lib/adminCache", () => ({
  getCacheTableStats: mocks.getCacheTableStats,
}));
vi.mock("@/app/api/v1/_lib/permissions", () => ({
  requireAdmin: mocks.requireAdmin,
}));
vi.mock("@/app/api/v1/_lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));

import { GET } from "@/app/api/v1/admin/diagnostics/route";

function seedSuccessfulQueries() {
  mocks.setTableResults({
    profiles: [{ data: null, error: null, count: 4 }],
    api_keys: [
      { data: null, error: null, count: 2 },
      {
        data: [{ user_id: "active-user" }, { user_id: "another-user" }],
        error: null,
        count: null,
      },
    ],
    film_events: [{ data: null, error: null, count: 6 }],
    user_taste_profile_cache: [
      {
        data: {
          user_id: "admin-user",
          film_count: 12,
          computed_at: "2026-08-02T00:00:00.000Z",
          input_revision: "abcdef0123456789",
          profile_model_version: "v1",
        },
        error: null,
        count: null,
      },
    ],
    user_feature_feedback: [{ data: null, error: null, count: 7 }],
  });
  mocks.getCacheTableStats.mockResolvedValue([
    { name: "cache_a", count: 3, expiredCount: 0 },
  ]);
}

async function readResponse(response: Response) {
  return (await response.json()) as {
    data: Record<string, any>;
    error: unknown;
  };
}

describe("admin diagnostics exposure aggregate", () => {
  beforeEach(() => {
    mocks.from.mockClear();
    mocks.rpc.mockReset();
    mocks.getCacheTableStats.mockReset();
    mocks.requireAdmin.mockClear();
    mocks.withApiAuth.mockClear();
    seedSuccessfulQueries();
    mocks.rpc.mockResolvedValue({
      data: [
        {
          total_count: 42,
          owner_count: 7,
          current_engine_count: 40,
          default_bucket_count: 42,
        },
      ],
      error: null,
    });
  });

  it("keeps the existing owner-scoped count separate from global diagnostics", async () => {
    const response = await GET(
      new Request("https://example.test/api/v1/admin/diagnostics"),
    );
    const body = await readResponse(response);

    expect(response.status).toBe(200);
    expect(mocks.requireAdmin).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "get_bounded_exposure_diagnostics",
      { p_owner_user_id: "admin-user" },
    );
    expect(
      mocks.from.mock.calls.filter(([table]) => table === "suggestion_exposure_log"),
    ).toHaveLength(0);

    expect(body.data.exposure_diagnostics).toEqual({
      total_count: 42,
      by_engine_version: { "v1-canonical-1": 40 },
      by_experiment_bucket: { default: 42 },
    });
    expect(body.data.engine_health.exposure_log_count).toBe(7);
  });

  it("keeps the existing successful response with bounded zeroes when the RPC fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: new Error("aggregate unavailable"),
    });

    try {
      const response = await GET(
        new Request("https://example.test/api/v1/admin/diagnostics"),
      );
      const body = await readResponse(response);

      expect(response.status).toBe(200);
      expect(body.data.exposure_diagnostics).toEqual({
        total_count: 0,
        by_engine_version: { "v1-canonical-1": 0 },
        by_experiment_bucket: { default: 0 },
      });
      expect(body.data.engine_health.exposure_log_count).toBe(0);
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
      expect(
        mocks.from.mock.calls.some(
          ([table]) => table === "suggestion_exposure_log",
        ),
      ).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
