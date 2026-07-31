import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import {
  adaptCanonicalResultToV1,
  adaptCanonicalResultToWeb,
  adaptV1RecommendationIntent,
  adaptWebRecommendationIntent,
  classifyVoteCategory,
  extractCachedWebRecommendationMetadata,
  getWebTmdbGenreFilterNames,
  getWebTmdbRetrievalGenreNames,
  matchesWebTmdbGenreFilter,
  matchesNicheGenrePresentation,
  normalizeWebRecommendationCount,
  selectCanonicalPalateCleanser,
  selectCanonicalWatchlistPicks,
} from "@/lib/recommendationAdapters";
import {
  buildRecommendationPersonalization,
  buildRecommendationScoringInputs,
} from "@/lib/recommendationPersonalization";
import type {
  RecommendationCandidate,
  RecommendationResult,
} from "@/lib/recommendationTypes";
import type {
  TasteProfile,
  UserContext,
} from "@/lib/serverSuggestionsEngine";

const candidate = (tmdbId: number, score: number): RecommendationCandidate => ({
  tmdbId,
  score,
  evidence: {
    seedAnchors: [101],
    providerFamilies: ["tmdb", "tastedive"],
    providerOccurrences: 2,
    retrievalScore: score,
  },
  attribution: {
    retrieval: score,
    preference: 0,
    context: 0,
    diversity: 0,
    total: score,
  },
});

function makeParityUserContext(): UserContext {
  return {
    films: [
      {
        uri: "film/a/",
        title: "A",
        year: 2020,
        rating: 4.5,
        rewatch: false,
        last_date: "2026-07-01",
        watch_count: 1,
        liked: true,
        on_watchlist: true,
      },
    ],
    mappings: new Map([["film/a/", 101]]),
    mappingsArray: [{ uri: "film/a/", tmdb_id: 101 }],
    feedback: [
      {
        feature_id: 7,
        feature_name: "Director Seven",
        feature_type: "director",
        inferred_preference: 0.9,
        positive_count: 3,
        negative_count: 0,
      },
      {
        feature_id: 8,
        feature_name: "Keyword Eight",
        feature_type: "keyword",
        inferred_preference: 0.1,
        positive_count: 0,
        negative_count: 2,
      },
    ],
    explorationRate: 0.15,
    adjacentGenres: [
      {
        from_genre_name: "Drama",
        to_genre_name: "Mystery",
        success_rate: 0.8,
      },
    ],
    recentExposures: new Map([[202, 3]]),
    blockedIds: new Set(),
    inputHealth: {} as UserContext["inputHealth"],
    failedSources: [],
    mode: "personalized",
  };
}

function makeParityTasteProfile(): TasteProfile {
  return {
    topActors: [{ id: 1, name: "Actor One", weight: 1, count: 2 }],
    topStudios: [{ id: 2, name: "Studio Two", weight: 0.8, count: 1 }],
    topKeywords: [{ id: 3, name: "Keyword Three", weight: 0.7, count: 1 }],
    topCountries: [{ name: "United States", count: 1 }],
    topLanguages: [{ name: "English", count: 1 }],
    avoidGenres: [{ id: 27, name: "Horror", weight: 1, count: 1 }],
    avoidKeywords: [{ id: 4, name: "Keyword Four", weight: 1, count: 1 }],
    avoidDirectors: [{ id: 5, name: "Director Five", weight: 1, count: 1 }],
    preferredSubgenreKeywordIds: [99],
    topDecades: [{ decade: 1990, weight: 1 }],
    watchlistGenres: [{ name: "Drama", count: 1 }],
    watchlistKeywords: [{ name: "Mystery", count: 1 }],
    watchlistDirectors: [{ name: "Director Seven", count: 1 }],
  } as unknown as TasteProfile;
}

function makeParitySourceMetadata() {
  return new Map([
    [
      707,
      {
        sources: ["tmdb", "tastedive"],
        consensusLevel: "high" as const,
      },
    ],
    [
      808,
      {
        sources: ["watchmode"],
        consensusLevel: "low" as const,
      },
    ],
  ]);
}

describe("v1 canonical recommendation adapter", () => {
  it("maps every parsed v1 intent field into canonical request and adapter options", () => {
    const adapted = adaptV1RecommendationIntent({
      userId: "v1-user",
      seedTmdbIds: [202, 101],
      limit: 7,
      excludeTmdbIds: [909, 808],
      genreIds: [28, 9648],
      genreNames: ["Action", "Mystery"],
      filterRelaxation: "threshold",
      debug: true,
      requestSeed: "v1-adapter-seed",
    });

    expect(adapted.request).toEqual({
      userId: "v1-user",
      count: 7,
      seeds: [
        { tmdbId: 202, weight: 1, source: "explicit" },
        { tmdbId: 101, weight: 1, source: "explicit" },
      ],
      excludeTmdbIds: [909, 808],
      genres: ["Action", "Mystery"],
      context: { mode: "neutral", localHour: null },
      requestSeed: "v1-adapter-seed",
    });
    expect(adapted.options).toEqual({
      genreIds: [28, 9648],
      filterRelaxation: "threshold",
      debug: true,
    });
  });

  it("maps canonical order into the compatible v1 payload plus additive diagnostics", () => {
    const result: RecommendationResult = {
      results: [candidate(22, 9.1254), candidate(11, 8.5)],
      diagnostics: {
        mode: "personalized",
        engineVersion: "v1-canonical-1",
        contextMode: "neutral",
        inputHealth: {
          films: { health: "ok", rowCount: 12 },
          mappings: { health: "ok", rowCount: 12 },
          feedback: { health: "empty", rowCount: 0 },
          exploration: { health: "empty", rowCount: 0 },
          adjacent_genres: { health: "empty", rowCount: 0 },
          exposures: { health: "empty", rowCount: 0 },
          blocked: { health: "ok", rowCount: 1 },
        },
        failedSources: [],
        requestSeedHash: "00000000deadbeef",
        seedCount: 1,
        candidateCount: 9,
        resultCount: 2,
        stageCounts: { retrieval: 9, scoring: 5, reranking: 2, final: 2 },
        dropReasonCounts: { excluded: 2, genre: 2 },
      },
    };
    const details = new Map([
      [
        22,
        {
          title: "Second by ID, first by canonical rank",
          consensusLevel: "high" as const,
          sources: ["tmdb", "tastedive"],
          reasons: ["Strong match"],
          genres: ["Mystery"],
          releaseDate: "2024-04-03",
          posterPath: "/22.jpg",
          voteCategory: "hidden-gem" as const,
        },
      ],
      [11, { title: "Eleven", sources: ["tmdb"] }],
    ]);

    const adapted = adaptCanonicalResultToV1(result, details);

    expect(adapted.data.map((item) => item.tmdb_id)).toEqual([22, 11]);
    expect(adapted.data[0]).toEqual({
      tmdb_id: 22,
      title: "Second by ID, first by canonical rank",
      score: 9.125,
      consensus_level: "high",
      sources: [
        { source: "tmdb", confidence: 1 },
        { source: "tastedive", confidence: 1 },
      ],
      reasons: ["Strong match"],
      genres: ["Mystery"],
      year: "2024",
      poster_path: "/22.jpg",
      vote_category: "hidden-gem",
    });
    expect(adapted.meta).toEqual(
      expect.objectContaining({
        mode: "personalized",
        engine_version: "v1-canonical-1",
        context_mode: "neutral",
        failed_sources: [],
        request_seed_hash: "00000000deadbeef",
        stage_counts: { retrieval: 9, scoring: 5, reranking: 2, final: 2 },
        drop_reason_counts: { excluded: 2, genre: 2 },
      }),
    );
    expect(adapted.meta.input_health.films).toEqual({
      health: "ok",
      row_count: 12,
    });
  });
});

describe("web canonical recommendation adapter", () => {
  it("maps rich canonical metadata and evidence without changing canonical order", () => {
    const result: RecommendationResult = {
      results: [
        {
          ...candidate(22, 9.1254),
          reasons: ["Matches your favorite mystery films", "Runtime fits your usual window"],
          explanation: "A mystery match with the pacing you usually enjoy.",
        },
        candidate(11, 8.5),
      ],
      diagnostics: {
        mode: "personalized",
        engineVersion: "v1-canonical-1",
        contextMode: "neutral",
        inputHealth: {
          films: { health: "ok", rowCount: 1 },
          mappings: { health: "ok", rowCount: 1 },
          feedback: { health: "empty", rowCount: 0 },
          exploration: { health: "empty", rowCount: 0 },
          adjacent_genres: { health: "empty", rowCount: 0 },
          exposures: { health: "empty", rowCount: 0 },
          blocked: { health: "empty", rowCount: 0 },
        },
        failedSources: [],
        requestSeedHash: "0000000000000001",
        seedCount: 0,
        candidateCount: 2,
        resultCount: 2,
        stageCounts: { retrieval: 2, scoring: 2, reranking: 2, final: 2 },
        dropReasonCounts: {},
      },
    };
    const details = new Map([
      [
        22,
        {
          title: "Canonical Mystery",
          releaseDate: "2024-04-03",
          runtime: 131,
          originalLanguage: "ko",
          criticScore: 87,
          posterPath: "/22.jpg",
          genres: ["Mystery"],
          overview: "A useful canonical explanation.",
        },
      ],
      [11, { title: "Eleven", runtime: 98, originalLanguage: "en" }],
    ]);

    const adapted = adaptCanonicalResultToWeb(result, details);

    expect(adapted.map((item) => item.id)).toEqual([22, 11]);
    expect(adapted[0]).toEqual(
      expect.objectContaining({
        id: 22,
        runtime: 131,
        original_language: "ko",
        critic_score: 87,
        reasons: [
          "Matches your favorite mystery films",
          "Runtime fits your usual window",
        ],
        explanation: "A mystery match with the pacing you usually enjoy.",
      }),
    );
    expect(adapted[1].reasons).toEqual([
      "Recommended from your canonical taste profile",
    ]);
  });

  it("produces the same canonical request as equivalent v1 intent", () => {
    const shared = {
      userId: "parity-user",
      limit: 12,
      seedTmdbIds: [101, 202],
      excludeTmdbIds: [303, 404],
      genreNames: ["Mystery", "Drama"],
      requestSeed: "adapter-parity-seed",
    } as const;
    const v1 = adaptV1RecommendationIntent({
      ...shared,
      genreIds: [9648, 18],
      filterRelaxation: "threshold",
      debug: false,
    });
    const web = adaptWebRecommendationIntent({
      ...shared,
      context: { mode: "neutral", localHour: null },
    });

    expect(web.request).toEqual(v1.request);
    expect(web.request.seeds).toEqual(v1.request.seeds);
  });

  it("keeps normalized web and v1 scorer inputs in parity", () => {
    const webScoringInputs = buildRecommendationScoringInputs(
      buildRecommendationPersonalization(
        makeParityUserContext(),
        makeParityTasteProfile(),
      ),
      makeParitySourceMetadata(),
    );
    const v1ScoringInputs = buildRecommendationScoringInputs(
      buildRecommendationPersonalization(
        makeParityUserContext(),
        makeParityTasteProfile(),
      ),
      makeParitySourceMetadata(),
    );

    expect(webScoringInputs.enhancedProfile).toEqual(
      v1ScoringInputs.enhancedProfile,
    );
    expect(webScoringInputs.featureFeedback).toEqual(
      v1ScoringInputs.featureFeedback,
    );
    expect(webScoringInputs.watchlistEntries).toEqual(
      v1ScoringInputs.watchlistEntries,
    );
    expect(webScoringInputs.recentExposures).toEqual(
      v1ScoringInputs.recentExposures,
    );
    expect(webScoringInputs.sourceMetadata).toEqual(
      v1ScoringInputs.sourceMetadata,
    );
    expect(webScoringInputs.mmrLambda).toBe(v1ScoringInputs.mmrLambda);

    expect(webScoringInputs.enhancedProfile).toEqual(
      expect.objectContaining({
        avoidKeywords: [
          expect.objectContaining({ name: "Keyword Four" }),
        ],
        preferredSubgenreKeywordIds: [99],
        watchlistGenres: ["Drama"],
      }),
    );
    expect(webScoringInputs.featureFeedback).toEqual(
      expect.objectContaining({
        preferDirectors: [expect.objectContaining({ id: 7 })],
        avoidKeywords: [expect.objectContaining({ id: 8 })],
      }),
    );
    expect(webScoringInputs.watchlistEntries).toEqual([
      { tmdbId: 101, addedAt: "2026-07-01" },
    ]);
    expect(webScoringInputs.recentExposures).toEqual(new Map([[202, 3]]));
    expect(webScoringInputs.sourceMetadata).toEqual(makeParitySourceMetadata());
    expect(webScoringInputs.mmrLambda).toBe(0.5);
  });

  it("bounds web result counts to the canonical request contract", () => {
    expect(normalizeWebRecommendationCount(600)).toBe(100);
    expect(normalizeWebRecommendationCount(0)).toBe(1);
    expect(normalizeWebRecommendationCount(Number.NaN)).toBe(1);
    expect(normalizeWebRecommendationCount(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("leaves niche GenreSelector intent for presentation matching instead of TMDB filtering", () => {
    const nicheGenreNames = [
      "Anime",
      "Food",
      "Travel",
      "Stand Up",
      "Sports",
    ];
    const tmdbFilterNames = getWebTmdbGenreFilterNames(nicheGenreNames);

    expect(tmdbFilterNames).toEqual([]);
    expect(matchesWebTmdbGenreFilter(["Animation"], tmdbFilterNames)).toBe(
      true,
    );
    expect(matchesWebTmdbGenreFilter(["Drama"], tmdbFilterNames)).toBe(true);
  });

  it("skips the exact prefilter when standard and niche genres are mixed", () => {
    const tmdbFilterNames = getWebTmdbGenreFilterNames(["Action", "Sports"]);

    expect(tmdbFilterNames).toEqual([]);
    expect(matchesWebTmdbGenreFilter(["Drama"], tmdbFilterNames)).toBe(true);
  });

  it("maps niche and mixed genre intent into deterministic TMDB retrieval profiles", () => {
    expect(getWebTmdbRetrievalGenreNames(["Anime"])).toEqual(["animation"]);
    expect(getWebTmdbRetrievalGenreNames(["Action", "Sports"])).toEqual([
      "action",
      "documentary",
    ]);
  });

  it("keeps exact filtering for standard TMDB genre intent", () => {
    const tmdbFilterNames = getWebTmdbGenreFilterNames([
      "Action",
      "Mystery",
    ]);

    expect(tmdbFilterNames).toEqual(["action", "mystery"]);
    expect(matchesWebTmdbGenreFilter(["Action"], tmdbFilterNames)).toBe(true);
    expect(matchesWebTmdbGenreFilter(["Drama"], tmdbFilterNames)).toBe(false);
  });

  it("matches Sports niche presentation results in canonical order", () => {
    expect(
      matchesNicheGenrePresentation("Sports", "The Football Final", ["Drama"]),
    ).toBe(true);
    expect(
      matchesNicheGenrePresentation("Sports", "A Quiet Conversation", ["Drama"]),
    ).toBe(false);
  });

  it("restores vote categories and cached rating metadata for web items", () => {
    expect(classifyVoteCategory(7.5, 999)).toBe("hidden-gem");
    expect(classifyVoteCategory(7, 1001)).toBe("cult-classic");
    expect(classifyVoteCategory(7, 10_001)).toBe("crowd-pleaser");
    expect(classifyVoteCategory(6.9, 50_000)).toBe("standard");

    expect(
      extractCachedWebRecommendationMetadata({
        vote_average: 7.2,
        vote_count: 2_000,
        imdb_rating: "8.1",
        rotten_tomatoes: "91%",
        metacritic: "82",
        critic_score: 88,
      }),
    ).toEqual({
      voteCategory: "cult-classic",
      imdbRating: "8.1",
      rottenTomatoes: "91%",
      metacritic: "82",
      criticScore: 88,
    });
  });

  it("derives watchlist and palate sections by filtering canonical order", () => {
    const ordered = [
      { id: 30, score: 100, genres: ["Drama"] },
      { id: 10, score: 1, genres: ["Comedy"] },
      { id: 20, score: 99, genres: ["Horror"] },
      { id: 40, score: 2, genres: ["Fantasy"] },
    ];

    const watchlistPicks = selectCanonicalWatchlistPicks(
      ordered,
      new Set([10, 20, 30]),
      2,
    );
    const palateCleanser = selectCanonicalPalateCleanser(ordered, {
      type: "intensity",
      count: 7,
      message: "Lighten the mood",
    });

    expect(watchlistPicks.map((item) => item.id)).toEqual([30, 10]);
    expect(palateCleanser.map((item) => item.id)).toEqual([10, 40]);
    expect(watchlistPicks[0]).toBe(ordered[0]);
    expect(palateCleanser[0]).toBe(ordered[1]);
  });

  it("leaves production recommendation orchestration on the authenticated server", () => {
    const page = readFileSync(
      resolve(process.cwd(), "src/app/suggest/page.tsx"),
      "utf8",
    );
    const action = readFileSync(
      resolve(process.cwd(), "src/app/actions/recommendations.ts"),
      "utf8",
    );
    const v1Route = readFileSync(
      resolve(process.cwd(), "src/app/api/v1/suggestions/generate/route.ts"),
      "utf8",
    );
    const trending = readFileSync(
      resolve(process.cwd(), "src/lib/trending.ts"),
      "utf8",
    );
    const genrePage = readFileSync(
      resolve(process.cwd(), "src/app/genre-suggest/page.tsx"),
      "utf8",
    );

    expect(page).not.toMatch(/\bgenerateSmartCandidates\s*\(/);
    expect(page).not.toMatch(/\bsuggestByOverlap\s*\(/);
    expect(page).not.toMatch(/\bcalibrateRecommendations\s*\(/);
    expect(page).toMatch(/loadPresentationState/);
    expect(page).toMatch(/\bgetSuggestionStorageKeys\s*\(/);
    for (const legacyKey of [
      "lettrsuggest_items",
      "lettrsuggest_shown_ids",
      "lettrsuggest_pair_history",
      "lettrsuggest_pairwise_count",
    ]) {
      const escapedKey = legacyKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(page).not.toMatch(
        new RegExp(
          `(?:sessionStorage|localStorage)\\s*\\.\\s*(?:getItem|setItem|removeItem)\\s*\\(\\s*["']${escapedKey}["']`,
        ),
      );
    }
    expect(page).toMatch(/auth\s*\.\s*onAuthStateChange\s*\(/);
    expect(page).toMatch(/unsubscribe\s*\(\s*\)/);
    expect(page).toMatch(
      /setItems\(null\);[\s\S]*?setPairHistory\(new Set\(\)\);[\s\S]*?setPairwisePair\(null\);[\s\S]*?setPairwiseVideoId\(null\);/,
    );
    expect(page).toMatch(
      /const timeoutId = setTimeout\([\s\S]*?return \(\) => clearTimeout\(timeoutId\);/,
    );
    expect(page).not.toMatch(/\blogSuggestionExposure\s*\(/);
    expect(page).not.toMatch(/Math\.random\s*\(/);
    expect(page).toMatch(/generateCanonicalWebRecommendations\s*\(/);
    expect(page).toContain("const sorted = [...items];");
    expect(page).not.toMatch(/fetchSectionReplacements\s*\(/);
    expect(page).toMatch(/selectCanonicalWatchlistPicks\s*\(/);
    expect(page).toMatch(/selectCanonicalPalateCleanser\s*\(/);
    expect(page).toMatch(/parseCanonicalWebItems\s*\(/);
    expect(page).not.toMatch(/await\s+detectGenreFatigue\s*\(/);
    expect(genrePage).toMatch(/parseCanonicalWebItems\s*\(/);
    expect(page).not.toMatch(/watchlistIdsHydrationRef/);
    expect(page).toMatch(/presentationHydrationEnabled/);
    expect(page).toMatch(
      /setItems\(\s*restoredItems(?:\s+as\s+MovieItem\[\])?\s*\);[\s\S]*?setPresentationHydrationEnabled\(\s*true\s*\)/,
    );
    expect(page).toContain(".slice(0, 300)");
    expect(page).not.toMatch(/\bgeneratePalateCleanser\s*\(/);
    expect(genrePage).not.toMatch(/\bgenerateSmartCandidates\s*\(/);
    expect(genrePage).not.toMatch(/\bsuggestByOverlap\s*\(/);
    expect(genrePage).not.toMatch(/Math\.random\s*\(/);
    expect(genrePage).toMatch(/generateCanonicalWebRecommendations\s*\(/);
    expect(genrePage).not.toMatch(/matchingMovies\.sort\s*\(/);
    expect(action).toMatch(/getUser\s*\(.*accessToken/s);
    expect(action).toMatch(/typeof params\.accessToken !== "string"/);
    expect(action).toContain('contextDiagnostics.mode === "degraded"');
    expect(action).toContain("getWebTmdbGenreFilterNames");
    expect(action).toContain("matchesWebTmdbGenreFilter");
    expect(action).toContain("retrievalTasteProfile");
    expect(action).toMatch(/runCanonicalServerRecommendations\s*\(/);
    expect(action).toContain("buildRecommendationPersonalization");
    expect(action).toMatch(
      /scoreRecommendationsWithOverlap[\s\S]*from "@\/lib\/recommendationScoring"/,
    );
    expect(v1Route).toContain("buildRecommendationPersonalization");
    expect(action).not.toMatch(/\bmmrLambda\s*=/);
    expect(v1Route).not.toMatch(/\bmmrLambda\s*=/);
    expect(action).toContain("normalizeWebRecommendationCount(params.count)");
    expect(action).toContain("adapted.request.seeds");
    expect(action).not.toMatch(/params\.userId/);
    expect(action).not.toMatch(/\bgetAggregatedRecommendations\b/);
    expect(action).not.toMatch(/\baggregateRecommendations\b/);
    expect(action).not.toContain("@/lib/recommendationAggregator");
    expect(trending).not.toMatch(/\bgenerateSmartCandidates\b/);
    expect(trending).not.toMatch(/\bgetAggregatedRecommendations\b/);
    expect(page.match(/\bvoid runSuggest\(\);/g) ?? []).toHaveLength(1);
  });

  it("scans all production TS and TSX for legacy orchestration imports and calls", () => {
    const sourceRoot = resolve(process.cwd(), "src");
    const collectSourceFiles = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return collectSourceFiles(path);
        return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
      });

    const sourceFiles = collectSourceFiles(sourceRoot);
    const integratedSources = sourceFiles.filter(
      (filePath) => basename(filePath) !== "recommendationAggregator.ts",
    );
    const source = integratedSources
      .map((filePath) => readFileSync(filePath, "utf8"))
      .join("\n");

    expect(source).not.toMatch(
      /(?:from\s+["'][^"']+|import\s*\([^)]*)\b(?:generateSmartCandidates|getAggregatedRecommendations)\b/,
    );
    expect(source).not.toMatch(
      /\b(?:generateSmartCandidates|getAggregatedRecommendations)\s*\(/,
    );
    expect(source).not.toMatch(/from\s+["'][^"']*recommendationAggregator["']/);
  });
});
