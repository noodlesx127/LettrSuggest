import pLimit from "p-limit";

import {
  applySourceIntentQuotas,
  createDeterministicRng,
  mergeCandidateEvidence,
  normalizeProviderFamily,
  normalizeProviderFamilies,
  stableSortCandidates,
  type WeightedRecommendationSeed,
} from "@/lib/recommendationCandidates";
import { hasGenuineWatchEvidence } from "@/lib/recommendationNormalization";

export type ServerCandidateFilm = Readonly<{
  uri: string;
  rating: number | null;
  rewatch: boolean | null;
  last_date: string | null;
  watch_count: number | null;
  liked: boolean | null;
}>;

export type ServerCandidateUserContext = Readonly<{
  films: readonly ServerCandidateFilm[];
  mappings: ReadonlyMap<string, number>;
  blockedIds: ReadonlySet<number>;
}>;

export type ServerCandidateTasteProfile = Readonly<{
  topGenres: readonly Readonly<{ id: number }>[];
}>;

export type ServerSeedInput =
  | number
  | Readonly<{
      tmdbId: number;
      weight?: number;
      source?: WeightedRecommendationSeed["source"];
      intent?: string;
    }>;

export type ServerCandidateProviderRequest = Readonly<{
  path: string;
  params?: Record<string, string | number | undefined>;
  source: string;
  intent?: string;
}>;

export type ServerCandidateProviderRow = Readonly<{
  tmdbId: number;
  source?: string;
  intent?: string;
  title?: string;
  confidence?: number;
  reason?: string;
}>;

export type ServerCandidateProvider = (
  request: ServerCandidateProviderRequest,
) => Promise<readonly ServerCandidateProviderRow[]>;

export type SourceMetadataEntry = {
  sources: string[];
  consensusLevel: "high" | "medium" | "low";
  intents?: string[];
};

export type SourceMetadata = Map<number, SourceMetadataEntry>;

export type ServerCandidateRetrievalResult = Readonly<{
  candidateIds: number[];
  sourceMetadata: SourceMetadata;
  evidence: ReadonlyMap<
    number,
    Readonly<{
      familyCount: number;
      providerOccurrences: number;
      providerFamilies: readonly string[];
    }>
  >;
}>;

export type ServerCandidateRetrievalLimits = Readonly<{
  providerConcurrency?: number;
  maxHistorySeeds?: number;
  maxDiscoveryGenres?: number;
}>;

export type ServerCandidateRetrievalOptions = Readonly<{
  requestSeed?: string;
  /** Inject only the provider/network response boundary, never merged output. */
  providerRows?: ServerCandidateProvider;
  now?: () => number;
  limits?: ServerCandidateRetrievalLimits;
}>;

const DEFAULT_PROVIDER_CONCURRENCY = 5;
const DEFAULT_MAX_HISTORY_SEEDS = 12;
const DEFAULT_MAX_DISCOVERY_GENRES = 3;

/**
 * Fixed bounded code for primary per-seed retrieval failures. Error objects
 * can carry provider payloads, filesystem paths, or secrets, so only this
 * code and the numeric seed ID may be logged.
 */
export const RETRIEVAL_PRIMARY_ERROR_CODE = "RETRIEVAL_PRIMARY_ERROR" as const;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeNonNegativeLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;
}

function normalizePositiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback;
}

/**
 * Preserve the legacy source-metadata contract. Consensus is based on
 * normalized provider families, while the candidate order and raw source
 * metadata remain separate concerns.
 */
function getLegacyConsensusLevel(
  rawSources: readonly string[],
): "high" | "medium" | "low" {
  const familyCount = normalizeProviderFamilies(rawSources).length;
  if (familyCount >= 3) return "high";
  if (familyCount >= 2) return "medium";
  return "low";
}

function scoreSeedFilm(film: ServerCandidateFilm, now: number): number {
  const ratingScore = film.rating ?? 0;
  const likedBonus = film.liked ? 1.5 : 0;
  const rewatchBonus = film.rewatch ? 1.25 : 0;
  const watchCountBonus = Math.min((film.watch_count ?? 0) * 0.1, 0.5);

  let recencyBonus = 0;
  if (film.last_date) {
    const timestamp = new Date(film.last_date).getTime();
    if (!Number.isNaN(timestamp)) {
      const daysAgo = (now - timestamp) / (1000 * 60 * 60 * 24);
      if (daysAgo <= 90) recencyBonus = 0.5;
      else if (daysAgo <= 365) recencyBonus = 0.25;
    }
  }

  return (
    ratingScore + likedBonus + rewatchBonus + watchCountBonus + recencyBonus
  );
}

function parseFilmDate(value: string | null): number | null {
  if (!value) return null;

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function getWatchedTmdbIds(userContext: ServerCandidateUserContext): number[] {
  return userContext.films
    .filter((film) =>
      hasGenuineWatchEvidence({
        watchDate: film.last_date,
        rating: film.rating,
        liked: film.liked,
        rewatch: film.rewatch,
        watchCount: film.watch_count,
      }),
    )
    .map((film) => userContext.mappings.get(film.uri))
    .filter((tmdbId): tmdbId is number => isFiniteNumber(tmdbId));
}

function compareSeedFilms(
  left: ServerCandidateFilm,
  right: ServerCandidateFilm,
  mappings: ReadonlyMap<string, number>,
  now: number,
): number {
  const scoreDifference =
    scoreSeedFilm(right, now) - scoreSeedFilm(left, now);
  if (scoreDifference !== 0) return scoreDifference;

  const leftDate = parseFilmDate(left.last_date);
  const rightDate = parseFilmDate(right.last_date);
  if (leftDate !== rightDate) {
    if (leftDate === null) return 1;
    if (rightDate === null) return -1;
    return rightDate - leftDate;
  }

  const leftTmdbId = mappings.get(left.uri);
  const rightTmdbId = mappings.get(right.uri);
  if (leftTmdbId !== rightTmdbId) {
    if (leftTmdbId === undefined) return 1;
    if (rightTmdbId === undefined) return -1;
    return leftTmdbId - rightTmdbId;
  }

  return left.uri.localeCompare(right.uri);
}

function getTopSeedTmdbIds(
  userContext: ServerCandidateUserContext,
  limit: number,
  now: number,
): WeightedRecommendationSeed[] {
  const scoredFilms = [...userContext.films]
    .filter(
      (film) =>
        userContext.mappings.has(film.uri) &&
        ((film.rating ?? 0) >= 3.5 || film.liked || film.rewatch),
    )
    .sort((left, right) =>
      compareSeedFilms(left, right, userContext.mappings, now),
    );

  const scored: WeightedRecommendationSeed[] = [];
  for (const film of scoredFilms) {
    const tmdbId = userContext.mappings.get(film.uri);
    if (tmdbId === undefined) continue;
    scored.push({
      tmdbId,
      weight: Math.max(0.01, scoreSeedFilm(film, now)),
      source: "history",
    });
  }

  const seen = new Set<number>();
  return scored
    .filter((seed) => {
      if (seen.has(seed.tmdbId)) return false;
      seen.add(seed.tmdbId);
      return true;
    })
    .slice(0, limit);
}

/**
 * Execute the pure candidate retrieval/merge/selection pipeline.
 *
 * The provider callback is the only network boundary. It returns raw provider
 * rows; this function owns seed handling, exclusions, evidence merging,
 * ordering, and source quotas. Production supplies its TMDB adapter while the
 * offline evaluator supplies fixture responses.
 */
export async function retrieveServerCandidates(
  userId: string,
  userContext: ServerCandidateUserContext,
  tasteProfile: ServerCandidateTasteProfile,
  seedTmdbIds: readonly ServerSeedInput[] = [],
  options: ServerCandidateRetrievalOptions = {},
): Promise<ServerCandidateRetrievalResult> {
  const currentTime = options.now?.() ?? Date.now();
  console.log("[ServerEngine] generateServerCandidates", {
    userId,
    seedCount: seedTmdbIds.length,
  });

  const explicitSeedsById = new Map<number, WeightedRecommendationSeed>();
  for (const seed of seedTmdbIds) {
    const tmdbId = typeof seed === "number" ? seed : seed.tmdbId;
    if (!isFiniteNumber(tmdbId) || tmdbId <= 0) continue;

    const weightedSeed: WeightedRecommendationSeed =
      typeof seed === "number"
        ? { tmdbId, weight: 2, source: "explicit" }
        : {
            tmdbId,
            weight:
              typeof seed.weight === "number" && seed.weight > 0
                ? seed.weight
                : 2,
            source: seed.source ?? "explicit",
            ...(seed.intent ? { intent: seed.intent } : {}),
          };
    const existing = explicitSeedsById.get(tmdbId);
    if (existing === undefined || weightedSeed.weight > existing.weight) {
      explicitSeedsById.set(tmdbId, weightedSeed);
    }
  }

  const explicitSeeds = [...explicitSeedsById.values()].sort(
    (left, right) => left.tmdbId - right.tmdbId,
  );
  const explicitSeedTmdbIds = explicitSeeds.map((seed) => seed.tmdbId);
  const seenIds = new Set<number>([
    ...getWatchedTmdbIds(userContext),
    ...Array.from(userContext.blockedIds.values()),
    ...explicitSeedTmdbIds,
  ]);
  const random = createDeterministicRng(
    options.requestSeed ?? `${userId}:${explicitSeedTmdbIds.join(",")}`,
  );
  const providerRows = options.providerRows ?? (async () => []);
  const limits = options.limits;
  const providerLimit = pLimit(
    normalizePositiveLimit(
      limits?.providerConcurrency,
      DEFAULT_PROVIDER_CONCURRENCY,
    ),
  );

  const limitedProvider = (
    request: ServerCandidateProviderRequest,
  ): Promise<readonly ServerCandidateProviderRow[]> =>
    providerLimit(() => providerRows(request));

  const topSeedTmdbIds = getTopSeedTmdbIds(
    userContext,
    normalizeNonNegativeLimit(
      limits?.maxHistorySeeds,
      DEFAULT_MAX_HISTORY_SEEDS,
    ),
    currentTime,
  );
  const neighborhoodSeedsById = new Map<number, WeightedRecommendationSeed>();
  for (const seed of [...explicitSeeds, ...topSeedTmdbIds]) {
    if (!neighborhoodSeedsById.has(seed.tmdbId)) {
      neighborhoodSeedsById.set(seed.tmdbId, seed);
    }
  }
  const neighborhoodSeeds = [...neighborhoodSeedsById.values()];
  const discoverGenreIds = tasteProfile.topGenres
    .slice(
      0,
      normalizeNonNegativeLimit(
        limits?.maxDiscoveryGenres,
        DEFAULT_MAX_DISCOVERY_GENRES,
      ),
    )
    .map((genre) => genre.id);

  const requests: Array<Promise<readonly ServerCandidateProviderRow[]>> = [];
  const useDayTrending = random() > 0.5;
  const normalizeRows = (
    rows: readonly ServerCandidateProviderRow[],
    request: ServerCandidateProviderRequest,
  ): ServerCandidateProviderRow[] =>
    rows.map((row) => ({
      ...row,
      source: row.source?.trim() || request.source,
      ...(row.intent ?? request.intent
        ? { intent: row.intent ?? request.intent }
        : {}),
    }));

  const trendingRequest = (
    path: string,
    source: string,
  ): ServerCandidateProviderRequest => ({
    path,
    source,
    intent: "exploration",
  });

  const primaryTrendingRequest = trendingRequest(
    useDayTrending ? "/trending/movie/day" : "/trending/movie/week",
    useDayTrending ? "trending-day" : "trending-week",
  );
  requests.push(
    limitedProvider(primaryTrendingRequest)
      .then((rows) => normalizeRows(rows, primaryTrendingRequest))
      .catch((error) => {
        console.error("[ServerEngine] trending error:", error);
        return [];
      }),
  );

  if (topSeedTmdbIds.length < 4) {
    const alternateTrendingRequest = trendingRequest(
      useDayTrending ? "/trending/movie/week" : "/trending/movie/day",
      useDayTrending ? "trending-week" : "trending-day",
    );
    requests.push(
      limitedProvider(alternateTrendingRequest)
        .then((rows) => normalizeRows(rows, alternateTrendingRequest))
        .catch((error) => {
          console.error("[ServerEngine] trending alternate error:", error);
          return [];
        }),
    );
  }

  if (discoverGenreIds.length > 0) {
    requests.push(
      (() => {
        const params = {
          with_genres: discoverGenreIds.join("|"),
          include_adult: "false",
          sort_by: "vote_average.desc",
          "vote_count.gte": 200,
          page: String(Math.floor(random() * 5) + 1),
        } satisfies Record<string, string | number | undefined>;
        const request = {
          path: "/discover/movie",
          params,
          source: "discover-top-genres",
          intent: "exploration",
        } satisfies ServerCandidateProviderRequest;
        return limitedProvider(request)
          .then((rows) => normalizeRows(rows, request))
          .catch((error) => {
            console.error("[ServerEngine] discover error:", error);
            return [];
          });
      })(),
    );
  }

  for (const seed of neighborhoodSeeds) {
    const { tmdbId } = seed;
    const intent = seed.intent ?? seed.source ?? "history";
    const recommendationRequest = {
      path: `/movie/${tmdbId}/recommendations`,
      params: { page: 1 },
      source: `similar:${tmdbId}`,
      intent,
    } satisfies ServerCandidateProviderRequest;
    const similarRequest = {
      path: `/movie/${tmdbId}/similar`,
      params: { page: 1 },
      source: `similar:${tmdbId}`,
      intent,
    } satisfies ServerCandidateProviderRequest;
    requests.push(
      limitedProvider(recommendationRequest)
        .catch(() => {
          console.error("[ServerEngine] recommendations fetch failed", {
            code: RETRIEVAL_PRIMARY_ERROR_CODE,
            tmdbId,
          });
          return [];
        })
        .then(async (rows) => {
          // /recommendations returns fewer results for obscure films.
          // Fall back to /similar only when recommendations is empty.
          if (rows.length > 0) return normalizeRows(rows, recommendationRequest);

          const fallback = await limitedProvider(similarRequest).catch(() => []);
          return normalizeRows(fallback, similarRequest);
        })
        .catch(() => {
          console.error("[ServerEngine] recommendations fetch failed", {
            code: RETRIEVAL_PRIMARY_ERROR_CODE,
            tmdbId,
          });
          return [];
        }),
    );
  }

  const settled = await Promise.allSettled(requests);

  const providerEvidenceRows: ServerCandidateProviderRow[] = [];
  const rawSourcesByCandidate = new Map<number, Set<string>>();
  const intentsByCandidate = new Map<number, Set<string>>();
  for (const result of settled) {
    if (result.status === "rejected") {
      console.error("[ServerEngine] candidate source failed:", result.reason);
      continue;
    }

    for (const row of result.value) {
      if (!isFiniteNumber(row.tmdbId) || row.tmdbId <= 0) continue;
      if (seenIds.has(row.tmdbId) || userContext.blockedIds.has(row.tmdbId)) {
        continue;
      }

      providerEvidenceRows.push(row);
      const rawSources =
        rawSourcesByCandidate.get(row.tmdbId) ?? new Set<string>();
      rawSources.add(row.source ?? "unknown");
      rawSourcesByCandidate.set(row.tmdbId, rawSources);
      if (row.intent) {
        const intents = intentsByCandidate.get(row.tmdbId) ?? new Set<string>();
        intents.add(row.intent);
        intentsByCandidate.set(row.tmdbId, intents);
      }
    }
  }

  const mergedEvidence = mergeCandidateEvidence(
    providerEvidenceRows.map((row) => ({
      tmdbId: row.tmdbId,
      ...(row.title ? { title: row.title } : {}),
      source: row.source ?? "unknown",
      confidence:
        typeof row.confidence === "number" && Number.isFinite(row.confidence)
          ? row.confidence
          : 1,
      ...(row.reason ? { reason: row.reason } : {}),
    })),
    normalizeProviderFamily,
  );
  const sourceMetadata: SourceMetadata = new Map(
    [...rawSourcesByCandidate.entries()].map(([tmdbId, rawSources]) => {
      const sources = [...rawSources].sort();
      const intents = [...(intentsByCandidate.get(tmdbId) ?? [])].sort();
      return [
        tmdbId,
        {
          sources,
          consensusLevel: getLegacyConsensusLevel(sources),
          ...(intents.length > 0 ? { intents } : {}),
        },
      ];
    }),
  );
  const evidenceById = new Map(
    mergedEvidence.map((candidate) => [
      candidate.tmdbId,
      {
        familyCount: candidate.familyCount,
        providerOccurrences: candidate.providerOccurrences,
        providerFamilies: candidate.providerFamilies,
      },
    ]),
  );

  const orderedCandidates = stableSortCandidates(
    [...rawSourcesByCandidate.keys()].map((tmdbId) => {
      const sources = sourceMetadata.get(tmdbId)?.sources ?? [];
      return { tmdbId, score: sources.length, sources };
    }),
  ).map((candidate) => candidate.tmdbId);

  const SOURCE_CAPS: Record<string, number> = {
    "trending-day": 10,
    "trending-week": 10,
    "discover-top-genres": 15,
  };

  const intentQuotas: Record<string, number> = {};
  for (const tmdbId of orderedCandidates) {
    const intents = sourceMetadata.get(tmdbId)?.intents ?? [];
    for (const intent of intents) {
      if (intent === "explicit" || intent === "history" || intent === "watchlist") {
        intentQuotas[intent] = (intentQuotas[intent] ?? 0) + 1;
      }
    }
  }

  const cappedCandidateOrder = applySourceIntentQuotas(
    orderedCandidates.map((tmdbId) => {
      const metadata = sourceMetadata.get(tmdbId);
      return {
        tmdbId,
        score: metadata?.sources.length ?? 0,
        sources: metadata?.sources ?? [],
        intents: metadata?.intents ?? [],
      };
    }),
    {
      limit: orderedCandidates.length,
      sourceQuotas: SOURCE_CAPS,
      intentQuotas,
    },
  ).map((candidate) => candidate.tmdbId);

  console.log("[ServerEngine] source caps applied", {
    before: orderedCandidates.length,
    after: cappedCandidateOrder.length,
    dropped: orderedCandidates.length - cappedCandidateOrder.length,
  });

  return {
    candidateIds: cappedCandidateOrder,
    sourceMetadata,
    evidence: evidenceById,
  };
}
