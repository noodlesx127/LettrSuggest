import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabaseClient", () => ({ supabase: undefined }));

import {
  createRecommendationEngine,
  type RecommendationEngineContext,
} from "@/lib/recommendationEngine";
import {
  loadRecommendationContext,
  type RecommendationContextRepository,
  type RecommendationContextSourceSnapshot,
} from "@/lib/recommendationContext";
import {
  rerankOverlapResults,
  suggestByOverlap,
  suggestByOverlapStaged,
  type SuggestByOverlapParams,
  type TMDBMovie,
} from "@/lib/enrich";
import {
  scoreRecommendationsWithOverlapStaged,
  type OverlapScoringOutcome,
  type RecommendationScoringPersonalization,
} from "@/lib/recommendationScoring";

const USER_ID = "prerank-user";

/**
 * Fixture designed so the existing overlap rerank MUST change the order:
 * two high-overlap non-niche candidates score at the top, while two niche
 * candidates (voteCount < 1000) score lower. The rerank's niche
 * prioritization (nicheRatio 0.35) pulls niche candidates forward, so the
 * final order cannot equal the pure score order.
 */
const movie = (
  id: number,
  title: string,
  genres: string[],
  voteAverage: number,
  voteCount: number,
  releaseDate: string,
): TMDBMovie => ({
  id,
  title,
  release_date: releaseDate,
  overview: `${title} overview.`,
  vote_average: voteAverage,
  vote_count: voteCount,
  genres: genres.map((name, index) => ({ id: index + 1, name })),
  credits: { cast: [], crew: [] },
  keywords: { keywords: [] },
});

const LIKED_FILM = movie(
  100,
  "Liked Seed Film",
  ["Drama", "Romance"],
  7.8,
  120_000,
  "2010-02-01",
);
const CANDIDATE_MOVIES: TMDBMovie[] = [
  movie(201, "Overlap Drama A", ["Drama", "Romance"], 7.2, 50_000, "2015-05-01"),
  movie(202, "Niche Comedy B", ["Drama", "Comedy"], 7.4, 300, "2018-06-01"),
  movie(203, "Overlap Drama C", ["Drama", "Romance"], 7.1, 80_000, "2016-05-01"),
  movie(204, "Niche Horror D", ["Drama", "Horror"], 7.3, 400, "2019-06-01"),
];
const CANDIDATE_IDS = CANDIDATE_MOVIES.map((candidate) => candidate.id);

const detailsCache = new Map<number, TMDBMovie>([
  [LIKED_FILM.id, LIKED_FILM],
  ...CANDIDATE_MOVIES.map(
    (candidate) => [candidate.id, candidate] as [number, TMDBMovie],
  ),
]);

const snapshot: RecommendationContextSourceSnapshot = {
  films: {
    data: [
      {
        uri: "letterboxd://film/liked-seed",
        title: "Liked Seed Film",
        year: 2010,
        rating: 5,
        liked: true,
        rewatch: false,
        on_watchlist: false,
        last_date: "2026-07-01",
      },
    ],
  },
  mappings: {
    data: [{ uri: "letterboxd://film/liked-seed", tmdbId: 100 }],
  },
  metadata: { data: [] },
  dates: { data: [] },
  ratings: { data: [] },
  features: { data: [] },
  sources: {
    feedback: { data: [] },
    exploration: { data: [] },
    adjacent_genres: { data: [] },
    exposures: { data: [] },
    blocked: { data: [] },
  },
};

const repository: RecommendationContextRepository = {
  load: async () => snapshot,
};

const personalization: RecommendationScoringPersonalization = {
  enhancedProfile: {
    topActors: [],
    topStudios: [],
    topKeywords: [],
    topCountries: [],
    topLanguages: [],
    avoidGenres: [],
    avoidKeywords: [],
    avoidDirectors: [],
    preferredSubgenreKeywordIds: [],
    topDecades: [],
    adjacentGenres: new Map(),
    watchlistGenres: [],
    watchlistKeywords: [],
    watchlistDirectors: [],
  },
  featureFeedback: {
    avoidActors: [],
    avoidKeywords: [],
    avoidFranchises: [],
    avoidDirectors: [],
    avoidGenres: [],
    avoidSubgenres: [],
    preferActors: [],
    preferKeywords: [],
    preferDirectors: [],
    preferGenres: [],
    preferSubgenres: [],
  },
  watchlistEntries: [],
  recentExposures: new Map(),
  // Legacy input is an exploration weight, so 0.9 becomes an MMR relevance
  // lambda of 0.1 and guarantees the similar top dramas are diversified.
  mmrLambda: 0.9,
  sourceMetadata: new Map(),
};

function buildOverlapParams(
  context: RecommendationEngineContext,
): SuggestByOverlapParams {
  return {
    userId: USER_ID,
    films: [
      {
        uri: "letterboxd://film/liked-seed",
        title: "Liked Seed Film",
        year: 2010,
        rating: 5,
        liked: true,
        lastDate: "2026-07-01",
      },
    ],
    mappings: new Map([["letterboxd://film/liked-seed", 100]]),
    candidates: [...CANDIDATE_IDS],
    tmdbDetailsCache: detailsCache,
    maxCandidates: CANDIDATE_IDS.length,
    feedbackMap: new Map(context.feedbackMap),
    desiredResults: 4,
    excludeWatchedIds: new Set(context.watchedTmdbIds),
    context: { mode: "neutral", localHour: null },
    enhancedProfile: personalization.enhancedProfile,
    featureFeedback: personalization.featureFeedback,
    watchlistEntries: [],
    recentExposures: new Map(),
    mmrLambda: personalization.mmrLambda,
    sourceMetadata: new Map(),
    mmrTopKFactor: 2.5,
  };
}

describe("overlap scoring/rerank seam", () => {
  it("exposes the score-ordered stage separately from the existing rerank", async () => {
    const context = await loadRecommendationContext(repository, USER_ID);
    const params = buildOverlapParams(context);

    const staged = await suggestByOverlapStaged(params);
    const legacy = await suggestByOverlap(params);
    expect(staged.scoreOrdered.length).toBeGreaterThan(0);
    // The staged output is the pure score order: non-increasing scores.
    const scores = staged.scoreOrdered.map((result) => result.score);
    expect(scores).toEqual([...scores].sort((left, right) => right - left));

    // The personalized path owns a real rerank stage.
    const { rerankInput } = staged;
    expect(rerankInput).not.toBeNull();
    if (!rerankInput) throw new Error("expected an overlap rerank stage");

    // The exported rerank with the staged input reproduces the legacy
    // end-to-end output exactly (identical params/behavior).
    expect(
      rerankOverlapResults(staged.scoreOrdered, rerankInput).map(
        (result) => result.tmdbId,
      ),
    ).toEqual(legacy.map((result) => result.tmdbId));
  });

  it("keeps the legacy suggestByOverlap output reranked, not score-ordered", async () => {
    const context = await loadRecommendationContext(repository, USER_ID);
    const params = buildOverlapParams(context);

    const staged = await suggestByOverlapStaged(params);
    const legacy = await suggestByOverlap(params);

    // The fixture forces the niche-aware rerank to change the order, so the
    // legacy output cannot equal the pure score order.
    expect(
      legacy.map((result) => result.tmdbId),
    ).not.toEqual(staged.scoreOrdered.map((result) => result.tmdbId));
  });
});

describe("canonical engine pre-rank over the production overlap path", () => {
  it("feeds score-ordered candidates to the engine and performs the existing rerank in rerankCandidates", async () => {
    const context = await loadRecommendationContext(repository, USER_ID);
    const params = buildOverlapParams(context);
    const staged = await suggestByOverlapStaged(params);
    const legacy = await suggestByOverlap(params);

    let outcome: OverlapScoringOutcome | null = null;
    const result = await createRecommendationEngine({
      loadContext: async () => context,
      retrieveCandidates: async () =>
        CANDIDATE_IDS.map((tmdbId) => ({ tmdbId })),
      scoreCandidates: async (scoreParams) => {
        outcome = await scoreRecommendationsWithOverlapStaged(
          scoreParams,
          detailsCache,
          personalization,
        );
        return outcome.candidates;
      },
      rerankCandidates: async () =>
        outcome ? outcome.rerankCandidates() : [],
      rng: () => () => 0.5,
      telemetry: () => undefined,
    }).generate({
      userId: USER_ID,
      count: 4,
      seeds: [],
      excludeTmdbIds: [],
      requestSeed: "prerank-overlap-seed",
    });

    // The engine's scoring stage output is the pure score order.
    expect(
      (outcome as unknown as OverlapScoringOutcome).candidates.map(
        (candidate) => candidate.tmdbId,
      ),
    ).toEqual(staged.scoreOrdered.map((item) => item.tmdbId));

    // Final results keep the existing reranked order exactly.
    expect(result.results.map((candidate) => candidate.tmdbId)).toEqual(
      legacy.map((item) => item.tmdbId),
    );

    // preRanksById is the 1-based score order, not the reranked order.
    const scoreRankById = new Map(
      staged.scoreOrdered.map((item, index) => [item.tmdbId, index + 1]),
    );
    for (const [tmdbId, preRank] of result.preRanksById) {
      expect(preRank).toBe(scoreRankById.get(tmdbId));
    }

    // The overlap MMR/niche rerank changed the order: at least one final
    // result has a pre-rank that differs from its post-rank.
    const diverged = result.results.some(
      (candidate, index) =>
        result.preRanksById.get(candidate.tmdbId) !== index + 1,
    );
    expect(diverged).toBe(true);
  });
});
