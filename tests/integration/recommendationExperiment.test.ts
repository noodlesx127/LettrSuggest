import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabaseClient", () => ({ supabase: undefined }));

import {
  assignRecommendationExperiment,
  deriveRecommendationExperimentConfigVersion,
  EXPERIMENT_ASSIGNMENT_INTERVAL_HEX_DIGITS,
  EXPERIMENT_ASSIGNMENT_INTERVAL_SCALE,
  EXPERIMENT_MATERIAL_MAX_DEPTH,
  EXPERIMENT_MATERIAL_MAX_NODES,
  EXPERIMENT_MATERIAL_MAX_STRING_LENGTH,
  getABTestVariant,
  type ABTestAssignmentClient,
  type ABTestVariant,
  type RecommendationExperimentConfigInput,
} from "@/lib/abTesting";
import {
  hashCanonicalRevision,
  stableCanonicalSerialize,
} from "@/lib/recommendationRevision";
import {
  aggregateExperimentOutcomes,
  buildRecommendationExposureRecords,
  buildRecommendationTrace,
  EXPERIMENT_ATTRIBUTION_WINDOW_DAYS,
  joinExperimentExposureFeedback,
  MAX_EXPERIMENT_JOIN_ASSIGNMENTS,
  MAX_EXPERIMENT_JOIN_EXPOSURES,
  MAX_EXPERIMENT_JOIN_FEEDBACK,
  MAX_EXPERIMENT_JOIN_OUTCOMES,
  validateRecommendationExposureRecord,
  type ExperimentAssignmentEvidenceRow,
  type ExperimentBucketOutcomeAggregate,
  type ExperimentExposureRow,
  type ExperimentFeedbackRow,
  type ExperimentOutcome,
} from "@/lib/recommendationTelemetry";
import {
  DEFAULT_EXPERIMENT_ASSIGNMENT,
  DEFAULT_EXPERIMENT_ASSIGNMENT_HASH,
  DEFAULT_EXPERIMENT_BUCKET,
  DEFAULT_EXPERIMENT_CONFIG_VERSION,
  MAX_DIAGNOSTIC_COUNT,
  RECOMMENDATION_ENGINE_VERSION,
  RECOMMENDATION_EXPERIMENT_ASSIGNMENT_UNITS,
  RECOMMENDATION_EXPERIMENT_BUCKETS,
  validateRecommendationExperimentAssignment,
  validateRecommendationTrace,
  type RecommendationExperimentAssignment,
} from "@/lib/recommendationTypes";
import { canonicalFixture } from "../fixtures/recommendations/canonicalFixture";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CONTROL_CONFIG = "0123456789abcdef";
const TREATMENT_CONFIG = "fedcba9876543210";
const CONTROL_ASSIGNMENT_HASH = "abcdef0123456789";
const TREATMENT_ASSIGNMENT_HASH = "123456789abcdef0";
const BALANCED_SPLIT = { default: 0, control: 0.5, treatment: 0.5 };
const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_MS = Date.parse("2026-08-01T00:00:00Z");

const EXPERIMENT_KEY = "exp-1";
const OPERATIVE_MATERIAL = { params: { mmrLambda: 0.5 } };

const FINAL_ORDER = canonicalFixture.result.results.map(
  (candidate) => candidate.tmdbId,
);

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function makeConfig(
  overrides?: Partial<RecommendationExperimentConfigInput>,
): RecommendationExperimentConfigInput {
  return {
    active: true,
    material: OPERATIVE_MATERIAL,
    trafficSplit: BALANCED_SPLIT,
    ...overrides,
  };
}

/**
 * The exact internally derived config version for the canonical operative
 * config: experiment key, assignment unit, exact traffic split, and algorithm
 * material. Object key order must not matter (stable canonical serialize).
 */
function expectedConfigVersion(input?: {
  unit?: string;
  experimentKey?: string;
  trafficSplit?: unknown;
  material?: unknown;
}): string {
  return hashCanonicalRevision(
    stableCanonicalSerialize({
      experimentKey: input?.experimentKey ?? EXPERIMENT_KEY,
      material: input && "material" in input ? input.material : OPERATIVE_MATERIAL,
      trafficSplit: input?.trafficSplit ?? BALANCED_SPLIT,
      unit: input?.unit ?? "user",
    }),
  );
}

function makeAssignment(
  overrides?: Partial<RecommendationExperimentAssignment>,
): RecommendationExperimentAssignment {
  return {
    bucket: "control",
    configVersion: CONTROL_CONFIG,
    assignmentHash: CONTROL_ASSIGNMENT_HASH,
    ...overrides,
  };
}

function makeExposure(
  overrides?: Partial<ExperimentExposureRow>,
): ExperimentExposureRow {
  return {
    userId: "user-1",
    tmdbId: 303,
    exposedAt: iso(BASE_MS),
    engineVersion: RECOMMENDATION_ENGINE_VERSION,
    experimentBucket: "control",
    experimentConfigVersion: CONTROL_CONFIG,
    assignmentHash: CONTROL_ASSIGNMENT_HASH,
    ...overrides,
  };
}

function makeAssignmentEvidence(
  overrides?: Partial<ExperimentAssignmentEvidenceRow>,
): ExperimentAssignmentEvidenceRow {
  return {
    userId: "user-1",
    assignmentHash: CONTROL_ASSIGNMENT_HASH,
    engineVersion: RECOMMENDATION_ENGINE_VERSION,
    configVersion: CONTROL_CONFIG,
    bucket: "control",
    ...overrides,
  };
}

function makeFeedback(
  overrides?: Partial<ExperimentFeedbackRow>,
): ExperimentFeedbackRow {
  return {
    userId: "user-1",
    tmdbId: 303,
    feedbackAt: iso(BASE_MS + DAY_MS),
    positive: true,
    ...overrides,
  };
}

describe("controlled experiment constants", () => {
  it("fixes the controlled buckets, assignment units, and zero config version", () => {
    expect(RECOMMENDATION_EXPERIMENT_BUCKETS).toEqual([
      "default",
      "control",
      "treatment",
    ]);
    expect(RECOMMENDATION_EXPERIMENT_ASSIGNMENT_UNITS).toEqual([
      "user",
      "request",
    ]);
    expect(DEFAULT_EXPERIMENT_CONFIG_VERSION).toBe("0000000000000000");
    expect(DEFAULT_EXPERIMENT_ASSIGNMENT_HASH).toBe("0000000000000000");
    expect(DEFAULT_EXPERIMENT_BUCKET).toBe("default");
    expect(DEFAULT_EXPERIMENT_ASSIGNMENT).toEqual({
      bucket: "default",
      configVersion: "0000000000000000",
      assignmentHash: "0000000000000000",
    });
  });

  it("derives the assignment unit interval from the first 13 hex digits over 2^52", () => {
    expect(EXPERIMENT_ASSIGNMENT_INTERVAL_HEX_DIGITS).toBe(13);
    expect(EXPERIMENT_ASSIGNMENT_INTERVAL_SCALE).toBe(2 ** 52);
  });
});

describe("deterministic experiment assignment", () => {
  it("assigns stable buckets and hashes for user and request units", () => {
    const first = assignRecommendationExperiment({
      unit: "user",
      assignmentKey: "user-1",
      experimentKey: EXPERIMENT_KEY,
      config: makeConfig(),
    });
    const again = assignRecommendationExperiment({
      unit: "user",
      assignmentKey: "user-1",
      experimentKey: EXPERIMENT_KEY,
      config: makeConfig(),
    });

    expect(again).toEqual(first);
    expect(validateRecommendationExperimentAssignment(first)).toBe(true);
    expect(["control", "treatment"]).toContain(first.bucket);
    expect(first.configVersion).toBe(expectedConfigVersion());
    expect(first.assignmentHash).toMatch(/^[0-9a-f]{16}$/);
    expect(first.assignmentHash).not.toBe(DEFAULT_EXPERIMENT_ASSIGNMENT_HASH);

    const request = assignRecommendationExperiment({
      unit: "request",
      assignmentKey: "request-1",
      experimentKey: EXPERIMENT_KEY,
      config: makeConfig(),
    });
    const requestAgain = assignRecommendationExperiment({
      unit: "request",
      assignmentKey: "request-1",
      experimentKey: EXPERIMENT_KEY,
      config: makeConfig(),
    });
    expect(requestAgain).toEqual(request);
    expect(validateRecommendationExperimentAssignment(request)).toBe(true);
  });

  it("returns only bucket, configVersion, and assignment hash, never raw keys", () => {
    const assignment = assignRecommendationExperiment({
      unit: "user",
      assignmentKey: "user-1",
      experimentKey: EXPERIMENT_KEY,
      config: makeConfig(),
    });

    expect(Object.keys(assignment).sort()).toEqual([
      "assignmentHash",
      "bucket",
      "configVersion",
    ]);
    const serialized = JSON.stringify(assignment);
    expect(serialized).not.toContain("user-1");
    expect(serialized).not.toContain(EXPERIMENT_KEY);
  });

  it("always derives the config version internally from the canonical operative config", () => {
    const assignment = assignRecommendationExperiment({
      unit: "user",
      assignmentKey: "user-1",
      experimentKey: EXPERIMENT_KEY,
      config: makeConfig(),
    });

    expect(assignment.configVersion).toBe(expectedConfigVersion());
    expect(assignment.configVersion).toMatch(/^[0-9a-f]{16}$/);
    expect(assignment.configVersion).not.toBe(
      DEFAULT_EXPERIMENT_CONFIG_VERSION,
    );
  });

  it("ignores any explicit config-version override in the config input", () => {
    const overridden = assignRecommendationExperiment({
      unit: "user",
      assignmentKey: "user-1",
      experimentKey: EXPERIMENT_KEY,
      config: {
        ...makeConfig(),
        configVersion: "ffffffffffffffff",
      } as unknown as RecommendationExperimentConfigInput,
    });

    expect(overridden.configVersion).toBe(expectedConfigVersion());
    expect(overridden.configVersion).not.toBe("ffffffffffffffff");
  });

  it("changes the config version when any operative field changes", () => {
    const base = expectedConfigVersion();

    const changed = [
      // Assignment unit is operative.
      assignRecommendationExperiment({
        unit: "request",
        assignmentKey: "user-1",
        experimentKey: EXPERIMENT_KEY,
        config: makeConfig(),
      }),
      // Experiment key is operative.
      assignRecommendationExperiment({
        unit: "user",
        assignmentKey: "user-1",
        experimentKey: "exp-2",
        config: makeConfig(),
      }),
      // The exact traffic split is operative.
      assignRecommendationExperiment({
        unit: "user",
        assignmentKey: "user-1",
        experimentKey: EXPERIMENT_KEY,
        config: makeConfig({
          trafficSplit: { default: 0, control: 0.9, treatment: 0.1 },
        }),
      }),
      // The algorithm/config material is operative.
      assignRecommendationExperiment({
        unit: "user",
        assignmentKey: "user-1",
        experimentKey: EXPERIMENT_KEY,
        config: makeConfig({ material: { params: { mmrLambda: 0.7 } } }),
      }),
    ];

    for (const assignment of changed) {
      expect(assignment.configVersion).not.toBe(base);
      expect(assignment.configVersion).not.toBe(
        DEFAULT_EXPERIMENT_CONFIG_VERSION,
      );
    }
    // Every operative change produces a distinct version.
    expect(new Set(changed.map((assignment) => assignment.configVersion)).size).toBe(
      changed.length,
    );
  });

  it("splits traffic deterministically across the controlled buckets", () => {
    const counts: Record<string, number> = {};
    for (let index = 0; index < 200; index += 1) {
      const assignment = assignRecommendationExperiment({
        unit: "user",
        assignmentKey: `user-${index}`,
        experimentKey: EXPERIMENT_KEY,
        config: makeConfig(),
      });
      counts[assignment.bucket] = (counts[assignment.bucket] ?? 0) + 1;

      // Deterministic repeat for every key.
      expect(
        assignRecommendationExperiment({
          unit: "user",
          assignmentKey: `user-${index}`,
          experimentKey: EXPERIMENT_KEY,
          config: makeConfig(),
        }),
      ).toEqual(assignment);
    }

    expect(counts.control ?? 0).toBeGreaterThan(0);
    expect(counts.treatment ?? 0).toBeGreaterThan(0);
    // A zero-weight default arm never assigns the default bucket.
    expect(counts.default ?? 0).toBe(0);
  });

  it("keeps holdout traffic on the default assignment when the default arm wins", () => {
    const assignment = assignRecommendationExperiment({
      unit: "user",
      assignmentKey: "user-1",
      experimentKey: EXPERIMENT_KEY,
      config: makeConfig({
        trafficSplit: { default: 1, control: 0, treatment: 0 },
      }),
    });

    expect(assignment).toEqual(DEFAULT_EXPERIMENT_ASSIGNMENT);
  });

  it("hashes canonical experiment material into the config version", () => {
    const material = { experimentKey: EXPERIMENT_KEY, params: { mmrLambda: 0.5 } };
    const assignment = assignRecommendationExperiment({
      unit: "user",
      assignmentKey: "user-1",
      experimentKey: EXPERIMENT_KEY,
      config: { active: true, material, trafficSplit: BALANCED_SPLIT },
    });

    expect(assignment.configVersion).toBe(
      hashCanonicalRevision(
        stableCanonicalSerialize({
          experimentKey: EXPERIMENT_KEY,
          material,
          trafficSplit: BALANCED_SPLIT,
          unit: "user",
        }),
      ),
    );
    expect(assignment.configVersion).toMatch(/^[0-9a-f]{16}$/);
    expect(assignment.configVersion).not.toBe(
      DEFAULT_EXPERIMENT_CONFIG_VERSION,
    );
  });

  it("is independent of traffic split and material object key order", () => {
    const first = assignRecommendationExperiment({
      unit: "user",
      assignmentKey: "user-9",
      experimentKey: EXPERIMENT_KEY,
      config: {
        active: true,
        material: { split: { default: 0, control: 0.5, treatment: 0.5 } },
        trafficSplit: { default: 0, control: 0.5, treatment: 0.5 },
      },
    });
    const reordered = assignRecommendationExperiment({
      unit: "user",
      assignmentKey: "user-9",
      experimentKey: EXPERIMENT_KEY,
      config: {
        active: true,
        material: { split: { treatment: 0.5, control: 0.5, default: 0 } },
        trafficSplit: { treatment: 0.5, default: 0, control: 0.5 },
      },
    });

    expect(reordered).toEqual(first);
  });

  it("fails closed to the default assignment for malformed traffic splits", () => {
    const badSplits: unknown[] = [
      { default: 0, control: 0.5, treatment: 0.4 },
      { default: 0, control: 0.5, treatment: 0.6 },
      { default: 0, control: -0.5, treatment: 1.5 },
      { default: 0, control: Number.NaN, treatment: 1 },
      { default: 0, control: Number.POSITIVE_INFINITY, treatment: 0 },
      { default: 0, control: 0.5 },
      { default: 0, control: 0.5, treatment: 0.5, bogus: 0 },
      {},
      null,
      [["default", 1]],
      "split",
    ];

    for (const trafficSplit of badSplits) {
      expect(
        assignRecommendationExperiment({
          unit: "user",
          assignmentKey: "user-1",
          experimentKey: EXPERIMENT_KEY,
          config: makeConfig({ trafficSplit }),
        }),
        `split ${JSON.stringify(trafficSplit)} must fail closed`,
      ).toEqual(DEFAULT_EXPERIMENT_ASSIGNMENT);
    }
  });

  it("fails closed for malformed assignment keys, experiment keys, and units", () => {
    const badKeys: unknown[] = [
      "",
      "   ",
      "a".repeat(129),
      " leading-space",
      "eyJhbGciOiJIUzI1NiJ9.payload.signature",
      null,
      123,
    ];
    for (const assignmentKey of badKeys) {
      expect(
        assignRecommendationExperiment({
          unit: "user",
          assignmentKey,
          experimentKey: EXPERIMENT_KEY,
          config: makeConfig(),
        }),
        `assignment key ${JSON.stringify(assignmentKey)} must fail closed`,
      ).toEqual(DEFAULT_EXPERIMENT_ASSIGNMENT);
    }

    for (const experimentKey of badKeys) {
      expect(
        assignRecommendationExperiment({
          unit: "user",
          assignmentKey: "user-1",
          experimentKey,
          config: makeConfig(),
        }),
        `experiment key ${JSON.stringify(experimentKey)} must fail closed`,
      ).toEqual(DEFAULT_EXPERIMENT_ASSIGNMENT);
    }

    for (const unit of ["session", "", null, 123]) {
      expect(
        assignRecommendationExperiment({
          unit,
          assignmentKey: "user-1",
          experimentKey: EXPERIMENT_KEY,
          config: makeConfig(),
        }),
        `unit ${JSON.stringify(unit)} must fail closed`,
      ).toEqual(DEFAULT_EXPERIMENT_ASSIGNMENT);
    }
  });

  it("fails closed for inactive, missing, or split-less experiment configs", () => {
    const cases: Array<RecommendationExperimentConfigInput | null | undefined> =
      [
        null,
        undefined,
        makeConfig({ active: false }),
        // No traffic split at all.
        { active: true, material: OPERATIVE_MATERIAL, trafficSplit: undefined },
      ];

    for (const config of cases) {
      expect(
        assignRecommendationExperiment({
          unit: "user",
          assignmentKey: "user-1",
          experimentKey: EXPERIMENT_KEY,
          config,
        }),
        `config ${JSON.stringify(config)} must fail closed`,
      ).toEqual(DEFAULT_EXPERIMENT_ASSIGNMENT);
    }
  });

  it("fails closed when config or split accessors throw or mutate between reads", () => {
    const throwingConfig = Object.defineProperty({}, "trafficSplit", {
      enumerable: true,
      get(): never {
        throw new Error("private config value");
      },
    });
    let splitReads = 0;
    const mutableSplit = Object.defineProperties({}, {
      default: { enumerable: true, value: 0 },
      control: {
        enumerable: true,
        get(): number {
          splitReads += 1;
          return splitReads === 1 ? 0.5 : 0.9;
        },
      },
      treatment: { enumerable: true, value: 0.5 },
    });

    for (const config of [
      throwingConfig,
      { active: true, material: OPERATIVE_MATERIAL, trafficSplit: mutableSplit },
    ]) {
      expect(() =>
        assignRecommendationExperiment({
          unit: "user",
          assignmentKey: "user-1",
          experimentKey: EXPERIMENT_KEY,
          config: config as RecommendationExperimentConfigInput,
        }),
      ).not.toThrow();
      expect(
        assignRecommendationExperiment({
          unit: "user",
          assignmentKey: "user-1",
          experimentKey: EXPERIMENT_KEY,
          config: config as RecommendationExperimentConfigInput,
        }),
      ).toEqual(DEFAULT_EXPERIMENT_ASSIGNMENT);
    }
  });

  it("uses one immutable traffic-split snapshot for versioning and bucket selection", () => {
    let reads = 0;
    const target = { default: 0, control: 0.5, treatment: 0.5 };
    const split = new Proxy(target, {
      get(object, property, receiver) {
        if (property === "control") {
          reads += 1;
          return reads === 1 ? 0.5 : 0.9;
        }
        return Reflect.get(object, property, receiver);
      },
    });

    const assignment = assignRecommendationExperiment({
      unit: "user",
      assignmentKey: "user-1",
      experimentKey: EXPERIMENT_KEY,
      config: makeConfig({ trafficSplit: split }),
    });
    expect(validateRecommendationExperimentAssignment(assignment)).toBe(true);
    expect(assignment.configVersion).not.toBe(DEFAULT_EXPERIMENT_CONFIG_VERSION);
    expect(reads).toBeLessThanOrEqual(1);
  });

  it("validates assignment hash pairing with bucket and config version", () => {
    expect(validateRecommendationExperimentAssignment(makeAssignment())).toBe(
      true,
    );
    expect(
      validateRecommendationExperimentAssignment(DEFAULT_EXPERIMENT_ASSIGNMENT),
    ).toBe(true);
    // Active bucket with the zero assignment hash fails closed.
    expect(
      validateRecommendationExperimentAssignment(
        makeAssignment({ assignmentHash: DEFAULT_EXPERIMENT_ASSIGNMENT_HASH }),
      ),
    ).toBe(false);
    // Default bucket with a nonzero assignment hash fails closed.
    expect(
      validateRecommendationExperimentAssignment({
        bucket: "default",
        configVersion: DEFAULT_EXPERIMENT_CONFIG_VERSION,
        assignmentHash: CONTROL_ASSIGNMENT_HASH,
      }),
    ).toBe(false);
  });
});

describe("malformed experiment material fails closed", () => {
  function makeCyclicMaterial(): Record<string, unknown> {
    const material: Record<string, unknown> = { params: { mmrLambda: 0.5 } };
    material.self = material;
    return material;
  }

  function makeThrowingGetterMaterial(): Record<string, unknown> {
    const material: Record<string, unknown> = {};
    Object.defineProperty(material, "params", {
      enumerable: true,
      configurable: true,
      get(): unknown {
        throw new Error("material getter failure");
      },
    });
    return material;
  }

  function makeIncrementingGetterMaterial(): {
    material: Record<string, unknown>;
    getterCalls: () => number;
  } {
    let calls = 0;
    const material: Record<string, unknown> = { params: { mmrLambda: 0.5 } };
    Object.defineProperty(material, "tick", {
      enumerable: true,
      configurable: true,
      get(): unknown {
        calls += 1;
        return calls;
      },
    });
    return { material, getterCalls: () => calls };
  }

  function makeUnstableProxyMaterial(): {
    material: Record<string, unknown>;
    reads: () => number;
  } {
    let reads = 0;
    // The proxy's own descriptor reports the target's plain value, but live
    // reads diverge from it, so any second observation cannot agree with the
    // first.
    const material = new Proxy<Record<string, unknown>>(
      { params: { mmrLambda: 0.5 } },
      {
        get(target, property, receiver) {
          if (property === "params") {
            reads += 1;
            return { mmrLambda: 0.5 + reads };
          }
          return Reflect.get(target, property, receiver);
        },
      },
    );
    return { material, reads: () => reads };
  }

  function makeDeepMaterial(depth: number): Record<string, unknown> {
    let material: Record<string, unknown> = { value: 1 };
    for (let level = 0; level < depth; level += 1) {
      material = { next: material };
    }
    return material;
  }

  it("fixes the bounded material limits", () => {
    expect(EXPERIMENT_MATERIAL_MAX_DEPTH).toBe(8);
    expect(EXPERIMENT_MATERIAL_MAX_NODES).toBe(1024);
    expect(EXPERIMENT_MATERIAL_MAX_STRING_LENGTH).toBe(512);
  });

  it("fails closed for cyclic material without throwing or leaking raw values", () => {
    const secret = "raw-material-secret-value";
    const material = makeCyclicMaterial();
    material.secret = secret;

    expect(() =>
      assignRecommendationExperiment({
        unit: "user",
        assignmentKey: "user-1",
        experimentKey: EXPERIMENT_KEY,
        config: makeConfig({ material }),
      }),
    ).not.toThrow();

    const assignment = assignRecommendationExperiment({
      unit: "user",
      assignmentKey: "user-1",
      experimentKey: EXPERIMENT_KEY,
      config: makeConfig({ material }),
    });
    expect(assignment).toEqual(DEFAULT_EXPERIMENT_ASSIGNMENT);
    expect(JSON.stringify(assignment)).not.toContain(secret);
  });

  it("fails closed when a material getter throws", () => {
    expect(() =>
      assignRecommendationExperiment({
        unit: "user",
        assignmentKey: "user-1",
        experimentKey: EXPERIMENT_KEY,
        config: makeConfig({ material: makeThrowingGetterMaterial() }),
      }),
    ).not.toThrow();
    expect(
      assignRecommendationExperiment({
        unit: "user",
        assignmentKey: "user-1",
        experimentKey: EXPERIMENT_KEY,
        config: makeConfig({ material: makeThrowingGetterMaterial() }),
      }),
    ).toEqual(DEFAULT_EXPERIMENT_ASSIGNMENT);
  });

  it("fails closed for non-throwing incrementing getter material and never evaluates the getter twice", () => {
    const { material, getterCalls } = makeIncrementingGetterMaterial();

    expect(() =>
      assignRecommendationExperiment({
        unit: "user",
        assignmentKey: "user-1",
        experimentKey: EXPERIMENT_KEY,
        config: makeConfig({ material }),
      }),
    ).not.toThrow();

    const first = assignRecommendationExperiment({
      unit: "user",
      assignmentKey: "user-1",
      experimentKey: EXPERIMENT_KEY,
      config: makeConfig({ material }),
    });
    const second = assignRecommendationExperiment({
      unit: "user",
      assignmentKey: "user-1",
      experimentKey: EXPERIMENT_KEY,
      config: makeConfig({ material }),
    });
    expect(first).toEqual(DEFAULT_EXPERIMENT_ASSIGNMENT);
    expect(second).toEqual(DEFAULT_EXPERIMENT_ASSIGNMENT);
    expect(getterCalls()).toBeLessThan(2);

    expect(
      deriveRecommendationExperimentConfigVersion({
        unit: "user",
        experimentKey: EXPERIMENT_KEY,
        trafficSplit: BALANCED_SPLIT,
        material,
      }),
    ).toBe(DEFAULT_EXPERIMENT_CONFIG_VERSION);
    expect(getterCalls()).toBeLessThan(2);
  });

  it("fails closed for accessor elements hidden in array material without evaluating the getter twice", () => {
    let calls = 0;
    const material: unknown[] = [{ params: { mmrLambda: 0.5 } }];
    Object.defineProperty(material, "1", {
      enumerable: true,
      configurable: true,
      get(): unknown {
        calls += 1;
        return calls;
      },
    });

    expect(
      assignRecommendationExperiment({
        unit: "user",
        assignmentKey: "user-1",
        experimentKey: EXPERIMENT_KEY,
        config: makeConfig({ material }),
      }),
    ).toEqual(DEFAULT_EXPERIMENT_ASSIGNMENT);
    expect(
      deriveRecommendationExperimentConfigVersion({
        unit: "user",
        experimentKey: EXPERIMENT_KEY,
        trafficSplit: BALANCED_SPLIT,
        material,
      }),
    ).toBe(DEFAULT_EXPERIMENT_CONFIG_VERSION);
    expect(calls).toBeLessThan(2);
  });

  it("fails closed when proxy material reads diverge from their own descriptors", () => {
    const { material, reads } = makeUnstableProxyMaterial();

    expect(() =>
      assignRecommendationExperiment({
        unit: "user",
        assignmentKey: "user-1",
        experimentKey: EXPERIMENT_KEY,
        config: makeConfig({ material }),
      }),
    ).not.toThrow();

    const first = assignRecommendationExperiment({
      unit: "user",
      assignmentKey: "user-1",
      experimentKey: EXPERIMENT_KEY,
      config: makeConfig({ material }),
    });
    const second = assignRecommendationExperiment({
      unit: "user",
      assignmentKey: "user-1",
      experimentKey: EXPERIMENT_KEY,
      config: makeConfig({ material }),
    });
    expect(first).toEqual(DEFAULT_EXPERIMENT_ASSIGNMENT);
    expect(second).toEqual(DEFAULT_EXPERIMENT_ASSIGNMENT);
    expect(
      deriveRecommendationExperimentConfigVersion({
        unit: "user",
        experimentKey: EXPERIMENT_KEY,
        trafficSplit: BALANCED_SPLIT,
        material,
      }),
    ).toBe(DEFAULT_EXPERIMENT_CONFIG_VERSION);
    // The unstable property is observed at most once per derivation: the
    // four derivations above (one throw probe, two assignments, one config
    // version) never re-read it.
    expect(reads()).toBeLessThanOrEqual(4);
  });

  it("fails closed beyond the bounded nesting depth and accepts the limit", () => {
    expect(
      assignRecommendationExperiment({
        unit: "user",
        assignmentKey: "user-1",
        experimentKey: EXPERIMENT_KEY,
        config: makeConfig({
          material: makeDeepMaterial(EXPERIMENT_MATERIAL_MAX_DEPTH),
        }),
      }),
    ).toEqual(DEFAULT_EXPERIMENT_ASSIGNMENT);

    const atLimit = assignRecommendationExperiment({
      unit: "user",
      assignmentKey: "user-1",
      experimentKey: EXPERIMENT_KEY,
      config: makeConfig({
        material: makeDeepMaterial(EXPERIMENT_MATERIAL_MAX_DEPTH - 1),
      }),
    });
    expect(atLimit.configVersion).not.toBe(DEFAULT_EXPERIMENT_CONFIG_VERSION);
    expect(validateRecommendationExperimentAssignment(atLimit)).toBe(true);
  });

  it("fails closed beyond the bounded node count for objects and arrays", () => {
    const wide: Record<string, number> = {};
    for (let index = 0; index < EXPERIMENT_MATERIAL_MAX_NODES; index += 1) {
      wide[`key-${index}`] = index;
    }
    // Root plus 1024 leaves exceeds the bounded node count.
    expect(
      assignRecommendationExperiment({
        unit: "user",
        assignmentKey: "user-1",
        experimentKey: EXPERIMENT_KEY,
        config: makeConfig({ material: wide }),
      }),
    ).toEqual(DEFAULT_EXPERIMENT_ASSIGNMENT);

    const longArray = Array.from(
      { length: EXPERIMENT_MATERIAL_MAX_NODES },
      (_, index) => index,
    );
    expect(
      assignRecommendationExperiment({
        unit: "user",
        assignmentKey: "user-1",
        experimentKey: EXPERIMENT_KEY,
        config: makeConfig({ material: longArray }),
      }),
    ).toEqual(DEFAULT_EXPERIMENT_ASSIGNMENT);
  });

  it("fails closed for non-JSON-like material values", () => {
    const malformed: unknown[] = [
      { fn: () => 1 },
      [() => 1],
      { symbol: Symbol("material") },
      { big: BigInt(1) },
      { nan: Number.NaN },
      { infinity: Number.POSITIVE_INFINITY },
      { negativeInfinity: Number.NEGATIVE_INFINITY },
      { date: new Date(0) },
      { long: "x".repeat(EXPERIMENT_MATERIAL_MAX_STRING_LENGTH + 1) },
    ];

    for (const material of malformed) {
      expect(
        assignRecommendationExperiment({
          unit: "user",
          assignmentKey: "user-1",
          experimentKey: EXPERIMENT_KEY,
          config: makeConfig({ material }),
        }),
        `material must fail closed`,
      ).toEqual(DEFAULT_EXPERIMENT_ASSIGNMENT);
    }
  });

  it("derives the zero config version for malformed material and the canonical version for bounded material", () => {
    const malformed: unknown[] = [
      makeCyclicMaterial(),
      makeThrowingGetterMaterial(),
      makeDeepMaterial(EXPERIMENT_MATERIAL_MAX_DEPTH),
    ];

    for (const material of malformed) {
      expect(
        deriveRecommendationExperimentConfigVersion({
          unit: "user",
          experimentKey: EXPERIMENT_KEY,
          trafficSplit: BALANCED_SPLIT,
          material,
        }),
      ).toBe(DEFAULT_EXPERIMENT_CONFIG_VERSION);
    }

    expect(
      deriveRecommendationExperimentConfigVersion({
        unit: "user",
        experimentKey: EXPERIMENT_KEY,
        trafficSplit: BALANCED_SPLIT,
        material: OPERATIVE_MATERIAL,
      }),
    ).toBe(expectedConfigVersion());
  });

  it("preserves an own __proto__ material key in the canonical config version", () => {
    const withProto = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(withProto, "__proto__", {
      enumerable: true,
      configurable: true,
      writable: true,
      value: { enabled: true },
    });
    withProto.params = { mmrLambda: 0.5 };

    const withoutProto = Object.create(null) as Record<string, unknown>;
    withoutProto.params = { mmrLambda: 0.5 };

    const withVersion = deriveRecommendationExperimentConfigVersion({
      unit: "user",
      experimentKey: EXPERIMENT_KEY,
      trafficSplit: BALANCED_SPLIT,
      material: withProto,
    });
    const withoutVersion = deriveRecommendationExperimentConfigVersion({
      unit: "user",
      experimentKey: EXPERIMENT_KEY,
      trafficSplit: BALANCED_SPLIT,
      material: withoutProto,
    });

    expect(withVersion).not.toBe(DEFAULT_EXPERIMENT_CONFIG_VERSION);
    expect(withVersion).not.toBe(withoutVersion);
  });

  it("accepts acyclic shared material references as repeated canonical subtrees", () => {
    const shared = { weight: 0.5 };
    const material = { control: shared, treatment: shared };

    const version = deriveRecommendationExperimentConfigVersion({
      unit: "user",
      experimentKey: EXPERIMENT_KEY,
      trafficSplit: BALANCED_SPLIT,
      material,
    });

    expect(version).not.toBe(DEFAULT_EXPERIMENT_CONFIG_VERSION);
    expect(
      assignRecommendationExperiment({
        unit: "user",
        assignmentKey: "user-1",
        experimentKey: EXPERIMENT_KEY,
        config: makeConfig({ material }),
      }),
    ).not.toEqual(DEFAULT_EXPERIMENT_ASSIGNMENT);
  });
});

describe("trace and exposure capture of experiment assignment", () => {
  it("captures the assigned bucket, config version, and assignment hash with the current engine version", () => {
    const assignment = makeAssignment();
    const trace = buildRecommendationTrace({
      result: canonicalFixture.result,
      experimentAssignment: assignment,
    });

    expect(trace.engineVersion).toBe(RECOMMENDATION_ENGINE_VERSION);
    expect(trace.experimentBucket).toBe("control");
    expect(trace.experimentConfigVersion).toBe(CONTROL_CONFIG);
    expect(trace.experimentAssignmentHash).toBe(CONTROL_ASSIGNMENT_HASH);
    expect(validateRecommendationTrace(trace)).toBe(true);
  });

  it("defaults to the default bucket, zero config version, and zero assignment hash without an assignment", () => {
    const trace = buildRecommendationTrace({ result: canonicalFixture.result });

    expect(trace.experimentBucket).toBe(DEFAULT_EXPERIMENT_BUCKET);
    expect(trace.experimentConfigVersion).toBe(
      DEFAULT_EXPERIMENT_CONFIG_VERSION,
    );
    expect(trace.experimentAssignmentHash).toBe(
      DEFAULT_EXPERIMENT_ASSIGNMENT_HASH,
    );
    expect(validateRecommendationTrace(trace)).toBe(true);
  });

  it("ignores malformed assignments and keeps the default pairing", () => {
    const malformed: unknown[] = [
      { bucket: "control", configVersion: DEFAULT_EXPERIMENT_CONFIG_VERSION },
      {
        bucket: "control",
        configVersion: DEFAULT_EXPERIMENT_CONFIG_VERSION,
        assignmentHash: CONTROL_ASSIGNMENT_HASH,
      },
      {
        bucket: "variant_a",
        configVersion: CONTROL_CONFIG,
        assignmentHash: CONTROL_ASSIGNMENT_HASH,
      },
      { bucket: "control", configVersion: "NOT-HEX", assignmentHash: "x" },
      // Active bucket with the zero assignment hash.
      {
        bucket: "control",
        configVersion: CONTROL_CONFIG,
        assignmentHash: DEFAULT_EXPERIMENT_ASSIGNMENT_HASH,
      },
      // Default bucket with a nonzero assignment hash.
      {
        bucket: "default",
        configVersion: DEFAULT_EXPERIMENT_CONFIG_VERSION,
        assignmentHash: CONTROL_ASSIGNMENT_HASH,
      },
      "control",
      null,
    ];

    for (const experimentAssignment of malformed) {
      const trace = buildRecommendationTrace({
        result: canonicalFixture.result,
        experimentAssignment,
      });
      expect(trace.experimentBucket).toBe(DEFAULT_EXPERIMENT_BUCKET);
      expect(trace.experimentConfigVersion).toBe(
        DEFAULT_EXPERIMENT_CONFIG_VERSION,
      );
      expect(trace.experimentAssignmentHash).toBe(
        DEFAULT_EXPERIMENT_ASSIGNMENT_HASH,
      );
    }
  });

  it("fails closed for an active bucket without a matching config version", () => {
    expect(() =>
      buildRecommendationTrace({
        result: canonicalFixture.result,
        experimentBucket: "control",
      }),
    ).toThrow();

    expect(() =>
      buildRecommendationTrace({
        result: canonicalFixture.result,
        experimentAssignment: {
          ...makeAssignment(),
          configVersion: DEFAULT_EXPERIMENT_CONFIG_VERSION,
        },
      }),
    ).not.toThrow();
  });

  it("rejects traces with a broken assignment hash pairing at the validator", () => {
    const trace = buildRecommendationTrace({
      result: canonicalFixture.result,
      experimentAssignment: makeAssignment(),
    });

    expect(
      validateRecommendationTrace({
        ...trace,
        experimentAssignmentHash: DEFAULT_EXPERIMENT_ASSIGNMENT_HASH,
      }),
    ).toBe(false);
    expect(
      validateRecommendationTrace({
        ...trace,
        experimentAssignmentHash: "NOT-HEX",
      }),
    ).toBe(false);
    expect(
      validateRecommendationTrace({
        ...trace,
        experimentBucket: DEFAULT_EXPERIMENT_BUCKET,
        experimentConfigVersion: DEFAULT_EXPERIMENT_CONFIG_VERSION,
        experimentAssignmentHash: CONTROL_ASSIGNMENT_HASH,
      }),
    ).toBe(false);
  });

  it("persists the experiment config version and assignment hash on every bounded exposure row", () => {
    const trace = buildRecommendationTrace({
      result: canonicalFixture.result,
      experimentAssignment: makeAssignment({
        bucket: "treatment",
        configVersion: TREATMENT_CONFIG,
        assignmentHash: TREATMENT_ASSIGNMENT_HASH,
      }),
    });

    const records = buildRecommendationExposureRecords({
      userId: USER_ID,
      trace,
      orderedTmdbIds: FINAL_ORDER,
    });

    expect(records).toHaveLength(FINAL_ORDER.length);
    for (const record of records) {
      expect(record.engine_version).toBe(RECOMMENDATION_ENGINE_VERSION);
      expect(record.experiment_bucket).toBe("treatment");
      expect(record.experiment_config_version).toBe(TREATMENT_CONFIG);
      expect(record.assignment_hash).toBe(TREATMENT_ASSIGNMENT_HASH);
      expect(validateRecommendationExposureRecord(record)).toBe(true);
    }
    // Raw assignment keys never reach persisted rows.
    expect(JSON.stringify(records)).not.toContain("user-1");
  });

  it("defaults exposure rows to the zero config version and zero assignment hash without an assignment", () => {
    const records = buildRecommendationExposureRecords({
      userId: USER_ID,
      trace: buildRecommendationTrace({ result: canonicalFixture.result }),
      orderedTmdbIds: FINAL_ORDER,
    });

    for (const record of records) {
      expect(record.experiment_bucket).toBe(DEFAULT_EXPERIMENT_BUCKET);
      expect(record.experiment_config_version).toBe(
        DEFAULT_EXPERIMENT_CONFIG_VERSION,
      );
      expect(record.assignment_hash).toBe(DEFAULT_EXPERIMENT_ASSIGNMENT_HASH);
    }
  });

  it("rejects exposure records with a broken assignment hash pairing", () => {
    const trace = buildRecommendationTrace({
      result: canonicalFixture.result,
      experimentAssignment: makeAssignment(),
    });
    const [record] = buildRecommendationExposureRecords({
      userId: USER_ID,
      trace,
      orderedTmdbIds: FINAL_ORDER,
    });

    expect(
      validateRecommendationExposureRecord({
        ...record,
        assignment_hash: DEFAULT_EXPERIMENT_ASSIGNMENT_HASH,
      }),
    ).toBe(false);
    expect(
      validateRecommendationExposureRecord({
        ...record,
        assignment_hash: "NOT-HEX",
      }),
    ).toBe(false);
  });
});

describe("exposure-to-feedback experiment join", () => {
  it("attributes feedback to the latest eligible exposure with matching assignment evidence", () => {
    const outcomes = joinExperimentExposureFeedback({
      exposures: [
        makeExposure(),
        makeExposure({
          exposedAt: iso(BASE_MS + 3 * DAY_MS),
          experimentBucket: "treatment",
          experimentConfigVersion: TREATMENT_CONFIG,
          assignmentHash: TREATMENT_ASSIGNMENT_HASH,
        }),
      ],
      feedback: [makeFeedback({ feedbackAt: iso(BASE_MS + 5 * DAY_MS) })],
      assignments: [
        makeAssignmentEvidence(),
        makeAssignmentEvidence({
          assignmentHash: TREATMENT_ASSIGNMENT_HASH,
          configVersion: TREATMENT_CONFIG,
          bucket: "treatment",
        }),
      ],
    });

    expect(outcomes).toEqual([
      {
        bucket: "treatment",
        configVersion: TREATMENT_CONFIG,
        positive: true,
      },
    ]);
  });

  it("falls back to an earlier exposure when feedback predates the latest one", () => {
    const outcomes = joinExperimentExposureFeedback({
      exposures: [
        makeExposure(),
        makeExposure({
          exposedAt: iso(BASE_MS + 3 * DAY_MS),
          experimentBucket: "treatment",
          experimentConfigVersion: TREATMENT_CONFIG,
          assignmentHash: TREATMENT_ASSIGNMENT_HASH,
        }),
      ],
      // After the control exposure but before the treatment exposure.
      feedback: [makeFeedback({ feedbackAt: iso(BASE_MS + 2 * DAY_MS) })],
      assignments: [
        makeAssignmentEvidence(),
        makeAssignmentEvidence({
          assignmentHash: TREATMENT_ASSIGNMENT_HASH,
          configVersion: TREATMENT_CONFIG,
          bucket: "treatment",
        }),
      ],
    });

    expect(outcomes).toEqual([
      { bucket: "control", configVersion: CONTROL_CONFIG, positive: true },
    ]);
  });

  it("chooses the latest eligible exposure deterministically regardless of row order", () => {
    const control = makeExposure();
    const treatment = makeExposure({
      experimentBucket: "treatment",
      experimentConfigVersion: TREATMENT_CONFIG,
      assignmentHash: TREATMENT_ASSIGNMENT_HASH,
    });
    const assignments = [
      makeAssignmentEvidence(),
      makeAssignmentEvidence({
        assignmentHash: TREATMENT_ASSIGNMENT_HASH,
        configVersion: TREATMENT_CONFIG,
        bucket: "treatment",
      }),
    ];

    const forward = joinExperimentExposureFeedback({
      exposures: [control, treatment],
      feedback: [makeFeedback()],
      assignments,
    });
    const reversed = joinExperimentExposureFeedback({
      exposures: [treatment, control],
      feedback: [makeFeedback()],
      assignments,
    });

    expect(forward).toEqual(reversed);
    expect(forward).toHaveLength(1);
    // Same-timestamp tie breaks deterministically on the config version.
    expect(forward[0].bucket).toBe("treatment");
    expect(forward[0].configVersion).toBe(TREATMENT_CONFIG);
  });

  it("enforces the strict 7-day attribution window", () => {
    expect(EXPERIMENT_ATTRIBUTION_WINDOW_DAYS).toBe(7);

    const assignments = [makeAssignmentEvidence()];
    const atWindowEnd = joinExperimentExposureFeedback({
      exposures: [makeExposure()],
      feedback: [
        makeFeedback({ feedbackAt: iso(BASE_MS + 7 * DAY_MS) }),
      ],
      assignments,
    });
    expect(atWindowEnd).toHaveLength(1);

    const pastWindow = joinExperimentExposureFeedback({
      exposures: [makeExposure()],
      feedback: [
        makeFeedback({ feedbackAt: iso(BASE_MS + 7 * DAY_MS + 1000) }),
      ],
      assignments,
    });
    expect(pastWindow).toEqual([]);

    const simultaneous = joinExperimentExposureFeedback({
      exposures: [makeExposure()],
      feedback: [makeFeedback({ feedbackAt: iso(BASE_MS) })],
      assignments,
    });
    expect(simultaneous).toEqual([]);

    const beforeExposure = joinExperimentExposureFeedback({
      exposures: [makeExposure()],
      feedback: [makeFeedback({ feedbackAt: iso(BASE_MS - 1000) })],
      assignments,
    });
    expect(beforeExposure).toEqual([]);
  });

  it("records negative outcomes when only negative feedback arrives in window", () => {
    const outcomes = joinExperimentExposureFeedback({
      exposures: [makeExposure()],
      feedback: [makeFeedback({ positive: false })],
      assignments: [makeAssignmentEvidence()],
    });

    expect(outcomes).toEqual([
      { bucket: "control", configVersion: CONTROL_CONFIG, positive: false },
    ]);
  });

  it("excludes forged exposures that lack a matching assignment evidence row", () => {
    // Valid exposure shape, but no assignment evidence exists at all.
    expect(
      joinExperimentExposureFeedback({
        exposures: [makeExposure()],
        feedback: [makeFeedback()],
        assignments: [],
      }),
    ).toEqual([]);

    // Evidence exists for a different assignment hash only.
    expect(
      joinExperimentExposureFeedback({
        exposures: [makeExposure()],
        feedback: [makeFeedback()],
        assignments: [
          makeAssignmentEvidence({ assignmentHash: "ffffffffffffffff" }),
        ],
      }),
    ).toEqual([]);

    // Exposure without an assignment hash cannot be evidenced.
    expect(
      joinExperimentExposureFeedback({
        exposures: [
          makeExposure({ assignmentHash: null }),
          makeExposure({
            tmdbId: 304,
            assignmentHash: DEFAULT_EXPERIMENT_ASSIGNMENT_HASH,
          }),
        ],
        feedback: [makeFeedback(), makeFeedback({ tmdbId: 304 })],
        assignments: [makeAssignmentEvidence()],
      }),
    ).toEqual([]);
  });

  it("excludes stale or mismatched assignment evidence for owner, engine, config, and bucket", () => {
    const mismatched: ExperimentAssignmentEvidenceRow[] = [
      // Evidence owned by another user.
      makeAssignmentEvidence({ userId: "user-3" }),
      // Evidence recorded by a stale engine.
      makeAssignmentEvidence({ engineVersion: "v0-legacy" }),
      // Evidence for a different config version.
      makeAssignmentEvidence({ configVersion: TREATMENT_CONFIG }),
      // Evidence for a different bucket.
      makeAssignmentEvidence({ bucket: "treatment" }),
      // Zero-hash evidence can never match an active exposure.
      makeAssignmentEvidence({
        assignmentHash: DEFAULT_EXPERIMENT_ASSIGNMENT_HASH,
      }),
      // Malformed evidence fields fail closed.
      makeAssignmentEvidence({ configVersion: null }),
      makeAssignmentEvidence({ bucket: null }),
      makeAssignmentEvidence({ engineVersion: null }),
      makeAssignmentEvidence({ userId: "   " }),
    ];

    for (const evidence of mismatched) {
      expect(
        joinExperimentExposureFeedback({
          exposures: [makeExposure()],
          feedback: [makeFeedback()],
          assignments: [evidence],
        }),
        `evidence ${JSON.stringify(evidence)} must not validate the exposure`,
      ).toEqual([]);
    }
  });

  it("excludes default, unassigned, malformed, mismatched, and out-of-window rows", () => {
    const exposures: ExperimentExposureRow[] = [
      // Default bucket / zero config: not part of any experiment comparison.
      makeExposure({
        experimentBucket: "default",
        experimentConfigVersion: DEFAULT_EXPERIMENT_CONFIG_VERSION,
        assignmentHash: DEFAULT_EXPERIMENT_ASSIGNMENT_HASH,
      }),
      // Legacy/unassigned rows.
      makeExposure({
        tmdbId: 304,
        experimentBucket: null,
        experimentConfigVersion: null,
        assignmentHash: null,
      }),
      // Broken bucket/config pairing.
      makeExposure({
        tmdbId: 305,
        experimentConfigVersion: DEFAULT_EXPERIMENT_CONFIG_VERSION,
      }),
      // Malformed config version.
      makeExposure({ tmdbId: 306, experimentConfigVersion: "NOT-HEX" }),
      // Non-current engine.
      makeExposure({ tmdbId: 307, engineVersion: "v0-legacy" }),
      // Malformed exposure timestamp.
      makeExposure({ tmdbId: 308, exposedAt: "not-a-date" }),
      // Feedback belongs to another user.
      makeExposure({ tmdbId: 309 }),
      // No feedback exists for this movie.
      makeExposure({ tmdbId: 310 }),
    ];
    const feedback: ExperimentFeedbackRow[] = [
      makeFeedback(),
      makeFeedback({ tmdbId: 304 }),
      makeFeedback({ tmdbId: 305 }),
      makeFeedback({ tmdbId: 306 }),
      makeFeedback({ tmdbId: 307 }),
      makeFeedback({ tmdbId: 308 }),
      makeFeedback({ tmdbId: 309, userId: "user-3" }),
      makeFeedback({ tmdbId: 999 }),
      // Out-of-window feedback for the tmdb 310 exposure.
      makeFeedback({ tmdbId: 310, feedbackAt: iso(BASE_MS + 8 * DAY_MS) }),
    ];

    expect(
      joinExperimentExposureFeedback({
        exposures,
        feedback,
        // Even a plausible-looking evidence row for the default bucket cannot
        // validate experiment traffic.
        assignments: [
          makeAssignmentEvidence({
            assignmentHash: DEFAULT_EXPERIMENT_ASSIGNMENT_HASH,
            configVersion: DEFAULT_EXPERIMENT_CONFIG_VERSION,
            bucket: "default",
          }),
          makeAssignmentEvidence(),
        ],
      }),
    ).toEqual([]);
  });

  it("rejects malformed feedback rows fail-closed", () => {
    const malformed: Partial<ExperimentFeedbackRow>[] = [
      { userId: "   " },
      { tmdbId: 0 },
      { feedbackAt: "not-a-date" },
      { positive: undefined },
    ];

    for (const override of malformed) {
      expect(
        joinExperimentExposureFeedback({
          exposures: [makeExposure()],
          feedback: [makeFeedback(override)],
          assignments: [makeAssignmentEvidence()],
        }),
        `feedback ${JSON.stringify(override)} must be excluded`,
      ).toEqual([]);
    }
  });
});

describe("bounded experiment join limits", () => {
  function pad(index: number): string {
    return index.toString().padStart(5, "0");
  }

  /**
   * One distinct eligible owner per index: matching exposure, feedback, and
   * server-owned assignment evidence, so every pair yields exactly one
   * outcome. Zero-padded owners make the sorted user/movie key order
   * numeric, so the deterministic output order is observable.
   */
  function makeJoinPopulation(
    count: number,
    positiveAt?: (index: number) => boolean,
  ): {
    exposures: ExperimentExposureRow[];
    feedback: ExperimentFeedbackRow[];
    assignments: ExperimentAssignmentEvidenceRow[];
  } {
    const exposures: ExperimentExposureRow[] = [];
    const feedback: ExperimentFeedbackRow[] = [];
    const assignments: ExperimentAssignmentEvidenceRow[] = [];
    for (let index = 0; index < count; index += 1) {
      const userId = `user-${pad(index)}`;
      exposures.push(makeExposure({ userId, tmdbId: 303 }));
      feedback.push(
        makeFeedback({
          userId,
          tmdbId: 303,
          positive: positiveAt ? positiveAt(index) : true,
        }),
      );
      assignments.push(makeAssignmentEvidence({ userId }));
    }
    return { exposures, feedback, assignments };
  }

  it("fixes the offline join input and output limits at the diagnostic count", () => {
    expect(MAX_EXPERIMENT_JOIN_EXPOSURES).toBe(10_000);
    expect(MAX_EXPERIMENT_JOIN_FEEDBACK).toBe(10_000);
    expect(MAX_EXPERIMENT_JOIN_ASSIGNMENTS).toBe(10_000);
    expect(MAX_EXPERIMENT_JOIN_OUTCOMES).toBe(10_000);
    expect(MAX_EXPERIMENT_JOIN_EXPOSURES).toBe(MAX_DIAGNOSTIC_COUNT);
    expect(MAX_EXPERIMENT_JOIN_FEEDBACK).toBe(MAX_DIAGNOSTIC_COUNT);
    expect(MAX_EXPERIMENT_JOIN_ASSIGNMENTS).toBe(MAX_DIAGNOSTIC_COUNT);
    expect(MAX_EXPERIMENT_JOIN_OUTCOMES).toBe(MAX_DIAGNOSTIC_COUNT);
  });

  it("fails closed when the exposure input alone exceeds its fixed limit", () => {
    const population = makeJoinPopulation(MAX_EXPERIMENT_JOIN_EXPOSURES);
    population.exposures.push(makeExposure({ userId: "user-overflow" }));
    expect(population.exposures).toHaveLength(
      MAX_EXPERIMENT_JOIN_EXPOSURES + 1,
    );

    expect(joinExperimentExposureFeedback(population)).toEqual([]);
  });

  it("fails closed when the feedback input alone exceeds its fixed limit", () => {
    const population = makeJoinPopulation(MAX_EXPERIMENT_JOIN_FEEDBACK);
    population.feedback.push(makeFeedback({ userId: "user-overflow" }));
    expect(population.feedback).toHaveLength(
      MAX_EXPERIMENT_JOIN_FEEDBACK + 1,
    );

    expect(joinExperimentExposureFeedback(population)).toEqual([]);
  });

  it("fails closed when the assignment evidence input alone exceeds its fixed limit", () => {
    const population = makeJoinPopulation(1);
    const assignments: ExperimentAssignmentEvidenceRow[] = [];
    for (let index = 0; index <= MAX_EXPERIMENT_JOIN_ASSIGNMENTS; index += 1) {
      assignments.push(makeAssignmentEvidence({ userId: `user-${pad(index)}` }));
    }
    expect(assignments).toHaveLength(MAX_EXPERIMENT_JOIN_ASSIGNMENTS + 1);

    expect(
      joinExperimentExposureFeedback({ ...population, assignments }),
    ).toEqual([]);
  });

  it("accepts exactly-at-limit inputs and stops at the fixed outcome cap in sorted user/movie order", () => {
    const population = makeJoinPopulation(
      MAX_EXPERIMENT_JOIN_OUTCOMES,
      (index) => index % 2 === 0,
    );
    const expected: ExperimentOutcome[] = Array.from(
      { length: MAX_EXPERIMENT_JOIN_OUTCOMES },
      (_, index) => ({
        bucket: "control" as const,
        configVersion: CONTROL_CONFIG,
        positive: index % 2 === 0,
      }),
    );

    const outcomes = joinExperimentExposureFeedback(population);

    // Exactly the fixed cap, never beyond it.
    expect(outcomes).toHaveLength(MAX_EXPERIMENT_JOIN_OUTCOMES);
    expect(outcomes.length).toBeLessThanOrEqual(MAX_EXPERIMENT_JOIN_OUTCOMES);
    // Exactly the first cap-many pairs in deterministic sorted user/movie
    // order: the alternating positive pattern survives projection.
    expect(outcomes).toEqual(expected);

    // Deterministic repeat regardless of input row order.
    const reversed = joinExperimentExposureFeedback({
      exposures: [...population.exposures].reverse(),
      feedback: [...population.feedback].reverse(),
      assignments: population.assignments,
    });
    expect(reversed).toEqual(outcomes);
  });

  it("never emits user or movie ids in bounded outcomes", () => {
    const outcomes = joinExperimentExposureFeedback(makeJoinPopulation(250));

    expect(outcomes).toHaveLength(250);
    for (const outcome of outcomes) {
      expect(Object.keys(outcome).sort()).toEqual([
        "bucket",
        "configVersion",
        "positive",
      ]);
    }
    const serialized = JSON.stringify(outcomes);
    expect(serialized).not.toContain("user-");
    expect(serialized).not.toContain("303");
  });
});

describe("experiment outcome aggregation", () => {
  function buildOutcomes(): ExperimentOutcome[] {
    return joinExperimentExposureFeedback({
      exposures: [
        makeExposure({ tmdbId: 301 }),
        makeExposure({ tmdbId: 302 }),
        makeExposure({ tmdbId: 303 }),
        makeExposure({
          tmdbId: 304,
          experimentBucket: "treatment",
          assignmentHash: TREATMENT_ASSIGNMENT_HASH,
        }),
        makeExposure({
          tmdbId: 305,
          experimentBucket: "treatment",
          assignmentHash: TREATMENT_ASSIGNMENT_HASH,
        }),
      ],
      feedback: [
        makeFeedback({ tmdbId: 301, positive: true }),
        makeFeedback({ tmdbId: 302, positive: true }),
        makeFeedback({ tmdbId: 303, positive: false }),
        makeFeedback({ tmdbId: 304, positive: true }),
        makeFeedback({ tmdbId: 305, positive: false }),
      ],
      assignments: [
        makeAssignmentEvidence(),
        makeAssignmentEvidence({
          assignmentHash: TREATMENT_ASSIGNMENT_HASH,
          bucket: "treatment",
        }),
      ],
    });
  }

  it("aggregates only the specified config version by bucket with counts and positive rate", () => {
    const aggregates = aggregateExperimentOutcomes(
      buildOutcomes(),
      CONTROL_CONFIG,
    );

    expect(aggregates).toEqual([
      {
        bucket: "control",
        configVersion: CONTROL_CONFIG,
        outcomeCount: 3,
        positiveCount: 2,
        positiveRate: 2 / 3,
      },
      {
        bucket: "treatment",
        configVersion: CONTROL_CONFIG,
        outcomeCount: 2,
        positiveCount: 1,
        positiveRate: 0.5,
      },
    ]);
  });

  it("emits at most control and treatment groups in canonical order", () => {
    const outcomes: ExperimentOutcome[] = [
      { bucket: "treatment", configVersion: CONTROL_CONFIG, positive: true },
      { bucket: "control", configVersion: CONTROL_CONFIG, positive: true },
      {
        bucket: "default",
        configVersion: DEFAULT_EXPERIMENT_CONFIG_VERSION,
        positive: true,
      },
      { bucket: "control", configVersion: TREATMENT_CONFIG, positive: true },
    ];

    const aggregates = aggregateExperimentOutcomes(outcomes, CONTROL_CONFIG);

    expect(aggregates.map((aggregate) => aggregate.bucket)).toEqual([
      "control",
      "treatment",
    ]);
    expect(aggregates.length).toBeLessThanOrEqual(2);
    for (const aggregate of aggregates) {
      expect(aggregate.configVersion).toBe(CONTROL_CONFIG);
    }
  });

  it("ignores outcomes from other config versions, default, and malformed rows", () => {
    const outcomes: ExperimentOutcome[] = [
      { bucket: "control", configVersion: TREATMENT_CONFIG, positive: true },
      {
        bucket: "default",
        configVersion: DEFAULT_EXPERIMENT_CONFIG_VERSION,
        positive: true,
      },
      { bucket: "variant_a", configVersion: CONTROL_CONFIG, positive: true },
      { bucket: "control", configVersion: "NOT-HEX", positive: true },
      { bucket: "control", configVersion: CONTROL_CONFIG, positive: true },
    ] as unknown as ExperimentOutcome[];

    expect(aggregateExperimentOutcomes(outcomes, CONTROL_CONFIG)).toEqual([
      {
        bucket: "control",
        configVersion: CONTROL_CONFIG,
        outcomeCount: 1,
        positiveCount: 1,
        positiveRate: 1,
      },
    ]);
  });

  it("fails closed for zero, malformed, or missing specified config versions", () => {
    const outcomes: ExperimentOutcome[] = [
      { bucket: "control", configVersion: CONTROL_CONFIG, positive: true },
    ];

    expect(
      aggregateExperimentOutcomes(outcomes, DEFAULT_EXPERIMENT_CONFIG_VERSION),
    ).toEqual([]);
    expect(aggregateExperimentOutcomes(outcomes, "NOT-HEX")).toEqual([]);
    expect(aggregateExperimentOutcomes(outcomes, "0123456789ABCDEF")).toEqual(
      [],
    );
    expect(aggregateExperimentOutcomes(outcomes, undefined)).toEqual([]);
    expect(aggregateExperimentOutcomes(outcomes, null)).toEqual([]);
    expect(aggregateExperimentOutcomes(outcomes, 123)).toEqual([]);
  });

  it("emits only bounded aggregate fields and never raw ids or rows", () => {
    const aggregates = aggregateExperimentOutcomes(
      buildOutcomes(),
      CONTROL_CONFIG,
    );
    const serialized = JSON.stringify(aggregates);

    expect(serialized).not.toContain("user-1");
    expect(serialized).not.toContain("301");
    expect(serialized).not.toContain("303");

    for (const aggregate of aggregates) {
      expect(Object.keys(aggregate).sort()).toEqual([
        "bucket",
        "configVersion",
        "outcomeCount",
        "positiveCount",
        "positiveRate",
      ]);
      expect(Number.isSafeInteger(aggregate.outcomeCount)).toBe(true);
      expect(Number.isSafeInteger(aggregate.positiveCount)).toBe(true);
      expect(aggregate.outcomeCount).toBeGreaterThanOrEqual(0);
      expect(aggregate.outcomeCount).toBeLessThanOrEqual(MAX_DIAGNOSTIC_COUNT);
      expect(aggregate.positiveCount).toBeLessThanOrEqual(
        aggregate.outcomeCount,
      );
      expect(aggregate.positiveRate).toBeGreaterThanOrEqual(0);
      expect(aggregate.positiveRate).toBeLessThanOrEqual(1);
    }
  });

  it("bounds aggregate totals at the diagnostic maximum", () => {
    const outcomes: ExperimentOutcome[] = Array.from(
      { length: MAX_DIAGNOSTIC_COUNT + 5 },
      () => ({
        bucket: "control" as const,
        configVersion: CONTROL_CONFIG,
        positive: true,
      }),
    );

    const [aggregate] = aggregateExperimentOutcomes(outcomes, CONTROL_CONFIG);
    expect(aggregate.outcomeCount).toBe(MAX_DIAGNOSTIC_COUNT);
    expect(aggregate.positiveCount).toBe(MAX_DIAGNOSTIC_COUNT);
    expect(aggregate.positiveRate).toBe(1);
  });

  it("computes counts and rate from the same first-in bounded population", () => {
    // The first MAX_DIAGNOSTIC_COUNT valid control outcomes carry exactly
    // four positives; the five overflow outcomes are all positive and must
    // never contribute to any published field. outcomeCount, positiveCount,
    // and positiveRate must all describe exactly that bounded population.
    const boundedPopulation: ExperimentOutcome[] = Array.from(
      { length: MAX_DIAGNOSTIC_COUNT },
      (_, index) => ({
        bucket: "control" as const,
        configVersion: CONTROL_CONFIG,
        positive: index < 4,
      }),
    );
    const overflow: ExperimentOutcome[] = Array.from({ length: 5 }, () => ({
      bucket: "control" as const,
      configVersion: CONTROL_CONFIG,
      positive: true,
    }));

    expect(
      aggregateExperimentOutcomes(
        [...boundedPopulation, ...overflow],
        CONTROL_CONFIG,
      ),
    ).toEqual([
      {
        bucket: "control",
        configVersion: CONTROL_CONFIG,
        outcomeCount: MAX_DIAGNOSTIC_COUNT,
        positiveCount: 4,
        positiveRate: 4 / MAX_DIAGNOSTIC_COUNT,
      },
    ]);
  });

  it("returns bounded empty aggregates for empty input", () => {
    expect(aggregateExperimentOutcomes([], CONTROL_CONFIG)).toEqual([]);
  });
});

describe("getABTestVariant deterministic assignment boundary", () => {
  const CONTROLLED_VARIANTS: ABTestVariant[] = [
    { name: "control", params: { mmrLambda: 0.5 } },
    { name: "treatment", params: { mmrLambda: 0.7 } },
  ];
  const CONTROLLED_SPLIT = { control: 0.5, treatment: 0.5 };

  type FakeAssignmentState = {
    stored: string | null;
    inserts: Record<string, unknown>[];
    fromCalls: number;
  };

  function createFakeAssignmentClient(options?: {
    insertError?: { code?: string; message?: string };
    /** Simulates a concurrent winner persisted while the local insert fails. */
    concurrentWinner?: string;
    preStored?: string | null;
  }): { client: ABTestAssignmentClient; state: FakeAssignmentState } {
    const state: FakeAssignmentState = {
      stored: options?.preStored ?? null,
      inserts: [],
      fromCalls: 0,
    };
    const client: ABTestAssignmentClient = {
      from: () => {
        state.fromCalls += 1;
        return {
          select: () => {
            const filter = {
              eq: () => filter,
              maybeSingle: async () => ({
                data: state.stored ? { variant_name: state.stored } : null,
                error: null,
              }),
            };
            return filter;
          },
          insert: async (row: Record<string, unknown>) => {
            if (options?.insertError) {
              if (options.concurrentWinner) state.stored = options.concurrentWinner;
              return { error: options.insertError };
            }
            state.inserts.push(row);
            state.stored = row.variant_name as string;
            return { error: null };
          },
        };
      },
    };
    return { client, state };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("assigns deterministically per user and test without Math.random", async () => {
    const randomSpy = vi.spyOn(Math, "random");

    const first = createFakeAssignmentClient();
    const second = createFakeAssignmentClient();
    const variantA = await getABTestVariant({
      userId: USER_ID,
      testId: 7,
      variants: CONTROLLED_VARIANTS,
      trafficSplit: CONTROLLED_SPLIT,
      client: first.client,
    });
    const variantB = await getABTestVariant({
      userId: USER_ID,
      testId: 7,
      variants: CONTROLLED_VARIANTS,
      trafficSplit: CONTROLLED_SPLIT,
      client: second.client,
    });

    expect(randomSpy).not.toHaveBeenCalled();
    expect(variantA).not.toBeNull();
    expect(variantB).toEqual(variantA);
    expect(["control", "treatment"]).toContain(variantA?.name);
    expect(first.state.inserts).toHaveLength(1);
    expect(first.state.inserts[0].variant_name).toBe(variantA?.name);

    // A different user may differ, but repeated calls never use Math.random.
    await getABTestVariant({
      userId: "22222222-2222-4222-8222-222222222222",
      testId: 7,
      variants: CONTROLLED_VARIANTS,
      trafficSplit: CONTROLLED_SPLIT,
      client: createFakeAssignmentClient().client,
    });
    expect(randomSpy).not.toHaveBeenCalled();
  });

  it("returns the existing stored assignment without re-inserting", async () => {
    const { client, state } = createFakeAssignmentClient({
      preStored: "treatment",
    });

    const variant = await getABTestVariant({
      userId: USER_ID,
      testId: 7,
      variants: CONTROLLED_VARIANTS,
      trafficSplit: CONTROLLED_SPLIT,
      client,
    });

    expect(variant?.name).toBe("treatment");
    expect(state.inserts).toHaveLength(0);
  });

  it("returns a stored assignment before applying changed, invalid, or holdout config rules", async () => {
    const cases: Array<{
      variants: ABTestVariant[];
      trafficSplit: Record<string, number>;
    }> = [
      { variants: CONTROLLED_VARIANTS, trafficSplit: { default: 1, control: 0, treatment: 0 } },
      { variants: CONTROLLED_VARIANTS, trafficSplit: { control: 0.5, treatment: 0.4 } },
      { variants: [CONTROLLED_VARIANTS[1]], trafficSplit: CONTROLLED_SPLIT },
    ];

    for (const current of cases) {
      const { client, state } = createFakeAssignmentClient({
        preStored: "treatment",
      });
      const variant = await getABTestVariant({
        userId: USER_ID,
        testId: 7,
        variants: current.variants,
        trafficSplit: current.trafficSplit,
        client,
      });

      expect(variant?.name).toBe("treatment");
      expect(state.inserts).toHaveLength(0);
      expect(state.fromCalls).toBeGreaterThan(0);
    }
  });

  it("returns the winning stored assignment on persistence race, never the losing local choice", async () => {
    // Determine the deterministic local choice for this user/test.
    const clean = createFakeAssignmentClient();
    const localVariant = await getABTestVariant({
      userId: USER_ID,
      testId: 9,
      variants: CONTROLLED_VARIANTS,
      trafficSplit: CONTROLLED_SPLIT,
      client: clean.client,
    });
    expect(localVariant).not.toBeNull();
    const winner = localVariant?.name === "control" ? "treatment" : "control";

    const racing = createFakeAssignmentClient({
      insertError: { code: "23505", message: "duplicate key" },
      concurrentWinner: winner,
    });
    const variant = await getABTestVariant({
      userId: USER_ID,
      testId: 9,
      variants: CONTROLLED_VARIANTS,
      trafficSplit: CONTROLLED_SPLIT,
      client: racing.client,
    });

    expect(variant?.name).toBe(winner);
    expect(variant?.name).not.toBe(localVariant?.name);
  });

  it("rejects an uncontrolled stored winner after a persistence race", async () => {
    const variants = [
      ...CONTROLLED_VARIANTS,
      { name: "legacy", params: { mmrLambda: 0.1 } },
    ];
    const racing = createFakeAssignmentClient({
      insertError: { code: "23505", message: "duplicate key" },
      concurrentWinner: "legacy",
    });

    const variant = await getABTestVariant({
      userId: USER_ID,
      testId: 9,
      variants,
      trafficSplit: CONTROLLED_SPLIT,
      client: racing.client,
    });

    expect(variant).toBeNull();
  });

  it("fails closed when a persistence failure has no stored winner", async () => {
    const { client } = createFakeAssignmentClient({
      insertError: { code: "08000", message: "connection lost" },
    });

    const variant = await getABTestVariant({
      userId: USER_ID,
      testId: 9,
      variants: CONTROLLED_VARIANTS,
      trafficSplit: CONTROLLED_SPLIT,
      client,
    });

    expect(variant).toBeNull();
  });

  it("fails closed for configs that cannot map to the controlled buckets", async () => {
    const unmappableSplits: Record<string, number>[] = [
      { A: 0.5, B: 0.5 },
      { variant_a: 1 },
      { control: 1 },
      { treatment: 1 },
      {},
      { control: 0.5, treatment: 0.4 },
    ];

    for (const trafficSplit of unmappableSplits) {
      const { client, state } = createFakeAssignmentClient();
      const variant = await getABTestVariant({
        userId: USER_ID,
        testId: 7,
        variants: CONTROLLED_VARIANTS,
        trafficSplit,
        client,
      });
      expect(
        variant,
        `split ${JSON.stringify(trafficSplit)} must fail closed`,
      ).toBeNull();
      expect(state.fromCalls).toBeGreaterThan(0);
    }

    // Variants that do not cover both controlled buckets fail closed too.
    const { client, state } = createFakeAssignmentClient();
    const variant = await getABTestVariant({
      userId: USER_ID,
      testId: 7,
      variants: [{ name: "control", params: {} }],
      trafficSplit: CONTROLLED_SPLIT,
      client,
    });
    expect(variant).toBeNull();
    expect(state.fromCalls).toBeGreaterThan(0);
  });

  it("fails closed for holdout traffic landing on the default bucket", async () => {
    const { client, state } = createFakeAssignmentClient();

    const variant = await getABTestVariant({
      userId: USER_ID,
      testId: 7,
      variants: CONTROLLED_VARIANTS,
      trafficSplit: { default: 1, control: 0, treatment: 0 },
      client,
    });

    expect(variant).toBeNull();
    expect(state.inserts).toHaveLength(0);
  });

  it("fails closed without a client", async () => {
    const variant = await getABTestVariant({
      userId: USER_ID,
      testId: 7,
      variants: CONTROLLED_VARIANTS,
      trafficSplit: CONTROLLED_SPLIT,
    });

    expect(variant).toBeNull();
  });
});

describe("prepare_recommendation_experiments migration contract", () => {
  const migrationPath = fileURLToPath(
    new URL(
      "../../supabase/migrations/20260803120000_prepare_recommendation_experiments.sql",
      import.meta.url,
    ),
  );
  const migration = readFileSync(migrationPath, "utf8");

  it("is a forward-only migration ordered after the exposure versioning migration", () => {
    expect("20260803120000" > "20260802120000").toBe(true);
    expect(migration).toMatch(
      /alter table public\.suggestion_exposure_log/i,
    );
    expect(migration).not.toMatch(/drop table/i);
    expect(migration).not.toMatch(/drop column/i);
  });

  it("adds experiment_config_version with the zero default and a rerunnable backfill", () => {
    expect(migration).toMatch(
      /add column if not exists experiment_config_version text\s+not null\s+default '0000000000000000'/i,
    );
    expect(migration).toMatch(
      /update public\.suggestion_exposure_log\s+set experiment_config_version = '0000000000000000'/i,
    );
  });

  it("adds assignment_hash with the zero default and a rerunnable backfill", () => {
    expect(migration).toMatch(
      /add column if not exists assignment_hash text\s+not null\s+default '0000000000000000'/i,
    );
    expect(migration).toMatch(
      /update public\.suggestion_exposure_log\s+set assignment_hash = '0000000000000000'/i,
    );
    expect(migration).toMatch(
      /add constraint suggestion_exposure_log_assignment_hash_bounds/i,
    );
  });

  it("permits only the controlled experiment buckets", () => {
    expect(migration).toMatch(
      /experiment_bucket in \('default', 'control', 'treatment'\)/i,
    );
    expect(migration).not.toMatch(/experiment_bucket ~ /i);
  });

  it("pairs the default bucket with the zero config and active buckets with nonzero 16-hex configs", () => {
    expect(migration).toMatch(
      /add constraint suggestion_exposure_log_experiment_config_version_bounds/i,
    );
    expect(migration).toMatch(
      /experiment_config_version ~ '\^\[0-9a-f\]\{16\}\$'/i,
    );
    expect(migration).toMatch(
      /experiment_config_version <> '0000000000000000'/i,
    );
    expect(migration).toMatch(
      /experiment_config_version = '0000000000000000'/i,
    );
  });

  it("creates the server-owned assignment registry with bounded checks and RLS", () => {
    expect(migration).toMatch(
      /create table if not exists public\.recommendation_experiment_assignments/i,
    );
    expect(migration).toMatch(/assignment_hash text not null/i);
    expect(migration).toMatch(
      /user_id uuid not null references auth\.users\(id\) on delete cascade/i,
    );
    expect(migration).toMatch(/assignment_unit text not null/i);
    expect(migration).toMatch(/subject_hash text not null/i);
    expect(migration).toMatch(/engine_version text not null/i);
    expect(migration).toMatch(/config_version text not null/i);
    expect(migration).toMatch(/bucket text not null/i);
    expect(migration).toMatch(
      /assigned_at timestamptz not null default now\(\)/i,
    );
    expect(migration).toMatch(/primary key \(assignment_hash, user_id\)/i);

    expect(migration).toMatch(
      /assignment_hash ~ '\^\[0-9a-f\]\{16\}\$'/i,
    );
    expect(migration).toMatch(/assignment_hash <> '0000000000000000'/i);
    expect(migration).toMatch(/assignment_unit in \('user', 'request'\)/i);
    expect(migration).toMatch(/subject_hash ~ '\^\[0-9a-f\]\{16\}\$'/i);
    expect(migration).toMatch(/engine_version = 'v1-canonical-1'/i);
    expect(migration).toMatch(/config_version <> '0000000000000000'/i);
    expect(migration).toMatch(/bucket in \('control', 'treatment'\)/i);

    expect(migration).toMatch(
      /alter table public\.recommendation_experiment_assignments\s+enable row level security/i,
    );
    // Raw assignment keys never appear as a registry column.
    expect(migration).not.toMatch(/assignment_key/i);
  });

  it("grants registry access only to service_role with no authenticated insert policy", () => {
    expect(migration).toMatch(
      /create policy "recommendation_experiment_assignments_service_select"[\s\S]*?for select\s+to service_role/i,
    );
    expect(migration).toMatch(
      /create policy "recommendation_experiment_assignments_service_insert"[\s\S]*?for insert\s+to service_role/i,
    );

    const registryPolicies =
      migration.match(
        /create policy "[^"]+"[^;]*on public\.recommendation_experiment_assignments[^;]*;/gi,
      ) ?? [];
    expect(registryPolicies.length).toBeGreaterThan(0);
    for (const policy of registryPolicies) {
      expect(policy).not.toMatch(/authenticated/i);
      expect(policy).not.toMatch(/\banon\b/i);
    }
  });

  it("validates experiment fields and registry evidence in the write trigger", () => {
    const triggerFunction =
      migration.match(
        /create or replace function public\.enforce_versioned_exposure_insert\(\)[\s\S]*?\$body\$[\s\S]*?\$body\$/i,
      )?.[0] ?? "";

    expect(triggerFunction.length).toBeGreaterThan(0);
    expect(triggerFunction).toMatch(
      /new\.experiment_bucket not in \('default', 'control', 'treatment'\)/i,
    );
    expect(triggerFunction).toMatch(
      /new\.experiment_config_version := '0000000000000000'/i,
    );
    expect(triggerFunction).toMatch(
      /new\.assignment_hash := '0000000000000000'/i,
    );
    expect(triggerFunction).toMatch(/22023/);
    expect(triggerFunction).toMatch(
      /incomplete versioned exposure record/,
    );

    // Default exposures require the zero config and zero assignment hash.
    expect(triggerFunction).toMatch(
      /new\.experiment_bucket = 'default'\s+and new\.assignment_hash is distinct from '0000000000000000'/i,
    );

    // Active exposures require a matching server-owned registry row:
    // assignment hash + same owner + engine/config/bucket.
    expect(triggerFunction).toMatch(
      /from public\.recommendation_experiment_assignments/i,
    );
    expect(triggerFunction).toMatch(
      /assignment_hash = new\.assignment_hash/i,
    );
    expect(triggerFunction).toMatch(/user_id = new\.user_id/i);
    expect(triggerFunction).toMatch(
      /engine_version = new\.engine_version/i,
    );
    expect(triggerFunction).toMatch(
      /config_version = new\.experiment_config_version/i,
    );
    expect(triggerFunction).toMatch(/bucket = new\.experiment_bucket/i);

    // Minimization and retention behavior is preserved from 2B.2.
    expect(triggerFunction).toMatch(/new\.exposed_at := now\(\);/i);
    expect(triggerFunction).toMatch(
      /new\.retention_until := now\(\) \+ interval '90 days';/i,
    );
    expect(triggerFunction).toMatch(/new\.exposed_at := old\.exposed_at;/i);
    expect(triggerFunction).toMatch(
      /new\.retention_until := old\.retention_until;/i,
    );
    expect(triggerFunction).toMatch(/new\.session_context := null;/i);
    expect(triggerFunction).toMatch(/new\.sources := null;/i);
    expect(triggerFunction).toMatch(/new\.reasons := null;/i);
  });

  it("ships a service-role-only SECURITY DEFINER registration RPC with bounded validation", () => {
    expect(migration).toMatch(
      /create or replace function public\.register_recommendation_experiment_assignment\(/i,
    );
    const rpc =
      migration.match(
        /create or replace function public\.register_recommendation_experiment_assignment\([\s\S]*?\$body\$[\s\S]*?\$body\$/i,
      )?.[0] ?? "";

    expect(rpc.length).toBeGreaterThan(0);
    expect(rpc).toMatch(/security definer/i);
    expect(rpc).toMatch(/set search_path to ''/i);
    expect(rpc).toMatch(/auth\.role\(\) is distinct from 'service_role'/i);
    expect(rpc).toMatch(
      /insert into public\.recommendation_experiment_assignments/i,
    );
    expect(rpc).toMatch(/assignment_hash !~ '\^\[0-9a-f\]\{16\}\$'/i);
    expect(rpc).toMatch(/assignment_unit not in \('user', 'request'\)/i);
    expect(rpc).toMatch(/bucket not in \('control', 'treatment'\)/i);
    // Raw assignment keys are never accepted by the RPC.
    expect(rpc).not.toMatch(/p_assignment_key/i);

    expect(migration).toMatch(
      /revoke all on function public\.register_recommendation_experiment_assignment\([^)]*\) from authenticated/i,
    );
    expect(migration).toMatch(
      /grant execute on function public\.register_recommendation_experiment_assignment\([^)]*\) to service_role/i,
    );
  });

  it("adds the indexes required for bounded exposure-to-feedback joins", () => {
    expect(migration).toMatch(
      /create index if not exists suggestion_exposure_log_experiment_join_idx/i,
    );
    expect(migration).toMatch(
      /\(\s*user_id\s*,\s*tmdb_id\s*,\s*exposed_at desc\s*\)/i,
    );
    expect(migration).toMatch(
      /create index if not exists suggestion_exposure_log_experiment_bucket_idx/i,
    );
    expect(migration).toMatch(
      /\(\s*experiment_bucket\s*,\s*experiment_config_version\s*\)/i,
    );
  });

  it("keeps owner RLS intact on the exposure table and notifies PostgREST", () => {
    // The browser owner-insert/select policies on suggestion_exposure_log are
    // untouched; only the server-owned registry table gets new policies.
    expect(migration).not.toMatch(
      /create policy "[^"]+"[^;]*on public\.suggestion_exposure_log/i,
    );
    expect(migration).not.toMatch(/drop policy/i);
    expect(migration).not.toMatch(/disable row level security/i);
    expect(migration).toMatch(/notify pgrst, ['"]reload schema['"]/i);
  });

  it("adds server-controlled feedback_event_at with a rerunnable created_at backfill", () => {
    // suggestion_feedback is unique per user/movie and created_at does not
    // advance on upsert, so the pure join needs a server-controlled event
    // time. Additive column only; no feedback column is dropped.
    expect(migration).toMatch(
      /alter table public\.suggestion_feedback\s+add column if not exists feedback_event_at timestamptz/i,
    );
    expect(migration).toMatch(
      /update public\.suggestion_feedback\s+set feedback_event_at = created_at\s+where feedback_event_at is null/i,
    );
    expect(migration).toMatch(
      /alter column feedback_event_at set default now\(\)/i,
    );
    expect(migration).toMatch(/alter column feedback_event_at set not null/i);
    expect(migration).not.toMatch(/drop column/i);
  });

  it("forces feedback_event_at on every feedback insert and update with an idempotent trigger", () => {
    expect(migration).toMatch(
      /create or replace function public\.enforce_feedback_event_at\(\)/i,
    );
    const triggerFunction =
      migration.match(
        /create or replace function public\.enforce_feedback_event_at\(\)[\s\S]*?\$body\$[\s\S]*?\$body\$/i,
      )?.[0] ?? "";

    expect(triggerFunction.length).toBeGreaterThan(0);
    expect(triggerFunction).toMatch(/new\.feedback_event_at := now\(\);/i);
    expect(triggerFunction).toMatch(/return new;/i);
    // Idempotent re-creation: drop-if-exists before create.
    expect(migration).toMatch(
      /drop trigger if exists suggestion_feedback_event_at_guard on public\.suggestion_feedback/i,
    );
    expect(migration).toMatch(
      /create trigger suggestion_feedback_event_at_guard\s+before insert or update on public\.suggestion_feedback/i,
    );
    expect(migration).toMatch(
      /execute function public\.enforce_feedback_event_at\(\)/i,
    );
    // Trigger execution requires EXECUTE for both writer roles.
    expect(migration).toMatch(
      /grant execute on function public\.enforce_feedback_event_at\(\) to authenticated/i,
    );
    expect(migration).toMatch(
      /grant execute on function public\.enforce_feedback_event_at\(\) to service_role/i,
    );
  });

  it("adds only the idempotent owner-scoped authenticated update policy to suggestion_feedback", () => {
    // Production feedback writes upsert on (user_id, tmdb_id); the DO UPDATE
    // arm requires an owner-scoped authenticated UPDATE policy in addition to
    // the existing select/insert/delete policies.
    expect(migration).toMatch(
      /create policy "suggestion_feedback_owner_update"\s+on public\.suggestion_feedback\s+for update\s+to authenticated\s+using \(\(select auth\.uid\(\)\) = user_id\)\s+with check \(\(select auth\.uid\(\)\) = user_id\);/i,
    );
    // Idempotent creation guarded by pg_policies, never drop-if-exists.
    expect(migration).toMatch(
      /tablename = 'suggestion_feedback'\s+and policyname = 'suggestion_feedback_owner_update'/i,
    );

    // Exactly one policy is created on suggestion_feedback: the update
    // policy. Every existing policy stays intact. The capture runs to the
    // end of the statement so the command and role stay assertable.
    const feedbackPolicies =
      migration.match(
        /create policy "[^"]+"[^;]*on public\.suggestion_feedback[^;]*/gi,
      ) ?? [];
    expect(feedbackPolicies).toHaveLength(1);
    expect(feedbackPolicies[0]).toMatch(/for update\s+to authenticated/i);
    expect(feedbackPolicies[0]).toMatch(
      /using \(\(select auth\.uid\(\)\) = user_id\)/i,
    );
    expect(feedbackPolicies[0]).toMatch(
      /with check \(\(select auth\.uid\(\)\) = user_id\)/i,
    );
    expect(migration).not.toMatch(
      /drop policy[^;]*on public\.suggestion_feedback/i,
    );
    expect(migration).not.toMatch(
      /alter table public\.suggestion_feedback[\s\S]{0,120}(enable|disable) row level security/i,
    );
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

  it("ships a structurally balanced pgTAP suite for the experiment contract", () => {
    const pgtapPath = fileURLToPath(
      new URL(
        "../../supabase/tests/database/recommendation_experiment.test.sql",
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
        /^\s*select\s+(?:ok|is|has_column|col_not_null|col_default_is|has_index|has_table|has_trigger|has_function_privilege|throws_ok)\(/gm,
      ) ?? [];
    expect(assertions.length).toBe(planned);

    // The suite covers the registry, the authenticated active-exposure
    // rejection, and the preserved browser default exposure path.
    expect(pgtap).toMatch(/recommendation_experiment_assignments/);
    expect(pgtap).toMatch(/register_recommendation_experiment_assignment/);
    expect(pgtap).toMatch(/authenticated direct active exposure insert is rejected/i);
    expect(pgtap).toMatch(/browser default exposure/i);

    // The suite covers the server-controlled feedback event time: static
    // column/default/trigger contract plus insert and update behavior probes.
    expect(pgtap).toMatch(/feedback_event_at/);
    expect(pgtap).toMatch(/suggestion_feedback_event_at_guard/);
    expect(pgtap).toMatch(/feedback insert forces feedback_event_at/i);
    expect(pgtap).toMatch(/feedback update forces feedback_event_at/i);

    // The suite covers the owner-scoped authenticated feedback update
    // policy: static contract plus owner conflicting-upsert and
    // cross-owner denial behavior.
    expect(pgtap).toMatch(/suggestion_feedback_owner_update/);
    expect(pgtap).toMatch(/owner conflicting upsert changes feedback_type/i);
    expect(pgtap).toMatch(
      /owner conflicting upsert forces the server-controlled feedback_event_at/i,
    );
    expect(pgtap).toMatch(/cross-owner feedback update is denied/i);

    const tagCounts = new Map<string, number>();
    for (const match of pgtap.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)\$/g)) {
      tagCounts.set(match[0], (tagCounts.get(match[0]) ?? 0) + 1);
    }
    for (const [tag, count] of tagCounts) {
      expect(count % 2, `dollar tag ${tag} unbalanced in pgTAP suite`).toBe(0);
    }
  });
});

describe("exposure prune function ACL remediation", () => {
  const migrationPath = fileURLToPath(
    new URL(
      "../../supabase/migrations/20260803130000_restrict_exposure_prune.sql",
      import.meta.url,
    ),
  );

  it("removes authenticated access from the privileged retention function", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).toMatch(
      /revoke all on function public\.prune_suggestion_exposures\(integer\) from public/i,
    );
    expect(migration).toMatch(
      /revoke all on function public\.prune_suggestion_exposures\(integer\) from anon/i,
    );
    expect(migration).toMatch(
      /revoke all on function public\.prune_suggestion_exposures\(integer\) from authenticated/i,
    );
    expect(migration).not.toMatch(/grant execute[^;]*to authenticated/i);
  });
});

describe("recommendation baseline protocol", () => {
  const baselinePath = fileURLToPath(
    new URL("../../docs/summary/recommendation-baseline.md", import.meta.url),
  );
  const baseline = readFileSync(baselinePath, "utf8");

  it("fixes the enrollment window, then 7-day maturation, with analysis only after maturation", () => {
    expect(baseline).toMatch(/enrollment window/i);
    expect(baseline).toMatch(/14 consecutive days/i);
    expect(baseline).toMatch(/7-day maturation/i);
    expect(baseline).toMatch(/after maturation/i);
    expect(baseline).toMatch(/no new assignments/i);
  });

  it("preregisters explicit numeric guardrail thresholds, not measured results", () => {
    expect(baseline).toMatch(/preregistered readiness defaults/i);
    expect(baseline).toMatch(/not measured results/i);
    // Conservative explicit numeric thresholds.
    expect(baseline).toMatch(/2 percentage points/i);
    expect(baseline).toMatch(/1 percentage point/i);
    expect(baseline).toMatch(/0\.5%/i);
    expect(baseline).toMatch(/1,000/);
  });

  it("fixes an explicit included-exposure cutoff at enrollment close", () => {
    expect(baseline).toMatch(/included-exposure cutoff/i);
    expect(baseline).toMatch(
      /only exposures recorded during the fixed\s+14-day enrollment window are included/i,
    );
    expect(baseline).toMatch(/already-assigned\s+traffic may continue its arm/i);
    expect(baseline).toMatch(/post-close\s+exposures are excluded/i);
    expect(baseline).toMatch(/maturation begins at enrollment close/i);
    expect(baseline).toMatch(/final included\s+exposure/i);
  });

  it("states 2C.2 prepares boundaries only and defers activation to Phase 3.1", () => {
    expect(baseline).toMatch(/does not activate/i);
    expect(baseline).toMatch(/control\/treatment traffic/i);
    expect(baseline).toMatch(/activation\/orchestration/i);
    expect(baseline).toMatch(/accepted treatment/i);
    expect(baseline).toMatch(/phase 3\.1/i);
    expect(baseline).toMatch(/claims no measured results/i);
  });
});
