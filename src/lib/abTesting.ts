/**
 * A/B Testing Infrastructure
 *
 * Enables controlled experiments on recommendation algorithm parameters:
 * - MMR lambda (diversity vs relevance tradeoff)
 * - Exploration rate (how often to show exploratory picks)
 * - Source reliability weights
 * - Quality gate thresholds
 *
 * Checkpoint 2C.2 adds the pure deterministic assignment boundary used for
 * online measurement readiness (`assignRecommendationExperiment`). It never
 * uses Math.random, never persists anything, and never returns raw
 * assignment/experiment keys.
 */

import { supabase } from './supabaseClient';
import {
  hashCanonicalRevision,
  stableCanonicalSerialize,
} from './recommendationRevision';
import {
  DEFAULT_EXPERIMENT_ASSIGNMENT,
  DEFAULT_EXPERIMENT_ASSIGNMENT_HASH,
  DEFAULT_EXPERIMENT_BUCKET,
  DEFAULT_EXPERIMENT_CONFIG_VERSION,
  RECOMMENDATION_EXPERIMENT_ASSIGNMENT_UNITS,
  RECOMMENDATION_EXPERIMENT_BUCKETS,
  validateExperimentTrafficSplit,
  type RecommendationExperimentAssignment,
  type RecommendationExperimentAssignmentUnit,
  type RecommendationExperimentBucket,
  type RecommendationExperimentTrafficSplit,
} from './recommendationTypes';

// ---------------------------------------------------------------------------
// Deterministic experiment assignment (checkpoint 2C.2).
// ---------------------------------------------------------------------------

/**
 * Hex digits of the assignment hash consumed to derive the [0, 1) assignment
 * interval: 13 hex digits = 52 bits, exactly representable as a double.
 */
export const EXPERIMENT_ASSIGNMENT_INTERVAL_HEX_DIGITS = 13;
export const EXPERIMENT_ASSIGNMENT_INTERVAL_SCALE = 2 ** 52;

const SAFE_EXPERIMENT_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const JWT_LIKE_STRING =
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * Active experiment config supplied to the assignment boundary. The config
 * version is ALWAYS derived internally from the canonical operative config -
 * experiment key, assignment unit, exact traffic split, and algorithm/config
 * `material` - through stableCanonicalSerialize/hashCanonicalRevision. Any
 * explicit config-version override in the input is ignored. `trafficSplit`
 * must cover exactly the controlled buckets with finite nonnegative weights
 * summing to 1 within the tight tolerance; derivation and assignment are
 * independent of split/material object key order. `material` must be bounded
 * JSON-like data (see the EXPERIMENT_MATERIAL_* bounds); malformed material
 * fails closed to the default assignment.
 */
export type RecommendationExperimentConfigInput = Readonly<{
  active?: boolean;
  material?: unknown;
  trafficSplit: unknown;
}>;

function isBoundedExperimentKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SAFE_EXPERIMENT_KEY.test(value) &&
    !JWT_LIKE_STRING.test(value)
  );
}

/**
 * Bounds applied to experiment-config `material` before canonicalization.
 * Material must be bounded JSON-like data: plain objects, arrays, booleans,
 * finite numbers, null/undefined, and bounded strings. Cycles, accessor
 * properties, throwing or descriptor-divergent property reads, non-JSON-like
 * values (functions, symbols, bigint, Date, non-finite numbers), and
 * structures beyond these limits fail closed to the default assignment; raw
 * material never appears in failed-closed output.
 */
export const EXPERIMENT_MATERIAL_MAX_DEPTH = 8;
export const EXPERIMENT_MATERIAL_MAX_NODES = 1024;
export const EXPERIMENT_MATERIAL_MAX_STRING_LENGTH = 512;

/** Sentinel returned when experiment material cannot be safely snapshotted. */
const EXPERIMENT_MATERIAL_INVALID: unique symbol = Symbol(
  "experiment-material-invalid",
);

const EXPERIMENT_INPUT_INVALID: unique symbol = Symbol(
  "experiment-input-invalid",
);

type StablePropertyRead =
  | Readonly<{ ok: true; present: boolean; value: unknown }>
  | Readonly<{ ok: false }>;

function readStableOwnDataProperty(
  object: object,
  key: PropertyKey,
): StablePropertyRead {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor) return { ok: true, present: false, value: undefined };
    if (isAccessorDescriptor(descriptor)) return { ok: false };
    return { ok: true, present: true, value: descriptor.value };
  } catch {
    return { ok: false };
  }
}

function isAccessorDescriptor(
  descriptor: PropertyDescriptor | undefined,
): boolean {
  return !!descriptor && ("get" in descriptor || "set" in descriptor);
}

/**
 * Builds the single safe snapshot of bounded JSON-like material that config
 * derivation hashes, so raw material is observed exactly once and can never
 * diverge during canonicalization. Own property descriptors are inspected
 * with guarded lookups and accessor properties are rejected without ever
 * evaluating a getter; each remaining property is read exactly once, must
 * match its reported descriptor value, and is snapshotted into a plain
 * object/array copy. Throwing descriptor/read traps, cycles, non-JSON-like
 * values, and structures beyond the bounds fail closed. Recursion never
 * exceeds EXPERIMENT_MATERIAL_MAX_DEPTH frames, so excessive nesting cannot
 * exhaust the validator's own stack. Ordinary bounded plain objects/arrays
 * snapshot to structurally identical copies, so derivation stays independent
 * of key insertion order.
 */
function snapshotBoundedJsonLikeMaterial(value: unknown): unknown {
  const activePath = new Set<object>();
  let nodes = 0;

  const snapshot = (current: unknown, depth: number): unknown => {
    nodes += 1;
    if (
      nodes > EXPERIMENT_MATERIAL_MAX_NODES ||
      depth > EXPERIMENT_MATERIAL_MAX_DEPTH
    ) {
      return EXPERIMENT_MATERIAL_INVALID;
    }

    if (current === null || current === undefined) return current;
    if (typeof current === "boolean") return current;
    if (typeof current === "number") {
      return Number.isFinite(current) ? current : EXPERIMENT_MATERIAL_INVALID;
    }
    if (typeof current === "string") {
      return current.length <= EXPERIMENT_MATERIAL_MAX_STRING_LENGTH
        ? current
        : EXPERIMENT_MATERIAL_INVALID;
    }
    if (typeof current !== "object") return EXPERIMENT_MATERIAL_INVALID;

    if (activePath.has(current)) return EXPERIMENT_MATERIAL_INVALID;
    activePath.add(current);

    try {
      if (Array.isArray(current)) {
      let length: number;
      try {
        length = current.length;
      } catch {
        return EXPERIMENT_MATERIAL_INVALID;
      }
      if (!Number.isSafeInteger(length) || length < 0) {
        return EXPERIMENT_MATERIAL_INVALID;
      }
      const items: unknown[] = new Array(length);
      for (let index = 0; index < length; index += 1) {
        let descriptor: PropertyDescriptor | undefined;
        try {
          descriptor = Object.getOwnPropertyDescriptor(current, index);
        } catch {
          return EXPERIMENT_MATERIAL_INVALID;
        }
        if (isAccessorDescriptor(descriptor)) return EXPERIMENT_MATERIAL_INVALID;
        let child: unknown;
        try {
          child = (current as unknown[])[index];
        } catch {
          return EXPERIMENT_MATERIAL_INVALID;
        }
        if (descriptor && !Object.is(descriptor.value, child)) {
          // The live read diverges from the reported descriptor value.
          return EXPERIMENT_MATERIAL_INVALID;
        }
        const snapshotted = snapshot(child, depth + 1);
        if (snapshotted === EXPERIMENT_MATERIAL_INVALID) {
          return EXPERIMENT_MATERIAL_INVALID;
        }
        // Only present indices are written, so array holes stay holes.
        if (descriptor) items[index] = snapshotted;
      }
        return items;
      }

    // Only plain JSON-like objects qualify: Date, Map, Set, class
    // instances, and every other exotic object fail closed.
    const prototype = Object.getPrototypeOf(current) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      return EXPERIMENT_MATERIAL_INVALID;
    }

    let keys: string[];
    try {
      keys = Object.keys(current);
    } catch {
      return EXPERIMENT_MATERIAL_INVALID;
    }

    const record = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(current, key);
      } catch {
        return EXPERIMENT_MATERIAL_INVALID;
      }
      if (isAccessorDescriptor(descriptor)) return EXPERIMENT_MATERIAL_INVALID;
      let child: unknown;
      try {
        child = (current as Record<string, unknown>)[key];
      } catch {
        return EXPERIMENT_MATERIAL_INVALID;
      }
      if (descriptor && !Object.is(descriptor.value, child)) {
        // The live read diverges from the reported descriptor value.
        return EXPERIMENT_MATERIAL_INVALID;
      }
      const snapshotted = snapshot(child, depth + 1);
      if (snapshotted === EXPERIMENT_MATERIAL_INVALID) {
        return EXPERIMENT_MATERIAL_INVALID;
      }
      Object.defineProperty(record, key, {
        configurable: true,
        enumerable: true,
        value: snapshotted,
        writable: true,
      });
    }
      return record;
    } finally {
      activePath.delete(current);
    }
  };

  return snapshot(value, 0);
}

type SnapshottedExperimentConfig = Readonly<{
  material: unknown;
  trafficSplit: RecommendationExperimentTrafficSplit;
}>;

function snapshotExperimentTrafficSplit(
  value: unknown,
): RecommendationExperimentTrafficSplit | typeof EXPERIMENT_INPUT_INVALID {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return EXPERIMENT_INPUT_INVALID;
  }

  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return EXPERIMENT_INPUT_INVALID;
    }
    const keys = Object.keys(value).sort();
    if (
      keys.length !== RECOMMENDATION_EXPERIMENT_BUCKETS.length ||
      keys.some((key, index) => key !== [...RECOMMENDATION_EXPERIMENT_BUCKETS].sort()[index])
    ) {
      return EXPERIMENT_INPUT_INVALID;
    }

    const weights: Record<RecommendationExperimentBucket, unknown> = {
      default: undefined,
      control: undefined,
      treatment: undefined,
    };
    for (const bucket of RECOMMENDATION_EXPERIMENT_BUCKETS) {
      const read = readStableOwnDataProperty(value, bucket);
      if (!read.ok || !read.present) return EXPERIMENT_INPUT_INVALID;
      weights[bucket] = read.value;
    }

    const snapshot = Object.freeze({
      default: weights.default,
      control: weights.control,
      treatment: weights.treatment,
    });
    return validateExperimentTrafficSplit(snapshot)
      ? snapshot
      : EXPERIMENT_INPUT_INVALID;
  } catch {
    return EXPERIMENT_INPUT_INVALID;
  }
}

function snapshotExperimentConfig(
  value: unknown,
): SnapshottedExperimentConfig | typeof EXPERIMENT_INPUT_INVALID {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return EXPERIMENT_INPUT_INVALID;
  }

  const active = readStableOwnDataProperty(value, "active");
  const split = readStableOwnDataProperty(value, "trafficSplit");
  const material = readStableOwnDataProperty(value, "material");
  if (!active.ok || !split.ok || !material.ok || !split.present) {
    return EXPERIMENT_INPUT_INVALID;
  }
  if (active.present && active.value === false) return EXPERIMENT_INPUT_INVALID;
  if (active.present && active.value !== undefined && active.value !== true) {
    return EXPERIMENT_INPUT_INVALID;
  }

  const trafficSplit = snapshotExperimentTrafficSplit(split.value);
  if (trafficSplit === EXPERIMENT_INPUT_INVALID) {
    return EXPERIMENT_INPUT_INVALID;
  }

  let materialSnapshot: unknown = null;
  if (material.present && material.value !== undefined) {
    materialSnapshot = snapshotBoundedJsonLikeMaterial(material.value);
    if (materialSnapshot === EXPERIMENT_MATERIAL_INVALID) {
      return EXPERIMENT_INPUT_INVALID;
    }
  }

  return Object.freeze({ material: materialSnapshot, trafficSplit });
}

function deriveConfigVersionFromSnapshot(input: {
  unit: RecommendationExperimentAssignmentUnit;
  experimentKey: string;
  config: SnapshottedExperimentConfig;
}): string {
  return hashCanonicalRevision(
    stableCanonicalSerialize({
      experimentKey: input.experimentKey,
      material: input.config.material,
      trafficSplit: input.config.trafficSplit,
      unit: input.unit,
    }),
  );
}

/**
 * Derive the bounded 16-char lowercase hex experiment config version from the
 * canonical operative config. Changing any operative field (experiment key,
 * assignment unit, any split weight, or material) changes the version; split
 * and material key insertion order never does. Material is observed exactly
 * once through a single safe snapshot, which is what gets canonicalized and
 * hashed, so no getter or unstable property is ever evaluated twice.
 * Malformed material (cycles, accessor properties, throwing or
 * descriptor-divergent reads, non-JSON-like values, excessive nesting/size)
 * and any canonicalization/hash failure fail closed to the zero config
 * version; raw material is never exposed.
 */
export function deriveRecommendationExperimentConfigVersion(input: {
  unit: RecommendationExperimentAssignmentUnit;
  experimentKey: string;
  trafficSplit: RecommendationExperimentTrafficSplit;
  material?: unknown;
}): string {
  try {
    const unit = readStableOwnDataProperty(input, "unit");
    const experimentKey = readStableOwnDataProperty(input, "experimentKey");
    const split = readStableOwnDataProperty(input, "trafficSplit");
    const material = readStableOwnDataProperty(input, "material");
    if (
      !unit.ok ||
      !unit.present ||
      !RECOMMENDATION_EXPERIMENT_ASSIGNMENT_UNITS.includes(
        unit.value as RecommendationExperimentAssignmentUnit,
      ) ||
      !experimentKey.ok ||
      !experimentKey.present ||
      !isBoundedExperimentKey(experimentKey.value) ||
      !split.ok ||
      !split.present ||
      !material.ok
    ) {
      return DEFAULT_EXPERIMENT_CONFIG_VERSION;
    }
    const config = snapshotExperimentConfig({
      active: true,
      material: material.present ? material.value : undefined,
      trafficSplit: split.value,
    });
    if (config === EXPERIMENT_INPUT_INVALID) {
      return DEFAULT_EXPERIMENT_CONFIG_VERSION;
    }
    return deriveConfigVersionFromSnapshot({
      unit: unit.value as RecommendationExperimentAssignmentUnit,
      experimentKey: experimentKey.value,
      config,
    });
  } catch {
    // Canonicalization/hash failure: fail closed without exposing raw input.
    return DEFAULT_EXPERIMENT_CONFIG_VERSION;
  }
}

/**
 * Pure deterministic experiment assignment boundary.
 *
 * Accepts the assignment unit (`user` or `request`), an opaque bounded
 * assignment key, a bounded experiment key, the algorithm/config material,
 * and an order-independent bounded traffic split over exactly the controlled
 * buckets. The config version is always derived internally from the
 * canonical operative config (experiment key, unit, exact split, material);
 * the assignment hash is the canonical hash of the unit plus both keys plus
 * the derived config version. Its first 13 hex digits divided by 2^52 yield
 * the [0, 1) interval walked against the cumulative split in canonical
 * bucket order.
 *
 * Returns only the bucket, config version, and assignment hash - never the
 * raw keys or material. Traffic landing on the default arm, and any invalid
 * unit/key/config/split/material, fails closed to the default assignment
 * (default bucket, zero config version, zero assignment hash). Malformed
 * material (cycles, accessor properties, throwing or descriptor-divergent
 * reads, non-JSON-like values, excessive nesting/size) and any
 * canonicalization/hash failure also fail closed; raw values are never
 * exposed. Never uses Math.random.
 */
export function assignRecommendationExperiment(input: {
  unit: unknown;
  assignmentKey: unknown;
  experimentKey: unknown;
  config?: RecommendationExperimentConfigInput | null;
}): RecommendationExperimentAssignment {
  try {
    const unit = readStableOwnDataProperty(input, "unit");
    const assignmentKey = readStableOwnDataProperty(input, "assignmentKey");
    const experimentKey = readStableOwnDataProperty(input, "experimentKey");
    const rawConfig = readStableOwnDataProperty(input, "config");
    if (
      !unit.ok ||
      !unit.present ||
      !RECOMMENDATION_EXPERIMENT_ASSIGNMENT_UNITS.includes(
        unit.value as RecommendationExperimentAssignmentUnit,
      ) ||
      !assignmentKey.ok ||
      !assignmentKey.present ||
      !isBoundedExperimentKey(assignmentKey.value) ||
      !experimentKey.ok ||
      !experimentKey.present ||
      !isBoundedExperimentKey(experimentKey.value) ||
      !rawConfig.ok ||
      !rawConfig.present
    ) {
      return DEFAULT_EXPERIMENT_ASSIGNMENT;
    }
    const config = snapshotExperimentConfig(rawConfig.value);
    if (config === EXPERIMENT_INPUT_INVALID) {
      return DEFAULT_EXPERIMENT_ASSIGNMENT;
    }

    const configVersion = deriveConfigVersionFromSnapshot({
      unit: unit.value as RecommendationExperimentAssignmentUnit,
      experimentKey: experimentKey.value,
      config,
    });
    if (configVersion === DEFAULT_EXPERIMENT_CONFIG_VERSION) {
      return DEFAULT_EXPERIMENT_ASSIGNMENT;
    }

    const assignmentHash = hashCanonicalRevision(
      stableCanonicalSerialize({
        assignmentKey: assignmentKey.value,
        configVersion,
        experimentKey: experimentKey.value,
        unit: unit.value,
      }),
    );
    if (assignmentHash === DEFAULT_EXPERIMENT_ASSIGNMENT_HASH) {
      return DEFAULT_EXPERIMENT_ASSIGNMENT;
    }

    const unitInterval =
      parseInt(
        assignmentHash.slice(0, EXPERIMENT_ASSIGNMENT_INTERVAL_HEX_DIGITS),
        16,
      ) / EXPERIMENT_ASSIGNMENT_INTERVAL_SCALE;

    let cumulative = 0;
    let selected: RecommendationExperimentBucket | null = null;
    let lastPositiveBucket: RecommendationExperimentBucket | null = null;
    for (const bucket of RECOMMENDATION_EXPERIMENT_BUCKETS) {
      const weight = config.trafficSplit[bucket];
      if (weight > 0) {
        lastPositiveBucket = bucket;
      }
      cumulative += weight;
      if (unitInterval < cumulative) {
        selected = bucket;
        break;
      }
    }

    const bucket = selected ?? lastPositiveBucket;
    // Holdout traffic and any float-edge residue stays on the default
    // assignment so the default bucket always pairs with the zero config
    // version.
    if (!bucket || bucket === DEFAULT_EXPERIMENT_BUCKET) {
      return DEFAULT_EXPERIMENT_ASSIGNMENT;
    }

    return { bucket, configVersion, assignmentHash };
  } catch {
    // Canonicalization/hash failure: fail closed without exposing raw input.
    return DEFAULT_EXPERIMENT_ASSIGNMENT;
  }
}

export type ABTestVariant = {
  name: string;
  params: {
    mmrLambda?: number;
    explorationRate?: number;
    sourceWeights?: Record<string, number>;
    qualityGateThreshold?: number;
    diversityTopK?: number;
    [key: string]: any;
  };
};

export type ABTestConfig = {
  id: number;
  testName: string;
  description?: string;
  status: 'draft' | 'running' | 'paused' | 'completed';
  startDate?: string;
  endDate?: string;
  variants: ABTestVariant[];
  trafficSplit: Record<string, number>;
  userCriteria?: {
    minFilmsRated?: number;
    genres?: string[];
    [key: string]: any;
  };
  primaryMetric: string;
  secondaryMetrics?: string[];
};

/**
 * Get active A/B tests
 */
export async function getActiveABTests(): Promise<ABTestConfig[]> {
  if (!supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('ab_test_configs')
      .select('*')
      .eq('status', 'running')
      .lte('start_date', new Date().toISOString())
      .or(`end_date.is.null,end_date.gte.${new Date().toISOString()}`);

    if (error) {
      console.error('[ABTest] Error fetching active tests:', error);
      return [];
    }

    return (data || []).map(row => ({
      id: row.id,
      testName: row.test_name,
      description: row.description,
      status: row.status,
      startDate: row.start_date,
      endDate: row.end_date,
      variants: row.variants || [],
      trafficSplit: row.traffic_split || {},
      userCriteria: row.user_criteria,
      primaryMetric: row.primary_metric,
      secondaryMetrics: row.secondary_metrics,
    }));
  } catch (e) {
    console.error('[ABTest] Exception fetching active tests:', e);
    return [];
  }
}

/**
 * Narrow assignment-store client seam used by getABTestVariant. The browser
 * Supabase client satisfies this shape structurally; tests inject fakes.
 */
export type ABTestAssignmentFilter = Readonly<{
  eq: (column: string, value: unknown) => ABTestAssignmentFilter;
  maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }>;
}>;

export type ABTestAssignmentClient = Readonly<{
  from: (table: string) => Readonly<{
    select: (columns: string) => ABTestAssignmentFilter;
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
  }>;
}>;

/**
 * Map a legacy A/B test traffic split onto the controlled buckets. Only
 * splits whose keys are a subset of the controlled buckets and that cover
 * both active arms map; anything else fails closed. The mapped split must
 * still satisfy the bounded sum validation.
 */
function toControlledExperimentTrafficSplit(
  trafficSplit: unknown,
): RecommendationExperimentTrafficSplit | null {
  if (
    typeof trafficSplit !== "object" ||
    trafficSplit === null ||
    Array.isArray(trafficSplit)
  ) {
    return null;
  }

  try {
    const prototype = Object.getPrototypeOf(trafficSplit);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Object.keys(trafficSplit);
    if (keys.length === 0) return null;
    for (const key of keys) {
      if (
        !RECOMMENDATION_EXPERIMENT_BUCKETS.includes(
          key as RecommendationExperimentBucket,
        )
      ) {
        return null;
      }
    }
    const defaultWeight = readStableOwnDataProperty(trafficSplit, "default");
    const controlWeight = readStableOwnDataProperty(trafficSplit, "control");
    const treatmentWeight = readStableOwnDataProperty(trafficSplit, "treatment");
    if (
      !defaultWeight.ok ||
      !controlWeight.ok ||
      !controlWeight.present ||
      !treatmentWeight.ok ||
      !treatmentWeight.present
    ) {
      return null;
    }

    const candidate = Object.freeze({
      default: defaultWeight.present ? defaultWeight.value : 0,
      control: controlWeight.value,
      treatment: treatmentWeight.value,
    });
    return validateExperimentTrafficSplit(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Get user's variant assignment for a test (or assign if not yet assigned).
 *
 * Assignment is fully deterministic: it is routed through
 * assignRecommendationExperiment using the testId/userId and the controlled
 * buckets, never Math.random. An already stored assignment always wins. On a
 * persistence failure or race the stored assignment is refetched and
 * returned; a losing local choice is never returned. Configs that cannot be
 * mapped onto the controlled buckets fail closed (no assignment).
 */
export async function getABTestVariant(params: {
  userId: string;
  testId: number;
  variants: ABTestVariant[];
  trafficSplit: Record<string, number>;
  client?: ABTestAssignmentClient | null;
}): Promise<ABTestVariant | null> {
  const { userId, testId, variants, trafficSplit } = params;
  const client: ABTestAssignmentClient | null | undefined =
    params.client ?? (supabase as unknown as ABTestAssignmentClient | undefined);
  if (!client) {
    return null;
  }

  if (typeof userId !== "string" || userId.trim().length === 0) return null;
  if (
    typeof testId !== "number" ||
    !Number.isSafeInteger(testId) ||
    testId <= 0
  ) {
    return null;
  }

  const readStoredVariantName = async (): Promise<
    { ok: boolean; variantName: string | null }
  > => {
    const { data, error } = await client
      .from("ab_test_assignments")
      .select("variant_name")
      .eq("test_id", testId)
      .eq("user_id", userId)
      .maybeSingle();
    if (
      error &&
      (error as { code?: string } | null)?.code !== "PGRST116"
    ) {
      console.error("[ABTest] Error fetching assignment:", error);
      return { ok: false, variantName: null };
    }
    const variantName =
      data &&
      typeof (data as { variant_name?: unknown }).variant_name === "string"
        ? (data as { variant_name: string }).variant_name
        : null;
    return { ok: true, variantName };
  };

  const resolveStoredVariant = (
    variantName: string | null,
  ): ABTestVariant | null => {
    if (variantName !== "control" && variantName !== "treatment") {
      return null;
    }
    return variants.find((variant) => variant.name === variantName) ?? null;
  };

  try {
    // A stored assignment always wins before current config validation. This
    // keeps enrollment stable when a split changes, becomes invalid, moves a
    // user into holdout, or removes the opposite arm.
    const stored = await readStoredVariantName();
    if (!stored.ok) return null;
    if (stored.variantName !== null) {
      return resolveStoredVariant(stored.variantName);
    }

    const controlledSplit = toControlledExperimentTrafficSplit(trafficSplit);
    if (!controlledSplit) return null;

    const controlVariant = variants.find((variant) => variant.name === "control");
    const treatmentVariant = variants.find(
      (variant) => variant.name === "treatment",
    );
    if (!controlVariant || !treatmentVariant) return null;

    const assignment = assignRecommendationExperiment({
      unit: "user",
      assignmentKey: userId,
      experimentKey: `ab-test-${testId}`,
      config: {
        active: true,
        material: {
          testId,
          trafficSplit: controlledSplit,
          variants: variants
            .map((variant) => ({
              name: variant.name,
              params: variant.params ?? null,
            }))
            .sort((left, right) => left.name.localeCompare(right.name)),
        },
        trafficSplit: controlledSplit,
      },
    });

    // Holdout traffic stays unassigned only when there was no stored winner.
    if (assignment.bucket === DEFAULT_EXPERIMENT_BUCKET) return null;
    const localVariant =
      assignment.bucket === "control" ? controlVariant : treatmentVariant;

    const { error: insertError } = await client
      .from("ab_test_assignments")
      .insert({
        test_id: testId,
        user_id: userId,
        variant_name: assignment.bucket,
      });

    if (!insertError) {
      console.log("[ABTest] Assigned user to variant:", {
        testId,
        userId: userId.slice(0, 8),
        variant: assignment.bucket,
      });
      return localVariant;
    }

    // Persistence failed (likely a race): refetch and return the winning
    // stored assignment. Never return the losing local choice.
    console.error("[ABTest] Error recording assignment:", insertError);
    const winner = await readStoredVariantName();
    if (!winner.ok || winner.variantName === null) return null;
    return resolveStoredVariant(winner.variantName);
  } catch (e) {
    console.error("[ABTest] Exception getting variant:", e);
    return null;
  }
}

/**
 * Record A/B test metric
 */
export async function recordABTestMetric(params: {
  userId: string;
  testId: number;
  variantName: string;
  metricName: string;
  metricValue: number;
  sessionData?: any;
}): Promise<void> {
  if (!supabase) {
    return;
  }

  const { userId, testId, variantName, metricName, metricValue, sessionData } = params;

  try {
    const { error } = await supabase
      .from('ab_test_metrics')
      .insert({
        test_id: testId,
        user_id: userId,
        variant_name: variantName,
        metric_name: metricName,
        metric_value: metricValue,
        session_data: sessionData,
      });

    if (error) {
      console.error('[ABTest] Error recording metric:', error);
    }
  } catch (e) {
    console.error('[ABTest] Exception recording metric:', e);
  }
}

/**
 * Welch's t-test for comparing two sample means with unequal variances
 * Returns t-statistic and approximate degrees of freedom
 */
function welchTTest(
  mean1: number, var1: number, n1: number,
  mean2: number, var2: number, n2: number
): { tStat: number; df: number } {
  const se1 = var1 / n1;
  const se2 = var2 / n2;
  const se = Math.sqrt(se1 + se2);

  if (se === 0) return { tStat: 0, df: 1 };

  const tStat = (mean1 - mean2) / se;

  // Welch-Satterthwaite degrees of freedom
  const num = Math.pow(se1 + se2, 2);
  const denom = Math.pow(se1, 2) / (n1 - 1) + Math.pow(se2, 2) / (n2 - 1);
  const df = denom === 0 ? 1 : num / denom;

  return { tStat, df };
}

/**
 * Approximate p-value from t-statistic using Student's t-distribution
 * Uses a numerical approximation suitable for two-tailed tests
 */
function tDistributionPValue(tStat: number, df: number): number {
  const x = df / (df + tStat * tStat);
  // Regularized incomplete beta function approximation
  // For large df, approaches normal distribution
  if (df > 100) {
    // Use normal approximation for large df
    const z = Math.abs(tStat);
    const p = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
    return 2 * (1 - normalCDF(Math.abs(tStat)));
  }

  // Simple approximation for smaller df
  const a = df / 2;
  const b = 0.5;
  // Beta function approximation
  const beta = Math.exp(lnGamma(a) + lnGamma(b) - lnGamma(a + b));
  const I = regularizedIncompleteBeta(x, a, b);
  return I;
}

function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

function lnGamma(x: number): number {
  // Lanczos approximation
  const g = 7;
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7
  ];

  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  }

  x -= 1;
  let a = c[0];
  for (let i = 1; i < g + 2; i++) {
    a += c[i] / (x + i);
  }
  const t = x + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  // Simple continued fraction approximation
  if (x === 0) return 0;
  if (x === 1) return 1;

  // Use symmetry for numerical stability
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedIncompleteBeta(1 - x, b, a);
  }

  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;

  // Continued fraction (Lentz's algorithm)
  let f = 1, c = 1, d = 0;
  for (let m = 0; m <= 100; m++) {
    const m2 = 2 * m;

    // Even step
    let an = (m === 0) ? 1 : (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + an * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    f *= d * c;

    // Odd step
    an = -((a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + an * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    f *= delta;

    if (Math.abs(delta - 1) < 1e-10) break;
  }

  return front * f;
}

export type StatisticalComparison = {
  controlVariant: string;
  testVariant: string;
  metric: string;
  controlMean: number;
  testMean: number;
  difference: number;
  percentChange: number;
  pValue: number;
  isSignificant: boolean; // p < 0.05
  confidenceInterval: { lower: number; upper: number };
};

/**
 * Get A/B test results for a specific test with statistical significance
 */
export async function getABTestResults(testId: number): Promise<{
  variants: Array<{
    name: string;
    userCount: number;
    metrics: Record<string, { mean: number; stddev: number; count: number }>;
  }>;
  comparisons: StatisticalComparison[];
}> {
  if (!supabase) {
    return { variants: [], comparisons: [] };
  }

  try {
    // Get all assignments for this test
    const { data: assignments, error: assignError } = await supabase
      .from('ab_test_assignments')
      .select('variant_name, user_id')
      .eq('test_id', testId);

    if (assignError) {
      console.error('[ABTest] Error fetching assignments:', assignError);
      return { variants: [], comparisons: [] };
    }

    // Get all metrics for this test
    const { data: metrics, error: metricsError } = await supabase
      .from('ab_test_metrics')
      .select('variant_name, metric_name, metric_value')
      .eq('test_id', testId);

    if (metricsError) {
      console.error('[ABTest] Error fetching metrics:', metricsError);
      return { variants: [], comparisons: [] };
    }

    // Aggregate by variant
    const variantStats = new Map<string, {
      userCount: number;
      metrics: Map<string, number[]>;
    }>();

    for (const assignment of (assignments || [])) {
      if (!variantStats.has(assignment.variant_name)) {
        variantStats.set(assignment.variant_name, {
          userCount: 0,
          metrics: new Map(),
        });
      }
      const stats = variantStats.get(assignment.variant_name)!;
      stats.userCount += 1;
    }

    for (const metric of (metrics || [])) {
      const stats = variantStats.get(metric.variant_name);
      if (!stats) continue;

      if (!stats.metrics.has(metric.metric_name)) {
        stats.metrics.set(metric.metric_name, []);
      }
      stats.metrics.get(metric.metric_name)!.push(metric.metric_value);
    }

    // Calculate mean and stddev for each metric
    const results = Array.from(variantStats.entries()).map(([name, stats]) => {
      const metricsObj: Record<string, { mean: number; stddev: number; count: number; variance: number }> = {};

      for (const [metricName, values] of stats.metrics.entries()) {
        const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
        const stddev = Math.sqrt(variance);

        metricsObj[metricName] = {
          mean,
          stddev,
          count: values.length,
          variance,
        };
      }

      return {
        name,
        userCount: stats.userCount,
        metrics: metricsObj,
      };
    });

    // Generate statistical comparisons between variants
    const comparisons: StatisticalComparison[] = [];

    // Find control variant (usually named 'control' or first variant)
    const controlVariant = results.find(v => v.name.toLowerCase() === 'control') || results[0];

    if (controlVariant && results.length > 1) {
      const testVariants = results.filter(v => v.name !== controlVariant.name);

      // Get all unique metric names
      const allMetricNames = new Set<string>();
      for (const variant of results) {
        for (const metricName of Object.keys(variant.metrics)) {
          allMetricNames.add(metricName);
        }
      }

      // Compare each test variant against control for each metric
      for (const testVariant of testVariants) {
        for (const metricName of allMetricNames) {
          const controlMetric = controlVariant.metrics[metricName];
          const testMetric = testVariant.metrics[metricName];

          if (!controlMetric || !testMetric || controlMetric.count < 2 || testMetric.count < 2) {
            continue; // Need at least 2 samples for t-test
          }

          const { tStat, df } = welchTTest(
            testMetric.mean, testMetric.variance, testMetric.count,
            controlMetric.mean, controlMetric.variance, controlMetric.count
          );

          const pValue = tDistributionPValue(tStat, df);
          const difference = testMetric.mean - controlMetric.mean;
          const percentChange = controlMetric.mean !== 0
            ? ((testMetric.mean - controlMetric.mean) / controlMetric.mean) * 100
            : 0;

          // 95% confidence interval for the difference
          const criticalValue = 1.96; // Approximation for large samples
          const se = Math.sqrt(testMetric.variance / testMetric.count + controlMetric.variance / controlMetric.count);
          const marginOfError = criticalValue * se;

          comparisons.push({
            controlVariant: controlVariant.name,
            testVariant: testVariant.name,
            metric: metricName,
            controlMean: controlMetric.mean,
            testMean: testMetric.mean,
            difference,
            percentChange,
            pValue,
            isSignificant: pValue < 0.05,
            confidenceInterval: {
              lower: difference - marginOfError,
              upper: difference + marginOfError,
            },
          });
        }
      }
    }

    return { variants: results, comparisons };
  } catch (e) {
    console.error('[ABTest] Exception getting test results:', e);
    return { variants: [], comparisons: [] };
  }
}

/**
 * Check if user meets criteria for a test
 */
export async function userMeetsCriteria(params: {
  userId: string;
  criteria?: {
    minFilmsRated?: number;
    genres?: string[];
    [key: string]: any;
  };
}): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  const { userId, criteria } = params;

  if (!criteria) {
    return true; // No criteria = everyone qualifies
  }

  try {
    // Check min films rated
    if (criteria.minFilmsRated !== undefined) {
      const { count, error } = await supabase
        .from('film_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (error) {
        console.error('[ABTest] Error checking film count:', error);
        return false;
      }

      if ((count || 0) < criteria.minFilmsRated) {
        return false;
      }
    }

    // Add more criteria checks as needed
    // e.g., check favorite genres, activity level, etc.

    return true;
  } catch (e) {
    console.error('[ABTest] Exception checking criteria:', e);
    return false;
  }
}
