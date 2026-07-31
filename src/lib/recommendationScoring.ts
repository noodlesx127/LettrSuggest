import { suggestByOverlap, type FilmEventLite, type TMDBMovie } from "@/lib/enrich";
import type { RecommendationScoreParams } from "@/lib/recommendationEngine";
import type { RecommendationCandidate } from "@/lib/recommendationTypes";
import type { RecommendationPersonalization } from "@/lib/recommendationPersonalization";

type OverlapScoringParams = Parameters<typeof suggestByOverlap>[0];

export type OverlapScoringContext = RecommendationScoreParams["context"];

export type RecommendationScoringPersonalization =
  RecommendationPersonalization & {
    sourceMetadata: NonNullable<OverlapScoringParams["sourceMetadata"]>;
  };

export async function scoreRecommendationsWithOverlap(
  params: RecommendationScoreParams,
  tmdbDetailsCache: Map<number, TMDBMovie>,
  personalization: RecommendationScoringPersonalization,
): Promise<RecommendationCandidate[]> {
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

  const scored = await suggestByOverlap({
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
    scored.some(
      (item) =>
        !Number.isFinite(item.score) ||
        !Number.isSafeInteger(item.tmdbId) ||
        item.tmdbId <= 0,
    )
  ) {
    throw new Error("Invalid overlap scorer result");
  }

  return scored.map((item) => {
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
  });
}
