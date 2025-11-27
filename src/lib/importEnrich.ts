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
import { searchWatchmode, getStreamingSources } from './watchmode';
import { upsertTmdbCache } from './enrich';
import { getMovieRatings } from './ratingsAggregator';
import type { TMDBMovie } from './enrich';

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
        let tmdbMovie: TMDBMovie | null = null;

        if (tmdbId) {
            // If we already have TMDB ID, fetch directly
            // This would require a new function, for now we'll search
            const searchResults = await searchMovies({ query: title, year, preferTuiMDB: true });
            tmdbMovie = searchResults.find(m => m.id === tmdbId) || searchResults[0] || null;
        } else {
            // Search for the movie
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
                    // TuiMDB provides genres, merge with TMDB genres
                    console.log('[ImportEnrich] TuiMDB data fetched', { genreCount: tuimdbData.genres.length });
                }
            } catch (e) {
                console.warn('[ImportEnrich] TuiMDB fetch failed (non-critical)', e);
            }
        }

        // Step 3: Get ratings from aggregator (OMDb → TMDB → Watchmode fallback)
        try {
            const ratings = await getMovieRatings(
                tmdbMovie.id,
                tmdbMovie.imdb_id,
                tmdbMovie.vote_average,
                tmdbMovie.vote_count
            );

            // Merge ratings into movie object
            if (ratings.imdb_rating) {
                tmdbMovie.imdb_rating = ratings.imdb_rating;
                tmdbMovie.imdb_votes = ratings.imdb_votes;
            }
            if (ratings.rotten_tomatoes) tmdbMovie.rotten_tomatoes = ratings.rotten_tomatoes;
            if (ratings.metacritic) tmdbMovie.metacritic = ratings.metacritic;
            if (ratings.awards) tmdbMovie.awards = ratings.awards;

            console.log('[ImportEnrich] Ratings aggregated:', {
                imdb: ratings.imdb_rating,
                source: ratings.imdb_source,
                rt: ratings.rotten_tomatoes,
                mc: ratings.metacritic,
            });
        } catch (e) {
            console.warn('[ImportEnrich] Ratings aggregation failed (non-critical)', e);
        }

        // Step 4: Get Watchmode streaming data
        const enrichedMovie: EnrichedImportMovie = tmdbMovie as EnrichedImportMovie;
        try {
            const watchmodeResults = await searchWatchmode(String(tmdbMovie.id), {
                searchField: 'tmdb_id',
            });

            if (watchmodeResults.length > 0) {
                const watchmodeTitle = watchmodeResults[0];
                enrichedMovie.watchmode_id = watchmodeTitle.id;

                // Get streaming sources
                const sources = await getStreamingSources(watchmodeTitle.id, { region: 'US' });
                if (sources.length > 0) {
                    enrichedMovie.streaming_sources = sources.map(s => ({
                        source_id: s.source_id,
                        name: s.name,
                        type: s.type,
                        region: s.region,
                        web_url: s.web_url,
                    }));
                    console.log('[ImportEnrich] Watchmode streaming sources added', { count: sources.length });
                }
            }
        } catch (e) {
            console.warn('[ImportEnrich] Watchmode fetch failed (non-critical)', e);
        }

        // Step 5: Cache the enriched movie in Supabase
        try {
            await upsertTmdbCache(enrichedMovie);
            console.log('[ImportEnrich] Cached enriched movie', { tmdbId: enrichedMovie.id });
        } catch (e) {
            console.error('[ImportEnrich] Cache upsert failed', e);
        }

        console.log('[ImportEnrich] Enrichment complete', {
            tmdbId: enrichedMovie.id,
            hasRatings: !!enrichedMovie.imdb_rating,
            hasTuiMDB: !!enrichedMovie.enhanced_genres,
            hasWatchmode: !!enrichedMovie.streaming_sources,
        });

        return enrichedMovie;
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
