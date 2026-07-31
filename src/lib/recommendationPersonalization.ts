import type { suggestByOverlap } from "@/lib/enrich";
import {
  buildAdjacentGenreMap,
  buildFeatureFeedbackFromRows,
  type TasteProfile,
  type UserContext,
} from "@/lib/serverSuggestionsEngine";

type OverlapScoringParams = Parameters<typeof suggestByOverlap>[0];

export type RecommendationPersonalization = {
  enhancedProfile: NonNullable<OverlapScoringParams["enhancedProfile"]>;
  featureFeedback: NonNullable<OverlapScoringParams["featureFeedback"]>;
  watchlistEntries: NonNullable<OverlapScoringParams["watchlistEntries"]>;
  recentExposures: NonNullable<OverlapScoringParams["recentExposures"]>;
  mmrLambda: NonNullable<OverlapScoringParams["mmrLambda"]>;
};

export type RecommendationScoringInputs = RecommendationPersonalization & {
  sourceMetadata: NonNullable<OverlapScoringParams["sourceMetadata"]>;
};

export function buildRecommendationScoringInputs(
  personalization: RecommendationPersonalization,
  sourceMetadata: RecommendationScoringInputs["sourceMetadata"],
): RecommendationScoringInputs {
  return {
    ...personalization,
    sourceMetadata,
  };
}

function buildMmrLambda(explorationRate: number): number {
  const boundedExplorationRate = Number.isFinite(explorationRate)
    ? Math.min(0.3, Math.max(0, explorationRate))
    : 0.15;

  return Math.max(
    0.3,
    Math.min(0.7, 0.3 + (boundedExplorationRate / 0.3) * 0.4),
  );
}

export function buildRecommendationPersonalization(
  userContext: UserContext,
  tasteProfile: TasteProfile,
): RecommendationPersonalization {
  const adjacentGenresMap = buildAdjacentGenreMap(userContext.adjacentGenres);
  const enhancedProfile: RecommendationPersonalization["enhancedProfile"] = {
    topActors: tasteProfile.topActors ?? [],
    topStudios: tasteProfile.topStudios ?? [],
    topKeywords: tasteProfile.topKeywords,
    topCountries: tasteProfile.topCountries,
    topLanguages: tasteProfile.topLanguages,
    avoidGenres: tasteProfile.avoidGenres ?? [],
    avoidKeywords: tasteProfile.avoidKeywords ?? [],
    avoidDirectors: tasteProfile.avoidDirectors ?? [],
    preferredSubgenreKeywordIds:
      tasteProfile.preferredSubgenreKeywordIds ?? [],
    topDecades: tasteProfile.topDecades,
    adjacentGenres: adjacentGenresMap,
    watchlistGenres: (tasteProfile.watchlistGenres ?? []).map(
      (genre) => genre.name,
    ),
    watchlistKeywords: (tasteProfile.watchlistKeywords ?? []).map(
      (keyword) => keyword.name,
    ),
    watchlistDirectors: (tasteProfile.watchlistDirectors ?? []).map(
      (director) => director.name,
    ),
  };

  const featureFeedback = buildFeatureFeedbackFromRows(userContext.feedback);
  const watchlistEntries = userContext.films
    .filter((film) => film.on_watchlist)
    .map((film) => ({
      tmdbId: userContext.mappings.get(film.uri),
      addedAt: film.last_date ?? null,
    }))
    .filter(
      (
        entry,
      ): entry is {
        tmdbId: number;
        addedAt: string | null;
      } => typeof entry.tmdbId === "number" && entry.tmdbId > 0,
    );

  return {
    enhancedProfile,
    featureFeedback,
    watchlistEntries,
    recentExposures: userContext.recentExposures,
    mmrLambda: buildMmrLambda(userContext.explorationRate),
  };
}
