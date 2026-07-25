export type DiversityDropReason =
  | "director"
  | "genre"
  | "decade"
  | "studio"
  | "actor";

export type RecommendationRerankingCandidate = Readonly<{
  tmdbId: number;
  score: number;
  genres?: readonly string[];
  directors?: readonly string[];
  studios?: readonly string[];
  actors?: readonly string[];
  release_date?: string;
  voteCount?: number;
  eligible?: boolean;
  eligibilityReason?: string;
}>;

export type DiversityLimits = Readonly<{
  maxSameDirector?: number;
  maxSameGenre?: number;
  maxSameDecade?: number;
  maxSameStudio?: number;
  maxSameActor?: number;
}>;

export type DiversityStage = Readonly<{
  name: string;
  limits: DiversityLimits;
}>;

export type RerankingStageDiagnostics = Readonly<{
  name: string;
  added: number;
  rejectedTmdbIds: readonly number[];
  dropReasons: readonly DiversityDropReason[];
}>;

export type RecommendationRerankingDiagnostics = Readonly<{
  eligibilityDrops: readonly Readonly<{ tmdbId: number; reason: string }>[];
  stages: readonly RerankingStageDiagnostics[];
  nicheTarget: number;
  nicheSelected: number;
}>;

export type RecommendationRerankingOptions = Readonly<{
  count: number;
  lambda?: number;
  nicheRatio?: number;
  nicheVoteCount?: number;
  diversityStages?: readonly DiversityStage[];
}>;

const DEFAULT_DIVERSITY_STAGES: readonly DiversityStage[] = [
  {
    name: "strict",
    limits: {
      maxSameDirector: 3,
      maxSameGenre: 5,
      maxSameDecade: 8,
      maxSameStudio: 4,
      maxSameActor: 4,
    },
  },
  {
    name: "relaxed",
    limits: {
      maxSameDirector: 5,
      maxSameGenre: 8,
      maxSameDecade: 12,
      maxSameStudio: 7,
      maxSameActor: 7,
    },
  },
];

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function calculateMmrScore(
  relevance: number,
  similarity: number,
  lambda: number,
): number {
  const boundedLambda = clamp(lambda, 0, 1);
  return boundedLambda * relevance - (1 - boundedLambda) * similarity;
}

export function lambdaFromExploration(exploration: number): number {
  const boundedExploration = clamp(exploration, 0, 1);
  return 0.7 - boundedExploration * 0.4;
}

const stringSet = (values?: readonly string[]) =>
  new Set((values ?? []).filter(Boolean));

const jaccard = (left: Set<string>, right: Set<string>) => {
  if (left.size === 0 && right.size === 0) return 0;
  let intersection = 0;
  left.forEach((value) => {
    if (right.has(value)) intersection += 1;
  });
  return intersection / (left.size + right.size - intersection);
};

const decade = (releaseDate?: string): number | null => {
  const year = Number.parseInt(releaseDate?.slice(0, 4) ?? "", 10);
  return Number.isFinite(year) ? Math.floor(year / 10) * 10 : null;
};

function similarity<T extends RecommendationRerankingCandidate>(
  left: T,
  right: T,
): number {
  const leftDecade = decade(left.release_date);
  const rightDecade = decade(right.release_date);
  return Math.min(
    1,
    jaccard(stringSet(left.genres), stringSet(right.genres)) * 0.4 +
      jaccard(stringSet(left.directors), stringSet(right.directors)) * 0.25 +
      jaccard(stringSet(left.actors), stringSet(right.actors)) * 0.2 +
      jaccard(stringSet(left.studios), stringSet(right.studios)) * 0.1 +
      (leftDecade !== null && leftDecade === rightDecade ? 0.05 : 0),
  );
}

function stableScoreOrder<T extends RecommendationRerankingCandidate>(
  candidates: readonly T[],
): T[] {
  return [...candidates].sort(
    (left, right) => right.score - left.score || left.tmdbId - right.tmdbId,
  );
}

function mmrOrder<T extends RecommendationRerankingCandidate>(
  candidates: readonly T[],
  lambda: number,
): T[] {
  const pool = stableScoreOrder(candidates);
  const selected: T[] = [];
  const topScore = Math.max(Math.abs(pool[0]?.score ?? 1), Number.EPSILON);

  while (pool.length > 0) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < pool.length; index += 1) {
      const item = pool[index];
      const maximumSimilarity =
        selected.length === 0
          ? 0
          : Math.max(...selected.map((picked) => similarity(picked, item)));
      const score = calculateMmrScore(
        item.score / topScore,
        maximumSimilarity,
        lambda,
      );
      const best = pool[bestIndex];
      if (
        score > bestScore ||
        (score === bestScore && item.tmdbId < best.tmdbId)
      ) {
        bestIndex = index;
        bestScore = score;
      }
    }
    selected.push(pool[bestIndex]);
    pool.splice(bestIndex, 1);
  }

  return selected;
}

function prioritizeNiche<T extends RecommendationRerankingCandidate>(
  candidates: readonly T[],
  count: number,
  nicheRatio: number,
  nicheVoteCount: number,
): { ordered: T[]; target: number } {
  const niche = candidates.filter(
    (candidate) => (candidate.voteCount ?? nicheVoteCount) < nicheVoteCount,
  );
  const target = Math.min(
    niche.length,
    count,
    Math.ceil(count * clamp(nicheRatio, 0, 1)),
  );
  if (target === 0) return { ordered: [...candidates], target };

  const requiredNicheIds = new Set(
    niche.slice(0, target).map((candidate) => candidate.tmdbId),
  );
  const preferredIds = new Set(requiredNicheIds);
  for (const candidate of candidates) {
    if (preferredIds.size < count) {
      preferredIds.add(candidate.tmdbId);
    }
  }

  return {
    ordered: [
      ...candidates.filter((candidate) => preferredIds.has(candidate.tmdbId)),
      ...candidates.filter((candidate) => !preferredIds.has(candidate.tmdbId)),
    ],
    target,
  };
}

type DiversityCounts = {
  directors: Map<string, number>;
  genres: Map<string, number>;
  decades: Map<number, number>;
  studios: Map<string, number>;
  actors: Map<string, number>;
};

const createCounts = (): DiversityCounts => ({
  directors: new Map(),
  genres: new Map(),
  decades: new Map(),
  studios: new Map(),
  actors: new Map(),
});

function diversityReasons<T extends RecommendationRerankingCandidate>(
  candidate: T,
  limits: DiversityLimits,
  counts: DiversityCounts,
): DiversityDropReason[] {
  const reasons: DiversityDropReason[] = [];
  if (
    candidate.directors?.some(
      (value) =>
        (counts.directors.get(value) ?? 0) >=
        (limits.maxSameDirector ?? Number.POSITIVE_INFINITY),
    )
  ) reasons.push("director");
  const primaryGenre = candidate.genres?.[0];
  if (
    primaryGenre &&
    (counts.genres.get(primaryGenre) ?? 0) >=
      (limits.maxSameGenre ?? Number.POSITIVE_INFINITY)
  ) reasons.push("genre");
  const candidateDecade = decade(candidate.release_date);
  if (
    candidateDecade !== null &&
    (counts.decades.get(candidateDecade) ?? 0) >=
      (limits.maxSameDecade ?? Number.POSITIVE_INFINITY)
  ) reasons.push("decade");
  if (
    candidate.studios?.some(
      (value) =>
        (counts.studios.get(value) ?? 0) >=
        (limits.maxSameStudio ?? Number.POSITIVE_INFINITY),
    )
  ) reasons.push("studio");
  if (
    candidate.actors?.slice(0, 2).some(
      (value) =>
        (counts.actors.get(value) ?? 0) >=
        (limits.maxSameActor ?? Number.POSITIVE_INFINITY),
    )
  ) reasons.push("actor");
  return reasons;
}

const increment = <T>(map: Map<T, number>, values: readonly T[]) => {
  values.forEach((value) => map.set(value, (map.get(value) ?? 0) + 1));
};

function recordSelection<T extends RecommendationRerankingCandidate>(
  candidate: T,
  counts: DiversityCounts,
) {
  increment(counts.directors, candidate.directors ?? []);
  increment(counts.genres, candidate.genres?.slice(0, 1) ?? []);
  const candidateDecade = decade(candidate.release_date);
  if (candidateDecade !== null) increment(counts.decades, [candidateDecade]);
  increment(counts.studios, candidate.studios ?? []);
  increment(counts.actors, candidate.actors?.slice(0, 2) ?? []);
}

export function rerankRecommendations<
  T extends RecommendationRerankingCandidate,
>(
  candidates: readonly T[],
  options: RecommendationRerankingOptions,
): Readonly<{
  candidates: readonly T[];
  diagnostics: RecommendationRerankingDiagnostics;
}> {
  const count = Math.max(0, Math.floor(options.count));
  const eligibilityDrops = candidates
    .filter((candidate) => candidate.eligible === false)
    .map((candidate) => ({
      tmdbId: candidate.tmdbId,
      reason: candidate.eligibilityReason || "ineligible",
    }));
  const eligible = candidates.filter((candidate) => candidate.eligible !== false);
  const reranked = mmrOrder(eligible, clamp(options.lambda ?? 0.65, 0, 1));
  const niche = prioritizeNiche(
    reranked,
    count,
    options.nicheRatio ?? 0.35,
    options.nicheVoteCount ?? 1_000,
  );
  const stages = options.diversityStages ?? DEFAULT_DIVERSITY_STAGES;
  const selected: T[] = [];
  const selectedIds = new Set<number>();
  const counts = createCounts();
  const stageDiagnostics: RerankingStageDiagnostics[] = [];

  for (const stage of stages) {
    const rejectedTmdbIds: number[] = [];
    const dropReasons = new Set<DiversityDropReason>();
    const before = selected.length;
    for (const candidate of niche.ordered) {
      if (selected.length >= count) break;
      if (selectedIds.has(candidate.tmdbId)) continue;
      const reasons = diversityReasons(candidate, stage.limits, counts);
      if (reasons.length > 0) {
        rejectedTmdbIds.push(candidate.tmdbId);
        reasons.forEach((reason) => dropReasons.add(reason));
        continue;
      }
      selected.push(candidate);
      selectedIds.add(candidate.tmdbId);
      recordSelection(candidate, counts);
    }
    stageDiagnostics.push({
      name: stage.name,
      added: selected.length - before,
      rejectedTmdbIds,
      dropReasons: [...dropReasons],
    });
  }

  const beforeBackfill = selected.length;
  for (const candidate of niche.ordered) {
    if (selected.length >= count) break;
    if (!selectedIds.has(candidate.tmdbId)) {
      selected.push(candidate);
      selectedIds.add(candidate.tmdbId);
    }
  }
  stageDiagnostics.push({
    name: "backfill",
    added: selected.length - beforeBackfill,
    rejectedTmdbIds: [],
    dropReasons: [],
  });

  const nicheSelected = selected.filter(
    (candidate) =>
      (candidate.voteCount ?? (options.nicheVoteCount ?? 1_000)) <
      (options.nicheVoteCount ?? 1_000),
  ).length;

  return {
    candidates: selected,
    diagnostics: {
      eligibilityDrops,
      stages: stageDiagnostics,
      nicheTarget: niche.target,
      nicheSelected,
    },
  };
}
