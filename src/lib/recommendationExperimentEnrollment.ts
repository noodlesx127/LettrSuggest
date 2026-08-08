import "server-only";

import { assignRecommendationExperiment } from "@/lib/abTesting";
import {
  hashCanonicalRevision,
  stableCanonicalSerialize,
} from "@/lib/recommendationRevision";
import {
  DEFAULT_EXPERIMENT_ASSIGNMENT,
  DEFAULT_EXPERIMENT_ASSIGNMENT_HASH,
  DEFAULT_EXPERIMENT_BUCKET,
  RECOMMENDATION_ENGINE_VERSION,
  validateRecommendationExperimentAssignment,
  type RecommendationExperimentAssignment,
  type RecommendationExperimentTrafficSplit,
} from "@/lib/recommendationTypes";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Checkpoint 3.1A frozen A/A enrollment boundary (server-only).
 *
 * Resolves the deterministic user-level experiment assignment for the frozen
 * `phase-3-1-canonical-aa-baseline-r1` run against the service-owned
 * enrollment control plane and assignment registry RPCs. Both arms run the
 * unchanged canonical engine with vector retrieval disabled; this module
 * never changes recommendation behavior itself.
 *
 * Fail-closed contract: every invalid input, missing client, read failure,
 * contract mismatch, malformed row, out-of-window state, or registry problem
 * returns DEFAULT_EXPERIMENT_ASSIGNMENT so recommendations remain unaffected.
 * Nothing is cached here. Logs are bounded to the `[RecommendationExperiment]`
 * prefix plus an allowlisted reason; raw user IDs, experiment keys, rows,
 * subject hashes, and thrown error text are never logged.
 */

// ---------------------------------------------------------------------------
// Frozen A/A contract constants. Compiled, not negotiated: any change requires
// a new run-specific experiment key and config version.
// ---------------------------------------------------------------------------

export const RECOMMENDATION_AA_EXPERIMENT_KEY =
  "phase-3-1-canonical-aa-baseline-r1" as const;

/**
 * Bounded 16-char lowercase hex config version derived from the frozen
 * operative config (experiment key, user unit, exact 0/0.5/0.5 split, and the
 * frozen arm material) via stableCanonicalSerialize/hashCanonicalRevision.
 */
export const RECOMMENDATION_AA_CONFIG_VERSION = "37ed98ccebd44c08" as const;

export const RECOMMENDATION_AA_ASSIGNMENT_UNIT = "user" as const;

export const RECOMMENDATION_AA_WINDOW_DAYS = 14 as const;

export const RECOMMENDATION_AA_TRAFFIC_SPLIT: RecommendationExperimentTrafficSplit =
  Object.freeze({ default: 0, control: 0.5, treatment: 0.5 });

/**
 * Frozen per-arm material. Both arms carry the identical canonical engine
 * version with vector retrieval disabled: this is an A/A baseline.
 */
export type RecommendationExperimentArmMaterial = Readonly<{
  engineVersion: typeof RECOMMENDATION_ENGINE_VERSION;
  vectorRetrieval: false;
}>;

export const RECOMMENDATION_AA_MATERIAL: Readonly<{
  control: RecommendationExperimentArmMaterial;
  treatment: RecommendationExperimentArmMaterial;
}> = Object.freeze({
  control: Object.freeze({
    engineVersion: RECOMMENDATION_ENGINE_VERSION,
    vectorRetrieval: false,
  }),
  treatment: Object.freeze({
    engineVersion: RECOMMENDATION_ENGINE_VERSION,
    vectorRetrieval: false,
  }),
});

// ---------------------------------------------------------------------------
// Bounded fallback logging.
// ---------------------------------------------------------------------------

export const RECOMMENDATION_EXPERIMENT_ENROLLMENT_FALLBACK_REASONS = [
  "invalid-user",
  "invalid-now",
  "client-unavailable",
  "active-enrollment-read-failed",
  "active-enrollment-invalid",
  "assignment-derivation-failed",
  "registry-read-failed",
  "registry-response-invalid",
  "unexpected-enrollment-failure",
] as const;

export type RecommendationExperimentEnrollmentFallbackReason =
  (typeof RECOMMENDATION_EXPERIMENT_ENROLLMENT_FALLBACK_REASONS)[number];

const ENROLLMENT_WARN_REASONS: ReadonlySet<RecommendationExperimentEnrollmentFallbackReason> =
  new Set(["invalid-user", "invalid-now", "client-unavailable"]);

function logEnrollmentFallback(
  reason: RecommendationExperimentEnrollmentFallbackReason,
): void {
  const message =
    "[RecommendationExperiment] Falling back to default experiment assignment";
  try {
    if (ENROLLMENT_WARN_REASONS.has(reason)) {
      console.warn(message, { reason });
    } else {
      console.error(message, { reason });
    }
  } catch {
    // Logging must never reject the resolver or break recommendations.
  }
}

// ---------------------------------------------------------------------------
// Client seam.
// ---------------------------------------------------------------------------

/**
 * Narrow RPC client seam used by the resolver. The service-role Supabase
 * client satisfies this shape structurally; tests inject fakes.
 */
export type RecommendationExperimentEnrollmentClient = Readonly<{
  rpc: (
    functionName: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
}>;

// ---------------------------------------------------------------------------
// Internal bounded contract.
// ---------------------------------------------------------------------------

/**
 * Conservative bounded wall-clock budget shared by every enrollment RPC. A
 * hung server dependency must never hold the recommendation request path:
 * each RPC is raced against this deadline, the timeout resolves null, and
 * the resolver fails closed to DEFAULT_EXPERIMENT_ASSIGNMENT with an
 * allowlisted reason.
 */
export const RECOMMENDATION_ENROLLMENT_RPC_TIMEOUT_MS = 2000;

const ACTIVE_ENROLLMENT_RPC =
  "get_active_recommendation_experiment_enrollment";
const RESOLVE_ASSIGNMENT_RPC = "resolve_recommendation_experiment_assignment";

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX_16_PATTERN = /^[0-9a-f]{16}$/;
const ENROLLMENT_WINDOW_MS =
  RECOMMENDATION_AA_WINDOW_DAYS * 24 * 60 * 60 * 1000;

const ACTIVE_ENROLLMENT_ROW_FIELDS = [
  "experiment_key",
  "config_version",
  "engine_version",
  "assignment_unit",
  "control_traffic",
  "treatment_traffic",
  "starts_at",
  "ends_at",
  "deactivated_at",
] as const;

const REGISTRY_ROW_FIELDS = [
  "assignment_hash",
  "config_version",
  "bucket",
] as const;

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_UUID_PATTERN.test(value);
}

function resolveNowMs(now: unknown): number | null {
  if (now === undefined) return Date.now();
  if (now instanceof Date) {
    const ms = now.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof now === "number") {
    return Number.isFinite(now) ? now : null;
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const own = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    own.length === expected.length &&
    own.every((key, index) => key === expected[index])
  );
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

function isFrozenHalfTraffic(value: unknown): boolean {
  // PostgREST normally serializes numeric as JSON number; the exact bounded
  // string form is accepted too. Every other representation fails closed.
  return value === 0.5 || value === "0.5";
}

function isControlledBucket(value: unknown): value is "control" | "treatment" {
  return value === "control" || value === "treatment";
}

type ActiveEnrollmentWindow = Readonly<{
  startsAtMs: number;
  endsAtMs: number;
}>;

/**
 * Validates one plain snake_case enrollment row against the exact frozen
 * contract: frozen key/config/engine/unit, exact 0.5/0.5 traffic, undeactivated,
 * parseable timestamps, and an exact 14-day window. Anything else fails closed.
 */
function parseActiveEnrollmentRow(row: unknown): ActiveEnrollmentWindow | null {
  if (!isPlainObject(row)) return null;
  if (!hasExactKeys(row, ACTIVE_ENROLLMENT_ROW_FIELDS)) return null;

  if (row.experiment_key !== RECOMMENDATION_AA_EXPERIMENT_KEY) return null;
  if (row.config_version !== RECOMMENDATION_AA_CONFIG_VERSION) return null;
  if (row.engine_version !== RECOMMENDATION_ENGINE_VERSION) return null;
  if (row.assignment_unit !== RECOMMENDATION_AA_ASSIGNMENT_UNIT) return null;
  if (!isFrozenHalfTraffic(row.control_traffic)) return null;
  if (!isFrozenHalfTraffic(row.treatment_traffic)) return null;
  if (row.deactivated_at !== null) return null;

  const startsAtMs = parseTimestampMs(row.starts_at);
  const endsAtMs = parseTimestampMs(row.ends_at);
  if (startsAtMs === null || endsAtMs === null) return null;
  if (endsAtMs - startsAtMs !== ENROLLMENT_WINDOW_MS) return null;

  return Object.freeze({ startsAtMs, endsAtMs });
}

/**
 * Validates one registry row and maps it only to the bounded assignment
 * triple. The stored bucket/hash may differ from the locally calculated
 * assignment and win; the config version must match the active frozen config
 * and the bucket must be a controlled arm.
 */
function parseRegistryRow(
  row: unknown,
): RecommendationExperimentAssignment | null {
  if (!isPlainObject(row)) return null;
  if (!hasExactKeys(row, REGISTRY_ROW_FIELDS)) return null;

  const assignmentHash = row.assignment_hash;
  const configVersion = row.config_version;
  const bucket = row.bucket;

  if (
    typeof assignmentHash !== "string" ||
    !HEX_16_PATTERN.test(assignmentHash) ||
    assignmentHash === DEFAULT_EXPERIMENT_ASSIGNMENT_HASH
  ) {
    return null;
  }
  if (configVersion !== RECOMMENDATION_AA_CONFIG_VERSION) return null;
  if (!isControlledBucket(bucket)) return null;

  return Object.freeze({
    bucket,
    configVersion: RECOMMENDATION_AA_CONFIG_VERSION,
    assignmentHash,
  });
}

/**
 * Bounded 16-char lowercase hex subject hash derived from the assignment unit
 * plus the authenticated user subject through the existing canonical hash
 * primitives. The raw user ID never crosses this boundary.
 */
function deriveExperimentSubjectHash(userId: string): string {
  return hashCanonicalRevision(
    stableCanonicalSerialize({
      assignmentUnit: RECOMMENDATION_AA_ASSIGNMENT_UNIT,
      subject: userId,
    }),
  );
}

/**
 * One bounded RPC attempt. The call is converted through Promise.resolve so
 * any synchronous throw or asynchronous rejection maps to null instead of
 * propagating, then raced against the fixed timeout budget; a timeout also
 * resolves null so the resolver fails closed. The timeout timer is always
 * cleared, and the attempt promise keeps its own catch so a late rejection
 * losing the race can never surface as an unhandled rejection.
 */
async function callEnrollmentRpc(
  client: RecommendationExperimentEnrollmentClient,
  functionName: string,
  args?: Record<string, unknown>,
): Promise<{ data: unknown; error: unknown } | null> {
  const attempt: Promise<{ data: unknown; error: unknown } | null> =
    Promise.resolve()
      .then(() => client.rpc(functionName, args))
      .then(
        (result): { data: unknown; error: unknown } | null =>
          result ? { data: result.data, error: result.error } : null,
      )
      .catch((): { data: unknown; error: unknown } | null => null);

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timeoutHandle = setTimeout(
      () => resolve(null),
      RECOMMENDATION_ENROLLMENT_RPC_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

// ---------------------------------------------------------------------------
// Resolver.
// ---------------------------------------------------------------------------

/**
 * Resolve the user-level experiment assignment for the frozen A/A run.
 *
 * Reads the service-owned active enrollment (exactly one valid row, exact
 * frozen contract, exact 14-day half-open `starts_at <= now < ends_at`
 * window), calculates the deterministic assignment with the frozen config via
 * assignRecommendationExperiment, then atomically resolves it through the
 * service-owned registry RPC using only the calculated assignment hash, the
 * canonical UUID, the `user` unit, the bounded subject hash, the frozen
 * engine/config, and the controlled bucket. A different valid stored
 * assignment returned by the registry wins.
 *
 * Every failure returns DEFAULT_EXPERIMENT_ASSIGNMENT with bounded
 * allowlisted logging; recommendations remain unaffected. No caching.
 */
export async function resolveRecommendationExperimentAssignment(input: {
  userId: string | null | undefined;
  client?: RecommendationExperimentEnrollmentClient | null;
  now?: Date;
}): Promise<RecommendationExperimentAssignment> {
  try {
    const userId = input.userId;
    if (!isCanonicalUuid(userId)) {
      logEnrollmentFallback("invalid-user");
      return DEFAULT_EXPERIMENT_ASSIGNMENT;
    }

    const nowMs = resolveNowMs(input.now);
    if (nowMs === null) {
      logEnrollmentFallback("invalid-now");
      return DEFAULT_EXPERIMENT_ASSIGNMENT;
    }

    let client: RecommendationExperimentEnrollmentClient;
    try {
      client = input.client ?? getSupabaseAdmin();
    } catch {
      logEnrollmentFallback("client-unavailable");
      return DEFAULT_EXPERIMENT_ASSIGNMENT;
    }

    // The read never carries an arm choice or any other argument.
    const activeRead = await callEnrollmentRpc(client, ACTIVE_ENROLLMENT_RPC);
    if (!activeRead || activeRead.error) {
      logEnrollmentFallback("active-enrollment-read-failed");
      return DEFAULT_EXPERIMENT_ASSIGNMENT;
    }

    const activeRows = activeRead.data;
    if (!Array.isArray(activeRows)) {
      logEnrollmentFallback("active-enrollment-invalid");
      return DEFAULT_EXPERIMENT_ASSIGNMENT;
    }
    if (activeRows.length === 0) {
      // No active enrollment: ordinary default traffic; not a failure state.
      return DEFAULT_EXPERIMENT_ASSIGNMENT;
    }
    if (activeRows.length !== 1) {
      logEnrollmentFallback("active-enrollment-invalid");
      return DEFAULT_EXPERIMENT_ASSIGNMENT;
    }

    const enrollmentWindow = parseActiveEnrollmentRow(activeRows[0]);
    if (!enrollmentWindow) {
      logEnrollmentFallback("active-enrollment-invalid");
      return DEFAULT_EXPERIMENT_ASSIGNMENT;
    }
    // Half-open interval: starts_at <= now < ends_at.
    if (
      nowMs < enrollmentWindow.startsAtMs ||
      nowMs >= enrollmentWindow.endsAtMs
    ) {
      logEnrollmentFallback("active-enrollment-invalid");
      return DEFAULT_EXPERIMENT_ASSIGNMENT;
    }

    const calculated = assignRecommendationExperiment({
      unit: RECOMMENDATION_AA_ASSIGNMENT_UNIT,
      assignmentKey: userId,
      experimentKey: RECOMMENDATION_AA_EXPERIMENT_KEY,
      config: {
        active: true,
        material: RECOMMENDATION_AA_MATERIAL,
        trafficSplit: RECOMMENDATION_AA_TRAFFIC_SPLIT,
      },
    });
    if (
      !validateRecommendationExperimentAssignment(calculated) ||
      calculated.bucket === DEFAULT_EXPERIMENT_BUCKET ||
      calculated.configVersion !== RECOMMENDATION_AA_CONFIG_VERSION
    ) {
      logEnrollmentFallback("assignment-derivation-failed");
      return DEFAULT_EXPERIMENT_ASSIGNMENT;
    }

    const subjectHash = deriveExperimentSubjectHash(userId);
    if (!HEX_16_PATTERN.test(subjectHash)) {
      logEnrollmentFallback("assignment-derivation-failed");
      return DEFAULT_EXPERIMENT_ASSIGNMENT;
    }

    const registryRead = await callEnrollmentRpc(
      client,
      RESOLVE_ASSIGNMENT_RPC,
      {
        p_assignment_hash: calculated.assignmentHash,
        p_user_id: userId,
        p_assignment_unit: RECOMMENDATION_AA_ASSIGNMENT_UNIT,
        p_subject_hash: subjectHash,
        p_engine_version: RECOMMENDATION_ENGINE_VERSION,
        p_config_version: RECOMMENDATION_AA_CONFIG_VERSION,
        p_bucket: calculated.bucket,
      },
    );
    if (!registryRead || registryRead.error) {
      logEnrollmentFallback("registry-read-failed");
      return DEFAULT_EXPERIMENT_ASSIGNMENT;
    }

    const registryRows = registryRead.data;
    if (!Array.isArray(registryRows) || registryRows.length !== 1) {
      logEnrollmentFallback("registry-response-invalid");
      return DEFAULT_EXPERIMENT_ASSIGNMENT;
    }

    const stored = parseRegistryRow(registryRows[0]);
    if (!stored) {
      logEnrollmentFallback("registry-response-invalid");
      return DEFAULT_EXPERIMENT_ASSIGNMENT;
    }

    return stored;
  } catch {
    // Enrollment resolution must never break recommendations.
    logEnrollmentFallback("unexpected-enrollment-failure");
    return DEFAULT_EXPERIMENT_ASSIGNMENT;
  }
}
