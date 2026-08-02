export const RECOMMENDATION_ENGINE_VERSION = "v1-canonical-1" as const;

export type RecommendationEngineVersion =
  typeof RECOMMENDATION_ENGINE_VERSION;

export const RECOMMENDATION_SOURCE_NAMES = [
  "films",
  "mappings",
  "feedback",
  "exploration",
  "adjacent_genres",
  "exposures",
  "blocked",
] as const;

export type RecommendationSourceName =
  (typeof RECOMMENDATION_SOURCE_NAMES)[number];

/**
 * Fixed canonical allowlist of normalized retrieval provider families that may
 * appear in bounded request diagnostics. Unknown values (including regex-valid
 * UUIDs, user IDs, or API-key-like strings) are discarded by trace builders.
 */
export const RECOMMENDATION_PROVIDER_FAMILIES = [
  "letterboxd",
  "tastedive",
  "tmdb",
  "tuimdb",
  "vector-similarity",
  "watchmode",
] as const;

export type RecommendationProviderFamily =
  (typeof RECOMMENDATION_PROVIDER_FAMILIES)[number];

/**
 * Controlled allowlist of experiment buckets emitted in bounded diagnostics.
 * Only canonical labels are permitted; arbitrary/API-key/user-like values are
 * normalized to the default. Stable assignment is checkpoint 2C.2.
 */
export const RECOMMENDATION_EXPERIMENT_BUCKETS = ["default"] as const;

export type RecommendationExperimentBucket =
  (typeof RECOMMENDATION_EXPERIMENT_BUCKETS)[number];

export const REQUIRED_RECOMMENDATION_SOURCES = [
  "films",
  "mappings",
  "blocked",
] as const satisfies readonly RecommendationSourceName[];

export type RecommendationContextMode =
  | "neutral"
  | "background"
  | "short"
  | "weeknight";

export type RecommendationContext = Readonly<{
  mode: RecommendationContextMode;
  localHour: number | null;
}>;

export const NEUTRAL_CONTEXT = Object.freeze({
  mode: "neutral",
  localHour: null,
} as const);

export type WeightedSeedSource =
  | "explicit"
  | "history"
  | "watchlist"
  | "feedback";

export type WeightedSeed = Readonly<{
  tmdbId: number;
  weight: number;
  source?: WeightedSeedSource;
}>;

export type RecommendationRequest = Readonly<{
  userId: string;
  count: number;
  seeds: readonly WeightedSeed[];
  excludeTmdbIds: readonly number[];
  genres: readonly string[];
  context: RecommendationContext;
  requestSeed: string;
}>;

export type RecommendationRequestInput = Omit<
  RecommendationRequest,
  "context" | "genres"
> & {
  context?: RecommendationContext | null;
  genres?: readonly string[];
};

export type SourceHealthState = "ok" | "empty" | "failed";

export type SourceHealth = Readonly<{
  health: SourceHealthState;
  rowCount: number;
}>;

export type RecommendationInputHealth = Readonly<
  Record<RecommendationSourceName, SourceHealth>
>;

export type CandidateEvidence = Readonly<{
  seedAnchors: readonly number[];
  providerFamilies: readonly string[];
  providerOccurrences: number;
  retrievalScore: number;
}>;

export type ScoreAttribution = Readonly<{
  retrieval: number;
  preference: number;
  context: number;
  diversity: number;
  total: number;
}>;

export const RECOMMENDATION_DROP_REASONS = [
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
] as const;

export type DropReason = (typeof RECOMMENDATION_DROP_REASONS)[number];

export type RecommendationEngineMode =
  | "personalized"
  | "cold_start"
  | "degraded";

export const RECOMMENDATION_STAGES = [
  "retrieval",
  "scoring",
  "reranking",
  "final",
] as const;

export type RecommendationStage = (typeof RECOMMENDATION_STAGES)[number];

export type RecommendationDiagnostics = Readonly<{
  mode: RecommendationEngineMode;
  engineVersion: RecommendationEngineVersion;
  contextMode: RecommendationContextMode;
  inputHealth: RecommendationInputHealth;
  failedSources: readonly RecommendationSourceName[];
  requestSeedHash: string;
  seedCount: number;
  candidateCount: number;
  resultCount: number;
  stageCounts: Readonly<Record<RecommendationStage, number>>;
  dropReasonCounts: Readonly<Partial<Record<DropReason, number>>>;
}>;

export const RECOMMENDATION_TRACE_RELAXATIONS = [
  "none",
  "threshold",
  "genre",
] as const;

export type RecommendationTraceRelaxation =
  (typeof RECOMMENDATION_TRACE_RELAXATIONS)[number];

/**
 * Bounded, allowlisted request diagnostics emitted identically through the v1
 * and web adapters. Extends the canonical engine diagnostics with bounded
 * source-family shares, relaxation, experiment bucket, and input revision.
 * Contains only fixed scalar fields plus bounded maps/enums; never raw film
 * lists, feedback text, JWTs, provider keys, or unbounded candidate arrays.
 */
export type RecommendationTrace = Readonly<{
  engineVersion: RecommendationEngineVersion;
  mode: RecommendationEngineMode;
  contextMode: RecommendationContextMode;
  inputHealth: RecommendationInputHealth;
  failedSources: readonly RecommendationSourceName[];
  requestSeedHash: string;
  seedCount: number;
  candidateCount: number;
  resultCount: number;
  stageCounts: Readonly<Record<RecommendationStage, number>>;
  dropReasonCounts: Readonly<Partial<Record<DropReason, number>>>;
  sourceShares: Readonly<Record<string, number>>;
  relaxation: RecommendationTraceRelaxation;
  experimentBucket: RecommendationExperimentBucket;
  inputRevision: string;
}>;

export type RecommendationCandidate = Readonly<{
  tmdbId: number;
  score: number;
  evidence: CandidateEvidence;
  attribution: ScoreAttribution;
  reasons?: readonly string[];
  explanation?: string;
}>;

export type RecommendationResult = Readonly<{
  results: readonly RecommendationCandidate[];
  diagnostics: RecommendationDiagnostics;
}>;

export const MAX_RECOMMENDATION_COUNT = 100;
export const MAX_DIAGNOSTIC_COUNT = 10_000;
export const MAX_DIAGNOSTIC_STRING_LENGTH = 128;
export const RECOMMENDATION_REQUEST_SEED_HASH_LENGTH = 16;
export const DEFAULT_EXPERIMENT_BUCKET = "default";
export const DEFAULT_INPUT_REVISION_HASH = "0000000000000000";
// Source share keys are restricted to the canonical provider-family allowlist,
// so the bounded map capacity equals that canonical capacity.
export const MAX_TRACE_SOURCE_SHARE_KEYS =
  RECOMMENDATION_PROVIDER_FAMILIES.length;

const RECOMMENDATION_CONTEXT_KEYS = ["mode", "localHour"] as const;
const SOURCE_HEALTH_KEYS = ["health", "rowCount"] as const;
const RECOMMENDATION_DIAGNOSTIC_KEYS = [
  "mode",
  "engineVersion",
  "contextMode",
  "inputHealth",
  "failedSources",
  "requestSeedHash",
  "seedCount",
  "candidateCount",
  "resultCount",
  "stageCounts",
  "dropReasonCounts",
] as const;
const RECOMMENDATION_TRACE_KEYS = [
  "engineVersion",
  "mode",
  "contextMode",
  "inputHealth",
  "failedSources",
  "requestSeedHash",
  "seedCount",
  "candidateCount",
  "resultCount",
  "stageCounts",
  "dropReasonCounts",
  "sourceShares",
  "relaxation",
  "experimentBucket",
  "inputRevision",
] as const;
const SAFE_REQUEST_SEED = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const JWT_LIKE_STRING =
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const LOWERCASE_HEX = /^[0-9a-f]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDenseArray<T>(
  value: unknown,
  predicate: (item: unknown) => item is T,
): value is T[] {
  if (!Array.isArray(value)) return false;

  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index) || !predicate(value[index])) return false;
  }

  return true;
}

function hasExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === allowedKeys.length &&
    allowedKeys.every((key) => Object.hasOwn(value, key))
  );
}

function isBoundedRequestSeed(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SAFE_REQUEST_SEED.test(value) &&
    !JWT_LIKE_STRING.test(value)
  );
}

function isRequestSeedHash(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === RECOMMENDATION_REQUEST_SEED_HASH_LENGTH &&
    LOWERCASE_HEX.test(value)
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isRecommendationSourceName(
  value: unknown,
): value is RecommendationSourceName {
  return RECOMMENDATION_SOURCE_NAMES.includes(value as RecommendationSourceName);
}

function isGenreName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_DIAGNOSTIC_STRING_LENGTH
  );
}

function isProviderFamily(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_DIAGNOSTIC_STRING_LENGTH
  );
}

function isBoundedCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_DIAGNOSTIC_COUNT
  );
}

function isContext(value: unknown): value is RecommendationContext {
  if (!isRecord(value) || !hasExactKeys(value, RECOMMENDATION_CONTEXT_KEYS)) {
    return false;
  }

  const validMode =
    value.mode === "neutral" ||
    value.mode === "background" ||
    value.mode === "short" ||
    value.mode === "weeknight";
  const validHour =
    value.localHour === null ||
    (typeof value.localHour === "number" &&
      Number.isInteger(value.localHour) &&
      value.localHour >= 0 &&
      value.localHour <= 23);

  return validMode && validHour;
}

function isWeightedSeed(value: unknown): value is WeightedSeed {
  if (!isRecord(value) || !isPositiveSafeInteger(value.tmdbId)) return false;
  if (
    typeof value.weight !== "number" ||
    !Number.isFinite(value.weight) ||
    value.weight <= 0
  ) {
    return false;
  }

  return (
    value.source === undefined ||
    value.source === "explicit" ||
    value.source === "history" ||
    value.source === "watchlist" ||
    value.source === "feedback"
  );
}

function isSourceHealth(value: unknown): value is SourceHealth {
  return (
    isRecord(value) &&
    hasExactKeys(value, SOURCE_HEALTH_KEYS) &&
    (value.health === "ok" ||
      value.health === "empty" ||
      value.health === "failed") &&
    isBoundedCount(value.rowCount)
  );
}

function isInputHealth(value: unknown): value is RecommendationInputHealth {
  if (!isRecord(value) || !hasExactKeys(value, RECOMMENDATION_SOURCE_NAMES)) {
    return false;
  }

  return RECOMMENDATION_SOURCE_NAMES.every((sourceName) =>
    isSourceHealth(value[sourceName]),
  );
}

function isFiniteScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasFailedRequiredSource(inputHealth: RecommendationInputHealth): boolean {
  return REQUIRED_RECOMMENDATION_SOURCES.some(
    (sourceName) => inputHealth[sourceName].health === "failed",
  );
}

function getFailedSourceNames(
  inputHealth: RecommendationInputHealth,
): RecommendationSourceName[] {
  return RECOMMENDATION_SOURCE_NAMES.filter(
    (sourceName) => inputHealth[sourceName].health === "failed",
  );
}

function hasSameSourceNames(
  actual: readonly RecommendationSourceName[],
  expected: readonly RecommendationSourceName[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((sourceName, index) => sourceName === expected[index])
  );
}

function isDiagnosticsModeConsistent(
  mode: RecommendationEngineMode,
  inputHealth: RecommendationInputHealth,
): boolean {
  if (hasFailedRequiredSource(inputHealth)) return mode === "degraded";

  // deriveRecommendationMode distinguishes personalized from cold_start using
  // evidence that is intentionally not present in bounded diagnostics.
  return mode === "personalized" || mode === "cold_start";
}

function isValidStageCounts(value: unknown): value is Readonly<
  Record<RecommendationStage, number>
> {
  if (!isRecord(value) || !hasExactKeys(value, RECOMMENDATION_STAGES)) {
    return false;
  }

  return RECOMMENDATION_STAGES.every((stage) => isBoundedCount(value[stage]));
}

function isValidDropReasonCounts(
  value: unknown,
): value is Readonly<Partial<Record<DropReason, number>>> {
  if (!isRecord(value)) return false;

  return Object.entries(value).every(
    ([reason, count]) =>
      RECOMMENDATION_DROP_REASONS.includes(reason as DropReason) &&
      isBoundedCount(count),
  );
}

function isValidCandidateEvidence(value: unknown): value is CandidateEvidence {
  if (
    !isRecord(value) ||
    !isDenseArray(value.seedAnchors, isPositiveSafeInteger) ||
    !isDenseArray(value.providerFamilies, isProviderFamily)
  ) {
    return false;
  }

  return (
    value.seedAnchors.length <= MAX_RECOMMENDATION_COUNT &&
    value.providerFamilies.length <= MAX_RECOMMENDATION_COUNT &&
    isBoundedCount(value.providerOccurrences) &&
    isFiniteScore(value.retrievalScore)
  );
}

function isValidAttribution(value: unknown): value is ScoreAttribution {
  if (!isRecord(value)) return false;

  return (
    isFiniteScore(value.retrieval) &&
    isFiniteScore(value.preference) &&
    isFiniteScore(value.context) &&
    isFiniteScore(value.diversity) &&
    isFiniteScore(value.total)
  );
}

function isValidCandidate(value: unknown): value is RecommendationCandidate {
  return (
    isRecord(value) &&
    isPositiveSafeInteger(value.tmdbId) &&
    isFiniteScore(value.score) &&
    isValidCandidateEvidence(value.evidence) &&
    isValidAttribution(value.attribution)
  );
}

export function validateRecommendationRequest(
  value: unknown,
): value is RecommendationRequest {
  if (!isRecord(value)) return false;
  if (typeof value.userId !== "string" || value.userId.trim().length === 0) {
    return false;
  }
  if (
    !isPositiveSafeInteger(value.count) ||
    value.count > MAX_RECOMMENDATION_COUNT ||
    !isBoundedRequestSeed(value.requestSeed)
  ) {
    return false;
  }
  if (!isDenseArray(value.seeds, isWeightedSeed)) {
    return false;
  }
  if (
    !isDenseArray(value.excludeTmdbIds, isPositiveSafeInteger) ||
    !isDenseArray(value.genres, isGenreName)
  ) {
    return false;
  }

  return isContext(value.context);
}

function validateRecommendationRequestInput(
  value: RecommendationRequestInput,
): boolean {
  if (!isRecord(value)) return false;

  const normalizedInput = {
    ...value,
    context: value.context ?? NEUTRAL_CONTEXT,
    genres: value.genres ?? [],
  };

  return validateRecommendationRequest(normalizedInput);
}

export function normalizeRecommendationRequest(
  input: RecommendationRequestInput,
): RecommendationRequest {
  if (!validateRecommendationRequestInput(input)) {
    throw new Error("Invalid recommendation request");
  }

  const seedById = new Map<number, WeightedSeed>();
  for (const seed of input.seeds) {
    const existing = seedById.get(seed.tmdbId);
    if (existing === undefined || seed.weight > existing.weight) {
      seedById.set(seed.tmdbId, seed);
    }
  }

  return {
    userId: input.userId.trim(),
    count: input.count,
    seeds: Array.from(seedById.values()),
    excludeTmdbIds: Array.from(new Set(input.excludeTmdbIds)).sort(
      (left, right) => left - right,
    ),
    genres: Array.from(
      new Set(input.genres?.map((genre) => genre.trim()).filter(Boolean)),
    ).sort(),
    context: input.context
      ? {
          mode: input.context.mode,
          localHour: input.context.localHour,
        }
      : NEUTRAL_CONTEXT,
    requestSeed: input.requestSeed.trim(),
  };
}

export function deriveRecommendationMode(input: {
  inputHealth: RecommendationInputHealth;
  hasPersonalizedEvidence: boolean;
}): RecommendationEngineMode {
  if (hasFailedRequiredSource(input.inputHealth)) return "degraded";
  return input.hasPersonalizedEvidence ? "personalized" : "cold_start";
}

export function validateRecommendationDiagnostics(
  value: unknown,
): value is RecommendationDiagnostics {
  if (!isRecord(value) || !hasExactKeys(value, RECOMMENDATION_DIAGNOSTIC_KEYS)) {
    return false;
  }
  if (
    value.mode !== "personalized" &&
    value.mode !== "cold_start" &&
    value.mode !== "degraded"
  ) {
    return false;
  }
  if (value.engineVersion !== RECOMMENDATION_ENGINE_VERSION) return false;
  if (!isContext({ mode: value.contextMode, localHour: null })) return false;
  const inputHealth = value.inputHealth;
  const failedSources = value.failedSources;
  if (
    !isInputHealth(inputHealth) ||
    !isDenseArray(failedSources, isRecommendationSourceName) ||
    failedSources.length > RECOMMENDATION_SOURCE_NAMES.length ||
    new Set(failedSources).size !== failedSources.length
  ) {
    return false;
  }
  if (!hasSameSourceNames(failedSources, getFailedSourceNames(inputHealth))) {
    return false;
  }
  if (
    !isRequestSeedHash(value.requestSeedHash) ||
    !isBoundedCount(value.seedCount) ||
    !isBoundedCount(value.candidateCount) ||
    !isBoundedCount(value.resultCount) ||
    !isValidStageCounts(value.stageCounts) ||
    !isValidDropReasonCounts(value.dropReasonCounts)
  ) {
    return false;
  }

  return isDiagnosticsModeConsistent(value.mode, inputHealth);
}

function isTraceSourceShares(
  value: unknown,
): value is Readonly<Record<string, number>> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length > MAX_TRACE_SOURCE_SHARE_KEYS) return false;

  return keys.every(
    (key) =>
      RECOMMENDATION_PROVIDER_FAMILIES.includes(
        key as RecommendationProviderFamily,
      ) && isBoundedCount(value[key]),
  );
}

function isTraceRelaxation(value: unknown): value is RecommendationTraceRelaxation {
  return RECOMMENDATION_TRACE_RELAXATIONS.includes(
    value as RecommendationTraceRelaxation,
  );
}

function isExperimentBucket(
  value: unknown,
): value is RecommendationExperimentBucket {
  return RECOMMENDATION_EXPERIMENT_BUCKETS.includes(
    value as RecommendationExperimentBucket,
  );
}

function isInputRevisionHash(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === RECOMMENDATION_REQUEST_SEED_HASH_LENGTH &&
    LOWERCASE_HEX.test(value)
  );
}

export function validateRecommendationTrace(
  value: unknown,
): value is RecommendationTrace {
  if (!isRecord(value) || !hasExactKeys(value, RECOMMENDATION_TRACE_KEYS)) {
    return false;
  }
  if (value.engineVersion !== RECOMMENDATION_ENGINE_VERSION) return false;
  if (
    value.mode !== "personalized" &&
    value.mode !== "cold_start" &&
    value.mode !== "degraded"
  ) {
    return false;
  }
  if (!isContext({ mode: value.contextMode, localHour: null })) return false;
  const inputHealth = value.inputHealth;
  const failedSources = value.failedSources;
  if (
    !isInputHealth(inputHealth) ||
    !isDenseArray(failedSources, isRecommendationSourceName) ||
    failedSources.length > RECOMMENDATION_SOURCE_NAMES.length ||
    new Set(failedSources).size !== failedSources.length
  ) {
    return false;
  }
  if (!hasSameSourceNames(failedSources, getFailedSourceNames(inputHealth))) {
    return false;
  }
  if (
    !isRequestSeedHash(value.requestSeedHash) ||
    !isBoundedCount(value.seedCount) ||
    !isBoundedCount(value.candidateCount) ||
    !isBoundedCount(value.resultCount) ||
    !isValidStageCounts(value.stageCounts) ||
    !isValidDropReasonCounts(value.dropReasonCounts) ||
    !isTraceSourceShares(value.sourceShares) ||
    !isTraceRelaxation(value.relaxation) ||
    !isExperimentBucket(value.experimentBucket) ||
    !isInputRevisionHash(value.inputRevision)
  ) {
    return false;
  }

  return isDiagnosticsModeConsistent(value.mode, inputHealth);
}

export function validateRecommendationResult(
  value: unknown,
  request: RecommendationRequest,
): value is RecommendationResult {
  if (!validateRecommendationRequest(request)) return false;
  if (!isRecord(value)) return false;
  const results = value.results;
  if (
    !isDenseArray(results, isValidCandidate) ||
    results.length > MAX_RECOMMENDATION_COUNT ||
    !validateRecommendationDiagnostics(value.diagnostics)
  ) {
    return false;
  }

  const ids = results.map((candidate) => candidate.tmdbId);
  if (new Set(ids).size !== ids.length) return false;
  if (value.diagnostics.resultCount !== results.length) return false;

  const excludedIds = new Set([
    ...request.seeds.map((seed) => seed.tmdbId),
    ...request.excludeTmdbIds,
  ]);
  if (ids.some((id) => excludedIds.has(id))) return false;
  if (results.length > request.count) return false;

  return true;
}
