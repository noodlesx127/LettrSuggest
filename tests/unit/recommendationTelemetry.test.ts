import { describe, expect, it } from "vitest";

import {
  adaptCanonicalResultToV1,
  adaptCanonicalResultToWeb,
  adaptCanonicalResultToWebEnvelope,
  type V1RecommendationDetails,
  type WebRecommendationDetails,
} from "@/lib/recommendationAdapters";
import {
  createDeterministicRng,
  normalizeProviderFamilies,
} from "@/lib/recommendationCandidates";
import {
  loadRecommendationContext,
  type RecommendationContextRepository,
  type RecommendationContextSourceSnapshot,
  type RecommendationInputRevisionMaterial,
} from "@/lib/recommendationContext";
import { createRecommendationEngine } from "@/lib/recommendationEngine";
import {
  buildRecommendationTrace,
  deriveAppliedRelaxation,
  deriveSourceShares,
  hashInputRevision,
  normalizeExperimentBucket,
  normalizeTraceRelaxation,
} from "@/lib/recommendationTelemetry";
import {
  DEFAULT_EXPERIMENT_BUCKET,
  DEFAULT_INPUT_REVISION_HASH,
  MAX_TRACE_SOURCE_SHARE_KEYS,
  RECOMMENDATION_ENGINE_VERSION,
  RECOMMENDATION_PROVIDER_FAMILIES,
  RECOMMENDATION_TRACE_RELAXATIONS,
  validateRecommendationTrace,
  type RecommendationCandidate,
  type RecommendationInputHealth,
  type RecommendationResult,
  type RecommendationTrace,
} from "@/lib/recommendationTypes";
import { canonicalFixture } from "../fixtures/recommendations/canonicalFixture";

const healthyInputHealth: RecommendationInputHealth = {
  films: { health: "ok", rowCount: 12 },
  mappings: { health: "ok", rowCount: 12 },
  feedback: { health: "ok", rowCount: 4 },
  exploration: { health: "empty", rowCount: 0 },
  adjacent_genres: { health: "ok", rowCount: 2 },
  exposures: { health: "ok", rowCount: 3 },
  blocked: { health: "ok", rowCount: 1 },
};

function makeCandidate(
  tmdbId: number,
  providerFamilies: readonly string[],
  score = 1,
): RecommendationCandidate {
  return {
    tmdbId,
    score,
    evidence: {
      seedAnchors: [101],
      providerFamilies: [...providerFamilies],
      providerOccurrences: providerFamilies.length,
      retrievalScore: score,
    },
    attribution: {
      retrieval: score,
      preference: 0,
      context: 0,
      diversity: 0,
      total: score,
    },
  };
}

function makeResult(overrides?: {
  results?: readonly RecommendationCandidate[];
  diagnostics?: RecommendationResult["diagnostics"];
}): RecommendationResult {
  return {
    results: overrides?.results ?? canonicalFixture.result.results,
    diagnostics: overrides?.diagnostics ?? canonicalFixture.result.diagnostics,
  };
}

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
  sourceHealth: {
    films: { health: "ok", rowCount: 1 },
    mappings: { health: "ok", rowCount: 1 },
    metadata: { health: "empty", rowCount: 0 },
    dates: { health: "empty", rowCount: 0 },
    ratings: { health: "empty", rowCount: 0 },
    features: { health: "empty", rowCount: 0 },
    feedback: { health: "empty", rowCount: 0 },
    exploration: { health: "empty", rowCount: 0 },
    adjacent_genres: { health: "empty", rowCount: 0 },
    exposures: { health: "empty", rowCount: 0 },
    blocked: { health: "empty", rowCount: 0 },
  },
  inputHealth: healthyInputHealth,
  ...revisionSources,
};

describe("recommendation telemetry trace builder", () => {
  it("carries stage input/output counts, drop reasons, and engine version from canonical diagnostics", () => {
    const trace = buildRecommendationTrace({ result: makeResult() });

    expect(trace.engineVersion).toBe(RECOMMENDATION_ENGINE_VERSION);
    expect(trace.stageCounts).toEqual({
      retrieval: 5,
      scoring: 5,
      reranking: 3,
      final: 3,
    });
    expect(trace.seedCount).toBe(2);
    expect(trace.candidateCount).toBe(5);
    expect(trace.resultCount).toBe(3);
    expect(trace.dropReasonCounts).toEqual({ seed: 2, excluded: 1 });
    expect(validateRecommendationTrace(trace)).toBe(true);
  });

  it("carries health, mode, and failed sources consistently", () => {
    const trace = buildRecommendationTrace({ result: makeResult() });

    expect(trace.mode).toBe("personalized");
    expect(trace.contextMode).toBe("neutral");
    expect(trace.inputHealth).toEqual(healthyInputHealth);
    expect(trace.failedSources).toEqual([]);

    const degradedDiagnostics = {
      ...canonicalFixture.result.diagnostics,
      mode: "degraded" as const,
      inputHealth: {
        ...healthyInputHealth,
        mappings: { health: "failed" as const, rowCount: 0 },
      },
      failedSources: ["mappings" as const],
    };
    const degradedTrace = buildRecommendationTrace({
      result: makeResult({ diagnostics: degradedDiagnostics }),
    });
    expect(degradedTrace.mode).toBe("degraded");
    expect(degradedTrace.failedSources).toEqual(["mappings"]);
    expect(validateRecommendationTrace(degradedTrace)).toBe(true);
  });

  it("derives bounded numeric source shares from final canonical evidence families", () => {
    const shares = deriveSourceShares(canonicalFixture.result.results);

    // Families across the fixture results: tmdb x3, letterboxd x1.
    expect(shares).toEqual({ letterboxd: 1, tmdb: 3 });
    for (const value of Object.values(shares)) {
      expect(Number.isSafeInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }

    const trace = buildRecommendationTrace({ result: makeResult() });
    expect(trace.sourceShares).toEqual({ letterboxd: 1, tmdb: 3 });
  });

  it("normalizes raw provider signals into known families before sharing", () => {
    const results = [
      makeCandidate(1, normalizeProviderFamilies(["similar:101", "trending-day"])),
      makeCandidate(2, normalizeProviderFamilies(["watchmode-similar"])),
    ];

    expect(deriveSourceShares(results)).toEqual({ tmdb: 1, watchmode: 1 });
  });

  it("discards unknown regex-valid provider families including UUID, user-id, and API-key-like values", () => {
    const unknownFamilies = [
      "550e8400-e29b-41d4-a716-446655440000",
      "user_123",
      "sk_live_abcdef0123456789",
      "some-unknown-family",
    ];
    const results = unknownFamilies.map((family, index) =>
      makeCandidate(index + 1, [family]),
    );

    expect(deriveSourceShares(results)).toEqual({});

    const mixed = [
      makeCandidate(101, ["tmdb", "550e8400-e29b-41d4-a716-446655440000"]),
      makeCandidate(102, ["sk_live_abcdef0123456789"]),
      makeCandidate(103, ["tmdb"]),
    ];
    expect(deriveSourceShares(mixed)).toEqual({ tmdb: 2 });

    const trace = buildRecommendationTrace({
      result: makeResult({ results: mixed }),
    });
    const serialized = JSON.stringify(trace);
    expect(trace.sourceShares).toEqual({ tmdb: 2 });
    expect(serialized).not.toContain("550e8400-e29b-41d4-a716-446655440000");
    expect(serialized).not.toContain("sk_live_abcdef0123456789");
    expect(serialized).not.toContain("user_123");
  });

  it("counts each normalized provider family once per result", () => {
    const duplicated = [
      makeCandidate(1, ["tmdb", "tmdb", "letterboxd", "letterboxd"]),
    ];
    expect(deriveSourceShares(duplicated)).toEqual({ letterboxd: 1, tmdb: 1 });

    const twoResults = [
      makeCandidate(1, ["tmdb", "tmdb"]),
      makeCandidate(2, ["tmdb", "tmdb"]),
    ];
    expect(deriveSourceShares(twoResults)).toEqual({ tmdb: 2 });
  });

  it("bounds source share keys to the canonical provider-family allowlist", () => {
    const results = [
      makeCandidate(1, ["tmdb", "tastedive"]),
      makeCandidate(2, ["watchmode", "letterboxd"]),
      makeCandidate(3, ["tuimdb", "vector-similarity"]),
      makeCandidate(4, [
        "unknown-family",
        "550e8400-e29b-41d4-a716-446655440000",
      ]),
    ];

    const shares = deriveSourceShares(results);
    const keys = Object.keys(shares);

    for (const key of keys) {
      expect(RECOMMENDATION_PROVIDER_FAMILIES).toContain(key);
    }
    expect(keys).toHaveLength(RECOMMENDATION_PROVIDER_FAMILIES.length);
    expect(keys.length).toBeLessThanOrEqual(MAX_TRACE_SOURCE_SHARE_KEYS);
    expect(shares).toEqual({
      letterboxd: 1,
      tastedive: 1,
      tmdb: 1,
      tuimdb: 1,
      "vector-similarity": 1,
      watchmode: 1,
    });
  });

  it("rejects serialized traces whose source share keys fall outside the allowlist", () => {
    const trace = buildRecommendationTrace({ result: makeResult() });
    expect(
      validateRecommendationTrace({
        ...trace,
        sourceShares: { tmdb: 1, "not-a-family": 1 },
      }),
    ).toBe(false);
    expect(
      validateRecommendationTrace({
        ...trace,
        sourceShares: { tmdb: 1, "550e8400-e29b-41d4-a716-446655440000": 1 },
      }),
    ).toBe(false);
    expect(
      validateRecommendationTrace({ ...trace, sourceShares: { tmdb: 1 } }),
    ).toBe(true);
  });

  it("drops unsafe or empty source-family keys from shares", () => {
    const results = [
      makeCandidate(1, ["tmdb", "", "   ", "a".repeat(200)]),
      makeCandidate(2, ["tmdb"]),
    ];

    expect(deriveSourceShares(results)).toEqual({ tmdb: 2 });
  });

  it("normalizes relaxations to a bounded allowlist with a safe default", () => {
    expect(RECOMMENDATION_TRACE_RELAXATIONS).toEqual(["none", "threshold", "genre"]);
    expect(normalizeTraceRelaxation(undefined)).toBe("none");
    expect(normalizeTraceRelaxation("threshold")).toBe("threshold");
    expect(normalizeTraceRelaxation("genre")).toBe("genre");
    expect(normalizeTraceRelaxation("bogus")).toBe("none");
    expect(normalizeTraceRelaxation(123)).toBe("none");

    expect(buildRecommendationTrace({ result: makeResult() }).relaxation).toBe(
      "none",
    );
    expect(
      buildRecommendationTrace({ result: makeResult(), relaxation: "genre" })
        .relaxation,
    ).toBe("genre");
  });

  it("derives the applied relaxation from genre-filter applied stages", () => {
    expect(deriveAppliedRelaxation([])).toBe("none");
    expect(deriveAppliedRelaxation(["threshold"])).toBe("threshold");
    expect(deriveAppliedRelaxation(["genre"])).toBe("genre");
    expect(deriveAppliedRelaxation(["threshold", "genre"])).toBe("genre");
  });

  it("reports the relaxation actually applied through the v1 adapter, not merely requested", () => {
    const result = makeResult();
    const details = new Map<number, V1RecommendationDetails>();

    // Strict success: no relaxation applied even if one was requested.
    const strict = adaptCanonicalResultToV1(result, details, {
      relaxation: deriveAppliedRelaxation([]),
    });
    expect(strict.meta.trace.relaxation).toBe("none");

    const threshold = adaptCanonicalResultToV1(result, details, {
      relaxation: deriveAppliedRelaxation(["threshold"]),
    });
    expect(threshold.meta.trace.relaxation).toBe("threshold");

    const genre = adaptCanonicalResultToV1(result, details, {
      relaxation: deriveAppliedRelaxation(["threshold", "genre"]),
    });
    expect(genre.meta.trace.relaxation).toBe("genre");
  });

  it("normalizes the experiment bucket to a controlled allowlist with a clear default", () => {
    expect(normalizeExperimentBucket(undefined)).toBe(DEFAULT_EXPERIMENT_BUCKET);
    expect(normalizeExperimentBucket("default")).toBe("default");
    // Controlled experiment buckets became canonical with stable assignment (2C.2).
    expect(normalizeExperimentBucket("control")).toBe("control");
    expect(normalizeExperimentBucket("treatment")).toBe("treatment");
    // Arbitrary labels remain normalized to the default.
    expect(normalizeExperimentBucket("variant_a")).toBe(DEFAULT_EXPERIMENT_BUCKET);
    expect(normalizeExperimentBucket("bucket_a")).toBe(DEFAULT_EXPERIMENT_BUCKET);
    expect(normalizeExperimentBucket("")).toBe(DEFAULT_EXPERIMENT_BUCKET);
    expect(normalizeExperimentBucket(123)).toBe(DEFAULT_EXPERIMENT_BUCKET);

    expect(
      buildRecommendationTrace({ result: makeResult() }).experimentBucket,
    ).toBe(DEFAULT_EXPERIMENT_BUCKET);
    // Traces carry the zero experiment config version until an active
    // assignment is supplied additively (2C.2).
    expect(
      buildRecommendationTrace({ result: makeResult() }).experimentConfigVersion,
    ).toBe(DEFAULT_INPUT_REVISION_HASH);
    // Traces carry the zero assignment hash until an active assignment is
    // supplied additively (2C.2).
    expect(
      buildRecommendationTrace({ result: makeResult() })
        .experimentAssignmentHash,
    ).toBe(DEFAULT_INPUT_REVISION_HASH);
  });

  it("fails closed for API-key, user-id, UUID-like, and unknown experiment buckets", () => {
    const unsafe = [
      "sk_live_abcdef0123456789",
      "user_123",
      "550e8400-e29b-41d4-a716-446655440000",
      "eyJhbGciOiJIUzI1NiJ9.payload.signature",
      "some-unknown-bucket",
    ];
    for (const value of unsafe) {
      expect(normalizeExperimentBucket(value)).toBe(DEFAULT_EXPERIMENT_BUCKET);
    }

    const trace = buildRecommendationTrace({
      result: makeResult(),
      experimentBucket: "sk_live_abcdef0123456789",
    });
    expect(trace.experimentBucket).toBe(DEFAULT_EXPERIMENT_BUCKET);
    expect(JSON.stringify(trace)).not.toContain("sk_live_abcdef0123456789");
    expect(JSON.stringify(trace)).not.toContain(
      "550e8400-e29b-41d4-a716-446655440000",
    );

    expect(
      validateRecommendationTrace({
        ...trace,
        experimentBucket: "sk_live_abcdef0123456789",
      }),
    ).toBe(false);
  });

  it("hashes input revision material into a bounded deterministic revision", () => {
    expect(hashInputRevision(null)).toBe(DEFAULT_INPUT_REVISION_HASH);
    expect(hashInputRevision(undefined)).toBe(DEFAULT_INPUT_REVISION_HASH);

    const revision = hashInputRevision(revisionMaterial);
    expect(revision).toMatch(/^[0-9a-f]{16}$/);
    expect(revision).toBe(hashInputRevision(revisionMaterial));
    expect(revision).not.toBe(DEFAULT_INPUT_REVISION_HASH);

    const changed: RecommendationInputRevisionMaterial = {
      ...revisionMaterial,
      films: [{ uri: "letterboxd://film/b", tmdbId: 222 }],
      sources: {
        ...revisionSources,
        films: [{ uri: "letterboxd://film/b", tmdbId: 222 }],
      },
    };
    expect(hashInputRevision(changed)).not.toBe(revision);

    const trace = buildRecommendationTrace({
      result: makeResult(),
      inputRevisionMaterial: revisionMaterial,
    });
    expect(trace.inputRevision).toBe(revision);
    expect(
      buildRecommendationTrace({ result: makeResult() }).inputRevision,
    ).toBe(DEFAULT_INPUT_REVISION_HASH);
  });

  it("prefers an explicit bounded input revision over material hashing", () => {
    const trace = buildRecommendationTrace({
      result: makeResult(),
      inputRevision: "abcdef0123456789",
      inputRevisionMaterial: revisionMaterial,
    });
    expect(trace.inputRevision).toBe("abcdef0123456789");
  });

  it("emits the hashed request seed and never the raw request seed", () => {
    const trace = buildRecommendationTrace({ result: makeResult() });

    expect(trace.requestSeedHash).toBe(
      canonicalFixture.result.diagnostics.requestSeedHash,
    );
    expect(trace.requestSeedHash).toMatch(/^[0-9a-f]{16}$/);
    expect(Object.keys(trace)).not.toContain("requestSeed");
    expect(JSON.stringify(trace)).not.toContain(
      canonicalFixture.request.requestSeed,
    );
  });

  it("validates the exact allowlisted trace shape and rejects extra or unsafe fields", () => {
    const trace = buildRecommendationTrace({ result: makeResult() });
    expect(validateRecommendationTrace(trace)).toBe(true);

    expect(validateRecommendationTrace({ ...trace, candidateIds: [1] })).toBe(
      false,
    );
    expect(
      validateRecommendationTrace({ ...trace, films: [{ uri: "x" }] }),
    ).toBe(false);
    expect(
      validateRecommendationTrace({
        ...trace,
        experimentBucket: "eyJhbGciOiJIUzI1NiJ9.payload.signature",
      }),
    ).toBe(false);
    expect(
      validateRecommendationTrace({ ...trace, inputRevision: "not-a-hash" }),
    ).toBe(false);
    expect(
      validateRecommendationTrace({ ...trace, relaxation: "loose" }),
    ).toBe(false);

    const nineShares: Record<string, number> = {};
    for (let index = 0; index < MAX_TRACE_SOURCE_SHARE_KEYS + 1; index += 1) {
      nineShares[`fam${index}`] = 1;
    }
    expect(validateRecommendationTrace({ ...trace, sourceShares: nineShares })).toBe(
      false,
    );
  });

  it("serializes without raw film lists, feedback text, JWTs, provider keys, or unbounded arrays", () => {
    const results = [
      {
        ...makeCandidate(303, ["tmdb"]),
        reasons: ["SECRET_REASON_TEXT because you watched a private film"],
        explanation: "FEEDBACK_TEXT jwt eyJhbGciOiJIUzI1NiJ9.payload.signature",
      },
    ];
    const trace = buildRecommendationTrace({
      result: makeResult({ results }),
      inputRevisionMaterial: revisionMaterial,
    });
    const serialized = JSON.stringify(trace);

    expect(serialized).not.toMatch(/SECRET_REASON_TEXT/);
    expect(serialized).not.toMatch(/FEEDBACK_TEXT/);
    expect(serialized).not.toMatch(/eyJhbGciOiJIUzI1NiJ9/);
    expect(serialized).not.toMatch(/private|secret|api[_-]?key|password/i);
    expect(serialized).not.toMatch(/letterboxd:\/\/film/);
    // No unbounded candidate/result id arrays leak into the trace.
    expect(serialized).not.toContain("303");
    expect(Object.keys(trace)).not.toContain("results");
    expect(Object.keys(trace)).not.toContain("candidateIds");
    expect(Array.isArray(trace.sourceShares)).toBe(false);

    const diagnosticKeys = Object.keys(trace);
    expect(
      diagnosticKeys.some((key) =>
        /film|watch|rating|private|secret|token|api[_-]?key|raw/i.test(key),
      ),
    ).toBe(false);
    expect(validateRecommendationTrace(trace)).toBe(true);
  });
});

describe("recommendation telemetry parity and engine emission", () => {
  it("attaches a validated canonical trace to the engine result", async () => {
    const snapshot: RecommendationContextSourceSnapshot = {
      films: {
        data: [
          {
            uri: "letterboxd://film/a",
            title: "A",
            year: 2020,
            rating: 4,
            liked: true,
            rewatch: false,
            on_watchlist: false,
            last_date: "2026-01-01",
          },
        ],
      },
      mappings: { data: [{ uri: "letterboxd://film/a", tmdbId: 111 }] },
      metadata: { data: [] },
      dates: { data: [] },
      ratings: { data: [] },
      features: { data: [] },
      sources: {
        feedback: { data: [] },
        exploration: { data: [] },
        adjacent_genres: { data: [] },
        exposures: { data: [] },
        blocked: { data: [] },
      },
    };
    const repository: RecommendationContextRepository = {
      load: async () => snapshot,
    };
    const context = await loadRecommendationContext(repository, "trace-user");

    const result = await createRecommendationEngine({
      loadContext: async () => context,
      retrieveCandidates: async () => [{ tmdbId: 222 }],
      scoreCandidates: async ({ candidates }) =>
        candidates.map(({ tmdbId }) => makeCandidate(tmdbId, ["tmdb"])),
      rerankCandidates: async ({ candidates }) => candidates,
      rng: createDeterministicRng,
      telemetry: () => undefined,
    }).generate({
      userId: "trace-user",
      count: 3,
      seeds: [],
      excludeTmdbIds: [],
      genres: [],
      requestSeed: "trace-fixture-seed",
    });

    expect(validateRecommendationTrace(result.trace)).toBe(true);
    expect(result.trace.sourceShares).toEqual({ tmdb: 1 });
    expect(result.trace.experimentBucket).toBe(DEFAULT_EXPERIMENT_BUCKET);
    expect(result.trace.relaxation).toBe("none");
    expect(result.trace.inputRevision).toBe(
      hashInputRevision(context.revisionMaterial),
    );
    expect(result.trace).toEqual(
      buildRecommendationTrace({
        result: { results: result.results, diagnostics: result.diagnostics },
        inputRevisionMaterial: context.revisionMaterial,
      }),
    );
  });

  it("emits the identical canonical diagnostic structure through the v1 adapter and shared builder", () => {
    const result = makeResult();
    const details = new Map<number, V1RecommendationDetails>([
      [303, { title: "Three Oh Three", sources: ["tmdb"] }],
    ]);

    const adapted = adaptCanonicalResultToV1(result, details, {
      relaxation: "threshold",
      experimentBucket: "bucket_a",
      inputRevisionMaterial: revisionMaterial,
    });
    const expected = buildRecommendationTrace({
      result,
      relaxation: "threshold",
      experimentBucket: "bucket_a",
      inputRevisionMaterial: revisionMaterial,
    });

    expect(adapted.meta.trace).toEqual(expected);
    expect(validateRecommendationTrace(adapted.meta.trace)).toBe(true);

    // The web seam consumes the same builder, so the structure is identical.
    const webTrace = buildRecommendationTrace({
      result,
      relaxation: "threshold",
      experimentBucket: "bucket_a",
      inputRevisionMaterial: revisionMaterial,
    });
    expect(webTrace).toEqual(adapted.meta.trace);
  });

  it("emits the canonical trace through the real web adapter envelope", () => {
    const result = makeResult();
    const details = new Map<number, WebRecommendationDetails>([
      [303, { title: "Three Oh Three", sources: ["tmdb"] }],
    ]);

    const envelope = adaptCanonicalResultToWebEnvelope(result, details, {
      experimentBucket: "bucket_a",
      inputRevisionMaterial: revisionMaterial,
    });

    // The envelope wraps the real web adapter output unchanged.
    expect(envelope.items).toEqual(adaptCanonicalResultToWeb(result, details));
    expect(validateRecommendationTrace(envelope.trace)).toBe(true);
    expect(envelope.trace).toEqual(
      buildRecommendationTrace({
        result,
        experimentBucket: "bucket_a",
        inputRevisionMaterial: revisionMaterial,
      }),
    );

    // Same canonical structure as the v1 adapter for identical options.
    const v1 = adaptCanonicalResultToV1(result, new Map(), {
      experimentBucket: "bucket_a",
      inputRevisionMaterial: revisionMaterial,
    });
    expect(envelope.trace).toEqual(v1.meta.trace);
  });

  it("keeps v1 adapter diagnostics additive and backward compatible without options", () => {
    const result = makeResult();
    const adapted = adaptCanonicalResultToV1(result, new Map());

    expect(adapted.meta.mode).toBe("personalized");
    expect(adapted.meta.engine_version).toBe(RECOMMENDATION_ENGINE_VERSION);
    expect(adapted.meta.trace).toEqual(buildRecommendationTrace({ result }));
    expect(validateRecommendationTrace(adapted.meta.trace)).toBe(true);
  });
});
