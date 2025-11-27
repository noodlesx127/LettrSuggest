/**
 * Import Enrichment Module
 * 
 * Comprehensive enrichment of user's imported films using all available APIs.
 * This runs ONCE during import to cache all data upfront, so suggestions
 * don't need to make repeated API calls.
 * 
 * APIs used:
 * 1. TMDB - Basic movie data, cast, crew, keywords
 * 2. TuiMDB - Enhanced genres, UID mapping
 * 3. Ratings Aggregator - IMDb ratings, RT, Metacritic (with OMDb → TMDB → Watchmode fallback)
 * 4. Watchmode - Streaming availability
 */

import { searchMovies } from './movieAPI';
import { getTuiMDBMovie } from './tuimdb';
import { upsertTmdbCache } from './enrich';
import type { TMDBMovie } from './enrich';
import { enrichMovieServerSide } from '@/app/actions/enrichment';

export interface EnrichedImportMovie extends TMDBMovie {
    // All OMDb fields are already in TMDBMovie type
    // Watchmode streaming data
    streaming_sources?: Array<{
        source_id: number;
        name: string;
        type: 'sub' | 'buy' | 'rent' | 'free';
        region: string;
        web_url: string;
    }>;
    watchmode_id?: number;
}

/**
 * Enrich a single movie with data from all APIs
 * This is called during import to cache everything upfront
 */
export async function enrichMovieForImport(
    title: string,
    year?: number,
    tmdbId?: number
): Promise<EnrichedImportMovie | null> {
    try {
        console.log('[ImportEnrich] Starting enrichment', { title, year, tmdbId });

        // Step 1: Get TMDB data (either by ID or search)
        // We do this on the client because searchMovies is optimized for client use
        let tmdbMovie: TMDBMovie | null = null;

        if (tmdbId) {
            const searchResults = await searchMovies({ query: title, year, preferTuiMDB: true });
            tmdbMovie = searchResults.find(m => m.id === tmdbId) || searchResults[0] || null;
        } else {
            const searchResults = await searchMovies({ query: title, year, preferTuiMDB: true });
            tmdbMovie = searchResults[0] || null;
        }

        if (!tmdbMovie) {
            console.log('[ImportEnrich] No TMDB match found', { title, year });
            return null;
        }

        console.log('[ImportEnrich] TMDB match found', { tmdbId: tmdbMovie.id, title: tmdbMovie.title });

        // Step 2: Get TuiMDB enhanced data (if available)
        if (tmdbMovie.tuimdb_uid) {
            try {
                const tuimdbData = await getTuiMDBMovie(tmdbMovie.tuimdb_uid);
                if (tuimdbData?.genres) {
                    console.log('[ImportEnrich] TuiMDB data fetched', { genreCount: tuimdbData.genres.length });
                    // Note: We're not merging genres here yet, assuming TuiMDB data is used elsewhere or cached separately?
                    // If we need to merge, we should do it here.
                }
            } catch (e) {
                console.warn('[ImportEnrich] TuiMDB fetch failed (non-critical)', e);
            }
        }

        // Step 3: Server-Side Enrichment (Ratings & Watchmode)
        // This securely handles API keys on the server
        try {
            const serverData = await enrichMovieServerSide(tmdbMovie.id);

            if (serverData.imdb_id) tmdbMovie.imdb_id = serverData.imdb_id;

            if (serverData.ratings) {
                const r = serverData.ratings;
                if (r.imdb_rating) {
                    tmdbMovie.imdb_rating = r.imdb_rating;
                    tmdbMovie.imdb_votes = r.imdb_votes;
                }
                if (r.rotten_tomatoes) tmdbMovie.rotten_tomatoes = r.rotten_tomatoes;
                if (r.metacritic) tmdbMovie.metacritic = r.metacritic;
                if (r.awards) tmdbMovie.awards = r.awards;

                console.log('[ImportEnrich] Ratings aggregated:', {
                    imdb: r.imdb_rating,
                    source: r.imdb_source,
                    rt: r.rotten_tomatoes,
                });
            }

            if (serverData.watchmode_id) {
                (tmdbMovie as EnrichedImportMovie).watchmode_id = serverData.watchmode_id;
            }

            if (serverData.streaming_sources) {
                (tmdbMovie as EnrichedImportMovie).streaming_sources = serverData.streaming_sources;
                console.log('[ImportEnrich] Watchmode streaming sources added', { count: serverData.streaming_sources.length });
            }

        } catch (e) {
            console.error('[ImportEnrich] Server enrichment failed', e);
        }

        // Step 4: Cache the enriched movie in Supabase
        try {
            await upsertTmdbCache(tmdbMovie);
            console.log('[ImportEnrich] Cached enriched movie', { tmdbId: tmdbMovie.id });
        } catch (e) {
            console.error('[ImportEnrich] Cache upsert failed', e);
        }

        return tmdbMovie as EnrichedImportMovie;
    } catch (error) {
        console.error('[ImportEnrich] Enrichment failed', { title, year, error });
        return null;
    }
}

/**
 * Batch enrich multiple movies with rate limiting
 * Used during import to enrich all user's films
 */
export async function batchEnrichMovies(
    movies: Array<{ title: string; year?: number; tmdbId?: number }>,
    options?: {
        concurrency?: number;
        onProgress?: (current: number, total: number) => void;
    }
): Promise<Map<number, EnrichedImportMovie>> {
    const { concurrency = 2, onProgress } = options || {};
    const results = new Map<number, EnrichedImportMovie>();

    let completed = 0;
    let next = 0;

    const worker = async () => {
        while (true) {
            const index = next++;
            if (index >= movies.length) break;

            const movie = movies[index];
            const enriched = await enrichMovieForImport(movie.title, movie.year, movie.tmdbId);

            if (enriched) {
                results.set(enriched.id, enriched);
            }

            completed++;
            if (onProgress) {
                onProgress(completed, movies.length);
            }

            // Rate limiting: 300ms between requests
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    };

    // Run workers in parallel
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    console.log('[ImportEnrich] Batch enrichment complete', {
        total: movies.length,
        enriched: results.size,
        failed: movies.length - results.size,
    });

    return results;
}
