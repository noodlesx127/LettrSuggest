/**
 * Watchmode API Client
 *
 * Purpose: Comprehensive entertainment data including streaming availability,
 * ratings, trending content, and metadata across 200+ services.
 *
 * API Key: Set via WATCHMODE_API_KEY environment variable
 * Rate Limit: Varies by plan
 * Cache Strategy: 24-hour TTL for streaming data (changes frequently)
 */

import {
  getCachedWatchmodeSources,
  setCachedWatchmodeSources,
} from "@/lib/apiCache";

// Cache key space layout for watchmode_cache.tmdb_id (INT4):
//   Positive (1 to ~1,000,000+): Real TMDB IDs (used by getStreamingSourcesByTMDB)
//   Negative (-1 to -1,899,999,999): Watchmode streaming-source IDs (getStreamingSourcesCacheKey)
//   Negative (-1,900,000,000 to -2,000,000,000): Trending query hashes (getTrendingCacheKey)

export interface WatchmodeSource {
  source_id: number;
  name: string; // "Netflix", "Hulu", "Disney+", etc.
  type: "sub" | "buy" | "rent" | "free"; // Subscription, purchase, rental, or free
  region: string; // "US", "GB", "CA", etc.
  web_url: string; // Direct link to watch
  format?: "4K" | "HD" | "SD";
  price?: number; // Price in USD for buy/rent
  seasons?: number; // For TV series
}

export interface WatchmodeTitle {
  id: number; // Watchmode ID
  title: string;
  original_title?: string;
  type: "movie" | "tv_series" | "tv_special" | "short_film";
  year: number;
  popularity_score?: number; // Trending/popularity score from list endpoints
  imdb_id?: string; // e.g., "tt0111161"
  tmdb_id?: number;
  tmdb_type?: "movie" | "tv";
  runtime_minutes?: number;
  user_rating?: number; // Aggregate rating (0-10)
  critic_score?: number; // Metacritic-style score
  us_rating?: string; // "PG-13", "R", etc.
  poster?: string; // Poster URL
  backdrop?: string; // Backdrop URL
  original_language?: string;
  genres?: number[]; // Genre IDs
  genre_names?: string[];
  plot_overview?: string;
  release_date?: string;
}

export interface WatchmodeTitleDetails extends WatchmodeTitle {
  sources?: WatchmodeSource[]; // Streaming availability
  similar_titles?: number[]; // Similar Watchmode IDs
  networks?: Array<{ id: number; name: string }>; // Production networks
}

function getTrendingCacheKey(options?: {
  limit?: number;
  type?: "movie" | "tv_series";
  genre?: number;
  source?: number;
}): number {
  const normalized = JSON.stringify({
    limit: options?.limit ?? 20,
    type: options?.type ?? null,
    genre: options?.genre ?? null,
    source: options?.source ?? null,
  });

  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash * 31 + normalized.charCodeAt(i)) | 0;
  }

  return -2_000_000_000 + (Math.abs(hash || 1) % 100_000_000);
}

function getStreamingSourcesCacheKey(watchmodeId: number): number {
  const key = -(watchmodeId + 1);

  if (key <= -1_900_000_000) {
    console.error(
      `[Watchmode] Cache key overflow: watchmodeId ${watchmodeId} would collide with trending key range. Skipping cache.`,
    );
    return 0;
  }

  return key;
}

async function fetchStreamingSourcesFromApi(
  watchmodeId: number,
  options?: { region?: string },
): Promise<WatchmodeSource[] | null> {
  const apiKey = process.env.WATCHMODE_API_KEY;

  if (!apiKey) {
    console.warn("[Watchmode] API key not configured");
    return [];
  }

  try {
    const params = new URLSearchParams({
      apiKey,
    });

    if (options?.region) {
      params.append("regions", options.region);
    }

    console.log("[Watchmode] Fetching sources for ID:", watchmodeId);

    const response = await fetch(
      `https://api.watchmode.com/v1/title/${watchmodeId}/sources/?${params}`,
    );

    if (!response.ok) {
      console.error("[Watchmode] HTTP error:", response.status);
      return null;
    }

    const sources: WatchmodeSource[] = await response.json();

    console.log("[Watchmode] Found sources", { count: sources.length });
    return sources;
  } catch (error) {
    console.error("[Watchmode] Sources error:", error);
    return null;
  }
}

/**
 * Search for titles on Watchmode
 * Supports search by name, TMDB ID, or IMDB ID
 */
export async function searchWatchmode(
  query: string,
  options?: {
    searchField?: "name" | "imdb_id" | "tmdb_id";
    type?: "movie" | "tv_series";
  },
): Promise<WatchmodeTitle[]> {
  const apiKey = process.env.WATCHMODE_API_KEY;

  if (!apiKey) {
    console.warn("[Watchmode] API key not configured");
    return [];
  }

  try {
    const searchField = options?.searchField || "name";
    const params = new URLSearchParams({
      apiKey,
      search_field: searchField,
      search_value: query,
    });

    if (options?.type) {
      params.append("types", options.type);
    }

    console.log("[Watchmode] Searching", { query, searchField });

    const response = await fetch(
      `https://api.watchmode.com/v1/search/?${params}`,
    );

    if (!response.ok) {
      console.error("[Watchmode] HTTP error:", response.status);
      return [];
    }

    const data: { title_results?: WatchmodeTitle[] } = await response.json();

    if (!data.title_results || data.title_results.length === 0) {
      console.log("[Watchmode] No results found for:", query);
      return [];
    }

    console.log("[Watchmode] Found results", {
      count: data.title_results.length,
    });
    return data.title_results;
  } catch (error) {
    console.error("[Watchmode] Search error:", error);
    return [];
  }
}

/**
 * Get streaming sources for a title
 * Returns where the title is available to watch
 */
export async function getStreamingSources(
  watchmodeId: number,
  options?: { region?: string },
): Promise<WatchmodeSource[]> {
  const cacheKey = getStreamingSourcesCacheKey(watchmodeId);

  try {
    if (cacheKey !== 0) {
      try {
        const cached =
          await getCachedWatchmodeSources<WatchmodeSource>(cacheKey);
        if (cached) {
          return cached;
        }
      } catch (cacheError) {
        console.warn("[Watchmode] Cache read failed:", cacheError);
      }
    }

    const sources = await fetchStreamingSourcesFromApi(watchmodeId, options);
    if (sources === null) {
      return [];
    }

    if (cacheKey !== 0) {
      try {
        await setCachedWatchmodeSources(cacheKey, sources);
      } catch (cacheError) {
        console.warn("[Watchmode] Cache write failed:", cacheError);
      }
    }

    return sources;
  } catch (error) {
    console.error("[Watchmode] Sources error:", error);
    return [];
  }
}

/**
 * Get detailed information about a title
 * Includes metadata, ratings, and optionally streaming sources
 */
export async function getTitleDetails(
  watchmodeId: number,
  options?: { appendSources?: boolean },
): Promise<WatchmodeTitleDetails | null> {
  const apiKey = process.env.WATCHMODE_API_KEY;

  if (!apiKey) {
    console.warn("[Watchmode] API key not configured");
    return null;
  }

  try {
    const params = new URLSearchParams({
      apiKey,
    });

    if (options?.appendSources) {
      params.append("append_to_response", "sources");
    }

    console.log("[Watchmode] Fetching details for ID:", watchmodeId);

    const response = await fetch(
      `https://api.watchmode.com/v1/title/${watchmodeId}/details/?${params}`,
    );

    if (!response.ok) {
      console.error("[Watchmode] HTTP error:", response.status);
      return null;
    }

    const details: WatchmodeTitleDetails = await response.json();

    console.log("[Watchmode] Got title details", { title: details.title });
    return details;
  } catch (error) {
    console.error("[Watchmode] Details error:", error);
    return null;
  }
}

/**
 * Get streaming sources by TMDB ID
 * Convenience function that searches by TMDB ID and returns sources
 */
export async function getStreamingSourcesByTMDB(
  tmdbId: number,
  options?: { region?: string },
): Promise<WatchmodeSource[]> {
  try {
    try {
      const cached = await getCachedWatchmodeSources<WatchmodeSource>(tmdbId);
      if (cached) {
        return cached;
      }
    } catch (cacheError) {
      console.warn("[Watchmode] Cache read failed:", cacheError);
    }

    // First search for the title by TMDB ID
    const results = await searchWatchmode(String(tmdbId), {
      searchField: "tmdb_id",
    });

    if (results.length === 0) {
      console.log("[Watchmode] No match found for TMDB ID:", tmdbId);
      return [];
    }

    const sources = await fetchStreamingSourcesFromApi(results[0].id, options);
    if (sources === null) {
      return [];
    }

    const watchmodeCacheKey = getStreamingSourcesCacheKey(results[0].id);

    try {
      const cacheWrites = [setCachedWatchmodeSources(tmdbId, sources)];

      if (watchmodeCacheKey !== 0) {
        cacheWrites.push(setCachedWatchmodeSources(watchmodeCacheKey, sources));
      }

      await Promise.all(cacheWrites);
    } catch (cacheError) {
      console.warn("[Watchmode] Cache write failed:", cacheError);
    }

    return sources;
  } catch (error) {
    console.error("[Watchmode] Sources by TMDB error:", error);
    return [];
  }
}

/**
 * Get trending titles
 * Returns popular/trending content, optionally filtered by genre or source
 */
export async function getTrendingTitles(options?: {
  limit?: number;
  type?: "movie" | "tv_series";
  genre?: number;
  source?: number; // Streaming service ID
}): Promise<WatchmodeTitle[]> {
  const apiKey = process.env.WATCHMODE_API_KEY;

  if (!apiKey) {
    console.warn("[Watchmode] API key not configured");
    return [];
  }

  const cacheKey = getTrendingCacheKey(options);

  try {
    try {
      const cached = await getCachedWatchmodeSources<WatchmodeTitle>(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (cacheError) {
      console.warn("[Watchmode] Cache read failed:", cacheError);
    }

    const params = new URLSearchParams({
      apiKey,
      limit: String(options?.limit || 20),
    });

    if (options?.type) {
      params.append("types", options.type);
    }

    if (options?.genre) {
      params.append("genres", String(options.genre));
    }

    if (options?.source) {
      params.append("source_ids", String(options.source));
    }

    console.log("[Watchmode] Fetching trending titles");

    const response = await fetch(
      `https://api.watchmode.com/v1/list-titles/?${params}`,
    );

    if (!response.ok) {
      console.error("[Watchmode] HTTP error:", response.status);
      return [];
    }

    const data: { titles?: WatchmodeTitle[] } = await response.json();

    if (!data.titles) {
      console.log("[Watchmode] No trending titles found");
      return [];
    }

    console.log("[Watchmode] Found trending titles", {
      count: data.titles.length,
    });

    try {
      await setCachedWatchmodeSources(cacheKey, data.titles);
    } catch (cacheError) {
      console.warn("[Watchmode] Cache write failed:", cacheError);
    }

    return data.titles;
  } catch (error) {
    console.error("[Watchmode] Trending error:", error);
    return [];
  }
}

/**
 * Convert Watchmode title to TMDB ID for unified API
 */
export function watchmodeToTMDB(title: WatchmodeTitle): number | null {
  return title.tmdb_id || null;
}
