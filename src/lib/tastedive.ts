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
    // API returns lowercase, but we normalize to capitalized for consistency
    Name: string;
    Type: 'movie' | 'show' | 'book' | 'music' | 'game' | 'podcast';
    wTeaser?: string; // Wikipedia description
    wUrl?: string; // Wikipedia URL
    yUrl?: string; // YouTube URL
    yID?: string; // YouTube video ID
}

export interface TasteDiveResponse {
    // API can return either Similar or similar (case varies)
    Similar?: {
        Info: TasteDiveResult[];
        Results: TasteDiveResult[];
    };
    similar?: {
        info: TasteDiveResult[];
        results: TasteDiveResult[];
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

        // Build URL with proper encoding
        const url = new URL('https://tastedive.com/api/similar');
        url.searchParams.set('q', queryString);
        url.searchParams.set('k', apiKey);
        // Type is required by TasteDive API
        url.searchParams.set('type', options?.type || 'movie');
        url.searchParams.set('info', options?.info ? '1' : '0');
        // TasteDive limit must be between 1 and 20
        url.searchParams.set('limit', String(Math.min(options?.limit || 20, 20)));

        console.log('[TasteDive] Fetching similar content', { 
            query: queryString, 
            type: options?.type,
            url: url.toString().replace(apiKey, 'REDACTED')
        });

        const response = await fetch(url.toString());

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unable to read error');
            console.error('[TasteDive] HTTP error:', response.status, errorText);
            return [];
        }

        const data = await response.json();
        
        // Log raw response for debugging
        console.log('[TasteDive] Raw response:', JSON.stringify(data).slice(0, 500));

        // TasteDive API uses lowercase field names
        const similar = data.Similar || data.similar;
        if (!similar) {
            console.log('[TasteDive] No Similar object in response');
            return [];
        }
        
        const rawResults = similar.Results || similar.results || [];
        if (rawResults.length === 0) {
            console.log('[TasteDive] No results found for query:', queryString);
            return [];
        }

        // Normalize results - API returns lowercase (name, type) but we use capitalized (Name, Type)
        const results: TasteDiveResult[] = rawResults.map((r: Record<string, unknown>) => ({
            Name: (r.Name || r.name || '') as string,
            Type: (r.Type || r.type || 'movie') as TasteDiveResult['Type'],
            wTeaser: (r.wTeaser || r.wteaser) as string | undefined,
            wUrl: (r.wUrl || r.wurl) as string | undefined,
            yUrl: (r.yUrl || r.yurl) as string | undefined,
            yID: (r.yID || r.yid) as string | undefined,
        }));

        console.log('[TasteDive] Found results', { count: results.length, firstResult: results[0]?.Name });
        return results;
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
