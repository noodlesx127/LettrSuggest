/**
 * OMDb API Client
 * 
 * Purpose: Interface with OMDb API for IMDB ratings, Rotten Tomatoes scores,
 * awards, box office data, and comprehensive movie metadata.
 * 
 * API Key: Set via OMDB_API_KEY environment variable
 * Rate Limit: 1,000 requests/day (free tier)
 * Cache Strategy: 7-day TTL (IMDB ratings update weekly)
 */

export interface OMDbMovie {
    Title: string;
    Year: string;
    Rated: string; // PG-13, R, etc.
    Released: string;
    Runtime: string;
    Genre: string;
    Director: string;
    Writer: string;
    Actors: string;
    Plot: string;
    Language: string;
    Country: string;
    Awards: string; // "Won 3 Oscars. 145 wins & 142 nominations"
    Poster: string;
    Ratings: Array<{
        Source: string; // "Internet Movie Database" | "Rotten Tomatoes" | "Metacritic"
        Value: string; // "9.3/10" | "91%" | "82/100"
    }>;
    Metascore: string;
    imdbRating: string; // "9.3"
    imdbVotes: string; // "2,789,456"
    imdbID: string; // "tt0111161"
    Type: string; // "movie" | "series" | "episode"
    DVD?: string;
    BoxOffice?: string; // "$28,767,189"
    Production?: string;
    Website?: string;
    Response: string; // "True" | "False"
    Error?: string;
}

export interface OMDbSearchResult {
    Search?: Array<{
        Title: string;
        Year: string;
        imdbID: string;
        Type: string;
        Poster: string;
    }>;
    totalResults?: string;
    Response: string;
    Error?: string;
}

/**
 * Search OMDb by title and optional year
 */
export async function searchOMDb(
    title: string,
    options?: { year?: number; plot?: 'short' | 'full' }
): Promise<OMDbMovie | null> {
    const apiKey = process.env.OMDB_API_KEY;

    if (!apiKey) {
        console.warn('[OMDb] API key not configured');
        return null;
    }

    try {
        const params = new URLSearchParams({
            apikey: apiKey,
            t: title,
            type: 'movie',
            plot: options?.plot || 'short',
            r: 'json'
        });

        if (options?.year) {
            params.append('y', String(options.year));
        }

        const response = await fetch(`http://www.omdbapi.com/?${params}`);

        if (!response.ok) {
            console.error('[OMDb] HTTP error:', response.status);
            return null;
        }

        const data: OMDbMovie = await response.json();

        if (data.Response === 'False') {
            console.log(`[OMDb] Movie not found: ${title}`, data.Error);
            return null;
        }

        return data;
    } catch (error) {
        console.error('[OMDb] Search error:', error);
        return null;
    }
}

/**
 * Get OMDb data by IMDB ID (most reliable method)
 */
export async function getOMDbByIMDB(
    imdbId: string,
    options?: { plot?: 'short' | 'full' }
): Promise<OMDbMovie | null> {
    const apiKey = process.env.OMDB_API_KEY;

    if (!apiKey) {
        console.warn('[OMDb] API key not configured');
        return null;
    }

    try {
        const params = new URLSearchParams({
            apikey: apiKey,
            i: imdbId,
            plot: options?.plot || 'short',
            r: 'json'
        });

        const response = await fetch(`http://www.omdbapi.com/?${params}`);

        if (!response.ok) {
            console.error('[OMDb] HTTP error:', response.status);
            return null;
        }

        const data: OMDbMovie = await response.json();

        if (data.Response === 'False') {
            console.log(`[OMDb] IMDB ID not found: ${imdbId}`, data.Error);
            return null;
        }

        return data;
    } catch (error) {
        console.error('[OMDb] IMDB fetch error:', error);
        return null;
    }
}

/**
 * Search for multiple movies (returns list)
 */
export async function searchOMDbMultiple(
    query: string,
    page: number = 1
): Promise<OMDbSearchResult | null> {
    const apiKey = process.env.OMDB_API_KEY;

    if (!apiKey) {
        console.warn('[OMDb] API key not configured');
        return null;
    }

    try {
        const params = new URLSearchParams({
            apikey: apiKey,
            s: query,
            type: 'movie',
            page: String(page),
            r: 'json'
        });

        const response = await fetch(`http://www.omdbapi.com/?${params}`);

        if (!response.ok) {
            console.error('[OMDb] HTTP error:', response.status);
            return null;
        }

        const data: OMDbSearchResult = await response.json();

        if (data.Response === 'False') {
            console.log(`[OMDb] Search failed: ${query}`, data.Error);
            return null;
        }

        return data;
    } catch (error) {
        console.error('[OMDb] Multiple search error:', error);
        return null;
    }
}

/**
 * Merge TMDB and OMDb data
 * TMDB: poster_path, backdrop_path, genres, cast, crew (visual/structural)
 * OMDb: IMDB rating, Rotten Tomatoes, awards, box office (ratings/prestige)
 */
export function mergeTMDBAndOMDb(
    tmdb: any | null,
    omdb: OMDbMovie | null
): any {
    if (!tmdb && !omdb) {
        throw new Error('No data from either TMDB or OMDb');
    }

    // Start with TMDB as base structure
    const merged = tmdb ? { ...tmdb } : {};

    // Enhance with OMDb data
    if (omdb) {
        // Primary ratings (IMDB is most trusted)
        merged.imdb_rating = omdb.imdbRating;
        merged.imdb_votes = omdb.imdbVotes;
        merged.metacritic = omdb.Metascore;

        // Parse Rotten Tomatoes from ratings array
        const rtRating = omdb.Ratings?.find(r =>
            r.Source === 'Rotten Tomatoes'
        );
        if (rtRating) {
            merged.rotten_tomatoes = rtRating.Value;
        }

        // Awards and prestige
        merged.awards = omdb.Awards;

        // Box office
        merged.box_office = omdb.BoxOffice;

        // Content rating
        merged.rated = omdb.Rated;

        // Full plot (if TMDB overview is sparse)
        if (omdb.Plot && omdb.Plot.length > (merged.overview?.length || 0)) {
            merged.omdb_plot_full = omdb.Plot;
        }

        // Poster fallback (if TMDB missing)
        if (!merged.poster_path && omdb.Poster && omdb.Poster !== 'N/A') {
            merged.omdb_poster = omdb.Poster;
        }

        // Track when OMDb data was fetched
        merged.omdb_fetched_at = new Date().toISOString();
    }

    return merged;
}

/**
 * Convert OMDb data to simplified format for caching
 */
export function omdbToCache(omdb: OMDbMovie) {
    const rtRating = omdb.Ratings?.find(r => r.Source === 'Rotten Tomatoes');

    return {
        imdb_rating: omdb.imdbRating,
        imdb_votes: omdb.imdbVotes,
        rotten_tomatoes: rtRating?.Value || undefined,
        metacritic: omdb.Metascore,
        awards: omdb.Awards,
        box_office: omdb.BoxOffice || undefined,
        rated: omdb.Rated,
        omdb_plot_full: omdb.Plot,
        omdb_fetched_at: new Date().toISOString()
    };
}
