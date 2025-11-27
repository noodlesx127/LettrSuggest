'use server';

import { getMovieRatings, type MovieRatings } from '@/lib/ratingsAggregator';
import { searchWatchmode, getStreamingSources, type WatchmodeSource } from '@/lib/watchmode';
import { getTuiMDBMovie, type TuiMDBMovie } from '@/lib/tuimdb';

export type EnrichmentResult = {
    imdb_id?: string;
    ratings?: MovieRatings;
    watchmode_id?: number;
    streaming_sources?: Array<{
        source_id: number;
        name: string;
        type: 'sub' | 'buy' | 'rent' | 'free';
        region: string;
        web_url: string;
    }>;
    tuimdb_movie?: TuiMDBMovie | null;
};

/**
 * Server Action to enrich a movie with sensitive API data (Ratings, Watchmode, TuiMDB)
 * This runs on the server, so it can access private environment variables.
 */
export async function enrichMovieServerSide(tmdbId: number, tuimdbUid?: number): Promise<EnrichmentResult> {
    try {
        console.log('[EnrichAction] Starting server-side enrichment for TMDB ID:', tmdbId);

        // 1. Fetch TMDB details to get IMDb ID
        const tmdbApiKey = process.env.TMDB_API_KEY || process.env.NEXT_PUBLIC_TMDB_API_KEY;
        if (!tmdbApiKey) {
            console.error('[EnrichAction] TMDB_API_KEY (or NEXT_PUBLIC_) not configured');
            return {};
        }

        const tmdbRes = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${tmdbApiKey}`, {
            next: { revalidate: 3600 } // Cache for 1 hour
        });

        if (!tmdbRes.ok) {
            console.error('[EnrichAction] TMDB fetch failed:', tmdbRes.status);
            return {};
        }

        const tmdbData = await tmdbRes.json();
        const imdbId = tmdbData.imdb_id;
        const voteAverage = tmdbData.vote_average;
        const voteCount = tmdbData.vote_count;

        console.log('[EnrichAction] Got TMDB details:', { imdbId, voteAverage });

        // 2. Get Ratings (OMDb -> TMDB -> Watchmode)
        // Now we have the IMDb ID, so OMDb fetch can actually work!
        const ratings = await getMovieRatings(tmdbId, imdbId, voteAverage, voteCount);

        // 3. Get Watchmode Data
        let watchmodeId: number | undefined;
        let streamingSources: EnrichmentResult['streaming_sources'] = undefined;

        try {
            const watchmodeResults = await searchWatchmode(String(tmdbId), {
                searchField: 'tmdb_id',
            });

            if (watchmodeResults.length > 0) {
                const watchmodeTitle = watchmodeResults[0];
                watchmodeId = watchmodeTitle.id;

                // Get streaming sources
                const sources = await getStreamingSources(watchmodeTitle.id, { region: 'US' });
                if (sources.length > 0) {
                    streamingSources = sources.map(s => ({
                        source_id: s.source_id,
                        name: s.name,
                        type: s.type,
                        region: s.region,
                        web_url: s.web_url,
                    }));
                }
            }
        } catch (e) {
            console.warn('[EnrichAction] Watchmode fetch failed:', e);
        }

        // 4. Get TuiMDB Data (if UID provided)
        let tuimdbMovie: TuiMDBMovie | null = null;
        if (tuimdbUid) {
            try {
                tuimdbMovie = await getTuiMDBMovie(tuimdbUid);
            } catch (e) {
                console.warn('[EnrichAction] TuiMDB fetch failed:', e);
            }
        }

        return {
            imdb_id: imdbId,
            ratings,
            watchmode_id: watchmodeId,
            streaming_sources: streamingSources,
            tuimdb_movie: tuimdbMovie,
        };

    } catch (error) {
        console.error('[EnrichAction] Server enrichment failed:', error);
        return {};
    }
}
