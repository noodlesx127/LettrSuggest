import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/supabaseClient", () => ({ supabase: undefined }));

import {
  buildBoundedExposureDiagnostics,
  buildRecommendationExposureRecords,
  buildRecommendationTrace,
  createLazyExposureWriter,
  createSupabaseExposureWriter,
  EXPOSURE_RETENTION_DAYS,
  MAX_EXPOSURE_RECORDS,
  recordRecommendationExposures,
  SUGGESTION_EXPOSURE_TABLE,
  validateRecommendationExposureRecord,
  type RecommendationExposureRecord,
  type RecommendationExposureWriter,
} from "@/lib/recommendationTelemetry";
import {
  DEFAULT_EXPERIMENT_BUCKET,
  DEFAULT_INPUT_REVISION_HASH,
  MAX_DIAGNOSTIC_COUNT,
  MAX_RECOMMENDATION_COUNT,
  RECOMMENDATION_DROP_REASONS,
  RECOMMENDATION_ENGINE_VERSION,
  RECOMMENDATION_PROVIDER_FAMILIES,
  type RecommendationTrace,
  type SourceHealth,
} from "@/lib/recommendationTypes";
import { normalizeProviderFamilies } from "@/lib/recommendationCandidates";
import type { RecommendationInputRevisionMaterial } from "@/lib/recommendationContext";
import { canonicalFixture } from "../fixtures/recommendations/canonicalFixture";

const USER_ID = "11111111-1111-4111-8111-111111111111";

const revisionSources: RecommendationInputRevisionMaterial["sources"] = {
  films: [{ uri: "letterboxd://film/a", tmdbId: 111 }],
  mappings: [{ uri: "letterboxd://film/a", tmdbId: 111 }],
  metadata: [],
  dates: [],
  ratings: [],
  features: [],
  feedback: [],
  exploration: [],
  adjacent_genres: [],
  exposures: [],
  blocked: [],
};

const revisionMaterial: RecommendationInputRevisionMaterial = {
  sources: revisionSources,
  sourceHealth: Object.fromEntries(
    Object.keys(revisionSources).map((source) => [
      source,
      { health: "ok", rowCount: 1 } satisfies SourceHealth,
    ]),
  ) as RecommendationInputRevisionMaterial["sourceHealth"],
  inputHealth: canonicalFixture.result.diagnostics.inputHealth,
  ...revisionSources,
};

function makeTrace(
  overrides?: Partial<Parameters<typeof buildRecommendationTrace>[0]>,
): RecommendationTrace {
  return buildRecommendationTrace({
    result: canonicalFixture.result,
    ...overrides,
  });
}

const FINAL_ORDER = canonicalFixture.result.results.map(
  (candidate) => candidate.tmdbId,
);

describe("recommendation exposure record builder", () => {
  it("builds one record per exposed result with engine version, bucket, and hashed input revision", () => {
    const trace = makeTrace();

    const records = buildRecommendationExposureRecords({
      userId: USER_ID,
      trace,
      orderedTmdbIds: FINAL_ORDER,
    });

    expect(records).toHaveLength(FINAL_ORDER.length);
    for (const [index, record] of records.entries()) {
      expect(record.user_id).toBe(USER_ID);
      expect(record.tmdb_id).toBe(FINAL_ORDER[index]);
      expect(record.engine_version).toBe(RECOMMENDATION_ENGINE_VERSION);
      expect(record.experiment_bucket).toBe(DEFAULT_EXPERIMENT_BUCKET);
      expect(record.input_revision).toBe(trace.inputRevision);
      expect(record.input_revision).toMatch(/^[0-9a-f]{16}$/);
      expect(validateRecommendationExposureRecord(record)).toBe(true);
    }
  });

  it("records bounded drop reasons and exposed source-family shares", () => {
    const trace = makeTrace();
    const providerFamiliesByTmdbId = new Map(
      canonicalFixture.result.results.map((candidate) => [
        candidate.tmdbId,
        candidate.evidence.providerFamilies,
      ]),
    );

    const records = buildRecommendationExposureRecords({
      userId: USER_ID,
      trace,
      orderedTmdbIds: FINAL_ORDER,
      providerFamiliesByTmdbId,
    });

    for (const record of records) {
      expect(record.drop_reason_counts).toEqual(trace.dropReasonCounts);
      expect(record.source_shares).toEqual({ letterboxd: 1, tmdb: 3 });
      for (const reason of Object.keys(record.drop_reason_counts)) {
        expect(RECOMMENDATION_DROP_REASONS).toContain(reason);
      }
      for (const family of Object.keys(record.source_shares)) {
        expect(RECOMMENDATION_PROVIDER_FAMILIES).toContain(family);
      }
    }
  });

  it("derives source shares only from exposed result ids, not hidden canonical results", () => {
    const records = buildRecommendationExposureRecords({
      userId: USER_ID,
      trace: makeTrace(),
      orderedTmdbIds: [FINAL_ORDER[0]],
      providerFamiliesByTmdbId: new Map([
        [FINAL_ORDER[0], ["tmdb"]],
        // This result is canonical but not exposed in this batch.
        [FINAL_ORDER[2], ["letterboxd"]],
      ]),
    });

    expect(records).toHaveLength(1);
    expect(records[0].source_shares).toEqual({ tmdb: 1 });
    expect(records[0].source_shares).not.toHaveProperty("letterboxd");
  });

  it("normalizes real web source labels and discards unknown values", () => {
    const records = buildRecommendationExposureRecords({
      userId: USER_ID,
      trace: makeTrace(),
      orderedTmdbIds: [FINAL_ORDER[0], FINAL_ORDER[1]],
      providerFamiliesByTmdbId: new Map([
        [
          FINAL_ORDER[0],
          ["similar:303", "trending-day", "sk_live_private", "private-family"],
        ],
        [
          FINAL_ORDER[1],
          ["watchmode-similar", "550e8400-e29b-41d4-a716-446655440000"],
        ],
        // Evidence for an unexposed id must not affect the batch map.
        [FINAL_ORDER[2], ["letterboxd"]],
      ]),
    });

    expect(records.map((record) => record.source_shares)).toEqual([
      { tmdb: 1, watchmode: 1 },
      { tmdb: 1, watchmode: 1 },
    ]);
  });

  it("assigns 1-based post-rank from final order and defaults pre-rank to post-rank", () => {
    const records = buildRecommendationExposureRecords({
      userId: USER_ID,
      trace: makeTrace(),
      orderedTmdbIds: FINAL_ORDER,
    });

    expect(records.map((record) => record.post_rank)).toEqual([1, 2, 3]);
    for (const record of records) {
      expect(record.pre_rank).toBe(record.post_rank);
    }
  });

  it("uses injected pre-rerank ranks when provided", () => {
    const records = buildRecommendationExposureRecords({
      userId: USER_ID,
      trace: makeTrace(),
      orderedTmdbIds: FINAL_ORDER,
      preRanksById: new Map([
        [FINAL_ORDER[0], 7],
        [FINAL_ORDER[2], 4],
      ]),
    });

    expect(records[0].pre_rank).toBe(7);
    expect(records[0].post_rank).toBe(1);
    // Missing pre-rank falls back to the post-rank.
    expect(records[1].pre_rank).toBe(records[1].post_rank);
    expect(records[2].pre_rank).toBe(4);
    expect(records[2].post_rank).toBe(3);
  });

  it("uses valid committed presentation post-ranks and keeps them bounded", () => {
    const records = buildRecommendationExposureRecords({
      userId: USER_ID,
      trace: makeTrace(),
      orderedTmdbIds: FINAL_ORDER,
      postRanksById: new Map([
        [FINAL_ORDER[0], 7],
        [FINAL_ORDER[1], 4],
        [FINAL_ORDER[2], 10_000],
      ]),
    });

    expect(records.map((record) => record.post_rank)).toEqual([7, 4, 10_000]);
    for (const record of records) {
      expect(record.post_rank).toBeGreaterThanOrEqual(1);
      expect(record.post_rank).toBeLessThanOrEqual(10_000);
      expect(validateRecommendationExposureRecord(record)).toBe(true);
    }
  });

  it("carries the hashed input revision rather than raw revision material", () => {
    const trace = makeTrace({ inputRevisionMaterial: revisionMaterial });
    expect(trace.inputRevision).toMatch(/^[0-9a-f]{16}$/);
    expect(trace.inputRevision).not.toBe(DEFAULT_INPUT_REVISION_HASH);

    const records = buildRecommendationExposureRecords({
      userId: USER_ID,
      trace,
      orderedTmdbIds: FINAL_ORDER,
    });
    for (const record of records) {
      expect(record.input_revision).toBe(trace.inputRevision);
    }
    // Raw revision material (film URIs) never reaches the persisted rows.
    expect(JSON.stringify(records)).not.toContain("letterboxd://film/a");
  });

  it("bounds persisted rows to the maximum recommendation count", () => {
    expect(MAX_EXPOSURE_RECORDS).toBe(MAX_RECOMMENDATION_COUNT);

    const oversized = Array.from(
      { length: MAX_RECOMMENDATION_COUNT + 50 },
      (_, index) => index + 1,
    );
    const records = buildRecommendationExposureRecords({
      userId: USER_ID,
      trace: makeTrace(),
      orderedTmdbIds: oversized,
    });

    expect(records).toHaveLength(MAX_EXPOSURE_RECORDS);
    expect(records.map((record) => record.post_rank)).toEqual(
      Array.from({ length: MAX_EXPOSURE_RECORDS }, (_, index) => index + 1),
    );
  });

  it("deduplicates repeated ids and ignores non-positive ids", () => {
    const records = buildRecommendationExposureRecords({
      userId: USER_ID,
      trace: makeTrace(),
      orderedTmdbIds: [FINAL_ORDER[0], FINAL_ORDER[0], 0, -5, FINAL_ORDER[1]],
    });

    expect(records.map((record) => record.tmdb_id)).toEqual([
      FINAL_ORDER[0],
      FINAL_ORDER[1],
    ]);
    expect(records.map((record) => record.post_rank)).toEqual([1, 2]);
  });

  it("returns no records for an empty exposure set", () => {
    expect(
      buildRecommendationExposureRecords({
        userId: USER_ID,
        trace: makeTrace(),
        orderedTmdbIds: [],
      }),
    ).toEqual([]);
  });

  it("fails closed for a blank owner or an invalid trace", () => {
    const trace = makeTrace();

    expect(() =>
      buildRecommendationExposureRecords({
        userId: "   ",
        trace,
        orderedTmdbIds: FINAL_ORDER,
      }),
    ).toThrow();

    const unsafeTrace = {
      ...trace,
      experimentBucket: "sk_live_abcdef0123456789",
    } as unknown as RecommendationTrace;
    expect(() =>
      buildRecommendationExposureRecords({
        userId: USER_ID,
        trace: unsafeTrace,
        orderedTmdbIds: FINAL_ORDER,
      }),
    ).toThrow();
  });

  it("validates exact bounded record keys and rejects unsafe values", () => {
    const [record] = buildRecommendationExposureRecords({
      userId: USER_ID,
      trace: makeTrace(),
      orderedTmdbIds: FINAL_ORDER,
    });
    expect(validateRecommendationExposureRecord(record)).toBe(true);

    expect(Object.keys(record).sort()).toEqual(
      [
        "drop_reason_counts",
        "engine_version",
        "experiment_bucket",
        "input_revision",
        "post_rank",
        "pre_rank",
        "source_shares",
        "tmdb_id",
        "user_id",
      ].sort(),
    );

    expect(
      validateRecommendationExposureRecord({ ...record, reasons: ["private"] }),
    ).toBe(false);
    expect(
      validateRecommendationExposureRecord({
        ...record,
        input_revision: "not-a-hash",
      }),
    ).toBe(false);
    expect(
      validateRecommendationExposureRecord({
        ...record,
        experiment_bucket: "variant_a",
      }),
    ).toBe(false);
    expect(
      validateRecommendationExposureRecord({ ...record, pre_rank: 0 }),
    ).toBe(false);
    expect(
      validateRecommendationExposureRecord({
        ...record,
        post_rank: MAX_DIAGNOSTIC_COUNT + 1,
      }),
    ).toBe(false);
    expect(
      validateRecommendationExposureRecord({
        ...record,
        source_shares: { "not-a-family": 1 },
      }),
    ).toBe(false);
    expect(
      validateRecommendationExposureRecord({
        ...record,
        drop_reason_counts: { not_a_reason: 1 },
      }),
    ).toBe(false);
    expect(
      validateRecommendationExposureRecord({ ...record, user_id: "   " }),
    ).toBe(false);
  });

  it("never serializes raw reasons, histories, feedback, JWTs, keys, or input filters", () => {
    const secretResults = [
      {
        ...canonicalFixture.result.results[0],
        reasons: ["SECRET_REASON_TEXT because you watched a private film"],
        explanation:
          "FEEDBACK_TEXT jwt eyJhbGciOiJIUzI1NiJ9.payload.signature",
      },
    ];
    const trace = buildRecommendationTrace({
      result: {
        results: secretResults,
        diagnostics: canonicalFixture.result.diagnostics,
      },
    });
    const records = buildRecommendationExposureRecords({
      userId: USER_ID,
      trace,
      orderedTmdbIds: secretResults.map((candidate) => candidate.tmdbId),
    });
    const serialized = JSON.stringify(records);

    expect(serialized).not.toContain("SECRET_REASON_TEXT");
    expect(serialized).not.toContain("FEEDBACK_TEXT");
    expect(serialized).not.toMatch(/eyJhbGciOiJIUzI1NiJ9/);
    expect(serialized).not.toMatch(/sk_live|api[_-]?key|password/i);
    expect(serialized).not.toMatch(/letterboxd:\/\/film/);
    expect(serialized).not.toContain("Mystery");
    expect(serialized).not.toContain("canonical-fixture-seed");
    // No candidate id arrays beyond the exposed tmdb_id scalar per record.
    for (const record of records) {
      expect(Array.isArray(record)).toBe(false);
      expect(Object.keys(record)).not.toContain("candidateIds");
      expect(Object.keys(record)).not.toContain("results");
      expect(Object.keys(record)).not.toContain("reasons");
    }
  });
});

describe("recommendation exposure sink", () => {
  let writer: Mock<RecommendationExposureWriter>;

  beforeEach(() => {
    writer = vi.fn<RecommendationExposureWriter>(async () => undefined);
  });

  it("routes the final output through one injected writer", async () => {
    const trace = makeTrace();

    await recordRecommendationExposures({
      userId: USER_ID,
      trace,
      orderedTmdbIds: FINAL_ORDER,
      writer,
    });

    expect(writer).toHaveBeenCalledTimes(1);
    expect(writer.mock.calls[0]?.[0]).toEqual(
      buildRecommendationExposureRecords({
        userId: USER_ID,
        trace,
        orderedTmdbIds: FINAL_ORDER,
      }),
    );
  });

  it("does not write when nothing was exposed", async () => {
    await recordRecommendationExposures({
      userId: USER_ID,
      trace: makeTrace(),
      orderedTmdbIds: [],
      writer,
    });

    expect(writer).not.toHaveBeenCalled();
  });

  it("swallows writer failures so exposure telemetry never breaks generation", async () => {
    const failing = vi.fn(async () => {
      throw new Error("insert failed");
    });

    await expect(
      recordRecommendationExposures({
        userId: USER_ID,
        trace: makeTrace(),
        orderedTmdbIds: FINAL_ORDER,
        writer: failing,
      }),
    ).resolves.toBeUndefined();
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("fails closed without writing when the trace is invalid", async () => {
    const unsafeTrace = {
      ...makeTrace(),
      inputRevision: "NOT-HEX",
    } as unknown as RecommendationTrace;

    await expect(
      recordRecommendationExposures({
        userId: USER_ID,
        trace: unsafeTrace,
        orderedTmdbIds: FINAL_ORDER,
        writer,
      }),
    ).resolves.toBeUndefined();
    expect(writer).not.toHaveBeenCalled();
  });

  it("resolves without a client when no writer is available", async () => {
    await expect(
      recordRecommendationExposures({
        userId: USER_ID,
        trace: makeTrace(),
        orderedTmdbIds: FINAL_ORDER,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("supabase exposure writer seam", () => {
  function makeClient(options?: { error?: unknown }) {
    const insert = vi.fn(async (..._rows: unknown[]) => ({
      data: null,
      error: options?.error ?? null,
    }));
    const from = vi.fn(() => ({ insert }));
    return { client: { from }, from, insert };
  }

  it("inserts bounded rows into the single exposure table", async () => {
    const { client, from, insert } = makeClient();
    const records = buildRecommendationExposureRecords({
      userId: USER_ID,
      trace: makeTrace(),
      orderedTmdbIds: FINAL_ORDER,
    });

    await createSupabaseExposureWriter(client)(records);

    expect(SUGGESTION_EXPOSURE_TABLE).toBe("suggestion_exposure_log");
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith(SUGGESTION_EXPOSURE_TABLE);
    expect(insert).toHaveBeenCalledTimes(1);
    const rows = insert.mock.calls[0]?.[0] as RecommendationExposureRecord[];
    expect(rows).toEqual(records);
    for (const row of rows) {
      expect(row.user_id).toBe(USER_ID);
      expect(validateRecommendationExposureRecord(row)).toBe(true);
    }
  });

  it("skips the insert entirely for an empty record set", async () => {
    const { client, from } = makeClient();

    await createSupabaseExposureWriter(client)([]);

    expect(from).not.toHaveBeenCalled();
  });

  it("surfaces insert errors so the sink can record them", async () => {
    const { client } = makeClient({ error: new Error("rls violation") });
    const records = buildRecommendationExposureRecords({
      userId: USER_ID,
      trace: makeTrace(),
      orderedTmdbIds: FINAL_ORDER,
    });

    await expect(
      createSupabaseExposureWriter(client)(records),
    ).rejects.toThrow();
  });

  it("no-ops gracefully when no supabase client is available", async () => {
    const records = buildRecommendationExposureRecords({
      userId: USER_ID,
      trace: makeTrace(),
      orderedTmdbIds: FINAL_ORDER,
    });

    await expect(
      createSupabaseExposureWriter(null)(records),
    ).resolves.toBeUndefined();
    await expect(
      createSupabaseExposureWriter(undefined)(records),
    ).resolves.toBeUndefined();
  });

  it("resolves the client lazily so construction failures stay inside the sink", async () => {
    const { client, insert } = makeClient();
    const records = buildRecommendationExposureRecords({
      userId: USER_ID,
      trace: makeTrace(),
      orderedTmdbIds: FINAL_ORDER,
    });

    const lazy = createLazyExposureWriter(() => client);
    await lazy(records);
    expect(insert).toHaveBeenCalledTimes(1);

    const throwing = createLazyExposureWriter(() => {
      throw new Error("env missing");
    });
    await expect(throwing(records)).rejects.toThrow();
  });
});

describe("web and v1 adapter exposure parity", () => {
  it("persists identical records for both adapters given the same trace and final order", () => {
    const trace = makeTrace();

    const web = buildRecommendationExposureRecords({
      userId: USER_ID,
      trace,
      orderedTmdbIds: FINAL_ORDER,
    });
    const v1 = buildRecommendationExposureRecords({
      userId: USER_ID,
      trace,
      orderedTmdbIds: FINAL_ORDER,
      preRanksById: new Map(FINAL_ORDER.map((id, index) => [id, index + 1])),
    });

    expect(v1).toEqual(web);
  });

  it("routes both production adapters through the shared sink and removes the legacy writer", () => {
    const page = readFileSync(
      fileURLToPath(new URL("../../src/app/suggest/page.tsx", import.meta.url)),
      "utf8",
    );
    const v1Route = readFileSync(
      fileURLToPath(
        new URL(
          "../../src/app/api/v1/suggestions/generate/route.ts",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    const enrich = readFileSync(
      fileURLToPath(new URL("../../src/lib/enrich.ts", import.meta.url)),
      "utf8",
    );

    // One shared sink after final output in both adapters.
    expect(page).toMatch(/recordRecommendationExposures\s*\(/);
    expect(v1Route).toMatch(/recordRecommendationExposures\s*\(/);
    expect(page).toMatch(/from "@/);
    expect(v1Route).toContain("@/lib/recommendationTelemetry");
    expect(page).toContain("@/lib/recommendationTelemetry");

    // The legacy unversioned writer is gone so no competing schema remains.
    expect(enrich).not.toMatch(/\blogSuggestionExposure\b/);
    expect(page).not.toMatch(/\blogSuggestionExposure\s*\(/);
    expect(v1Route).not.toMatch(/\blogSuggestionExposure\s*\(/);
  });

  it("threads engine pre-ranks through both canonical web callers and awaits the v1 sink", () => {
    const page = readFileSync(
      fileURLToPath(new URL("../../src/app/suggest/page.tsx", import.meta.url)),
      "utf8",
    );
    const genrePage = readFileSync(
      fileURLToPath(
        new URL("../../src/app/genre-suggest/page.tsx", import.meta.url),
      ),
      "utf8",
    );
    const v1Route = readFileSync(
      fileURLToPath(
        new URL(
          "../../src/app/api/v1/suggestions/generate/route.ts",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    // /suggest parses the canonical preRanks payload and passes the map to the
    // shared sink with the final details order.
    expect(page).toContain("parseCanonicalWebPreRanks");
    expect(page).toMatch(/recordRecommendationExposures\s*\(\s*\{[^}]*preRanksById/);
    expect(page).toContain(
      "postRanksById: committedSuggestPresentation.postRanksById",
    );
    expect(page).toContain("providerFamiliesByTmdbId");

    // /genre-suggest records exposures for the final deduped presented order
    // using the canonical trace and parsed pre-ranks, guarded so stale or
    // account-switched runs do not log.
    expect(genrePage).toContain("@/lib/recommendationTelemetry");
    expect(genrePage).toContain("parseCanonicalWebPreRanks");
    expect(genrePage).toMatch(/recordRecommendationExposures\s*\(\s*\{[^}]*preRanksById/);
    expect(genrePage).toContain(
      "postRanksById: committedGenrePresentation.postRanksById",
    );
    expect(genrePage).toContain("providerFamiliesByTmdbId");
    expect(genrePage).toMatch(/canonical\.trace/);
    expect(genrePage).toMatch(/isCurrentRun\(\)/);
    expect(genrePage).toMatch(/data\.session\?\.user\?\.id/);

    // v1 awaits the non-throwing sink before responding and uses the engine's
    // canonical pre-rank map instead of rebuilding ranks locally.
    expect(v1Route).toMatch(/await recordRecommendationExposures\s*\(/);
    expect(v1Route).not.toMatch(/void recordRecommendationExposures/);
    expect(v1Route).toContain("canonicalResult.preRanksById");
    expect(v1Route).toContain("providerFamiliesByTmdbId");
  });

  it("normalizes raw web labels before building exposed-only provider maps", () => {
    const page = readFileSync(
      fileURLToPath(new URL("../../src/app/suggest/page.tsx", import.meta.url)),
      "utf8",
    );
    const genrePage = readFileSync(
      fileURLToPath(
        new URL("../../src/app/genre-suggest/page.tsx", import.meta.url),
      ),
      "utf8",
    );

    expect(page).toMatch(/normalizeProviderFamilies\(item\.sources \?\? \[\]\)/);
    expect(genrePage).toMatch(
      /normalizeProviderFamilies\(movie\.sources \?\? \[\]\)/,
    );

    const canonicalFamilies = normalizeProviderFamilies([
      "similar:303",
      "trending-day",
      "watchmode-similar",
      "sk_live_private",
      "private-family",
    ]);
    expect(canonicalFamilies).toEqual([
      "private-family",
      "sk_live_private",
      "tmdb",
      "watchmode",
    ]);

    const [record] = buildRecommendationExposureRecords({
      userId: USER_ID,
      trace: makeTrace(),
      orderedTmdbIds: [FINAL_ORDER[0]],
      providerFamiliesByTmdbId: new Map([
        [FINAL_ORDER[0], canonicalFamilies],
      ]),
    });
    expect(record.source_shares).toEqual({ tmdb: 1, watchmode: 1 });
  });
});

describe("bounded admin exposure diagnostics", () => {
  it("aggregates only allowlisted engine versions and experiment buckets", () => {
    const diagnostics = buildBoundedExposureDiagnostics({
      totalCount: 42,
      countsByEngineVersion: {
        [RECOMMENDATION_ENGINE_VERSION]: 40,
        "sk_live_abcdef0123456789": 5,
        user_123: 5,
        "550e8400-e29b-41d4-a716-446655440000": 5,
      },
      countsByExperimentBucket: {
        [DEFAULT_EXPERIMENT_BUCKET]: 42,
        variant_a: 3,
      },
    });

    expect(diagnostics.total_count).toBe(42);
    expect(diagnostics.by_engine_version).toEqual({
      [RECOMMENDATION_ENGINE_VERSION]: 40,
    });
    expect(diagnostics.by_experiment_bucket).toEqual({
      [DEFAULT_EXPERIMENT_BUCKET]: 42,
    });
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain("sk_live");
    expect(serialized).not.toContain("user_123");
    expect(serialized).not.toContain("variant_a");
  });

  it("bounds totals and counts into the safe diagnostic range", () => {
    const diagnostics = buildBoundedExposureDiagnostics({
      totalCount: Number.MAX_SAFE_INTEGER,
      countsByEngineVersion: {
        [RECOMMENDATION_ENGINE_VERSION]: MAX_DIAGNOSTIC_COUNT + 999,
      },
      countsByExperimentBucket: {
        [DEFAULT_EXPERIMENT_BUCKET]: -5,
      },
    });

    expect(diagnostics.total_count).toBe(MAX_DIAGNOSTIC_COUNT);
    expect(
      diagnostics.by_engine_version[RECOMMENDATION_ENGINE_VERSION],
    ).toBe(MAX_DIAGNOSTIC_COUNT);
    expect(
      diagnostics.by_experiment_bucket[DEFAULT_EXPERIMENT_BUCKET],
    ).toBe(0);
  });

  it("coerces unsafe inputs to bounded zero counts", () => {
    const diagnostics = buildBoundedExposureDiagnostics({
      totalCount: Number.NaN,
      countsByEngineVersion: {
        [RECOMMENDATION_ENGINE_VERSION]: Number.POSITIVE_INFINITY,
      },
      countsByExperimentBucket: {},
    });

    expect(diagnostics.total_count).toBe(0);
    expect(
      diagnostics.by_engine_version[RECOMMENDATION_ENGINE_VERSION],
    ).toBe(0);
    expect(
      diagnostics.by_experiment_bucket[DEFAULT_EXPERIMENT_BUCKET],
    ).toBe(0);
  });

  it("emits an exact bounded shape without raw rows, reasons, or arrays", () => {
    const diagnostics = buildBoundedExposureDiagnostics({
      totalCount: 3,
      countsByEngineVersion: { [RECOMMENDATION_ENGINE_VERSION]: 3 },
      countsByExperimentBucket: { [DEFAULT_EXPERIMENT_BUCKET]: 3 },
    });

    expect(Object.keys(diagnostics).sort()).toEqual([
      "by_engine_version",
      "by_experiment_bucket",
      "total_count",
    ]);
    expect(Array.isArray(diagnostics.by_engine_version)).toBe(false);
    expect(Array.isArray(diagnostics.by_experiment_bucket)).toBe(false);
    for (const map of [
      diagnostics.by_engine_version,
      diagnostics.by_experiment_bucket,
    ]) {
      for (const value of Object.values(map)) {
        expect(Number.isSafeInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(MAX_DIAGNOSTIC_COUNT);
      }
    }
  });
});

describe("version_recommendation_exposure migration contract", () => {
  const migrationPath = fileURLToPath(
    new URL(
      "../../supabase/migrations/20260802120000_version_recommendation_exposure.sql",
      import.meta.url,
    ),
  );
  const migration = readFileSync(migrationPath, "utf8");

  it("is a forward-only migration ordered after the linked reconcile snapshot version", () => {
    // 20260802120000 > 20260802013015 (latest linked applied migration).
    expect("20260802120000" > "20260802013015").toBe(true);
    expect(migration).toMatch(
      /alter table public\.suggestion_exposure_log/i,
    );
    expect(migration).not.toMatch(/drop table/i);
    expect(migration).not.toMatch(/drop column/i);
  });

  it("adds only the required bounded versioned exposure columns", () => {
    for (const column of [
      "engine_version",
      "experiment_bucket",
      "input_revision",
      "pre_rank",
      "post_rank",
      "drop_reason_counts",
      "source_shares",
      "retention_until",
    ]) {
      expect(
        migration,
        `missing add column if not exists ${column}`,
      ).toMatch(new RegExp(`add column if not exists ${column}\\b`, "i"));
    }
    expect(migration).toMatch(
      /retention_until\s+timestamptz\s+not null\s+default/i,
    );
  });

  it("bounds persisted diagnostic values with check constraints", () => {
    expect(migration).toMatch(/\[0-9a-f\]\{16\}/);
    expect(migration).toMatch(/pre_rank\s+(?:is null or|between)/i);
    expect(migration).toMatch(/post_rank\s+(?:is null or|between)/i);
    expect(migration).toMatch(/between 1 and 10000/i);
    expect(migration).toMatch(/bounded_jsonb_object\(\s*drop_reason_counts/i);
    expect(migration).toMatch(/bounded_jsonb_object\(\s*source_shares/i);
    expect(migration).toMatch(/engine_version is null or/i);
    expect(migration).toMatch(/experiment_bucket is null or/i);
  });

  it("keeps owner isolation and never grants update or delete to users", () => {
    expect(migration).not.toMatch(/disable row level security/i);
    expect(migration).not.toMatch(/drop policy "Users can view/i);
    expect(migration).not.toMatch(/drop policy "Users can insert/i);
    expect(migration).not.toMatch(/for update/i);
    expect(migration).not.toMatch(/for delete to authenticated/i);
    expect(migration).not.toMatch(/for delete to anon/i);
  });

  it("adds retention and owner-scoped lookup indexes", () => {
    expect(migration).toMatch(
      /create index if not exists suggestion_exposure_log_retention/i,
    );
    expect(migration).toMatch(/\(\s*retention_until\s*\)/i);
    expect(migration).toMatch(
      /create index if not exists suggestion_exposure_log_user_exposed/i,
    );
    expect(migration).toMatch(/\(\s*user_id\s*,\s*exposed_at desc\s*\)/i);
  });

  it("enforces bounded retention through a privileged definer prune job", () => {
    expect(EXPOSURE_RETENTION_DAYS).toBe(90);
    expect(migration).toMatch(
      /create or replace function public\.prune_suggestion_exposures/i,
    );
    expect(migration).toMatch(/security definer/i);
    expect(migration).toMatch(/set search_path to ''/i);
    expect(migration).toMatch(/retention_until < now\(\)/i);
    expect(migration).toMatch(
      /revoke all on function public\.prune_suggestion_exposures\(integer\) from public/i,
    );
    expect(migration).toMatch(/cron\.schedule\(/i);
    expect(migration).toMatch(/prune_suggestion_exposures_daily/);
    expect(migration).toMatch(/cron\.unschedule/i);
    expect(migration).toMatch(/notify pgrst, ['"]reload schema['"]/i);
  });

  it("defines one bounded service-role-only exposure aggregate RPC", () => {
    const rpcFunction =
      migration.match(
        /create or replace function public\.get_bounded_exposure_diagnostics\(\s*p_owner_user_id\s+uuid\s*\)[\s\S]*?\$body\$[\s\S]*?\$body\$/i,
      )?.[0] ?? "";

    expect(rpcFunction.length).toBeGreaterThan(0);
    expect(rpcFunction).toMatch(
      /returns table\s*\(\s*total_count\s+integer\s*,\s*owner_count\s+integer\s*,\s*current_engine_count\s+integer\s*,\s*default_bucket_count\s+integer\s*\)/i,
    );
    expect(rpcFunction).toMatch(/security definer/i);
    expect(rpcFunction).toMatch(/set search_path to ''/i);
    expect(rpcFunction).toMatch(
      /least\(\s*count\(\*\)\s*,\s*10000::bigint\s*\)/i,
    );
    expect(rpcFunction).toMatch(
      /count\(\*\)\s+filter\s*\(\s*where\s+engine_version\s*=\s*'v1-canonical-1'/i,
    );
    expect(rpcFunction).toMatch(
      /count\(\*\)\s+filter\s*\(\s*where\s+experiment_bucket\s*=\s*'default'/i,
    );
    expect(rpcFunction).toMatch(
      /count\(\*\)\s+filter\s*\(\s*where\s+user_id\s*=\s*p_owner_user_id/i,
    );
    expect(
      rpcFunction.match(/from\s+public\.suggestion_exposure_log/gi) ?? [],
    ).toHaveLength(1);
    expect(rpcFunction).not.toMatch(/select\s+\*/i);

    for (const role of ["public", "anon", "authenticated"]) {
      expect(migration).toMatch(
        new RegExp(
          `revoke all on function public\\.get_bounded_exposure_diagnostics\\(uuid\\) from ${role}\\s*;`,
          "i",
        ),
      );
    }
    expect(migration).toMatch(
      /grant execute on function public\.get_bounded_exposure_diagnostics\(uuid\) to service_role\s*;/i,
    );
  });

  it("forces insert timestamps, preserves update timestamps, and nulls legacy raw columns through one security-invoker write trigger", () => {
    const triggerFunction =
      migration.match(
        /create or replace function public\.enforce_versioned_exposure_insert\(\)[\s\S]*?\$body\$[\s\S]*?\$body\$/i,
      )?.[0] ?? "";

    expect(triggerFunction.length).toBeGreaterThan(0);
    expect(triggerFunction).toMatch(/returns trigger/i);
    expect(triggerFunction).toMatch(/language plpgsql/i);
    expect(triggerFunction).toMatch(/security invoker/i);
    expect(triggerFunction).not.toMatch(/security definer/i);
    expect(triggerFunction).toMatch(/set search_path to ''/i);
    expect(triggerFunction).toMatch(/if\s+tg_op\s*=\s*'insert'\s+then/i);
    expect(triggerFunction).toMatch(/new\.exposed_at\s*:=\s*now\(\)\s*;/i);
    expect(triggerFunction).toMatch(
      /new\.retention_until\s*:=\s*now\(\)\s*\+\s*interval '90 days'\s*;/i,
    );
    expect(triggerFunction).toMatch(
      /new\.exposed_at\s*:=\s*old\.exposed_at\s*;/i,
    );
    expect(triggerFunction).toMatch(
      /new\.retention_until\s*:=\s*old\.retention_until\s*;/i,
    );
    expect(triggerFunction).toMatch(/new\.session_context\s*:=\s*null\s*;/i);
    expect(triggerFunction).toMatch(/new\.sources\s*:=\s*null\s*;/i);
    expect(triggerFunction).toMatch(/new\.reasons\s*:=\s*null\s*;/i);
    expect(triggerFunction).toMatch(/return new\s*;/i);

    // Rerunnable, schema-qualified trigger attachment on the exposure table.
    expect(migration).toMatch(
      /drop trigger if exists suggestion_exposure_log_version_guard on public\.suggestion_exposure_log\s*;/i,
    );
    expect(migration).toMatch(
      /create trigger suggestion_exposure_log_version_guard\s+before insert or update on public\.suggestion_exposure_log\s+for each row\s+execute function public\.enforce_versioned_exposure_insert\(\)\s*;/i,
    );
  });

  it("keeps legacy nullable rows while requiring an all-null or complete canonical field set", () => {
    expect(migration).toMatch(
      /drop constraint if exists suggestion_exposure_log_canonical_fields_bounds/i,
    );
    expect(migration).toMatch(
      /add constraint suggestion_exposure_log_canonical_fields_bounds\s+check/i,
    );

    const canonicalConstraint =
      migration.match(
        /add constraint suggestion_exposure_log_canonical_fields_bounds[\s\S]*?--\s*Indexes:/i,
      )?.[0] ?? "";
    expect(canonicalConstraint).toMatch(
      /engine_version\s+is null\s+and\s+experiment_bucket\s+is null/i,
    );
    expect(canonicalConstraint).toMatch(
      /engine_version\s+is not null\s+and\s+experiment_bucket\s+is not null/i,
    );
    for (const field of [
      "input_revision",
      "pre_rank",
      "post_rank",
      "drop_reason_counts",
      "source_shares",
    ]) {
      expect(
        canonicalConstraint,
        `canonical constraint must account for ${field}`,
      ).toMatch(new RegExp(`\\b${field}\\s+is\\s+(?:null|not null)`, "i"));
    }
  });

  it("clears every legacy telemetry payload column for existing rows at migration time", () => {
    const legacyColumns = [
      "category",
      "session_context",
      "base_score",
      "consensus_level",
      "sources",
      "reasons",
      "mmr_lambda",
      "diversity_rank",
      "has_poster",
      "has_trailer",
      "metadata_completeness",
    ];

    const cleanupStatement = [
      ...migration.matchAll(
        /update public\.suggestion_exposure_log\s+set\s+[\s\S]*?;/gi,
      ),
    ]
      .map((match) => match[0])
      .find((statement) => /\bcategory\s*=\s*null/i.test(statement));

    expect(
      cleanupStatement,
      "expected a migration-time update that clears the legacy payload columns",
    ).toBeDefined();

    for (const column of legacyColumns) {
      expect(
        cleanupStatement,
        `legacy payload column ${column} is not cleared for existing rows`,
      ).toMatch(new RegExp(`\\b${column}\\s*=\\s*null`, "i"));
    }

    // Identity, ownership, timestamps, retention, and canonical fields survive.
    for (const preserved of [
      "id",
      "user_id",
      "tmdb_id",
      "exposed_at",
      "created_at",
      "retention_until",
      "engine_version",
      "experiment_bucket",
      "input_revision",
      "pre_rank",
      "post_rank",
      "drop_reason_counts",
      "source_shares",
    ]) {
      expect(
        cleanupStatement,
        `legacy cleanup must not rewrite ${preserved}`,
      ).not.toMatch(new RegExp(`\\b${preserved}\\b\\s*=`, "i"));
    }
  });

  it("nulls every legacy payload column and rejects incomplete canonical records in the write guard", () => {
    const triggerFunction =
      migration.match(
        /create or replace function public\.enforce_versioned_exposure_insert\(\)[\s\S]*?\$body\$[\s\S]*?\$body\$/i,
      )?.[0] ?? "";
    expect(triggerFunction.length).toBeGreaterThan(0);

    for (const column of [
      "category",
      "session_context",
      "base_score",
      "consensus_level",
      "sources",
      "reasons",
      "mmr_lambda",
      "diversity_rank",
      "has_poster",
      "has_trailer",
      "metadata_completeness",
    ]) {
      expect(
        triggerFunction,
        `guard must null new.${column} regardless of client input`,
      ).toMatch(new RegExp(`new\\.${column}\\s*:=\\s*null\\s*;`, "i"));
    }

    // Incomplete or non-canonical records fail closed with a stable
    // SQLSTATE/message that pgTAP can assert exactly.
    expect(triggerFunction).toMatch(/22023/);
    expect(triggerFunction).toMatch(/incomplete versioned exposure record/);

    for (const field of [
      "engine_version",
      "experiment_bucket",
      "input_revision",
      "pre_rank",
      "post_rank",
      "drop_reason_counts",
      "source_shares",
    ]) {
      expect(
        triggerFunction,
        `guard must reject rows missing ${field}`,
      ).toMatch(
        new RegExp(`new\\.${field}\\s+is\\s+(?:null|distinct\\s+from)`, "i"),
      );
    }

    // Exact canonical pairing, revision shape, rank bounds, and the bounded
    // allowlisted diagnostic maps are enforced before the row can exist.
    expect(triggerFunction).toMatch(
      /new\.engine_version\s+is\s+distinct\s+from\s+'v1-canonical-1'/i,
    );
    expect(triggerFunction).toMatch(
      /new\.experiment_bucket\s+is\s+distinct\s+from\s+'default'/i,
    );
    expect(triggerFunction).toMatch(
      /new\.input_revision\s+!~\s*'\^\[0-9a-f\]\{16\}\$'/i,
    );
    expect(triggerFunction).toMatch(
      /new\.pre_rank\s+not\s+between\s+1\s+and\s+10000/i,
    );
    expect(triggerFunction).toMatch(
      /new\.post_rank\s+not\s+between\s+1\s+and\s+10000/i,
    );
    expect(triggerFunction).toMatch(
      /bounded_jsonb_object\(\s*new\.drop_reason_counts/i,
    );
    expect(triggerFunction).toMatch(
      /bounded_jsonb_object\(\s*new\.source_shares/i,
    );
  });

  it("restricts guard EXECUTE to authenticated and service_role writers and leaves owner RLS intact", () => {
    expect(migration).toMatch(
      /revoke all on function public\.enforce_versioned_exposure_insert\(\) from public\s*;/i,
    );
    expect(migration).toMatch(
      /revoke all on function public\.enforce_versioned_exposure_insert\(\) from anon\s*;/i,
    );
    expect(migration).toMatch(
      /grant execute on function public\.enforce_versioned_exposure_insert\(\) to authenticated\s*;/i,
    );
    expect(migration).toMatch(
      /grant execute on function public\.enforce_versioned_exposure_insert\(\) to service_role\s*;/i,
    );

    // The owner INSERT RLS policy and the service-role writer path are
    // preserved, never dropped or redefined by this migration.
    expect(migration).not.toMatch(/create policy/i);
    expect(migration).not.toMatch(/drop policy/i);
  });

  it("allows only legacy-null rows or the exact canonical engine version and default bucket", () => {
    expect(migration).toMatch(
      /engine_version is null or\s*\(\s*engine_version = 'v1-canonical-1'\s+and experiment_bucket = 'default'\s*\)/i,
    );
    expect(migration).toMatch(
      /experiment_bucket is null or\s*\(\s*experiment_bucket = 'default'\s+and engine_version = 'v1-canonical-1'\s*\)/i,
    );
    // Legacy regex-shaped engine/bucket bounds are replaced by the exact pair.
    expect(migration).not.toMatch(/engine_version ~ /i);
    expect(migration).not.toMatch(/experiment_bucket ~ /i);
    // Input revision stays a 16-char lowercase hash.
    expect(migration).toMatch(/input_revision ~ '\^\[0-9a-f\]\{16\}\$'/i);
  });

  it("validates diagnostic maps with an exact allowlist, bounded keys, size, and integer values", () => {
    const helper =
      migration.match(
        /create or replace function public\.bounded_jsonb_object\([\s\S]*?\$body\$[\s\S]*?\$body\$/i,
      )?.[0] ?? "";

    expect(helper.length).toBeGreaterThan(0);
    expect(helper).toMatch(/allowed_keys text\[\]/i);
    expect(helper).toMatch(/max_key_length integer/i);
    expect(helper).toMatch(/max_serialized_bytes integer/i);
    expect(helper).toMatch(/max_value integer/i);
    expect(helper).toMatch(/immutable/i);
    expect(helper).toMatch(/security invoker/i);
    expect(helper).not.toMatch(/security definer/i);
    expect(helper).toMatch(/set search_path to ''/i);

    // Bounded cardinality, serialized size, key length, exact key allowlist,
    // and integer values within [0, max_value]; non-object jsonb fails closed.
    expect(helper).toMatch(/<=\s*max_keys/);
    expect(helper).toMatch(
      /octet_length\(value::text\)\s*<=\s*max_serialized_bytes/,
    );
    expect(helper).toMatch(
      /char_length\(entries\.entry_key\)\s*>\s*max_key_length/,
    );
    expect(helper).toMatch(
      /array_position\(allowed_keys,\s*entries\.entry_key\) is null/,
    );
    expect(helper).toMatch(
      /case\s+jsonb_typeof\(entries\.entry_value\)\s+when\s+'number'/i,
    );
    expect(helper).toMatch(/else\s+true/i);
    expect(helper).toMatch(/trunc\(/);
    expect(helper).toMatch(/>\s*max_value/);
    expect(helper).toMatch(/case jsonb_typeof\(value\)/);
    expect(helper).toMatch(/else false/);

    // The legacy unbounded overload is removed and never re-granted.
    expect(migration).toMatch(
      /drop function if exists public\.bounded_jsonb_object\(jsonb, integer, numeric\)\s*;/i,
    );
    expect(migration).not.toMatch(
      /bounded_jsonb_object\(jsonb, integer, numeric\)\s+to/i,
    );

    // EXECUTE is restricted to real writers; check constraints evaluate as the
    // inserting role, so authenticated and service_role both need it.
    for (const role of ["public", "anon"]) {
      expect(migration).toMatch(
        new RegExp(
          `revoke all on function public\\.bounded_jsonb_object\\(jsonb, text\\[\\], integer, integer, integer, integer\\) from ${role}\\s*;`,
          "i",
        ),
      );
    }
    for (const role of ["authenticated", "service_role"]) {
      expect(migration).toMatch(
        new RegExp(
          `grant execute on function public\\.bounded_jsonb_object\\(jsonb, text\\[\\], integer, integer, integer, integer\\) to ${role}\\s*;`,
          "i",
        ),
      );
    }
  });

  it("persists only the exact drop-reason and source-family allowlists with bounded integer values", () => {
    const dropReasonKeys = [
      "seed",
      "excluded",
      "blocked",
      "watched",
      "genre",
      "negative",
      "duplicate",
      "invalid_score",
      "source_failed",
      "insufficient_evidence",
      "diversity",
    ];
    const sourceKeys = [
      "letterboxd",
      "tastedive",
      "tmdb",
      "tuimdb",
      "vector-similarity",
      "watchmode",
    ];

    const dropConstraint = migration.match(
      /add constraint suggestion_exposure_log_drop_reason_counts_bounds[\s\S]*?bounded_jsonb_object\(\s*drop_reason_counts,\s*array\[([\s\S]*?)\],\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\s*\)/i,
    );
    expect(dropConstraint).not.toBeNull();
    const dropKeys = [...(dropConstraint?.[1] ?? "").matchAll(/'([^']+)'/g)].map(
      (match) => match[1],
    );
    expect(dropKeys).toEqual(dropReasonKeys);
    expect(Number(dropConstraint?.[2])).toBe(dropReasonKeys.length);
    expect(Number(dropConstraint?.[3])).toBeGreaterThanOrEqual(
      "insufficient_evidence".length,
    );
    expect(Number(dropConstraint?.[5])).toBe(10000);

    const sourceConstraint = migration.match(
      /add constraint suggestion_exposure_log_source_shares_bounds[\s\S]*?bounded_jsonb_object\(\s*source_shares,\s*array\[([\s\S]*?)\],\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\s*\)/i,
    );
    expect(sourceConstraint).not.toBeNull();
    const sourceKeyList = [
      ...(sourceConstraint?.[1] ?? "").matchAll(/'([^']+)'/g),
    ].map((match) => match[1]);
    expect(sourceKeyList).toEqual(sourceKeys);
    expect(Number(sourceConstraint?.[2])).toBe(sourceKeys.length);
    expect(Number(sourceConstraint?.[3])).toBeGreaterThanOrEqual(
      "vector-similarity".length,
    );
    expect(Number(sourceConstraint?.[5])).toBe(10000);
  });

  it("prunes expired rows and caps legacy rows at the true 90-day retention boundary", () => {
    // Already-expired rows are pruned during the migration itself.
    expect(migration).toMatch(
      /delete from public\.suggestion_exposure_log\s+where exposed_at < now\(\) - interval '90 days'\s+or retention_until < now\(\)\s*;/i,
    );
    // Client-supplied future exposure timestamps are clamped to the server clock.
    expect(migration).toMatch(
      /update public\.suggestion_exposure_log\s+set exposed_at = least\(exposed_at, now\(\)\)\s+where exposed_at > now\(\)\s*;/i,
    );
    // No row, however dated, outlives exposed_at + 90 days.
    expect(migration).toMatch(
      /update public\.suggestion_exposure_log\s+set retention_until = least\(retention_until, exposed_at \+ interval '90 days'\)\s+where retention_until > exposed_at \+ interval '90 days'\s*;/i,
    );
    // The backfill never rewrites version identity, so legacy null fields survive.
    expect(migration).not.toMatch(/set engine_version/i);
    expect(migration).not.toMatch(/set experiment_bucket/i);
    expect(migration).not.toMatch(/set input_revision/i);
  });

  it("drops an existing write guard before rerunnable migration-time updates", () => {
    const guardDrop = migration.search(
      /drop trigger if exists suggestion_exposure_log_version_guard on public\.suggestion_exposure_log\s*;/i,
    );
    const firstBackfillUpdate = migration.search(
      /update public\.suggestion_exposure_log\s+set exposed_at = least\(exposed_at, now\(\)\)/i,
    );

    expect(guardDrop).toBeGreaterThanOrEqual(0);
    expect(firstBackfillUpdate).toBeGreaterThan(guardDrop);
  });

  it("keeps migration dollar-quote tags balanced", () => {
    const tagCounts = new Map<string, number>();
    for (const match of migration.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)\$/g)) {
      tagCounts.set(match[0], (tagCounts.get(match[0]) ?? 0) + 1);
    }
    expect(tagCounts.size).toBeGreaterThan(0);
    for (const [tag, count] of tagCounts) {
      expect(count % 2, `dollar tag ${tag} unbalanced in migration`).toBe(0);
    }
  });

  it("ships a structurally balanced pgTAP suite for the exposure contract", () => {
    const pgtapPath = fileURLToPath(
      new URL(
        "../../supabase/tests/database/recommendation_exposure.test.sql",
        import.meta.url,
      ),
    );
    expect(existsSync(pgtapPath)).toBe(true);
    const pgtap = readFileSync(pgtapPath, "utf8");

    expect(pgtap).toMatch(/^begin;\s*$/im);
    expect(pgtap).toMatch(/rollback;\s*$/im);
    expect(pgtap).toMatch(/select \* from finish\(\)/i);
    expect(pgtap).toMatch(/create extension if not exists pgtap/i);

    const planned = Number(pgtap.match(/select plan\((\d+)\)/i)?.[1] ?? 0);
    expect(planned).toBeGreaterThan(0);
    const assertions =
      pgtap.match(
        /^\s*select\s+(?:ok|is|isnt|has_function|function_returns|function_privs_are|has_trigger|throws_ok|throws_matching)\(/gm,
      ) ?? [];
    expect(assertions.length).toBe(planned);

    const tagCounts = new Map<string, number>();
    for (const match of pgtap.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)\$/g)) {
      tagCounts.set(match[0], (tagCounts.get(match[0]) ?? 0) + 1);
    }
    for (const [tag, count] of tagCounts) {
      expect(count % 2, `dollar tag ${tag} unbalanced in pgTAP suite`).toBe(0);
    }
  });
});
