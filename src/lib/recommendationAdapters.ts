import type { FilterRelaxation } from "@/lib/advancedFiltering";
import type {
  RecommendationRequest,
  RecommendationResult,
} from "@/lib/recommendationTypes";

export type V1RecommendationIntent = Readonly<{
  userId: string;
  seedTmdbIds: readonly number[];
  limit: number;
  excludeTmdbIds: readonly number[];
  genreIds?: readonly number[];
  genreNames?: readonly string[];
  filterRelaxation?: FilterRelaxation;
  debug: boolean;
  requestSeed: string;
}>;

export type V1RecommendationAdapterOptions = Readonly<{
  genreIds?: readonly number[];
  filterRelaxation?: FilterRelaxation;
  debug: boolean;
}>;

export type V1RecommendationDetails = Readonly<{
  title?: string;
  consensusLevel?: "high" | "medium" | "low";
  sources?: readonly string[];
  reasons?: readonly string[];
  genres?: readonly string[];
  releaseDate?: string;
  posterPath?: string | null;
  voteCategory?: "hidden-gem" | "crowd-pleaser" | "cult-classic" | "standard";
}>;

export function adaptV1RecommendationIntent(
  intent: V1RecommendationIntent,
): Readonly<{
  request: RecommendationRequest;
  options: V1RecommendationAdapterOptions;
}> {
  return {
    request: {
      userId: intent.userId,
      count: intent.limit,
      seeds: intent.seedTmdbIds.map((tmdbId) => ({
        tmdbId,
        weight: 1,
        source: "explicit" as const,
      })),
      excludeTmdbIds: [...intent.excludeTmdbIds],
      genres: [...(intent.genreNames ?? [])],
      context: { mode: "neutral", localHour: null },
      requestSeed: intent.requestSeed,
    },
    options: {
      ...(intent.genreIds !== undefined
        ? { genreIds: [...intent.genreIds] }
        : {}),
      ...(intent.filterRelaxation !== undefined
        ? { filterRelaxation: intent.filterRelaxation }
        : {}),
      debug: intent.debug,
    },
  };
}

export function adaptCanonicalResultToV1(
  result: RecommendationResult,
  detailsByTmdbId: ReadonlyMap<number, V1RecommendationDetails>,
) {
  const data = result.results.map((candidate) => {
    const details = detailsByTmdbId.get(candidate.tmdbId);
    return {
      tmdb_id: candidate.tmdbId,
      title: details?.title ?? "",
      score: Math.round(candidate.score * 1000) / 1000,
      consensus_level: details?.consensusLevel ?? "low",
      sources: (details?.sources ?? candidate.evidence.providerFamilies).map(
        (source) => ({ source, confidence: 1 }),
      ),
      reasons: [...(details?.reasons ?? [])],
      genres: [...(details?.genres ?? [])],
      year: details?.releaseDate?.slice(0, 4) ?? null,
      poster_path: details?.posterPath ?? null,
      vote_category: details?.voteCategory ?? null,
    };
  });
  const diagnostics = result.diagnostics;
  const inputHealth = Object.fromEntries(
    Object.entries(diagnostics.inputHealth).map(([source, health]) => [
      source,
      { health: health.health, row_count: health.rowCount },
    ]),
  );

  return {
    data,
    meta: {
      mode: diagnostics.mode,
      failed_sources: [...diagnostics.failedSources],
      input_health: inputHealth,
      engine_version: diagnostics.engineVersion,
      context_mode: diagnostics.contextMode,
      request_seed_hash: diagnostics.requestSeedHash,
      stage_counts: { ...diagnostics.stageCounts },
      drop_reason_counts: { ...diagnostics.dropReasonCounts },
    },
  };
}
