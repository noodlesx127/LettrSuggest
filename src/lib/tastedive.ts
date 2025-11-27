/**
 * TasteDive API Client
 * 
 * Purpose: Cross-media recommendation engine for discovering similar content
 * across movies, TV shows, books, music, and games.
 * 
 * API Key: Set via TASTEDIVE_API_KEY environment variable
 * Rate Limit: 300 requests/hour
 * Cache Strategy: 7-day TTL for similar content recommendations
 */

export interface TasteDiveResult {
    Name: string;
    Type: 'movie' | 'show' | 'book' | 'music' | 'game' | 'podcast';
    wTeaser?: string; // Wikipedia description
    wUrl?: string; // Wikipedia URL
    yUrl?: string; // YouTube URL
    yID?: string; // YouTube video ID
}

export interface TasteDiveResponse {
    Similar: {
        Info: TasteDiveResult[]; // Info about the queried items
        Results: TasteDiveResult[]; // Recommended similar items
    };
}

/**
 * Get similar content recommendations from TasteDive
 * Supports cross-media queries (e.g., books → movies, music → films)
 */
export async function getSimilarContent(
    query: string | string[],
    options?: {
        type?: 'movie' | 'show' | 'book' | 'music' | 'game';
        info?: boolean; // Include Wikipedia/YouTube enrichment
        limit?: number; // Max results (default: 20, max: 100)
    }
): Promise<TasteDiveResult[]> {
    const apiKey = process.env.TASTEDIVE_API_KEY;

    if (!apiKey) {
        console.warn('[TasteDive] API key not configured');
        return [];
    }

    try {
        // Build query string (supports comma-separated multi-query)
        const queryString = Array.isArray(query) ? query.join(', ') : query;

        const params = new URLSearchParams({
            q: queryString,
            k: apiKey,
            type: options?.type || 'movie',
            info: options?.info ? '1' : '0',
            limit: String(options?.limit || 20),
        });

        console.log('[TasteDive] Fetching similar content', { query: queryString, type: options?.type });

        const response = await fetch(`https://tastedive.com/api/similar?${params}`);

        if (!response.ok) {
            console.error('[TasteDive] HTTP error:', response.status);
            return [];
        }

        const data: TasteDiveResponse = await response.json();

        if (!data.Similar || !data.Similar.Results) {
            console.log('[TasteDive] No results found for query:', queryString);
            return [];
        }

        console.log('[TasteDive] Found results', { count: data.Similar.Results.length });
        return data.Similar.Results;
    } catch (error) {
        console.error('[TasteDive] Request error:', error);
        return [];
    }
}

/**
 * Get movie recommendations based on multiple favorite films
 * Uses TasteDive's multi-query feature for better recommendations
 */
export async function getMovieRecommendations(
    movieTitles: string[],
    options?: { limit?: number; includeInfo?: boolean }
): Promise<TasteDiveResult[]> {
    // Prefix each title with "movie:" for explicit typing
    const queries = movieTitles.map(title => `movie:${title}`);

    return getSimilarContent(queries, {
        type: 'movie',
        info: options?.includeInfo ?? false,
        limit: options?.limit || 20,
    });
}

/**
 * Get cross-media recommendations (e.g., from books/music to movies)
 * This is TasteDive's unique capability
 */
export async function getCrossMediaRecommendations(
    items: Array<{ title: string; type: 'movie' | 'show' | 'book' | 'music' | 'game' }>,
    options?: { limit?: number }
): Promise<TasteDiveResult[]> {
    // Build typed queries (e.g., "book:Dune, music:Pink Floyd")
    const queries = items.map(item => `${item.type}:${item.title}`);

    return getSimilarContent(queries, {
        type: 'movie', // Return only movies
        info: true, // Include enrichment data
        limit: options?.limit || 20,
    });
}

/**
 * Convert TasteDive movie name to search query for TMDB lookup
 * TasteDive returns movie names, we need to map them to TMDB IDs
 */
export function tasteDiveToSearchQuery(result: TasteDiveResult): string {
    return result.Name;
}
