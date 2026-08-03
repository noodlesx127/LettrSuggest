import {
  rerankOverlapResults,
  suggestByOverlapStaged,
  type FilmEventLite,
  type OverlapScoredResult,
  type TMDBMovie,
} from "@/lib/enrich";
import type { RecommendationScoreParams } from "@/lib/recommendationEngine";
import type { RecommendationCandidate } from "@/lib/recommendationTypes";
import type { RecommendationPersonalization } from "@/lib/recommendationPersonalization";

type OverlapScoringParams = Parameters<typeof suggestByOverlapStaged>[0];

export type OverlapScoringContext = RecommendationScoreParams["context"];

export type RecommendationScoringPersonalization =
  RecommendationPersonalization & {
    sourceMetadata: NonNullable<OverlapScoringParams["sourceMetadata"]>;
  };

export type OverlapScoringOutcome = Readonly<{
  /** Score-ordered canonical candidates, before the existing overlap rerank. */
  candidates: RecommendationCandidate[];
  /**
   * Performs the existing overlap rerank (MMR + niche prioritization +
   * diversity stages) over the staged score order with identical
   * params/behavior. Paths without a rerank stage (cold start) return the
   * score-ordered candidates unchanged.
   */
  rerankCandidates: () => RecommendationCandidate[];
}>;

function toRecommendationCandidate(
  item: OverlapScoredResult,
): RecommendationCandidate {
  const providerFamilies = item.sources?.length
    ? [...item.sources]
    : ["overlap"];
  const retrievalScore = item.score;

  return {
    tmdbId: item.tmdbId,
    score: item.score,
    reasons: [...item.reasons],
    explanation: item.reasons[0],
    evidence: {
      seedAnchors: [],
      providerFamilies,
      providerOccurrences: providerFamilies.length,
      retrievalScore,
    },
    attribution: {
      retrieval: retrievalScore,
      preference: 0,
      context: 0,
      diversity: 0,
      total: item.score,
    },
  };
}

/**
 * Score candidates through the overlap seam and expose the scoring/rerank
 * stages separately. candidates is the pure score order (pre-rerank) so the
 * canonical engine can record a true pre-rank; rerankCandidates performs the
 * existing overlap rerank with identical params/behavior.
 */
export async function scoreRecommendationsWithOverlapStaged(
  params: RecommendationScoreParams,
  tmdbDetailsCache: Map<number, TMDBMovie>,
  personalization: RecommendationScoringPersonalization,
): Promise<OverlapScoringOutcome> {
  if (
    params.candidates.some(
      (candidate) =>
        !Number.isSafeInteger(candidate.tmdbId) || candidate.tmdbId <= 0,
    )
  ) {
    throw new Error("Invalid recommendation candidate ID");
  }

  const films: FilmEventLite[] = params.context.films.map((tuple) => {
    const film = tuple.film;
    const rating = tuple.rating ?? film.rating;
    const lastDate = tuple.watchDate ?? film.lastDate ?? film.last_date;

    return {
      uri: tuple.uri,
      title: typeof film.title === "string" ? film.title : "",
      year: typeof film.year === "number" ? film.year : null,
      ...(typeof rating === "number" ? { rating } : {}),
      ...(typeof film.liked === "boolean" ? { liked: film.liked } : {}),
      ...(typeof lastDate === "string" ? { lastDate } : {}),
    };
  });
  const mappings = new Map<string, number>();
  for (const tuple of params.context.films) {
    if (tuple.tmdbId !== null) mappings.set(tuple.uri, tuple.tmdbId);
  }

  const { scoreOrdered, rerankInput } = await suggestByOverlapStaged({
    userId: params.request.userId,
    films,
    mappings,
    candidates: params.candidates.map((candidate) => candidate.tmdbId),
    tmdbDetailsCache,
    maxCandidates: params.candidates.length,
    feedbackMap: new Map(params.context.feedbackMap),
    desiredResults: params.request.count,
    excludeWatchedIds: new Set(params.context.watchedTmdbIds),
    context: {
      mode: params.request.context.mode,
      localHour: params.request.context.localHour,
    },
    ...personalization,
    mmrTopKFactor: 2.5,
  });

  if (
    scoreOrdered.some(
      (item) =>
        !Number.isFinite(item.score) ||
        !Number.isSafeInteger(item.tmdbId) ||
        item.tmdbId <= 0,
    )
  ) {
    throw new Error("Invalid overlap scorer result");
  }

  const candidates = scoreOrdered.map(toRecommendationCandidate);
  const candidateById = new Map(
    candidates.map((candidate) => [candidate.tmdbId, candidate]),
  );

  return {
    candidates,
    rerankCandidates: () => {
      if (!rerankInput) return candidates;
      return rerankOverlapResults(scoreOrdered, rerankInput).flatMap(
        (item) => {
          const candidate = candidateById.get(item.tmdbId);
          return candidate ? [candidate] : [];
        },
      );
    },
  };
}

/**
 * Canonical scoring seam: returns the score-ordered (pre-rerank) candidates.
 * Callers that also need the existing overlap rerank should use
 * scoreRecommendationsWithOverlapStaged.
 */
export async function scoreRecommendationsWithOverlap(
  params: RecommendationScoreParams,
  tmdbDetailsCache: Map<number, TMDBMovie>,
  personalization: RecommendationScoringPersonalization,
): Promise<RecommendationCandidate[]> {
  const { candidates } = await scoreRecommendationsWithOverlapStaged(
    params,
    tmdbDetailsCache,
    personalization,
  );
  return candidates;
}
