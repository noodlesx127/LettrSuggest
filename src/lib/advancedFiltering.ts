/**
 * Advanced Filtering for Movie Suggestions
 * Applies subgenre-level filtering and cross-genre boost logic
 */

import { type TMDBMovie } from "./enrich";
import { type EnhancedTasteProfile } from "./enhancedProfile";
import {
  shouldFilterBySubgenre,
  boostForCrossGenreMatch,
  generateSubgenreReport,
} from "./subgenreDetection";

export type FilterResult = {
  shouldFilter: boolean;
  reason?: string;
  boost?: number;
  boostReason?: string;
};

export const MIN_GENRE_SCORE = 15;

export type FilterRelaxation = "threshold" | "genre";

export type AdvancedFilteringCandidate = {
  tmdbId: number;
  score: number;
  reasons?: readonly string[];
};

export type GenreFilterDiagnostics = {
  reasons: Array<"insufficient_eligible_supply">;
  appliedStages: FilterRelaxation[];
  strictCount: number;
  thresholdCount: number;
  genreCount: number;
};

export type GenreFilterResult<T> = {
  candidates: T[];
  diagnostics: GenreFilterDiagnostics;
};

function compareCandidates(
  left: AdvancedFilteringCandidate,
  right: AdvancedFilteringCandidate,
): number {
  const leftScore = Number.isFinite(left.score)
    ? left.score
    : Number.NEGATIVE_INFINITY;
  const rightScore = Number.isFinite(right.score)
    ? right.score
    : Number.NEGATIVE_INFINITY;

  return rightScore - leftScore || left.tmdbId - right.tmdbId;
}

function canonicalizeFilterValue(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Return a stable score order without mutating or deduplicating candidates.
 * Scores are expected to already include all scoring-stage boosts.
 */
export function stableScoreOrder<T extends AdvancedFilteringCandidate>(
  candidates: readonly T[],
): T[] {
  return [...candidates].sort(compareCandidates);
}

/**
 * Apply strict genre eligibility and opt-in staged relaxation.
 *
 * With a genre request, strict eligibility requires both a canonical genre
 * match and MIN_GENRE_SCORE. Threshold relaxation adds lower-scoring matches;
 * genre relaxation then adds nonmatching candidates only if matching supply
 * is still below the requested count.
 */
export function filterCandidatesByGenre<
  T extends AdvancedFilteringCandidate & { genres?: readonly string[] },
>(
  candidates: readonly T[],
  options: {
    requestedGenreNames: readonly string[];
    requestedCount: number;
    filterRelaxation?: FilterRelaxation;
    minimumScore?: number;
  },
): GenreFilterResult<T> {
  const ordered = candidates.filter((candidate) =>
    Number.isFinite(candidate.score),
  );
  const requestedCount = Math.max(0, Math.floor(options.requestedCount));
  const requestedNames = options.requestedGenreNames;
  const hasGenreRequest = requestedNames.length > 0;
  const requestedGenres = new Set(
    requestedNames.map(canonicalizeFilterValue).filter(Boolean),
  );

  if (!hasGenreRequest) {
    return {
      candidates: ordered.slice(0, requestedCount),
      diagnostics: {
        reasons: [],
        appliedStages: [],
        strictCount: ordered.length,
        thresholdCount: ordered.length,
        genreCount: ordered.length,
      },
    };
  }

  const matchesGenre = (candidate: T) =>
    requestedGenres.size > 0 &&
    (candidate.genres ?? []).some((genre) =>
      requestedGenres.has(canonicalizeFilterValue(genre)),
    );
  const matchingCandidates = ordered.filter(matchesGenre);
  const minimumScore = options.minimumScore ?? MIN_GENRE_SCORE;
  const finiteMatchingCandidates = matchingCandidates.filter((candidate) =>
    Number.isFinite(candidate.score),
  );
  const strictCandidates = finiteMatchingCandidates.filter(
    (candidate) => candidate.score >= minimumScore,
  );
  const thresholdCandidates = finiteMatchingCandidates.filter(
    (candidate) => candidate.score < minimumScore,
  );
  const genreCandidates = ordered.filter(
    (candidate) => !matchesGenre(candidate) && Number.isFinite(candidate.score),
  );
  const diagnostics: GenreFilterDiagnostics = {
    reasons: [],
    appliedStages: [],
    strictCount: strictCandidates.length,
    thresholdCount: finiteMatchingCandidates.length,
    genreCount: finiteMatchingCandidates.length + genreCandidates.length,
  };

  let eligibleCandidates = strictCandidates;

  if (
    strictCandidates.length < requestedCount &&
    options.filterRelaxation !== undefined
  ) {
    if (thresholdCandidates.length > 0) {
      eligibleCandidates = [...strictCandidates, ...thresholdCandidates];
      diagnostics.appliedStages.push("threshold");
    }

    if (
      options.filterRelaxation === "genre" &&
      eligibleCandidates.length < requestedCount
    ) {
      if (genreCandidates.length > 0) {
        eligibleCandidates = [
          ...eligibleCandidates,
          ...genreCandidates,
        ];
        diagnostics.appliedStages.push("genre");
      }
    }
  }

  if (
    strictCandidates.length < requestedCount &&
    eligibleCandidates.length < requestedCount
  ) {
    diagnostics.reasons.push("insufficient_eligible_supply");
  }

  return {
    candidates: eligibleCandidates.slice(0, requestedCount),
    diagnostics,
  };
}

/**
 * Apply advanced filtering to a candidate movie based on user's nuanced preferences
 * Returns whether to filter (exclude) the movie and any score boosts
 */
export function applyAdvancedFiltering(
  candidate: TMDBMovie,
  profile: EnhancedTasteProfile,
  preferSubgenres?: Array<{ key: string; weight: number; count: number }>,
): FilterResult {
  const genres = candidate.genres?.map((g) => g.name) || [];
  // Handle TMDBMovie keyword structure: keywords.keywords or keywords.results (for arrays of objects with id/name)
  const keywordsList =
    (candidate.keywords as any)?.keywords ||
    (candidate.keywords as any)?.results ||
    [];
  const keywords = Array.isArray(keywordsList)
    ? keywordsList.map((k: any) => k.name || k).filter(Boolean)
    : [];
  const keywordIds = Array.isArray(keywordsList)
    ? keywordsList
        .map((k: any) => k.id || 0)
        .filter((id: any) => typeof id === "number" && id > 0)
    : [];
  const title = candidate.title || "";

  // Step 1: Check for subgenre avoidance
  // E.g., user likes Action but avoids Superhero Action
  const subgenreCheck = shouldFilterBySubgenre(
    genres,
    keywords,
    keywordIds, // Added keywordIds
    title,
    profile.subgenrePatterns,
    undefined,
    preferSubgenres,
  );

  if (subgenreCheck.shouldFilter) {
    console.log(
      `[AdvancedFilter] Filtering "${title}" - ${subgenreCheck.reason}`,
    );
    return {
      shouldFilter: true,
      reason: subgenreCheck.reason,
    };
  }

  // Step 2: Check for cross-genre pattern match
  // E.g., user loves Action+Thriller with spy themes
  const crossGenreBoost = boostForCrossGenreMatch(
    genres,
    keywords,
    profile.crossGenrePatterns,
  );

  if (crossGenreBoost.boost > 0) {
    console.log(
      `[AdvancedFilter] Boosting "${title}" by ${crossGenreBoost.boost.toFixed(2)} - ${crossGenreBoost.reason}`,
    );
  }

  return {
    shouldFilter: false,
    boost: crossGenreBoost.boost,
    boostReason: crossGenreBoost.reason,
  };
}

/**
 * Apply negative filtering for explicitly disliked patterns
 */
export function applyNegativeFiltering(
  candidate: TMDBMovie,
  profile: EnhancedTasteProfile,
): { shouldFilter: boolean; reason?: string } {
  const genres = candidate.genres?.map((g) => g.name) || [];
  // Handle TMDBMovie keyword structure
  const keywordsList =
    (candidate.keywords as any)?.keywords ||
    (candidate.keywords as any)?.results ||
    [];
  const keywords = Array.isArray(keywordsList)
    ? keywordsList
        .map((k: any) => (typeof k === "string" ? k : k?.name))
        .filter(
          (keyword: unknown): keyword is string =>
            typeof keyword === "string" && keyword.trim().length > 0,
        )
    : [];
  const genreCombo = genres.slice(0, 2).sort().join("+");

  // Check avoided genre combinations
  if (profile.avoidedGenreCombos.has(genreCombo)) {
    return {
      shouldFilter: true,
      reason: `User avoids genre combo: ${genreCombo}`,
    };
  }

  // Check avoided keywords (with threshold)
  const avoidedKeywords = new Set(
    Array.from(profile.avoidedKeywords, canonicalizeFilterValue).filter(Boolean),
  );
  const matchedAvoidedKeywords = Array.from(
    new Set(
      keywords
        .map(canonicalizeFilterValue)
        .filter((keyword) => avoidedKeywords.has(keyword)),
    ),
  );
  if (matchedAvoidedKeywords.length >= 2) {
    return {
      shouldFilter: true,
      reason: `User avoids keywords: ${matchedAvoidedKeywords.slice(0, 2).join(", ")}`,
    };
  }

  return { shouldFilter: false };
}

/**
 * Check if candidate matches user's niche preferences
 * Returns false (should filter) if candidate is in a niche the user avoids
 */
export function checkNicheCompatibility(
  candidate: TMDBMovie,
  profile: EnhancedTasteProfile,
): { compatible: boolean; reason?: string } {
  const genres = candidate.genres?.map((g) => g.name) || [];
  // Handle TMDBMovie keyword structure: keywords.keywords or keywords.results
  const keywordsList =
    (candidate.keywords as any)?.keywords ||
    (candidate.keywords as any)?.results ||
    [];
  const keywords = Array.isArray(keywordsList)
    ? keywordsList.map((k: any) => k.name || k).filter(Boolean)
    : [];
  const allText = [
    candidate.title?.toLowerCase() || "",
    ...keywords.map((k: string) => String(k).toLowerCase()),
  ].join(" ");

  // Check Anime
  const isAnime =
    genres.some((g) => g.toLowerCase().includes("anime")) ||
    allText.includes("anime") ||
    allText.includes("japanese animation");

  if (isAnime && !profile.nichePreferences.likesAnime) {
    return {
      compatible: false,
      reason: "User has not shown interest in anime",
    };
  }

  // Check Stand-Up Comedy
  const isStandUp =
    allText.includes("stand-up") ||
    allText.includes("stand up comedy") ||
    allText.includes("comedian");

  if (isStandUp && !profile.nichePreferences.likesStandUp) {
    return {
      compatible: false,
      reason: "User has not shown interest in stand-up comedy",
    };
  }

  // Check Food Documentaries
  const isFoodDoc =
    genres.includes("Documentary") &&
    (allText.includes("food") ||
      allText.includes("cooking") ||
      allText.includes("chef") ||
      allText.includes("restaurant"));

  if (isFoodDoc && !profile.nichePreferences.likesFoodDocs) {
    return {
      compatible: false,
      reason: "User has not shown interest in food documentaries",
    };
  }

  // Check Travel Documentaries
  const isTravelDoc =
    genres.includes("Documentary") &&
    (allText.includes("travel") ||
      allText.includes("journey") ||
      allText.includes("explorer") ||
      allText.includes("adventure documentary"));

  if (isTravelDoc && !profile.nichePreferences.likesTravelDocs) {
    return {
      compatible: false,
      reason: "User has not shown interest in travel documentaries",
    };
  }

  return { compatible: true };
}

/**
 * Check runtime compatibility with user's preferences
 */
export function checkRuntimeCompatibility(
  candidate: TMDBMovie,
  profile: EnhancedTasteProfile,
): { compatible: boolean; reason?: string } {
  const runtime = (candidate as any).runtime || 0;

  if (runtime === 0) return { compatible: true };

  const { min, max, avg } = profile.runtimePreferences;

  // If user has consistent runtime preferences, be strict
  if (max > 0 && max - min < 60) {
    // User watches movies in a tight runtime range
    const tolerance = 30; // 30 minutes tolerance

    if (runtime < avg - tolerance || runtime > avg + tolerance) {
      return {
        compatible: false,
        reason: `Runtime (${runtime}min) outside user's typical range (${avg.toFixed(0)}±${tolerance}min)`,
      };
    }
  }

  return { compatible: true };
}

/**
 * Generate human-readable filtering report for debugging
 */
export function generateFilteringReport(profile: EnhancedTasteProfile): string {
  const lines: string[] = [
    "=== Advanced Filtering Report ===",
    "",
    "📊 Subgenre Intelligence:",
    generateSubgenreReport(profile.subgenrePatterns),
    "",
    "🔗 Cross-Genre Patterns:",
  ];

  const topCrossPatterns = Array.from(profile.crossGenrePatterns.entries())
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, 5);

  for (const [combo, pattern] of topCrossPatterns) {
    const keywordSample = Array.from(pattern.keywords).slice(0, 3).join(", ");
    lines.push(
      `  ✅ ${combo}: ${pattern.watched} watched, keywords: ${keywordSample}`,
    );
    lines.push(`     Examples: ${pattern.examples.join(", ")}`);
  }

  lines.push("");
  lines.push("🚫 Avoidance Patterns:");
  lines.push(
    `  Avoided Genre Combos: ${Array.from(profile.avoidedGenreCombos).slice(0, 5).join(", ") || "none"}`,
  );
  lines.push(
    `  Avoided Keywords: ${Array.from(profile.avoidedKeywords).slice(0, 5).join(", ") || "none"}`,
  );

  lines.push("");
  lines.push("🎯 Niche Preferences:");
  lines.push(
    `  Anime: ${profile.nichePreferences.likesAnime ? "✅ Yes" : "❌ No"}`,
  );
  lines.push(
    `  Stand-Up: ${profile.nichePreferences.likesStandUp ? "✅ Yes" : "❌ No"}`,
  );
  lines.push(
    `  Food Docs: ${profile.nichePreferences.likesFoodDocs ? "✅ Yes" : "❌ No"}`,
  );
  lines.push(
    `  Travel Docs: ${profile.nichePreferences.likesTravelDocs ? "✅ Yes" : "❌ No"}`,
  );

  lines.push("");
  lines.push("⏱️ Runtime Preferences:");
  lines.push(
    `  Range: ${profile.runtimePreferences.min}-${profile.runtimePreferences.max} min`,
  );
  lines.push(`  Average: ${profile.runtimePreferences.avg.toFixed(0)} min`);

  return lines.join("\n");
}
