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
  MAX_TRACE_SOURCE_SHARE_KEYS,
  RECOMMENDATION_EXPERIMENT_BUCKETS,
  RECOMMENDATION_PROVIDER_FAMILIES,
  RECOMMENDATION_TRACE_RELAXATIONS,
  validateRecommendationTrace,
  type RecommendationCandidate,
  type RecommendationExperimentBucket,
  type RecommendationProviderFamily,
  type RecommendationResult,
  type RecommendationTrace,
  type RecommendationTraceRelaxation,
} from "@/lib/recommendationTypes";

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
  results: readonly RecommendationCandidate[],
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
