import type { WeightedSeed } from "@/lib/recommendationTypes";

export type RecommendationRng = () => number;

export const VECTOR_EMBEDDING_MODEL_VERSION = "text-embedding-ada-002";
export const VECTOR_EMBEDDING_DIMENSIONS = 1536;
export const VECTOR_SIMILARITY_CACHE_VERSION = "vector-similarity-v1";

export type VectorSimilarityResult = Readonly<{
  tmdbId: number;
  similarity: number;
}>;

export type VectorBackfillMarker = Readonly<{
  status: "pending" | "running" | "partial" | "failed" | "complete";
  modelVersion: string | null;
  dimensions: number | null;
  expectedCount: number;
  completedCount: number;
  failureCount: number;
}>;

export const VECTOR_CAPABILITY_CHECKS = [
  "model-version",
  "dimensions",
  "backfill",
  "similarity-scores",
  "rank-parity",
] as const;

export type VectorCapabilityCheck =
  (typeof VECTOR_CAPABILITY_CHECKS)[number];

export type VectorCapabilityInput = Readonly<{
  modelVersion?: string | null;
  dimensions?: number | null;
  backfill?: VectorBackfillMarker | null;
  cachedResults?: readonly VectorSimilarityResult[] | null;
  uncachedResults?: readonly VectorSimilarityResult[] | null;
}>;

export type VectorCapabilityRequirements = Readonly<{
  modelVersion: string;
  dimensions: number;
}>;

export type VectorCapabilityResult = Readonly<{
  capable: boolean;
  eligible: boolean;
  productionEnabled: false;
  activation: "disabled";
  checks: Readonly<Record<VectorCapabilityCheck, boolean>>;
  failedChecks: readonly VectorCapabilityCheck[];
}>;

export const DEFAULT_VECTOR_CAPABILITY_REQUIREMENTS: VectorCapabilityRequirements =
  {
    modelVersion: VECTOR_EMBEDDING_MODEL_VERSION,
    dimensions: VECTOR_EMBEDDING_DIMENSIONS,
  };

export type WeightedRecommendationSeed = WeightedSeed & {
  title?: string;
  imdbId?: string;
  intent?: string;
};

export type QuotaCandidate = Readonly<{
  tmdbId: number;
  source?: string;
  sources?: readonly string[];
  intent?: string;
  intents?: readonly string[];
  score?: number;
  retrievalScore?: number;
}>;

export type CandidateQuotaOptions = Readonly<{
  limit: number;
  sourceQuotas?: Readonly<Record<string, number>>;
  intentQuotas?: Readonly<Record<string, number>>;
}>;

export type CandidateEvidenceInput<TSource extends string = string> = Readonly<{
  tmdbId: number;
  title?: string;
  source: TSource;
  confidence: number;
  reason?: string;
}>;

export type MergedCandidateEvidence<TSource extends string = string> = {
  tmdbId: number;
  title: string;
  sources: Array<{
    source: TSource;
    confidence: number;
    reason?: string;
  }>;
  providerFamilies: string[];
  familyCount: number;
  providerOccurrences: number;
  repetitionsByFamily: Record<string, number>;
};

const MAX_CONSENSUS_BONUS = 0.25;
const MAX_REPETITION_BONUS = 0.05;
const MAX_BONUS_REPETITIONS = 3;

const REQUEST_SEED_HASH_OFFSET = 2166136261;
const REQUEST_SEED_HASH_PRIME = 16777619;

function hashRequestSeed(value: string): string {
  let hash = REQUEST_SEED_HASH_OFFSET;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, REQUEST_SEED_HASH_PRIME);
  }

  return (hash >>> 0).toString(16);
}

/**
 * Create the only random stream used by recommendation retrieval.
 *
 * The state is local to a request, so concurrent requests cannot influence
 * one another through ambient process randomness.
 */
export function createDeterministicRng(requestSeed: string): RecommendationRng {
  let state = REQUEST_SEED_HASH_OFFSET;

  for (let index = 0; index < requestSeed.length; index += 1) {
    state ^= requestSeed.charCodeAt(index);
    state = Math.imul(state, REQUEST_SEED_HASH_PRIME);
  }

  if (state === 0) state = 1;

  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

export const createRequestScopedRng = createDeterministicRng;

export function shuffleDeterministic<T>(
  items: readonly T[],
  rng: RecommendationRng,
): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const random = normalizedRandom(rng());
    const swapIndex = Math.floor(random * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }
  return shuffled;
}

/**
 * Derive a stable fallback request key when an older caller has not supplied
 * one yet. Seed IDs and weights, rather than input array order, define it.
 */
export function deriveCandidateRequestSeed(
  seeds: readonly Pick<WeightedRecommendationSeed, "tmdbId" | "weight">[],
): string {
  const canonicalSeeds = [...seeds]
    .filter(
      (seed) =>
        Number.isSafeInteger(seed.tmdbId) &&
        seed.tmdbId > 0 &&
        Number.isFinite(seed.weight) &&
        seed.weight > 0,
    )
    .map((seed) => ({ tmdbId: seed.tmdbId, weight: seed.weight }))
    .sort(
      (left, right) =>
        left.tmdbId - right.tmdbId || left.weight - right.weight,
    );

  return hashRequestSeed(JSON.stringify(canonicalSeeds));
}

function normalizedRandom(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return Number.MIN_VALUE;
  if (value >= 1) return 1 - Number.EPSILON;
  return value;
}

function isValidVectorSimilarityResult(
  result: VectorSimilarityResult,
): boolean {
  return (
    Number.isSafeInteger(result.tmdbId) &&
    result.tmdbId > 0 &&
    Number.isFinite(result.similarity)
  );
}

/**
 * Apply the one stable ordering used by both cached and uncached vector
 * results. Invalid rows are omitted here; capability evaluation checks them
 * explicitly so they cannot make a source eligible.
 */
export function rankVectorSimilarityResults(
  results: readonly VectorSimilarityResult[],
): VectorSimilarityResult[] {
  return results
    .filter(isValidVectorSimilarityResult)
    .sort(
      (left, right) =>
        right.similarity - left.similarity || left.tmdbId - right.tmdbId,
    );
}

function hasFinitePersistedScores(
  results: readonly VectorSimilarityResult[] | null | undefined,
): results is readonly VectorSimilarityResult[] {
  return (
    Array.isArray(results) &&
    results.length > 0 &&
    results.every(isValidVectorSimilarityResult)
  );
}

function hasExactRankParity(
  cachedResults: readonly VectorSimilarityResult[] | null | undefined,
  uncachedResults: readonly VectorSimilarityResult[] | null | undefined,
): boolean {
  if (!hasFinitePersistedScores(cachedResults) || !hasFinitePersistedScores(uncachedResults)) {
    return false;
  }

  const cachedRank = rankVectorSimilarityResults(cachedResults);
  const uncachedRank = rankVectorSimilarityResults(uncachedResults);

  return (
    cachedRank.length === uncachedRank.length &&
    cachedRank.every((result, index) => result.tmdbId === uncachedRank[index]?.tmdbId)
  );
}

function hasCompleteMatchingBackfill(
  marker: VectorBackfillMarker | null | undefined,
  requirements: VectorCapabilityRequirements,
): boolean {
  return (
    marker?.status === "complete" &&
    marker.modelVersion === requirements.modelVersion &&
    marker.dimensions === requirements.dimensions &&
    Number.isSafeInteger(marker.expectedCount) &&
    marker.expectedCount > 0 &&
    Number.isSafeInteger(marker.completedCount) &&
    marker.completedCount === marker.expectedCount &&
    Number.isSafeInteger(marker.failureCount) &&
    marker.failureCount === 0
  );
}

/**
 * Evaluate vector readiness without activating the source. The result is
 * intentionally deterministic and exposes every failed gate by name.
 */
export function evaluateVectorCapability(
  input: VectorCapabilityInput,
  requirements: VectorCapabilityRequirements =
    DEFAULT_VECTOR_CAPABILITY_REQUIREMENTS,
): VectorCapabilityResult {
  const checks: Record<VectorCapabilityCheck, boolean> = {
    "model-version":
      typeof input.modelVersion === "string" &&
      input.modelVersion === requirements.modelVersion,
    dimensions:
      Number.isSafeInteger(input.dimensions) &&
      input.dimensions === requirements.dimensions,
    backfill: hasCompleteMatchingBackfill(input.backfill, requirements),
    "similarity-scores": hasFinitePersistedScores(input.cachedResults),
    "rank-parity": hasExactRankParity(
      input.cachedResults,
      input.uncachedResults,
    ),
  };
  const failedChecks = VECTOR_CAPABILITY_CHECKS.filter(
    (check) => !checks[check],
  );
  const capable = failedChecks.length === 0;

  return {
    capable,
    eligible: capable,
    productionEnabled: false,
    activation: "disabled",
    checks,
    failedChecks,
  };
}

export function getProviderConsensusLevel(
  familyCount: number,
): "high" | "medium" | "low" {
  if (familyCount >= 4) return "high";
  if (familyCount >= 2) return "medium";
  return "low";
}

export function normalizeProviderFamily(source: string): string {
  const normalizedSource = source.trim();
  if (
    normalizedSource === "watchmode" ||
    normalizedSource === "watchmode-similar"
  ) {
    return "watchmode";
  }

  if (
    normalizedSource === "tmdb" ||
    normalizedSource.startsWith("similar:") ||
    normalizedSource === "trending-day" ||
    normalizedSource === "trending-week" ||
    normalizedSource === "discover-top-genres"
  ) {
    return "tmdb";
  }

  return normalizedSource;
}

export function normalizeProviderFamilies(
  sources: readonly string[],
): string[] {
  return [
    ...new Set(
      sources
        .map(normalizeProviderFamily)
        .filter((source) => source.length > 0),
    ),
  ].sort();
}

export function getProviderEvidenceBonus(
  familyCount: number,
  providerOccurrences: number,
  activeFamilyCount = 4,
): number {
  const normalizedFamilyCount = Math.max(0, Math.floor(familyCount));
  const normalizedOccurrences = Math.max(
    normalizedFamilyCount,
    Math.floor(providerOccurrences),
  );
  const repetitionCount = normalizedOccurrences - normalizedFamilyCount;
  const consensusBonus =
    Math.min(normalizedFamilyCount / Math.max(1, activeFamilyCount), 1) *
    MAX_CONSENSUS_BONUS;
  const repetitionBonus =
    (Math.min(repetitionCount, MAX_BONUS_REPETITIONS) /
      MAX_BONUS_REPETITIONS) *
    MAX_REPETITION_BONUS;

  return consensusBonus + repetitionBonus;
}

/**
 * Merge raw provider evidence without treating repeated results from one
 * provider family as independent agreement. Raw rows remain available for
 * attribution, while family and repetition signals are stored separately.
 */
export function mergeCandidateEvidence<TSource extends string>(
  candidates: readonly CandidateEvidenceInput<TSource>[],
  getProviderFamily: (source: TSource) => string,
): MergedCandidateEvidence<TSource>[] {
  const grouped = new Map<
    number,
    {
      titles: Set<string>;
      sources: MergedCandidateEvidence<TSource>["sources"];
      repetitionsByFamily: Map<string, number>;
    }
  >();

  for (const candidate of candidates) {
    if (!Number.isSafeInteger(candidate.tmdbId) || candidate.tmdbId <= 0) {
      continue;
    }

    const providerFamily = getProviderFamily(candidate.source).trim();
    if (!providerFamily) continue;

    const existing = grouped.get(candidate.tmdbId) ?? {
      titles: new Set<string>(),
      sources: [],
      repetitionsByFamily: new Map<string, number>(),
    };
    if (candidate.title?.trim()) existing.titles.add(candidate.title.trim());
    existing.sources.push({
      source: candidate.source,
      confidence: candidate.confidence,
      ...(candidate.reason === undefined ? {} : { reason: candidate.reason }),
    });
    existing.repetitionsByFamily.set(
      providerFamily,
      (existing.repetitionsByFamily.get(providerFamily) ?? 0) + 1,
    );
    grouped.set(candidate.tmdbId, existing);
  }

  return [...grouped.entries()]
    .map(([tmdbId, evidence]) => {
      const providerFamilies = [...evidence.repetitionsByFamily.keys()].sort();
      const repetitionsByFamily = Object.fromEntries(
        providerFamilies.map((family) => [
          family,
          evidence.repetitionsByFamily.get(family) ?? 0,
        ]),
      );
      const sources = [...evidence.sources].sort(
        (left, right) =>
          right.confidence - left.confidence ||
          left.source.localeCompare(right.source) ||
          (left.reason ?? "").localeCompare(right.reason ?? ""),
      );

      return {
        tmdbId,
        title: [...evidence.titles].sort()[0] ?? "",
        sources,
        providerFamilies,
        familyCount: providerFamilies.length,
        providerOccurrences: sources.length,
        repetitionsByFamily,
      };
    })
    .sort((left, right) => left.tmdbId - right.tmdbId);
}

function seedSourcePriority(source: WeightedRecommendationSeed["source"]): number {
  switch (source) {
    case "explicit":
      return 4;
    case "feedback":
      return 3;
    case "watchlist":
      return 2;
    case "history":
      return 1;
    default:
      return 0;
  }
}

/**
 * Select a deterministic weighted seed subset without losing the seed
 * objects. The weighted priority is a seeded weighted sample; equal priorities
 * always finish with ascending TMDB ID.
 */
export function selectWeightedSeeds<T extends WeightedRecommendationSeed>(
  seeds: readonly T[],
  limit: number,
  rng: RecommendationRng,
): T[] {
  if (limit <= 0) return [];

  const unique = new Map<number, T>();
  for (const seed of seeds) {
    if (
      !Number.isSafeInteger(seed.tmdbId) ||
      seed.tmdbId <= 0 ||
      !Number.isFinite(seed.weight) ||
      seed.weight <= 0
    ) {
      continue;
    }

    const existing = unique.get(seed.tmdbId);
    if (
      existing === undefined ||
      seed.weight > existing.weight ||
      (seed.weight === existing.weight &&
        seedSourcePriority(seed.source) > seedSourcePriority(existing.source))
    ) {
      unique.set(seed.tmdbId, seed);
    }
  }

  const ranked = [...unique.values()]
    .sort((left, right) => left.tmdbId - right.tmdbId)
    .map((seed) => {
      const random = normalizedRandom(rng());
      return {
        seed,
        priority: Math.pow(random, 1 / seed.weight),
      };
    })
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        right.seed.weight - left.seed.weight ||
        left.seed.tmdbId - right.seed.tmdbId,
    );

  return ranked.slice(0, limit).map(({ seed }) => seed);
}

function candidateScore(candidate: QuotaCandidate): number {
  const score = candidate.score ?? candidate.retrievalScore ?? 0;
  return Number.isFinite(score) ? score : Number.NEGATIVE_INFINITY;
}

function candidateSources(candidate: QuotaCandidate): readonly string[] {
  if (candidate.sources && candidate.sources.length > 0) {
    return candidate.sources;
  }
  return candidate.source ? [candidate.source] : [];
}

function candidateIntents(candidate: QuotaCandidate): readonly string[] {
  if (candidate.intents && candidate.intents.length > 0) {
    return candidate.intents;
  }
  return candidate.intent ? [candidate.intent] : [];
}

function compareQuotaCandidates(
  left: QuotaCandidate,
  right: QuotaCandidate,
): number {
  return (
    candidateScore(right) - candidateScore(left) ||
    candidateSources(right).length - candidateSources(left).length ||
    left.tmdbId - right.tmdbId
  );
}

/**
 * Deduplicate candidates without making incoming provider order meaningful.
 * Higher retrieval scores win; equal scores use the lower TMDB ID.
 */
export function stableDedupeCandidates<T extends QuotaCandidate>(
  candidates: readonly T[],
): T[] {
  const unique = new Map<number, T>();

  for (const candidate of candidates) {
    if (!Number.isSafeInteger(candidate.tmdbId) || candidate.tmdbId <= 0) {
      continue;
    }

    const existing = unique.get(candidate.tmdbId);
    if (existing === undefined || compareQuotaCandidates(candidate, existing) < 0) {
      unique.set(candidate.tmdbId, candidate);
    }
  }

  return [...unique.values()].sort(compareQuotaCandidates);
}

export function stableSortCandidates<T extends QuotaCandidate>(
  candidates: readonly T[],
): T[] {
  return [...candidates].sort(compareQuotaCandidates);
}

function canAddCandidate<T extends QuotaCandidate>(
  candidate: T,
  selected: readonly T[],
  sourceQuotas: Readonly<Record<string, number>>,
): boolean {
  const counts = new Map<string, number>();
  for (const selectedCandidate of selected) {
    for (const source of candidateSources(selectedCandidate)) {
      counts.set(source, (counts.get(source) ?? 0) + 1);
    }
  }

  const sources = candidateSources(candidate);
  if (sources.length === 0) return true;

  return sources.some((source) => {
    const quota = sourceQuotas[source];
    return quota === undefined || (counts.get(source) ?? 0) < quota;
  });
}

function addSelectedCandidate<T extends QuotaCandidate>(
  candidate: T,
  selected: T[],
  selectedIntents: Map<string, number>,
): void {
  selected.push(candidate);
  for (const intent of candidateIntents(candidate)) {
    selectedIntents.set(intent, (selectedIntents.get(intent) ?? 0) + 1);
  }
}

/**
 * Apply intent reservations and source caps before the global result window.
 * Reservations are selected first, then the final output is restored to the
 * deterministic retrieval order.
 */
export function applySourceIntentQuotas<T extends QuotaCandidate>(
  candidates: readonly T[],
  options: CandidateQuotaOptions,
): T[] {
  const limit = Math.max(0, Math.floor(options.limit));
  if (limit === 0) return [];

  const sourceQuotas = options.sourceQuotas ?? {};
  const intentQuotas = options.intentQuotas ?? {};
  const ranked = stableDedupeCandidates(candidates);
  const selected: T[] = [];
  const selectedIds = new Set<number>();
  const selectedIntents = new Map<string, number>();

  for (const intent of Object.keys(intentQuotas)) {
    const quota = Math.max(0, Math.floor(intentQuotas[intent] ?? 0));
    for (const candidate of ranked) {
      if (selected.length >= limit || selectedIntents.get(intent) === quota) {
        break;
      }
      if (
        selectedIds.has(candidate.tmdbId) ||
        !candidateIntents(candidate).includes(intent) ||
        !canAddCandidate(candidate, selected, sourceQuotas)
      ) {
        continue;
      }

      addSelectedCandidate(candidate, selected, selectedIntents);
      selectedIds.add(candidate.tmdbId);
    }
  }

  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    if (
      selectedIds.has(candidate.tmdbId) ||
      !canAddCandidate(candidate, selected, sourceQuotas)
    ) {
      continue;
    }

    addSelectedCandidate(candidate, selected, selectedIntents);
    selectedIds.add(candidate.tmdbId);
  }

  const selectedSet = new Set(selected.map((candidate) => candidate.tmdbId));
  return ranked
    .filter((candidate) => selectedSet.has(candidate.tmdbId))
    .slice(0, limit) as T[];
}

export const retainCandidatesByQuota = applySourceIntentQuotas;
export const retainCandidatesWithQuotas = applySourceIntentQuotas;
