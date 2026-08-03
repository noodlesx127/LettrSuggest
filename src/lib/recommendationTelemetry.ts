import type { FilterRelaxation } from "@/lib/advancedFiltering";
import { normalizeProviderFamily } from "@/lib/recommendationCandidates";
import type { RecommendationInputRevisionMaterial } from "@/lib/recommendationContext";
import {
  hashCanonicalRevision,
  stableCanonicalSerialize,
} from "@/lib/recommendationRevision";
import {
  DEFAULT_EXPERIMENT_BUCKET,
  DEFAULT_INPUT_REVISION_HASH,
  MAX_DIAGNOSTIC_COUNT,
  MAX_RECOMMENDATION_COUNT,
  MAX_TRACE_SOURCE_SHARE_KEYS,
  RECOMMENDATION_DROP_REASONS,
  RECOMMENDATION_ENGINE_VERSION,
  RECOMMENDATION_EXPERIMENT_BUCKETS,
  RECOMMENDATION_PROVIDER_FAMILIES,
  RECOMMENDATION_TRACE_RELAXATIONS,
  validateRecommendationTrace,
  type DropReason,
  type RecommendationEngineVersion,
  type RecommendationExperimentBucket,
  type RecommendationProviderFamily,
  type RecommendationResult,
  type RecommendationTrace,
  type RecommendationTraceRelaxation,
} from "@/lib/recommendationTypes";
import { supabase } from "@/lib/supabaseClient";

const INPUT_REVISION_PATTERN = /^[0-9a-f]{16}$/;

function isCanonicalProviderFamily(
  family: string,
): family is RecommendationProviderFamily {
  return RECOMMENDATION_PROVIDER_FAMILIES.includes(
    family as RecommendationProviderFamily,
  );
}

/**
 * Derive bounded per-family result shares from final canonical evidence.
 *
 * Shares are integer result counts keyed by normalized provider family. Keys
 * are normalized through the canonical provider-family seam, restricted to a
 * safe allowlisted charset, and capped to the top bounded cardinality so no
 * raw candidate evidence or unbounded user-controlled keys can leak.
 */
export function deriveSourceShares(
  results: readonly Readonly<{
    evidence: Readonly<{ providerFamilies: readonly string[] }>;
  }>[],
): Readonly<Record<string, number>> {
  const counts = new Map<string, number>();

  for (const result of results) {
    // Count each normalized canonical family at most once per result so
    // repeated provider evidence cannot inflate bounded shares. Unknown
    // regex-valid families (UUIDs, user IDs, API keys) are discarded.
    const familiesInResult = new Set<RecommendationProviderFamily>();
    for (const family of result.evidence.providerFamilies) {
      const normalized = normalizeProviderFamily(family).trim();
      if (isCanonicalProviderFamily(normalized)) {
        familiesInResult.add(normalized);
      }
    }
    for (const family of familiesInResult) {
      counts.set(family, (counts.get(family) ?? 0) + 1);
    }
  }

  const bounded = [...counts.entries()]
    .sort(
      (left, right) =>
        right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .slice(0, MAX_TRACE_SOURCE_SHARE_KEYS);

  return Object.fromEntries(
    bounded
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([family, count]) => [
        family,
        Math.min(Math.max(0, count), MAX_DIAGNOSTIC_COUNT),
      ]),
  );
}

/**
 * Hash recommendation input revision material into a bounded 16-char hex
 * revision. Returns the documented default when material is unavailable so the
 * trace always carries a bounded, deterministic revision string.
 */
export function hashInputRevision(
  material: RecommendationInputRevisionMaterial | null | undefined,
): string {
  if (!material) return DEFAULT_INPUT_REVISION_HASH;
  return hashCanonicalRevision(stableCanonicalSerialize(material));
}

/**
 * Normalize an experiment bucket into a bounded string with a clear default.
 * Rejects empty, oversized, and JWT-like values.
 */
export function normalizeExperimentBucket(
  value: unknown,
): RecommendationExperimentBucket {
  if (
    RECOMMENDATION_EXPERIMENT_BUCKETS.includes(
      value as RecommendationExperimentBucket,
    )
  ) {
    return value as RecommendationExperimentBucket;
  }
  return DEFAULT_EXPERIMENT_BUCKET;
}

/** Normalize a filter relaxation into the bounded trace allowlist. */
export function normalizeTraceRelaxation(
  value: unknown,
): RecommendationTraceRelaxation {
  if (
    value === "threshold" ||
    value === "genre" ||
    value === "none"
  ) {
    return value;
  }
  return RECOMMENDATION_TRACE_RELAXATIONS[0];
}

/**
 * Derive the relaxation actually applied from genre-filter applied stages.
 *
 * Reports the most permissive stage that fired: genre dominates threshold.
 * Returns "none" when strict filtering succeeded (no stage applied), so the
 * trace reflects applied behavior rather than merely requested relaxation.
 */
export function deriveAppliedRelaxation(
  appliedStages: readonly FilterRelaxation[],
): RecommendationTraceRelaxation {
  if (appliedStages.includes("genre")) return "genre";
  if (appliedStages.includes("threshold")) return "threshold";
  return "none";
}

export type RecommendationTraceInput = Readonly<{
  result: RecommendationResult;
  relaxation?: unknown;
  experimentBucket?: unknown;
  inputRevision?: string | null;
  inputRevisionMaterial?: RecommendationInputRevisionMaterial | null;
}>;

function resolveInputRevision(input: RecommendationTraceInput): string {
  if (
    typeof input.inputRevision === "string" &&
    INPUT_REVISION_PATTERN.test(input.inputRevision)
  ) {
    return input.inputRevision;
  }
  return hashInputRevision(input.inputRevisionMaterial ?? null);
}

/**
 * Build the canonical bounded request diagnostics trace. This is the single
 * allowlisted builder shared by the engine and both the v1 and web adapters so
 * they emit an identical diagnostic structure. Fails closed if the assembled
 * trace does not satisfy the bounded contract.
 */
export function buildRecommendationTrace(
  input: RecommendationTraceInput,
): RecommendationTrace {
  const diagnostics = input.result.diagnostics;
  const trace: RecommendationTrace = {
    engineVersion: diagnostics.engineVersion,
    mode: diagnostics.mode,
    contextMode: diagnostics.contextMode,
    inputHealth: diagnostics.inputHealth,
    failedSources: [...diagnostics.failedSources],
    requestSeedHash: diagnostics.requestSeedHash,
    seedCount: diagnostics.seedCount,
    candidateCount: diagnostics.candidateCount,
    resultCount: diagnostics.resultCount,
    stageCounts: { ...diagnostics.stageCounts },
    dropReasonCounts: { ...diagnostics.dropReasonCounts },
    sourceShares: deriveSourceShares(input.result.results),
    relaxation: normalizeTraceRelaxation(input.relaxation),
    experimentBucket: normalizeExperimentBucket(input.experimentBucket),
    inputRevision: resolveInputRevision(input),
  };

  if (!validateRecommendationTrace(trace)) {
    throw new Error("Invalid recommendation trace");
  }

  return trace;
}

/**
 * Exposure telemetry (checkpoint 2B.2).
 *
 * Persisted exposures carry only the bounded canonical trace fields required
 * for versioned online measurement: engine version, controlled experiment
 * bucket, hashed input revision, pre/post rank, bounded drop-reason counts,
 * and bounded source-family shares. Raw reasons, explanations, histories,
 * feedback, filters, credentials, and unbounded candidate arrays are never
 * persisted. Retention is bounded and enforced by the database
 * (`retention_until` default plus the privileged prune job).
 */

export const SUGGESTION_EXPOSURE_TABLE = "suggestion_exposure_log";
export const EXPOSURE_RETENTION_DAYS = 90;
export const MAX_EXPOSURE_RECORDS = MAX_RECOMMENDATION_COUNT;

const EXPOSURE_USER_ID_MAX_LENGTH = 64;
const MAX_EXPOSURE_RANK = 10_000;
const EXPOSURE_RECORD_KEYS = [
  "user_id",
  "tmdb_id",
  "engine_version",
  "experiment_bucket",
  "input_revision",
  "pre_rank",
  "post_rank",
  "drop_reason_counts",
  "source_shares",
] as const;

export type RecommendationExposureRecord = Readonly<{
  user_id: string;
  tmdb_id: number;
  engine_version: RecommendationEngineVersion;
  experiment_bucket: RecommendationExperimentBucket;
  input_revision: string;
  pre_rank: number;
  post_rank: number;
  drop_reason_counts: Readonly<Partial<Record<DropReason, number>>>;
  source_shares: Readonly<Record<string, number>>;
}>;

function isExposureRecordObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedRank(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_EXPOSURE_RANK
  );
}

function isBoundedExposureCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_DIAGNOSTIC_COUNT
  );
}

function isExposureDropReasonCounts(
  value: unknown,
): value is Readonly<Partial<Record<DropReason, number>>> {
  if (!isExposureRecordObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length > RECOMMENDATION_DROP_REASONS.length) return false;

  return keys.every(
    (key) =>
      RECOMMENDATION_DROP_REASONS.includes(key as DropReason) &&
      isBoundedExposureCount(value[key]),
  );
}

function isExposureSourceShares(
  value: unknown,
): value is Readonly<Record<string, number>> {
  if (!isExposureRecordObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length > MAX_TRACE_SOURCE_SHARE_KEYS) return false;

  return keys.every(
    (key) =>
      RECOMMENDATION_PROVIDER_FAMILIES.includes(
        key as RecommendationProviderFamily,
      ) && isBoundedExposureCount(value[key]),
  );
}

/**
 * Validate the exact bounded exposure row shape. Rejects extra fields, unsafe
 * identifiers, unallowlisted enums, unbounded ranks, and unbounded maps.
 */
export function validateRecommendationExposureRecord(
  value: unknown,
): value is RecommendationExposureRecord {
  if (!isExposureRecordObject(value)) return false;
  const keys = Object.keys(value);
  if (
    keys.length !== EXPOSURE_RECORD_KEYS.length ||
    !EXPOSURE_RECORD_KEYS.every((key) => Object.hasOwn(value, key))
  ) {
    return false;
  }

  return (
    typeof value.user_id === "string" &&
    value.user_id.trim().length > 0 &&
    value.user_id.length <= EXPOSURE_USER_ID_MAX_LENGTH &&
    typeof value.tmdb_id === "number" &&
    Number.isSafeInteger(value.tmdb_id) &&
    value.tmdb_id > 0 &&
    value.engine_version === RECOMMENDATION_ENGINE_VERSION &&
    RECOMMENDATION_EXPERIMENT_BUCKETS.includes(
      value.experiment_bucket as RecommendationExperimentBucket,
    ) &&
    typeof value.input_revision === "string" &&
    INPUT_REVISION_PATTERN.test(value.input_revision) &&
    isBoundedRank(value.pre_rank) &&
    isBoundedRank(value.post_rank) &&
    isExposureDropReasonCounts(value.drop_reason_counts) &&
    isExposureSourceShares(value.source_shares)
  );
}

export type RecommendationExposureBuildInput = Readonly<{
  userId: string;
  trace: RecommendationTrace;
  orderedTmdbIds: readonly number[];
  /**
   * Provider-family evidence keyed by result id. Only entries for valid,
   * deduplicated exposed ids are included in the batch source-share map.
   */
  providerFamiliesByTmdbId?: ReadonlyMap<number, readonly string[]>;
  /**
   * Optional pre-rerank rank (1-based) by TMDB id. Missing or unsafe entries
   * fall back to the post-rank, matching adapters without an active rerank.
   */
  preRanksById?: ReadonlyMap<number, number>;
  /**
   * Optional full committed-presentation post-rank (1-based) by TMDB id.
   * Missing or unsafe entries fall back to the rank within this exposure
   * batch, which keeps delta emissions bounded and backward compatible.
   */
  postRanksById?: ReadonlyMap<number, number>;
}>; 

/**
 * Build the bounded exposure rows for a final canonical output. One row per
 * exposed result in presentation order; fails closed on unsafe owners or
 * traces so invalid telemetry can never reach the writer.
 */
export function buildRecommendationExposureRecords(
  input: RecommendationExposureBuildInput,
): RecommendationExposureRecord[] {
  if (
    typeof input.userId !== "string" ||
    input.userId.trim().length === 0 ||
    input.userId.length > EXPOSURE_USER_ID_MAX_LENGTH
  ) {
    throw new Error("Invalid exposure owner");
  }
  if (!validateRecommendationTrace(input.trace)) {
    throw new Error("Invalid recommendation trace");
  }

  const userId = input.userId.trim();
  const seen = new Set<number>();
  const exposedTmdbIds: number[] = [];

  for (const tmdbId of input.orderedTmdbIds) {
    if (exposedTmdbIds.length >= MAX_EXPOSURE_RECORDS) break;
    if (
      typeof tmdbId !== "number" ||
      !Number.isSafeInteger(tmdbId) ||
      tmdbId <= 0 ||
      seen.has(tmdbId)
    ) {
      continue;
    }
    seen.add(tmdbId);
    exposedTmdbIds.push(tmdbId);
  }

  // Build one bounded source-share map from the exact ids that will produce
  // rows. Do not fall back to trace.sourceShares: that map covers every
  // canonical result rather than the exposed presentation subset.
  const exposedSourceShares = deriveSourceShares(
    exposedTmdbIds.map((tmdbId) => ({
      evidence: {
        providerFamilies:
          input.providerFamiliesByTmdbId?.get(tmdbId) ?? [],
      },
    })),
  );
  const records: RecommendationExposureRecord[] = [];

  for (const [index, tmdbId] of exposedTmdbIds.entries()) {
    const injectedPostRank = input.postRanksById?.get(tmdbId);
    const postRank = isBoundedRank(injectedPostRank)
      ? injectedPostRank
      : index + 1;
    const injectedPreRank = input.preRanksById?.get(tmdbId);
    const record: RecommendationExposureRecord = {
      user_id: userId,
      tmdb_id: tmdbId,
      engine_version: input.trace.engineVersion,
      experiment_bucket: input.trace.experimentBucket,
      input_revision: input.trace.inputRevision,
      pre_rank: isBoundedRank(injectedPreRank) ? injectedPreRank : postRank,
      post_rank: postRank,
      drop_reason_counts: { ...input.trace.dropReasonCounts },
      source_shares: { ...exposedSourceShares },
    };

    if (!validateRecommendationExposureRecord(record)) {
      throw new Error("Invalid recommendation exposure record");
    }
    records.push(record);
  }

  return records;
}

export type RecommendationExposureWriter = (
  records: readonly RecommendationExposureRecord[],
) => Promise<void>;

export type RecommendationExposureInsertClient = Readonly<{
  from: (
    table: string,
  ) => Readonly<{
    insert: (
      rows: RecommendationExposureRecord[],
    ) => PromiseLike<{ error: unknown }>;
  }>;
}>;

/**
 * Create the single Supabase exposure writer used by both production
 * adapters. A missing client degrades to a logged no-op so telemetry can
 * never block recommendation delivery.
 */
export function createSupabaseExposureWriter(
  client: RecommendationExposureInsertClient | null | undefined,
): RecommendationExposureWriter {
  return async (records) => {
    if (!client) {
      console.warn(
        "[RecommendationTelemetry] Supabase not available; skipping exposure writes",
      );
      return;
    }
    if (records.length === 0) return;

    const { error } = await client
      .from(SUGGESTION_EXPOSURE_TABLE)
      .insert(records.map((record) => ({ ...record })));
    if (error) {
      throw new Error("Exposure write failed");
    }
  };
}

/**
 * Resolve the insert client lazily inside the writer so client-construction
 * failures (for example missing service-role env) stay inside the sink's
 * fail-safe boundary instead of breaking the calling route.
 */
export function createLazyExposureWriter(
  getClient: () => RecommendationExposureInsertClient | null | undefined,
): RecommendationExposureWriter {
  return async (records) => {
    await createSupabaseExposureWriter(getClient())(records);
  };
}

export type RecommendationExposureSinkInput =
  RecommendationExposureBuildInput &
    Readonly<{
      /** Injected writer seam; defaults to the browser Supabase client. */
      writer?: RecommendationExposureWriter;
    }>;

/**
 * The single exposure telemetry sink. Both the web page and the v1 route
 * record final-output exposures through this function after generation so
 * one bounded schema is persisted for every adapter. Never throws: invalid
 * traces fail closed (nothing is written) and writer failures are logged.
 */
export async function recordRecommendationExposures(
  input: RecommendationExposureSinkInput,
): Promise<void> {
  try {
    const records = buildRecommendationExposureRecords(input);
    if (records.length === 0) return;

    const writer = input.writer ?? createSupabaseExposureWriter(supabase);
    await writer(records);
  } catch (error) {
    console.error("[RecommendationTelemetry] Exposure write skipped", {
      code: error instanceof Error ? error.name : "UNKNOWN_ERROR",
    });
  }
}

export type ExposureDiagnosticCounts = Readonly<
  Record<string, number | null | undefined>
>;

export type BoundedExposureDiagnostics = Readonly<{
  total_count: number;
  by_engine_version: Readonly<Record<string, number>>;
  by_experiment_bucket: Readonly<Record<string, number>>;
}>;

const EXPOSURE_ENGINE_VERSIONS: readonly RecommendationEngineVersion[] = [
  RECOMMENDATION_ENGINE_VERSION,
];

function boundExposureAggregateCount(
  value: number | null | undefined,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return 0;
  return Math.min(Math.max(0, value), MAX_DIAGNOSTIC_COUNT);
}

/**
 * Build bounded admin exposure aggregates. Only allowlisted engine versions
 * and experiment buckets can appear as keys; counts are clamped into the safe
 * diagnostic range. Raw rows, histories, reasons, and candidate arrays never
 * enter this shape.
 */
export function buildBoundedExposureDiagnostics(input: {
  totalCount: number | null | undefined;
  countsByEngineVersion: ExposureDiagnosticCounts;
  countsByExperimentBucket: ExposureDiagnosticCounts;
}): BoundedExposureDiagnostics {
  const byEngineVersion: Record<string, number> = {};
  for (const version of EXPOSURE_ENGINE_VERSIONS) {
    byEngineVersion[version] = boundExposureAggregateCount(
      input.countsByEngineVersion[version],
    );
  }

  const byExperimentBucket: Record<string, number> = {};
  for (const bucket of RECOMMENDATION_EXPERIMENT_BUCKETS) {
    byExperimentBucket[bucket] = boundExposureAggregateCount(
      input.countsByExperimentBucket[bucket],
    );
  }

  return {
    total_count: boundExposureAggregateCount(input.totalCount),
    by_engine_version: byEngineVersion,
    by_experiment_bucket: byExperimentBucket,
  };
}
