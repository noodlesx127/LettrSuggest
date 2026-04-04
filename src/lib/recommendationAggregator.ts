/**
 * Multi-Source Recommendation Aggregator
 *
 * Combines recommendations from 4 active sources:
 * 1. TMDB - Recommended movies (collaborative filtering via /recommendations endpoint)
 * 2. TasteDive - Cross-media similar content
 * 3. Watchmode - Trending content
 * 4. Vector Similarity - Semantic embedding neighbors
 *
 * Note: TuiMDB is defined in the type for future use but not yet implemented.
 *
 * Strategy: More sources agreeing = higher confidence = better recommendation
 */

import pLimit from "p-limit";

import { generateMovieEmbeddingById } from "./embeddings";
import { searchMovies } from "./movieAPI";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSimilarContent } from "./tastedive";
import {
  getCachedVectorSimilarity,
  setCachedVectorSimilarity,
} from "./vectorSimilarityCache";
import {
  getTitleDetails,
  getTrendingTitles,
  searchWatchmode,
} from "./watchmode";

// Note: 'tuimdb' is defined for future use but not yet implemented in aggregation
export type RecommendationSource =
  | "tmdb"
  | "tastedive"
  | "tuimdb"
  | "watchmode"
  | "watchmode-similar"
  | "vector-similarity";

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
export type SourceDebug = Record<
  string,
  { status: string; count: number; error?: string }
>;

export type AggregateRecommendationsResult = {
  recommendations: AggregatedRecommendation[];
  sourceDebug: SourceDebug;
};

export async function aggregateRecommendations(params: {
  seedMovies: Array<{ tmdbId: number; title: string; imdbId?: string }>;
  limit?: number;
  sourceReliability?: Map<string, number>;
  deadlineMs?: number;
}): Promise<AggregateRecommendationsResult> {
  const { seedMovies, limit = 50, sourceReliability, deadlineMs } = params;
  const startTime = Date.now();

  const withDeadline = <T>(p: Promise<T>, label: string): Promise<T> => {
    if (!deadlineMs) return p;

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new Error(`[Aggregator] ${label} timed out after ${deadlineMs}ms`),
        );
      }, deadlineMs);
    });

    return Promise.race([p, timeoutPromise]).finally(() => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    });
  };

  console.log("[Aggregator] Starting multi-source aggregation", {
    seedCount: seedMovies.length,
    limit,
  });

  // Fetch from all sources in parallel
  const sourceFetchStart = Date.now();
  const [tmdbRecs, tastediveRecs, watchmodeRecs, vectorRecs] =
    await Promise.allSettled([
      withDeadline(fetchTMDBRecommendations(seedMovies), "TMDB"),
      withDeadline(fetchTasteDiveRecommendations(seedMovies), "TasteDive"),
      withDeadline(
        fetchWatchmodeSimilar(seedMovies).then((results) =>
          results.length > 0 ? results : fetchWatchmodeTrending(),
        ),
        "Watchmode",
      ),
      withDeadline(fetchVectorSimilarityRecommendations(seedMovies), "Vector"),
    ]);
  const sourceFetchElapsed = Date.now() - sourceFetchStart;

  const sourceDebug: SourceDebug = {
    tmdb: {
      status: tmdbRecs.status,
      count: tmdbRecs.status === "fulfilled" ? tmdbRecs.value.length : 0,
      ...(tmdbRecs.status === "rejected"
        ? { error: String(tmdbRecs.reason) }
        : {}),
    },
    tastedive: {
      status: tastediveRecs.status,
      count:
        tastediveRecs.status === "fulfilled" ? tastediveRecs.value.length : 0,
      ...(tastediveRecs.status === "rejected"
        ? { error: String(tastediveRecs.reason) }
        : {}),
    },
    watchmode: {
      status: watchmodeRecs.status,
      count:
        watchmodeRecs.status === "fulfilled" ? watchmodeRecs.value.length : 0,
      ...(watchmodeRecs.status === "rejected"
        ? { error: String(watchmodeRecs.reason) }
        : {}),
    },
    vector: {
      status: vectorRecs.status,
      count: vectorRecs.status === "fulfilled" ? vectorRecs.value.length : 0,
      ...(vectorRecs.status === "rejected"
        ? { error: String(vectorRecs.reason) }
        : {}),
    },
  };

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

  if (watchmodeRecs.status === "fulfilled") {
    allRecs.push(...watchmodeRecs.value);
    console.log(
      "[Aggregator] Watchmode recommendations:",
      watchmodeRecs.value.length,
    );
  } else {
    console.error("[Aggregator] Watchmode fetch failed:", watchmodeRecs.reason);
  }

  if (vectorRecs.status === "fulfilled") {
    allRecs.push(...vectorRecs.value);
    console.log(
      "[Aggregator] Vector similarity recommendations:",
      vectorRecs.value.length,
    );
  } else {
    console.error(
      "[Aggregator] Vector similarity fetch failed:",
      vectorRecs.reason,
    );
  }

  console.log(
    `[Aggregator] Source fetching completed in ${sourceFetchElapsed}ms`,
  );

  // Merge and deduplicate by TMDB ID
  const mergedRecs = mergeRecommendations(allRecs);

  // Watchmode-only entries are kept but naturally deprioritized by their lower
  // confidence score and base weight, so they only surface when there are gaps
  // after TMDB, TasteDive, and Vector results.
  const aggregated = mergedRecs;

  console.log(
    `[Aggregator] Watchmode items included (deprioritized): ${mergedRecs.filter((r) => r.sources.length === 1 && r.sources[0].source === "watchmode").length}`,
  );

  // Calculate consensus scores and sort
  const scored = aggregated
    .map((rec) => ({
      ...rec,
      score: calculateAggregateScore(rec, sourceReliability),
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

  return { recommendations: scored, sourceDebug };
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

  // Check if we're meeting the goal: TasteDive > 40%
  const tastediveCount = sourceCount["tastedive"] || 0;
  const qualitySourceTotal = tastediveCount;
  const qualitySourceRate = (qualitySourceTotal / (total * 2)) * 100; // Divide by total*2 since each rec can have both

  console.log("[Aggregator] Quality Source Metrics:", {
    tastedive: tastediveCount,
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
    sourceSpecific: 0, // "Via TasteDive", "Related to"
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
const ACTIVE_SOURCE_COUNT = 4; // tmdb, tastedive, watchmode, vector-similarity

/**
 * Calculate weighted score based on:
 * 1. Number of sources (more = better)
 * 2. Source reliability weights (personalized per-user based on feedback)
 * 3. Individual source confidence
 */
function calculateAggregateScore(
  rec: AggregatedRecommendation,
  sourceReliability?: Map<string, number>,
): number {
  // Base weights: Used as fallback when no user-specific reliability data exists
  const baseWeights: Record<RecommendationSource, number> = {
    tmdb: 0.85, // Reduced - already dominant, favors mainstream
    tastedive: 1.3, // Boosted - excellent at finding niche/non-obvious matches
    tuimdb: 1.05, // Slight boost if implemented
    watchmode: 0.9, // Reduced - trending = generic, not personalized
    "watchmode-similar": 1.0, // Personalized seed-based related titles
    "vector-similarity": 1.0, // Semantic similarity signal
  };

  /**
   * Adjust base weight using user's source reliability feedback
   * reliability ranges from 0-1, we boost weight by up to 50%
   */
  const getAdjustedWeight = (
    source: RecommendationSource,
    baseWeight: number,
  ): number => {
    if (!sourceReliability || !sourceReliability.has(source)) {
      return baseWeight;
    }

    const reliability = sourceReliability.get(source)!;
    // Boost weight by up to 50% based on reliability (0-1 range)
    const bonus = reliability * 0.5;
    return baseWeight * (1 + bonus);
  };

  let totalScore = 0;
  let totalWeight = 0;
  const adjustedWeights: Record<string, number> = {};

  for (const source of rec.sources) {
    const adjustedWeight = getAdjustedWeight(
      source.source,
      baseWeights[source.source],
    );
    adjustedWeights[source.source] = adjustedWeight;
    totalScore += source.confidence * adjustedWeight;
    totalWeight += adjustedWeight;
  }

  // Log adjusted weights for first recommendation (debugging)
  if (Object.keys(adjustedWeights).length > 0 && sourceReliability) {
    console.log("[Aggregator] Sample adjusted weights:", adjustedWeights);
  }

  // Bonus for consensus (multiple sources agreeing)
  // Divide by ACTIVE_SOURCE_COUNT so movies appearing in all active sources get full bonus
  const consensusBonus =
    Math.min(rec.sources.length / ACTIVE_SOURCE_COUNT, 1.0) * 0.5;

  // Quality source bonus (TasteDive is better for personalized niche finds)
  // Gives a small edge to recommendations that include high-quality niche sources
  const sourceNames = rec.sources.map((s) => s.source);
  const hasTasteDive = sourceNames.includes("tastedive");
  const qualitySourceBonus = hasTasteDive ? 0.05 : 0;

  // No uniqueness bonus — single-source finds should not outrank multi-source consensus.
  // The quality of a recommendation is validated by source agreement, not scarcity.
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
 * Uses TMDB's /recommendations endpoint (collaborative filtering)
 */
async function fetchTMDBRecommendations(
  seedMovies: Array<{ tmdbId: number; title: string }>,
): Promise<SourceRecommendation[]> {
  const recommendations: SourceRecommendation[] = [];

  // Dynamically scale limit based on seed pool size (5 to 25)
  const dynamicLimit = Math.min(
    Math.max(5, Math.floor(seedMovies.length * 0.15)),
    25,
  );
  // Randomly sample seeds for higher recommendation variety
  const seeds = [...seedMovies]
    .sort(() => Math.random() - 0.5)
    .slice(0, dynamicLimit);

  console.log("[Aggregator] Fetching TMDB recommendations", {
    seedCount: seeds.length,
    seeds: seeds.map((s) => s.title),
  });

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    console.error("[Aggregator] TMDB_API_KEY not configured");
    return recommendations;
  }

  const tmdbLimit = pLimit(5);

  const seedResults = await Promise.allSettled(
    seeds.map((seed) =>
      tmdbLimit(async () => {
        const tmdbUrl = `https://api.themoviedb.org/3/movie/${encodeURIComponent(String(seed.tmdbId))}?api_key=${apiKey}&append_to_response=recommendations`;
        const redactedTmdbUrl = tmdbUrl.replace(
          /api_key=[^&]+/,
          "api_key=REDACTED",
        );

        try {
          const response = await fetch(tmdbUrl, {
            headers: { Accept: "application/json" },
            cache: "no-store",
          });
          if (!response.ok) {
            if (response.status === 404) {
              console.warn(`[Aggregator] TMDB movie not found: ${seed.tmdbId}`);
            } else {
              console.warn(
                `[Aggregator] TMDB fetch failed for ${seed.tmdbId}: HTTP ${response.status}`,
              );
            }
            return [];
          }

          const movie = await response.json();
          if (!movie || movie.success === false) return [];
          const recs: SourceRecommendation[] = [];

          // Only use recommendations (collaborative filtering) — not similar (metadata matching).
          // TMDB's /similar endpoint returns unrelated films based on incidental metadata overlap.
          // /recommendations uses real user behaviour and is significantly more reliable.
          const recommendedMovies = movie.recommendations?.results || [];
          for (const rec of recommendedMovies.slice(0, 20)) {
            recs.push({
              source: "tmdb" as const,
              tmdbId: rec.id,
              title: rec.title,
              confidence: 0.9,
              reason: `Recommended based on "${seed.title}"`,
            });
          }

          console.log("[Aggregator] TMDB recommendations for:", seed.title, {
            recommended: recommendedMovies.length,
          });

          return recs;
        } catch (error) {
          if (error instanceof Error) {
            throw new Error(
              error.message
                .replace(tmdbUrl, redactedTmdbUrl)
                .replace(/api_key=[^&\s]+/, "api_key=REDACTED"),
            );
          }

          throw error;
        }
      }),
    ),
  );

  for (const result of seedResults) {
    if (result.status === "fulfilled") {
      recommendations.push(...result.value);
    } else {
      console.error(
        "[Aggregator] TMDB fetch error:",
        result.reason instanceof Error
          ? result.reason.message.replace(/api_key=[^&\s]+/, "api_key=REDACTED")
          : result.reason,
      );
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
    // Dynamically scale limit based on seed pool size (5 to 25)
    const dynamicLimit = Math.min(
      Math.max(5, Math.floor(seedMovies.length * 0.15)),
      25,
    );
    // Randomly sample seeds for higher recommendation variety
    const seeds = [...seedMovies]
      .sort(() => Math.random() - 0.5)
      .slice(0, dynamicLimit);

    console.log("[Aggregator] Fetching TasteDive recommendations in chunks", {
      totalSeeds: seeds.length,
    });

    const allResults: Array<{ Name: string }> = [];
    const chunkSize = 5; // Chunk size of 5 to maximize TasteDive's 20-limit response per chunk

    // Process in chunks concurrently
    const chunkPromises = [];
    for (let i = 0; i < seeds.length; i += chunkSize) {
      const chunk = seeds.slice(i, i + chunkSize);
      const query = chunk
        .map((s) =>
          s.title
            .replace(/[&+#:]/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .join(", ");

      chunkPromises.push(
        getSimilarContent(query, {
          type: "movie", // Type is required by TasteDive API
          info: false,
          limit: 20, // 20 per chunk yields a much higher total cap
        }).catch((err: any) => {
          console.warn(
            `[Aggregator] TasteDive chunk failed for query "${query}"`,
            err,
          );
          return [];
        }),
      );
    }

    const chunkResults = await Promise.all(chunkPromises);
    const seenTitles = new Set<string>();

    for (const results of chunkResults) {
      for (const result of results) {
        if (!seenTitles.has(result.Name)) {
          seenTitles.add(result.Name);
          allResults.push(result);
        }
      }
    }

    console.log(
      `[Aggregator] TasteDive chunking complete. Found ${allResults.length} raw results.`,
    );

    const searchLimit = pLimit(5);

    const resolvedResults = await Promise.allSettled(
      allResults.map((result) =>
        searchLimit(async () => {
          const searchResults = await searchMovies({
            query: result.Name,
            preferTuiMDB: false,
          });
          return { result, searchResults };
        }),
      ),
    );

    for (const resolved of resolvedResults) {
      if (resolved.status === "rejected") {
        console.warn(
          "[Aggregator] TasteDive ID resolution failed:",
          resolved.reason,
        );
        continue;
      }
      const { result, searchResults } = resolved.value;

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

async function fetchWatchmodeSimilar(
  seedMovies: Array<{ tmdbId: number; title: string }>,
): Promise<SourceRecommendation[]> {
  const limit = pLimit(2);
  const results: SourceRecommendation[] = [];
  const seedsToProcess = seedMovies.slice(0, 3);

  await Promise.allSettled(
    seedsToProcess.map((seed) =>
      limit(async () => {
        try {
          const searchResults = await searchWatchmode(String(seed.tmdbId), {
            searchField: "tmdb_id",
            type: "movie",
          });
          const watchmodeId = searchResults[0]?.id;

          if (!watchmodeId) {
            return;
          }

          const details = await getTitleDetails(watchmodeId, {
            appendSimilarTitles: true,
          });
          const similarIds = details?.similar_titles ?? [];

          if (similarIds.length === 0) {
            return;
          }

          const resolveLimit = pLimit(2);
          await Promise.allSettled(
            similarIds.slice(0, 8).map((wId) =>
              resolveLimit(async () => {
                try {
                  const d = await getTitleDetails(wId);

                  if (d?.tmdb_id) {
                    results.push({
                      tmdbId: d.tmdb_id,
                      title: d.title,
                      source: "watchmode-similar",
                      confidence: 0.6,
                      reason: `Similar to ${seed.title} (Watchmode)`,
                    });
                  }
                } catch (e) {
                  console.warn(
                    "[Watchmode-Similar] Failed resolving similar title wId:",
                    wId,
                    e,
                  );
                }
              }),
            ),
          );
        } catch (e) {
          console.warn(
            "[Watchmode-Similar] Failed processing seed tmdbId:",
            seed.tmdbId,
            e,
          );
        }
      }),
    ),
  );

  const seen = new Set<number>();
  const seedTmdbIds = new Set(seedMovies.map((s) => s.tmdbId));
  return results.filter((r) => {
    if (seen.has(r.tmdbId) || seedTmdbIds.has(r.tmdbId)) {
      return false;
    }

    seen.add(r.tmdbId);
    return true;
  });
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
          confidence: title.popularity_score
            ? Math.min(0.35 + title.popularity_score * 0.05, 0.5)
            : 0.35,
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

/**
 * Fetch vector similarity recommendations for seed movies
 * Uses server-side vector embeddings to find semantic neighbors
 */
async function fetchVectorSimilarityRecommendations(
  seedMovies: Array<{ tmdbId: number; title: string }>,
): Promise<SourceRecommendation[]> {
  const recommendations: SourceRecommendation[] = [];

  try {
    const dynamicLimit = Math.min(
      Math.max(5, Math.floor(seedMovies.length * 0.15)),
      25,
    );
    const seeds = [...seedMovies]
      .sort(() => Math.random() - 0.5)
      .slice(0, dynamicLimit);
    const seedIds = seeds.map((s) => s.tmdbId).filter(Boolean);
    if (seedIds.length === 0) return recommendations;

    const limit = 20;
    const aggregated = new Map<number, { score: number; count: number }>();

    for (const tmdbId of seedIds) {
      const cachedNeighbors = await getCachedVectorSimilarity(tmdbId);
      let neighbors: Array<{ tmdbId: number; similarity: number }> = [];

      if (cachedNeighbors) {
        neighbors = cachedNeighbors.map((id) => ({
          tmdbId: id,
          similarity: 0,
        }));
      } else {
        const embedding = await generateMovieEmbeddingById(tmdbId);
        if (!embedding.length) {
          console.log("[Aggregator] Vector similarity: missing embedding", {
            tmdbId,
          });
          continue;
        }

        try {
          const { data, error } = await supabaseAdmin.rpc(
            "match_movie_embeddings",
            {
              query_embedding: embedding,
              match_count: limit,
            },
          );
          if (!error && Array.isArray(data)) {
            neighbors = data.map((row: Record<string, unknown>) => ({
              tmdbId: Number(row.tmdb_id),
              similarity: Number(row.similarity ?? 0),
            }));
            await setCachedVectorSimilarity(
              tmdbId,
              neighbors.map((n) => n.tmdbId),
            );
          }
        } catch (e) {
          console.error(
            "[Aggregator] Vector similarity neighbor lookup failed",
            e,
          );
        }
      }

      for (const neighbor of neighbors) {
        if (neighbor.tmdbId === tmdbId) continue;
        const current = aggregated.get(neighbor.tmdbId) ?? {
          score: 0,
          count: 0,
        };
        current.score += neighbor.similarity || 0;
        current.count += 1;
        aggregated.set(neighbor.tmdbId, current);
      }
    }

    const sorted = Array.from(aggregated.entries())
      .map(([id, data]) => ({
        tmdbId: id,
        score: data.score + data.count * 0.05,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    for (const rec of sorted) {
      if (!seedIds.includes(rec.tmdbId)) {
        recommendations.push({
          source: "vector-similarity",
          tmdbId: rec.tmdbId,
          title: "",
          confidence: 0.8,
          reason: "Similar vibe (vector match)",
        });
      }
    }

    console.log("[Aggregator] Vector similarity fetched", {
      seedCount: seedIds.length,
      resultCount: recommendations.length,
    });
  } catch (error) {
    console.error("[Aggregator] Vector similarity fetch error:", error);
  }

  return recommendations;
}
