/**
 * Multi-Source Recommendation Aggregator
 *
 * Combines recommendations from 4 active sources:
 * 1. TMDB - Similar/recommended movies
 * 2. TasteDive - Cross-media similar content
 * 3. Trakt - Community-driven related movies
 * 4. Watchmode - Trending content
 *
 * Note: TuiMDB is defined in the type for future use but not yet implemented.
 *
 * Strategy: More sources agreeing = higher confidence = better recommendation
 */

import { searchMovies } from "./movieAPI";
import { getSimilarContent } from "./tastedive";
import { getTrendingTitles } from "./watchmode";

// Note: 'tuimdb' is defined for future use but not yet implemented in aggregation
export type RecommendationSource =
  | "tmdb"
  | "tastedive"
  | "trakt"
  | "tuimdb"
  | "watchmode";

export type SourceRecommendation = {
  source: RecommendationSource;
  tmdbId: number;
  title: string;
  confidence: number; // 0-1 score
  reason?: string;
};

export type AggregatedRecommendation = {
  tmdbId: number;
  title: string;
  score: number; // Weighted aggregate score
  sources: Array<{
    source: RecommendationSource;
    confidence: number;
    reason?: string;
  }>;
  consensusLevel: "high" | "medium" | "low"; // How many sources agree
};

/**
 * Aggregate recommendations from multiple sources
 * More sources = higher confidence = higher ranking
 */
export async function aggregateRecommendations(params: {
  seedMovies: Array<{ tmdbId: number; title: string; imdbId?: string }>;
  limit?: number;
}): Promise<AggregatedRecommendation[]> {
  const { seedMovies, limit = 50 } = params;
  const startTime = Date.now();

  console.log("[Aggregator] Starting multi-source aggregation", {
    seedCount: seedMovies.length,
    limit,
  });

  // Fetch from all sources in parallel
  const sourceFetchStart = Date.now();
  const [tmdbRecs, tastediveRecs, traktRecs, watchmodeRecs] =
    await Promise.allSettled([
      fetchTMDBRecommendations(seedMovies),
      fetchTasteDiveRecommendations(seedMovies),
      fetchTraktRecommendations(seedMovies),
      fetchWatchmodeTrending(),
    ]);
  const sourceFetchElapsed = Date.now() - sourceFetchStart;

  // Collect all recommendations
  const allRecs: SourceRecommendation[] = [];

  if (tmdbRecs.status === "fulfilled") {
    allRecs.push(...tmdbRecs.value);
    console.log("[Aggregator] TMDB recommendations:", tmdbRecs.value.length);
  } else {
    console.error("[Aggregator] TMDB fetch failed:", tmdbRecs.reason);
  }

  if (tastediveRecs.status === "fulfilled") {
    allRecs.push(...tastediveRecs.value);
    console.log(
      "[Aggregator] TasteDive recommendations:",
      tastediveRecs.value.length,
    );
  } else {
    console.error("[Aggregator] TasteDive fetch failed:", tastediveRecs.reason);
  }

  if (traktRecs.status === "fulfilled") {
    allRecs.push(...traktRecs.value);
    console.log("[Aggregator] Trakt recommendations:", traktRecs.value.length);
  } else {
    console.error("[Aggregator] Trakt fetch failed:", traktRecs.reason);
  }

  if (watchmodeRecs.status === "fulfilled") {
    allRecs.push(...watchmodeRecs.value);
    console.log(
      "[Aggregator] Watchmode recommendations:",
      watchmodeRecs.value.length,
    );
  } else {
    console.error("[Aggregator] Watchmode fetch failed:", watchmodeRecs.reason);
  }

  console.log(
    `[Aggregator] Source fetching completed in ${sourceFetchElapsed}ms`,
  );

  // Merge and deduplicate by TMDB ID
  const mergedRecs = mergeRecommendations(allRecs);

  // Filter out Watchmode-only entries - these are generic trending content
  // without any personalization signal. Only keep Watchmode recs that also
  // appear in at least one personalized source (TMDB similar, TasteDive, Trakt)
  const aggregated = mergedRecs.filter((rec) => {
    const isWatchmodeOnly =
      rec.sources.length === 1 && rec.sources[0].source === "watchmode";
    if (isWatchmodeOnly) {
      console.log("[Aggregator] Filtering Watchmode-only:", rec.title);
    }
    return !isWatchmodeOnly;
  });

  console.log("[Aggregator] After Watchmode filter:", {
    beforeFilter: mergedRecs.length,
    afterFilter: aggregated.length,
    filtered: mergedRecs.length - aggregated.length,
  });

  // Calculate consensus scores and sort
  const scored = aggregated
    .map((rec) => ({
      ...rec,
      score: calculateAggregateScore(rec),
      consensusLevel: getConsensusLevel(rec.sources.length),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Log comprehensive source distribution and quality metrics
  logSourceDistribution(scored);
  logReasonQuality(scored);
  logTopRecommendations(scored);

  // Log timing information
  const elapsed = Date.now() - startTime;
  console.log(
    `[Aggregator] Completed in ${elapsed}ms with ${scored.length} recommendations`,
  );

  return scored;
}

/**
 * Log source distribution across final recommendations
 * Tracks which sources contributed and how often multiple sources agree
 */
function logSourceDistribution(recommendations: AggregatedRecommendation[]) {
  if (recommendations.length === 0) {
    console.log(
      "[Aggregator] Source Distribution: No recommendations to analyze",
    );
    return;
  }

  const sourceCount: Record<string, number> = {};
  const multiSourceCount = { single: 0, multi: 0 };

  for (const rec of recommendations) {
    const sources = rec.sources || [];
    if (sources.length === 1) {
      multiSourceCount.single++;
    } else {
      multiSourceCount.multi++;
    }

    for (const src of sources) {
      sourceCount[src.source] = (sourceCount[src.source] || 0) + 1;
    }
  }

  const total = recommendations.length;
  console.log("[Aggregator] Source Distribution:", {
    total,
    bySource: Object.entries(sourceCount).map(([source, count]) => ({
      source,
      count,
      percent: ((count / total) * 100).toFixed(1) + "%",
    })),
    singleSource: multiSourceCount.single,
    multiSource: multiSourceCount.multi,
    consensusRate: ((multiSourceCount.multi / total) * 100).toFixed(1) + "%",
  });

  // Consensus level breakdown
  console.log("[Aggregator] Consensus Breakdown:", {
    high: recommendations.filter((r) => r.consensusLevel === "high").length,
    medium: recommendations.filter((r) => r.consensusLevel === "medium").length,
    low: recommendations.filter((r) => r.consensusLevel === "low").length,
  });

  // Check if we're meeting the goal: TasteDive/Trakt > 40%
  const tastediveCount = sourceCount["tastedive"] || 0;
  const traktCount = sourceCount["trakt"] || 0;
  const qualitySourceTotal = tastediveCount + traktCount;
  const qualitySourceRate = (qualitySourceTotal / (total * 2)) * 100; // Divide by total*2 since each rec can have both

  console.log("[Aggregator] Quality Source Metrics:", {
    tastedive: tastediveCount,
    trakt: traktCount,
    qualitySourceRate: qualitySourceRate.toFixed(1) + "%",
    goalMet: qualitySourceRate > 40 ? "✓ YES" : "✗ NO (goal: >40%)",
  });
}

/**
 * Log recommendation reason quality
 * Tracks how personalized vs generic the recommendation reasons are
 */
function logReasonQuality(recommendations: AggregatedRecommendation[]) {
  if (recommendations.length === 0) {
    console.log("[Aggregator] Reason Quality: No recommendations to analyze");
    return;
  }

  const reasonStats = {
    personalized: 0, // "Because you loved X", "Similar to X"
    generic: 0, // "Trending", "Popular"
    sourceSpecific: 0, // "Via TasteDive", "Trakt community pick"
    noReason: 0,
  };

  for (const rec of recommendations) {
    // Check all source reasons for this recommendation
    let hasPersonalized = false;
    let hasGeneric = false;
    let hasSourceSpecific = false;

    for (const source of rec.sources) {
      const reason = source.reason || "";

      if (
        reason.includes("you loved") ||
        reason.includes("Similar to") ||
        reason.includes("Recommended based on")
      ) {
        hasPersonalized = true;
      } else if (reason.includes("Trending") || reason.includes("Popular")) {
        hasGeneric = true;
      } else if (
        reason.includes("TasteDive") ||
        reason.includes("Trakt community") ||
        reason.includes("Related to")
      ) {
        hasSourceSpecific = true;
      }
    }

    // Categorize based on priority: personalized > sourceSpecific > generic
    if (hasPersonalized) {
      reasonStats.personalized++;
    } else if (hasSourceSpecific) {
      reasonStats.sourceSpecific++;
    } else if (hasGeneric) {
      reasonStats.generic++;
    } else {
      reasonStats.noReason++;
    }
  }

  const total = recommendations.length;
  console.log("[Aggregator] Reason Quality:", {
    ...reasonStats,
    personalizedRate:
      ((reasonStats.personalized / total) * 100).toFixed(1) + "%",
    sourceSpecificRate:
      ((reasonStats.sourceSpecific / total) * 100).toFixed(1) + "%",
    genericRate: ((reasonStats.generic / total) * 100).toFixed(1) + "%",
  });
}

/**
 * Log top recommendations with their source breakdown
 * Helps understand why certain movies were selected
 */
function logTopRecommendations(recommendations: AggregatedRecommendation[]) {
  if (recommendations.length === 0) {
    console.log("[Aggregator] Top Recommendations: None available");
    return;
  }

  const topN = Math.min(10, recommendations.length);
  const top = recommendations.slice(0, topN);

  console.log(`[Aggregator] Top ${topN} Recommendations with Sources:`);
  for (let i = 0; i < top.length; i++) {
    const rec = top[i];
    const sources = rec.sources || [];
    const sourceList = sources.map((s) => s.source).join(", ") || "unknown";
    const reasonSample = sources[0]?.reason || "No reason";

    console.log(`  ${i + 1}. ${rec.title || `TMDB ${rec.tmdbId}`}`, {
      score: rec.score.toFixed(2),
      consensus: rec.consensusLevel,
      sources: sourceList,
      sourceCount: sources.length,
      sampleReason: reasonSample,
    });
  }
}

/**
 * Merge recommendations from multiple sources
 * Groups by TMDB ID and combines source information
 */
function mergeRecommendations(
  recs: SourceRecommendation[],
): AggregatedRecommendation[] {
  const grouped = new Map<number, AggregatedRecommendation>();

  for (const rec of recs) {
    const existing = grouped.get(rec.tmdbId);

    if (existing) {
      // Prefer non-empty title (Trakt returns empty titles)
      if (!existing.title && rec.title) {
        existing.title = rec.title;
      }
      // Add this source to existing recommendation
      existing.sources.push({
        source: rec.source,
        confidence: rec.confidence,
        reason: rec.reason,
      });
    } else {
      // Create new aggregated recommendation
      // Note: Title may be empty (e.g., Trakt) - will be filled when other sources add same movie
      grouped.set(rec.tmdbId, {
        tmdbId: rec.tmdbId,
        title: rec.title,
        score: 0, // Will be calculated later
        sources: [
          {
            source: rec.source,
            confidence: rec.confidence,
            reason: rec.reason,
          },
        ],
        consensusLevel: "low", // Will be calculated later
      });
    }
  }

  return Array.from(grouped.values());
}

// Number of actually implemented recommendation sources
// Update this constant if TuiMDB or other sources are added/removed
const ACTIVE_SOURCE_COUNT = 4; // tmdb, tastedive, trakt, watchmode

/**
 * Calculate weighted score based on:
 * 1. Number of sources (more = better)
 * 2. Source reliability weights
 * 3. Individual source confidence
 */
function calculateAggregateScore(rec: AggregatedRecommendation): number {
  // Rebalanced weights: Boost niche/personalized sources, reduce generic ones
  // This helps unique discoveries from TasteDive/Trakt compete with mainstream TMDB results
  const sourceWeights: Record<RecommendationSource, number> = {
    tmdb: 0.85, // Reduced - already dominant, favors mainstream
    tastedive: 1.3, // Boosted - excellent at finding niche/non-obvious matches
    trakt: 1.25, // Boosted - community-driven curation, quality signal
    tuimdb: 1.05, // Slight boost if implemented
    watchmode: 0.9, // Reduced - trending = generic, not personalized
  };

  let totalScore = 0;
  let totalWeight = 0;

  for (const source of rec.sources) {
    const weight = sourceWeights[source.source];
    totalScore += source.confidence * weight;
    totalWeight += weight;
  }

  // Bonus for consensus (multiple sources agreeing)
  // Divide by ACTIVE_SOURCE_COUNT so movies appearing in all active sources get full bonus
  const consensusBonus =
    Math.min(rec.sources.length / ACTIVE_SOURCE_COUNT, 1.0) * 0.3;

  // Quality source bonus (TasteDive/Trakt are better for personalized niche finds)
  // Combined with the uniqueness bonus below, this ensures niche sources compete with consensus
  const sourceNames = rec.sources.map((s) => s.source);
  const hasTrakt = sourceNames.includes("trakt");
  const hasTasteDive = sourceNames.includes("tastedive");
  const qualitySourceBonus = (hasTrakt ? 0.05 : 0) + (hasTasteDive ? 0.05 : 0);

  // Uniqueness bonus: Single-source discoveries are often niche finds worth surfacing
  // Particularly valuable when the source is TasteDive or Trakt
  const isUniqueFind = rec.sources.length === 1;
  const uniqueSource = isUniqueFind ? rec.sources[0].source : null;
  const uniquenessBonus = isUniqueFind
    ? uniqueSource === "tastedive" || uniqueSource === "trakt"
      ? 0.2
      : 0.1
    : 0;

  return (
    totalScore / totalWeight +
    consensusBonus +
    qualitySourceBonus +
    uniquenessBonus
  );
}

/**
 * Determine consensus level based on number of sources
 */
function getConsensusLevel(sourceCount: number): "high" | "medium" | "low" {
  if (sourceCount >= 4) return "high"; // 4-5 sources agree
  if (sourceCount >= 2) return "medium"; // 2-3 sources agree
  return "low"; // 1 source
}

/**
 * Fetch TMDB recommendations for seed movies
 * Uses TMDB's similar/recommended endpoints
 */
async function fetchTMDBRecommendations(
  seedMovies: Array<{ tmdbId: number; title: string }>,
): Promise<SourceRecommendation[]> {
  const recommendations: SourceRecommendation[] = [];

  // Use top 10 seeds for more diverse recommendations
  const seeds = seedMovies.slice(0, 10);

  console.log("[Aggregator] Fetching TMDB recommendations", {
    seedCount: seeds.length,
    seeds: seeds.map((s) => s.title),
  });

  for (const seed of seeds) {
    try {
      // Fetch from our TMDB movie endpoint which includes similar/recommendations
      const baseUrl =
        typeof window === "undefined"
          ? process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
          : typeof self !== "undefined" && self.location
            ? self.location.origin
            : "http://localhost:3000";
      const u = new URL("/api/tmdb/movie", baseUrl);
      u.searchParams.set("id", String(seed.tmdbId));
      u.searchParams.set("append_to_response", "similar,recommendations");

      const response = await fetch(u.toString());
      if (!response.ok) continue;

      const data = await response.json();
      if (!data.ok || !data.movie) continue;

      const movie = data.movie;

      // Process similar movies
      const similarMovies = movie.similar?.results || [];
      for (const similar of similarMovies.slice(0, 10)) {
        recommendations.push({
          source: "tmdb" as const,
          tmdbId: similar.id,
          title: similar.title,
          confidence: 0.85,
          reason: `Similar to "${seed.title}"`,
        });
      }

      // Process recommended movies
      const recommendedMovies = movie.recommendations?.results || [];
      for (const rec of recommendedMovies.slice(0, 10)) {
        // Avoid duplicates
        if (!recommendations.some((r) => r.tmdbId === rec.id)) {
          recommendations.push({
            source: "tmdb" as const,
            tmdbId: rec.id,
            title: rec.title,
            confidence: 0.9, // Recommendations are slightly more reliable
            reason: `Recommended based on "${seed.title}"`,
          });
        }
      }

      console.log("[Aggregator] TMDB recommendations for:", seed.title, {
        similar: similarMovies.length,
        recommended: recommendedMovies.length,
      });
    } catch (error) {
      console.error("[Aggregator] TMDB fetch error:", error);
    }
  }

  return recommendations;
}

/**
 * Calculate title similarity for fuzzy matching
 * Returns a score from 0.0 (no match) to 1.0 (exact match)
 */
function titleSimilarity(a: string, b: string): number {
  // Preserve spaces for word splitting, remove other special chars
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const na = normalize(a);
  const nb = normalize(b);

  // Handle empty strings
  if (na.length === 0 || nb.length === 0) return 0;

  // Exact match after normalization
  if (na === nb) return 1.0;

  // One title contains the other (e.g., "Alien" and "Alien Director's Cut")
  if (na.includes(nb) || nb.includes(na)) return 0.8;

  // Calculate word overlap
  const words1 = na.split(/\s+/);
  const words2 = nb.split(/\s+/);

  const overlap = words1.filter((w) => words2.includes(w)).length;
  return overlap / Math.max(words1.length, words2.length);
}

/**
 * Fetch TasteDive recommendations for seed movies
 * Uses TasteDive's similar content API
 */
async function fetchTasteDiveRecommendations(
  seedMovies: Array<{ tmdbId: number; title: string }>,
): Promise<SourceRecommendation[]> {
  const recommendations: SourceRecommendation[] = [];

  try {
    // Use top 10 seed movies for TasteDive query for more diverse results
    const seeds = seedMovies.slice(0, 10);
    // Don't use movie: prefix - just use clean titles with type=movie parameter
    const query = seeds
      .map((s) => {
        // Remove special characters that might cause API issues
        return s.title
          .replace(/[&+#:]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      })
      .join(", ");

    console.log("[Aggregator] Fetching TasteDive recommendations", {
      query,
      seedCount: seeds.length,
    });

    const results = await getSimilarContent(query, {
      type: "movie", // Type is required by TasteDive API
      info: false,
      limit: 20, // TasteDive max is 20
    });

    for (const result of results) {
      // Search for TMDB ID by title
      const searchResults = await searchMovies({
        query: result.Name,
        preferTuiMDB: false,
      });

      if (searchResults.length > 0) {
        const tmdbMatch = searchResults[0];

        // Verify title similarity to avoid false matches
        const similarity = titleSimilarity(result.Name, tmdbMatch.title);

        // Skip very poor matches (likely wrong movie)
        if (similarity < 0.3) {
          console.log(
            `[Aggregator] TasteDive skip: "${result.Name}" → "${tmdbMatch.title}" (similarity: ${similarity.toFixed(2)})`,
          );
          continue;
        }

        // Base confidence for TasteDive (excellent cross-media intelligence)
        const baseConfidence = 0.88;

        // Adjust confidence based on match quality
        let adjustedConfidence: number;
        if (similarity >= 0.8) {
          // Strong match (exact or very close)
          adjustedConfidence = baseConfidence;
        } else if (similarity >= 0.5) {
          // Moderate match (probably correct but not certain)
          adjustedConfidence = baseConfidence * 0.7; // 0.616
        } else {
          // Weak match (possible but uncertain)
          adjustedConfidence = baseConfidence * 0.4; // 0.352
        }

        recommendations.push({
          source: "tastedive",
          tmdbId: tmdbMatch.id,
          title: result.Name,
          confidence: adjustedConfidence,
          reason: `Similar content via TasteDive (match: ${Math.round(similarity * 100)}%)`,
        });

        // Log match quality for monitoring
        if (similarity < 0.8) {
          console.log(
            `[Aggregator] TasteDive fuzzy match: "${result.Name}" → "${tmdbMatch.title}" (similarity: ${similarity.toFixed(2)}, confidence: ${adjustedConfidence.toFixed(2)})`,
          );
        }
      }
    }

    console.log("[Aggregator] TasteDive found:", recommendations.length);
  } catch (error) {
    console.error("[Aggregator] TasteDive fetch error:", error);
  }

  return recommendations;
}

/**
 * Fetch Trakt recommendations for seed movies
 * Uses existing Trakt related movies functionality
 */
async function fetchTraktRecommendations(
  seedMovies: Array<{ tmdbId: number; title: string }>,
): Promise<SourceRecommendation[]> {
  const recommendations: SourceRecommendation[] = [];

  try {
    // Fetch related movies from Trakt for top 10 seeds for broader coverage
    const seeds = seedMovies.slice(0, 10);

    for (const seed of seeds) {
      try {
        const baseUrl =
          typeof window === "undefined"
            ? process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
            : typeof self !== "undefined" && self.location
              ? self.location.origin
              : "http://localhost:3000";
        const u = new URL("/api/trakt/related", baseUrl);
        u.searchParams.set("id", String(seed.tmdbId));
        u.searchParams.set("limit", "15"); // Increased from 10

        const response = await fetch(u.toString());
        if (!response.ok) continue;

        const data = await response.json();
        if (!data.ok || !data.ids) continue;

        // Trakt returns TMDB IDs directly
        for (const tmdbId of data.ids) {
          // Avoid duplicates
          if (!recommendations.some((r) => r.tmdbId === tmdbId)) {
            recommendations.push({
              source: "trakt" as const,
              tmdbId,
              title: "", // We don't have the title from Trakt API response
              confidence: 0.9, // Community-driven (boosted - Trakt has best quality recs)
              reason: `Related to "${seed.title}" (Trakt community)`,
            });
          }
        }

        console.log("[Aggregator] Trakt related for:", seed.title, {
          count: data.ids?.length || 0,
        });
      } catch (err) {
        console.error("[Aggregator] Trakt error for seed:", seed.title, err);
      }
    }

    console.log(
      "[Aggregator] Trakt total recommendations:",
      recommendations.length,
    );
  } catch (error) {
    console.error("[Aggregator] Trakt fetch error:", error);
  }

  return recommendations;
}

/**
 * Fetch Watchmode trending titles
 * Supplements recommendations with popular content
 */
async function fetchWatchmodeTrending(): Promise<SourceRecommendation[]> {
  const recommendations: SourceRecommendation[] = [];

  try {
    console.log("[Aggregator] Fetching Watchmode trending");

    const trending = await getTrendingTitles({
      limit: 20,
      type: "movie",
    });

    for (const title of trending) {
      if (title.tmdb_id) {
        recommendations.push({
          source: "watchmode",
          tmdbId: title.tmdb_id,
          title: title.title,
          confidence: 0.6, // Trending is less personalized
          reason: "Trending on streaming services",
        });
      }
    }

    console.log(
      "[Aggregator] Watchmode trending found:",
      recommendations.length,
    );
  } catch (error) {
    console.error("[Aggregator] Watchmode fetch error:", error);
  }

  return recommendations;
}
