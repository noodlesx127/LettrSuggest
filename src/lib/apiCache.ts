/**
 * API Response Caching Utilities
 *
 * Provides caching layer for external API calls (TMDB, TuiMDB)
 * to reduce API usage and improve performance.
 *
 * Cache Strategy:
 * - Cache-first: Check cache before API call
 * - TTL-based expiration: Different TTLs for different data types
 * - Graceful fallback: Return null on cache miss, caller fetches from API
 */

import type { TasteDiveResult } from "@/lib/tastedive";
import { getSupabaseAdmin, supabase } from "@/lib/supabaseClient";

/**
 * Check if a cache entry is still valid based on TTL
 */
export function isCacheValid(cachedAt: string, ttlDays: number): boolean {
  const cacheDate = new Date(cachedAt);
  const expiryDate = new Date(
    cacheDate.getTime() + ttlDays * 24 * 60 * 60 * 1000,
  );
  return new Date() < expiryDate;
}

function isHourlyCacheValid(cachedAt: string, ttlHours: number): boolean {
  const cacheDate = new Date(cachedAt);
  const expiryDate = new Date(cacheDate.getTime() + ttlHours * 60 * 60 * 1000);
  return new Date() < expiryDate;
}

// ============================================================================
// TMDB Similar/Recommendations Cache
// ============================================================================

export const TMDB_SIMILAR_CACHE_TTL_DAYS = 30;

export interface TMDBSimilarCache {
  similar: number[];
  recommendations: number[];
}

/**
 * Get cached TMDB similar and recommendations for a movie
 * @returns Object with similar and recommendations arrays if cache hit, null if cache miss
 */
export async function getCachedTMDBSimilar(
  tmdbId: number,
): Promise<TMDBSimilarCache | null> {
  if (!supabase) {
    console.warn("[Cache] Supabase client not initialized");
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("tmdb_similar_cache")
      .select("similar_ids, recommendations_ids, cached_at")
      .eq("tmdb_id", tmdbId)
      .single();

    if (error || !data) {
      return null; // Cache miss
    }

    // Check if cache is still valid
    if (!isCacheValid(data.cached_at, TMDB_SIMILAR_CACHE_TTL_DAYS)) {
      console.log(`[Cache] TMDB similar cache expired for ${tmdbId}`);
      return null; // Cache expired
    }

    console.log(`[Cache] TMDB similar cache HIT for ${tmdbId}`);
    return {
      similar: data.similar_ids as number[],
      recommendations: data.recommendations_ids as number[],
    };
  } catch (e) {
    console.error("[Cache] Error reading TMDB similar cache:", e);
    return null;
  }
}

// ============================================================================
// TuiMDB UID Cache
// ============================================================================

export const TUIMDB_UID_CACHE_TTL_DAYS = 30;

/**
 * Get cached TuiMDB UID for a TMDB ID
 * Uses the admin client to bypass RLS restrictions on the cache table.
 * @returns TuiMDB UID (number), null if not found in TuiMDB, undefined if not in cache
 */
export async function getCachedTuiMDBUid(
  tmdbId: number,
): Promise<number | null | undefined> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("tuimdb_uid_cache")
      .select("tuimdb_uid, cached_at")
      .eq("tmdb_id", tmdbId)
      .single();

    if (error || !data) {
      return undefined; // Not in cache
    }

    // Check if cache is still valid
    if (!isCacheValid(data.cached_at, TUIMDB_UID_CACHE_TTL_DAYS)) {
      console.log(`[Cache] TuiMDB UID cache expired for ${tmdbId}`);
      return undefined; // Cache expired
    }

    console.log(
      `[Cache] TuiMDB UID cache HIT for ${tmdbId}: ${data.tuimdb_uid ?? "null"}`,
    );
    return data.tuimdb_uid; // Can be null if movie not found in TuiMDB
  } catch (e) {
    console.error("[Cache] Error reading TuiMDB UID cache:", e);
    return undefined;
  }
}

/**
 * Store TuiMDB UID in cache
 * Uses the admin client to bypass RLS restrictions on the cache table.
 * @param uid TuiMDB UID or null if movie not found in TuiMDB
 */
export async function setCachedTuiMDBUid(
  tmdbId: number,
  uid: number | null,
): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin.from("tuimdb_uid_cache").upsert({
      tmdb_id: tmdbId,
      tuimdb_uid: uid,
      cached_at: new Date().toISOString(),
    });

    if (error) {
      console.error("[Cache] Error writing TuiMDB UID cache:", error);
    } else {
      console.log(
        `[Cache] TuiMDB UID cache SET for ${tmdbId}: ${uid ?? "null"}`,
      );
    }
  } catch (e) {
    console.error("[Cache] Exception writing TuiMDB UID cache:", e);
  }
}

// ============================================================================
// Cache Statistics (Optional - for monitoring)
// ============================================================================

export interface CacheStats {
  tmdbSimilarCacheSize: number;
  tuimdbUidCacheSize: number;
}

/**
 * Get cache statistics (for admin/monitoring)
 */
export async function getCacheStats(): Promise<CacheStats | null> {
  if (!supabase) {
    console.warn("[Cache] Supabase client not initialized");
    return null;
  }

  try {
    const [tmdbSimilar, tuimdb] = await Promise.all([
      supabase
        .from("tmdb_similar_cache")
        .select("tmdb_id", { count: "exact", head: true }),
      supabase
        .from("tuimdb_uid_cache")
        .select("tmdb_id", { count: "exact", head: true }),
    ]);

    return {
      tmdbSimilarCacheSize: tmdbSimilar.count ?? 0,
      tuimdbUidCacheSize: tuimdb.count ?? 0,
    };
  } catch (e) {
    console.error("[Cache] Error getting cache stats:", e);
    return null;
  }
}

// ============================================================================
// OMDb Data Cache (merged with TMDB in tmdb_movies table)
// ============================================================================

export const OMDB_CACHE_TTL_DAYS = 7;

/**
 * Check if OMDb data needs to be refreshed for a movie
 * Returns true if never fetched or if cache is older than 7 days
 */
export async function needsOMDbRefresh(tmdbId: number): Promise<boolean> {
  if (!supabase) {
    console.warn("[Cache] Supabase client not initialized");
    return true; // Fetch if we can't check cache
  }

  try {
    const { data, error } = await supabase
      .from("tmdb_movies")
      .select("omdb_fetched_at")
      .eq("id", tmdbId)
      .single();

    if (error || !data) {
      return true; // Fetch if movie not in cache
    }

    if (!data.omdb_fetched_at) {
      return true; // Fetch if OMDb data never fetched
    }

    // Check if cache is still valid
    const isValid = isCacheValid(data.omdb_fetched_at, OMDB_CACHE_TTL_DAYS);

    if (!isValid) {
      console.log(`[Cache] OMDb cache expired for TMDB ${tmdbId}`);
    }

    return !isValid; // Return true if needs refresh
  } catch (e) {
    console.error("[Cache] Error checking OMDb cache:", e);
    return true; // Fetch on error
  }
}

/**
 * Update OMDb data in tmdb_movies table
 * Used after fetching from OMDb API
 */
export async function updateOMDbCache(
  tmdbId: number,
  omdbData: {
    imdb_rating?: string;
    imdb_votes?: string;
    rotten_tomatoes?: string;
    metacritic?: string;
    awards?: string;
    box_office?: string;
    rated?: string;
    omdb_plot_full?: string;
  },
): Promise<void> {
  if (!supabase) {
    console.warn("[Cache] Supabase client not initialized");
    return;
  }

  try {
    const { error } = await supabase
      .from("tmdb_movies")
      .update({
        ...omdbData,
        omdb_fetched_at: new Date().toISOString(),
      })
      .eq("id", tmdbId);

    if (error) {
      console.error("[Cache] Error updating OMDb cache:", error);
    } else {
      console.log(`[Cache] OMDb cache updated for TMDB ${tmdbId}`);
    }
  } catch (e) {
    console.error("[Cache] Exception updating OMDb cache:", e);
  }
}

// ============================================================================
// TasteDive Similar Content Cache
// ============================================================================

export const TASTEDIVE_CACHE_TTL_DAYS = 7;

/**
 * Get cached TasteDive similar content for a query key
 * @returns Array of TasteDive results if cache hit, null if cache miss
 */
export async function getCachedTasteDiveSimilar(
  movieTitle: string,
): Promise<TasteDiveResult[] | null> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("tastedive_cache")
      .select("similar_titles, cached_at")
      .eq("movie_title", movieTitle)
      .single();

    if (error || !data) {
      return null; // Cache miss
    }

    // Check if cache is still valid
    if (!isCacheValid(data.cached_at, TASTEDIVE_CACHE_TTL_DAYS)) {
      console.log(`[Cache] TasteDive cache expired for "${movieTitle}"`);
      return null; // Cache expired
    }

    console.log(`[Cache] TasteDive cache HIT for "${movieTitle}"`);
    return data.similar_titles as TasteDiveResult[];
  } catch (e) {
    console.warn("[Cache] Error reading TasteDive cache:", e);
    return null;
  }
}

/**
 * Store TasteDive similar content in cache
 */
export async function setCachedTasteDiveSimilar(
  movieTitle: string,
  similarTitles: TasteDiveResult[],
): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin.from("tastedive_cache").upsert({
      movie_title: movieTitle,
      similar_titles: similarTitles,
      cached_at: new Date().toISOString(),
    });

    if (error) {
      console.warn("[Cache] Error writing TasteDive cache:", error);
    } else {
      console.log(
        `[Cache] TasteDive cache SET for "${movieTitle}" (${similarTitles.length} titles)`,
      );
    }
  } catch (e) {
    console.warn("[Cache] Exception writing TasteDive cache:", e);
  }
}

// ============================================================================
// Watchmode Streaming Sources Cache
// ============================================================================

export const WATCHMODE_CACHE_TTL_HOURS = 24; // Streaming availability changes frequently

/**
 * Get cached Watchmode payload for a numeric cache key
 * @returns Cached payload if cache hit, null if cache miss
 */
export async function getCachedWatchmodeSources<T = unknown>(
  cacheKey: number,
): Promise<T[] | null> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("watchmode_cache")
      .select("sources, cached_at")
      .eq("tmdb_id", cacheKey)
      .single();

    if (error || !data) {
      return null; // Cache miss
    }

    // Check if cache is still valid (24 hours)
    if (!isHourlyCacheValid(data.cached_at, WATCHMODE_CACHE_TTL_HOURS)) {
      console.log(`[Cache] Watchmode cache expired for key ${cacheKey}`);
      return null; // Cache expired
    }

    console.log(`[Cache] Watchmode cache HIT for key ${cacheKey}`);
    return data.sources as T[];
  } catch (e) {
    console.warn("[Cache] Error reading Watchmode cache:", e);
    return null;
  }
}

/**
 * Store Watchmode payload data in cache
 */
export async function setCachedWatchmodeSources<T = unknown>(
  cacheKey: number,
  sources: T[],
): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin.from("watchmode_cache").upsert({
      tmdb_id: cacheKey,
      sources: sources,
      cached_at: new Date().toISOString(),
    });

    if (error) {
      console.warn("[Cache] Error writing Watchmode cache:", error);
    } else {
      console.log(
        `[Cache] Watchmode cache SET for key ${cacheKey} (${sources.length} items)`,
      );
    }
  } catch (e) {
    console.warn("[Cache] Exception writing Watchmode cache:", e);
  }
}
