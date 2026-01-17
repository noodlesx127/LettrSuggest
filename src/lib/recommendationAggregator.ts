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

  console.log("[Aggregator] Starting multi-source aggregation", {
    seedCount: seedMovies.length,
    limit,
  });

  // Fetch from all sources in parallel
  const [tmdbRecs, tastediveRecs, traktRecs, watchmodeRecs] =
    await Promise.allSettled([
      fetchTMDBRecommendations(seedMovies),
      fetchTasteDiveRecommendations(seedMovies),
      fetchTraktRecommendations(seedMovies),
      fetchWatchmodeTrending(),
    ]);

  // Collect all recommendations
  const allRecs: SourceRecommendation[] = [];

  if (tmdbRecs.status === "fulfilled") {
    allRecs.push(...tmdbRecs.value);
    console.log("[Aggregator] TMDB recommendations:", tmdbRecs.value.length);
  }

  if (tastediveRecs.status === "fulfilled") {
    allRecs.push(...tastediveRecs.value);
    console.log(
      "[Aggregator] TasteDive recommendations:",
      tastediveRecs.value.length,
    );
  }

  if (traktRecs.status === "fulfilled") {
    allRecs.push(...traktRecs.value);
    console.log("[Aggregator] Trakt recommendations:", traktRecs.value.length);
  }

  if (watchmodeRecs.status === "fulfilled") {
    allRecs.push(...watchmodeRecs.value);
    console.log(
      "[Aggregator] Watchmode recommendations:",
      watchmodeRecs.value.length,
    );
  }

  // Merge and deduplicate by TMDB ID
  const aggregated = mergeRecommendations(allRecs);

  console.log("[Aggregator] Merged recommendations:", {
    total: allRecs.length,
    unique: aggregated.length,
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

  // Log source distribution in top results
  const sourceStats = {
    trakt: scored.filter((r) => r.sources.some((s) => s.source === "trakt"))
      .length,
    tastedive: scored.filter((r) =>
      r.sources.some((s) => s.source === "tastedive"),
    ).length,
    tmdb: scored.filter((r) => r.sources.some((s) => s.source === "tmdb"))
      .length,
    watchmode: scored.filter((r) =>
      r.sources.some((s) => s.source === "watchmode"),
    ).length,
  };

  console.log("[Aggregator] Top recommendations by consensus:", {
    high: scored.filter((r) => r.consensusLevel === "high").length,
    medium: scored.filter((r) => r.consensusLevel === "medium").length,
    low: scored.filter((r) => r.consensusLevel === "low").length,
  });
  console.log(
    "[Aggregator] Source representation in top results:",
    sourceStats,
  );

  return scored;
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
      // Add this source to existing recommendation
      existing.sources.push({
        source: rec.source,
        confidence: rec.confidence,
        reason: rec.reason,
      });
    } else {
      // Create new aggregated recommendation
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
  // Balanced weights: consensus matters more than source identity
  // Range narrowed from 0.6-1.4 to 0.95-1.15 for fairer scoring
  const sourceWeights: Record<RecommendationSource, number> = {
    tmdb: 1.0, // Baseline - reliable mainstream recommendations
    tastedive: 1.1, // Slight boost - good at finding non-obvious matches
    trakt: 1.15, // Slight boost - community-driven quality
    tuimdb: 1.0, // Baseline - good for genre matching
    watchmode: 0.95, // Slight reduction - trending but less personalized
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

  // Extra bonus when high-quality sources (Trakt/TasteDive) are present
  const sourceNames = rec.sources.map((s) => s.source);
  // Reduced quality source bonus since weights are now more balanced
  const hasTrakt = sourceNames.includes("trakt");
  const hasTasteDive = sourceNames.includes("tastedive");
  const qualitySourceBonus = (hasTrakt ? 0.05 : 0) + (hasTasteDive ? 0.05 : 0);

  return totalScore / totalWeight + consensusBonus + qualitySourceBonus;
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
        const tmdbId = searchResults[0].id;
        recommendations.push({
          source: "tastedive",
          tmdbId,
          title: result.Name,
          confidence: 0.88, // TasteDive has excellent cross-media intelligence (boosted)
          reason: "Similar content via TasteDive",
        });
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
