/**
 * API Response Caching Utilities
 * 
 * Provides caching layer for external API calls (Trakt, TMDB, TuiMDB)
 * to reduce API usage and improve performance.
 * 
 * Cache Strategy:
 * - Cache-first: Check cache before API call
 * - TTL-based expiration: Different TTLs for different data types
 * - Graceful fallback: Return null on cache miss, caller fetches from API
 */

import { supabase } from './supabaseClient';

/**
 * Check if a cache entry is still valid based on TTL
 */
function isCacheValid(cachedAt: string, ttlDays: number): boolean {
    const cacheDate = new Date(cachedAt);
    const expiryDate = new Date(cacheDate.getTime() + ttlDays * 24 * 60 * 60 * 1000);
    return new Date() < expiryDate;
}

// ============================================================================
// Trakt Related Movies Cache
// ============================================================================

const TRAKT_CACHE_TTL_DAYS = 7;

/**
 * Get cached Trakt related movies for a seed movie
 * @returns Array of TMDB IDs if cache hit, null if cache miss
 */
export async function getCachedTraktRelated(tmdbId: number): Promise<number[] | null> {
    if (!supabase) {
        console.warn('[Cache] Supabase client not initialized');
        return null;
    }

    try {
        const { data, error } = await supabase
            .from('trakt_related_cache')
            .select('related_ids, cached_at')
            .eq('tmdb_id', tmdbId)
            .single();

        if (error || !data) {
            return null; // Cache miss
        }

        // Check if cache is still valid
        if (!isCacheValid(data.cached_at, TRAKT_CACHE_TTL_DAYS)) {
            console.log(`[Cache] Trakt cache expired for ${tmdbId}`);
            return null; // Cache expired
        }

        console.log(`[Cache] Trakt cache HIT for ${tmdbId}`);
        return data.related_ids as number[];
    } catch (e) {
        console.error('[Cache] Error reading Trakt cache:', e);
        return null;
    }
}

/**
 * Store Trakt related movies in cache
 */
export async function setCachedTraktRelated(tmdbId: number, relatedIds: number[]): Promise<void> {
    if (!supabase) {
        console.warn('[Cache] Supabase client not initialized');
        return;
    }

    try {
        const { error } = await supabase
            .from('trakt_related_cache')
            .upsert({
                tmdb_id: tmdbId,
                related_ids: relatedIds,
                cached_at: new Date().toISOString(),
            });

        if (error) {
            console.error('[Cache] Error writing Trakt cache:', error);
        } else {
            console.log(`[Cache] Trakt cache SET for ${tmdbId} (${relatedIds.length} IDs)`);
        }
    } catch (e) {
        console.error('[Cache] Exception writing Trakt cache:', e);
    }
}

// ============================================================================
// TMDB Similar/Recommendations Cache
// ============================================================================

const TMDB_SIMILAR_CACHE_TTL_DAYS = 7;

export interface TMDBSimilarCache {
    similar: number[];
    recommendations: number[];
}

/**
 * Get cached TMDB similar and recommendations for a movie
 * @returns Object with similar and recommendations arrays if cache hit, null if cache miss
 */
export async function getCachedTMDBSimilar(tmdbId: number): Promise<TMDBSimilarCache | null> {
    if (!supabase) {
        console.warn('[Cache] Supabase client not initialized');
        return null;
    }

    try {
        const { data, error } = await supabase
            .from('tmdb_similar_cache')
            .select('similar_ids, recommendations_ids, cached_at')
            .eq('tmdb_id', tmdbId)
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
        console.error('[Cache] Error reading TMDB similar cache:', e);
        return null;
    }
}

/**
 * Store TMDB similar and recommendations in cache
 */
export async function setCachedTMDBSimilar(
    tmdbId: number,
    similar: number[],
    recommendations: number[]
): Promise<void> {
    if (!supabase) {
        console.warn('[Cache] Supabase client not initialized');
        return;
    }

    try {
        const { error } = await supabase
            .from('tmdb_similar_cache')
            .upsert({
                tmdb_id: tmdbId,
                similar_ids: similar,
                recommendations_ids: recommendations,
                cached_at: new Date().toISOString(),
            });

        if (error) {
            console.error('[Cache] Error writing TMDB similar cache:', error);
        } else {
            console.log(`[Cache] TMDB similar cache SET for ${tmdbId} (${similar.length} similar, ${recommendations.length} recs)`);
        }
    } catch (e) {
        console.error('[Cache] Exception writing TMDB similar cache:', e);
    }
}

// ============================================================================
// TuiMDB UID Cache
// ============================================================================

const TUIMDB_UID_CACHE_TTL_DAYS = 30;

/**
 * Get cached TuiMDB UID for a TMDB ID
 * @returns TuiMDB UID (number), null if not found in TuiMDB, undefined if not in cache
 */
export async function getCachedTuiMDBUid(tmdbId: number): Promise<number | null | undefined> {
    if (!supabase) {
        console.warn('[Cache] Supabase client not initialized');
        return undefined;
    }

    try {
        const { data, error } = await supabase
            .from('tuimdb_uid_cache')
            .select('tuimdb_uid, cached_at')
            .eq('tmdb_id', tmdbId)
            .single();

        if (error || !data) {
            return undefined; // Not in cache
        }

        // Check if cache is still valid
        if (!isCacheValid(data.cached_at, TUIMDB_UID_CACHE_TTL_DAYS)) {
            console.log(`[Cache] TuiMDB UID cache expired for ${tmdbId}`);
            return undefined; // Cache expired
        }

        console.log(`[Cache] TuiMDB UID cache HIT for ${tmdbId}: ${data.tuimdb_uid ?? 'null'}`);
        return data.tuimdb_uid; // Can be null if movie not found in TuiMDB
    } catch (e) {
        console.error('[Cache] Error reading TuiMDB UID cache:', e);
        return undefined;
    }
}

/**
 * Store TuiMDB UID in cache
 * @param uid TuiMDB UID or null if movie not found in TuiMDB
 */
export async function setCachedTuiMDBUid(tmdbId: number, uid: number | null): Promise<void> {
    if (!supabase) {
        console.warn('[Cache] Supabase client not initialized');
        return;
    }

    try {
        const { error } = await supabase
            .from('tuimdb_uid_cache')
            .upsert({
                tmdb_id: tmdbId,
                tuimdb_uid: uid,
                cached_at: new Date().toISOString(),
            });

        if (error) {
            console.error('[Cache] Error writing TuiMDB UID cache:', error);
        } else {
            console.log(`[Cache] TuiMDB UID cache SET for ${tmdbId}: ${uid ?? 'null'}`);
        }
    } catch (e) {
        console.error('[Cache] Exception writing TuiMDB UID cache:', e);
    }
}

// ============================================================================
// Cache Statistics (Optional - for monitoring)
// ============================================================================

export interface CacheStats {
    traktCacheSize: number;
    tmdbSimilarCacheSize: number;
    tuimdbUidCacheSize: number;
}

/**
 * Get cache statistics (for admin/monitoring)
 */
export async function getCacheStats(): Promise<CacheStats | null> {
    if (!supabase) {
        console.warn('[Cache] Supabase client not initialized');
        return null;
    }

    try {
        const [trakt, tmdbSimilar, tuimdb] = await Promise.all([
            supabase.from('trakt_related_cache').select('tmdb_id', { count: 'exact', head: true }),
            supabase.from('tmdb_similar_cache').select('tmdb_id', { count: 'exact', head: true }),
            supabase.from('tuimdb_uid_cache').select('tmdb_id', { count: 'exact', head: true }),
        ]);

        return {
            traktCacheSize: trakt.count ?? 0,
            tmdbSimilarCacheSize: tmdbSimilar.count ?? 0,
            tuimdbUidCacheSize: tuimdb.count ?? 0,
        };
    } catch (e) {
        console.error('[Cache] Error getting cache stats:', e);
        return null;
    }
}
