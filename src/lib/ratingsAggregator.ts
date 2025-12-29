/**
 * Ratings Aggregator Module
 * 
 * Provides movie ratings using TMDB and Watchmode as sources.
 * Cascading order: TMDB → Watchmode
 * 
 * Note: OMDb was removed due to severe rate limits (1000/day free tier).
 */

import { searchWatchmode } from './watchmode';

export type RatingSource = 'tmdb' | 'watchmode';

export type MovieRatings = {
    // Rating on 0-10 scale
    rating?: string;
    rating_source?: RatingSource;
    vote_count?: number;

    // Critic scores
    rotten_tomatoes?: string;  // e.g., "91%"
    metacritic?: string;       // e.g., "82"

    // TMDB ratings (always available)
    vote_average?: number;

    // Watchmode ratings
    critic_score?: number;     // 0-100 scale
    user_rating?: number;      // 0-10 scale
};

/**
 * Normalize a rating to 0-10 scale with one decimal place
 */
function normalizeRating(value: number | string, source: RatingSource): string {
    const num = typeof value === 'string' ? parseFloat(value) : value;

    if (isNaN(num)) return '';

    // Watchmode critic_score is 0-100, convert to 0-10
    if (source === 'watchmode' && num > 10) {
        return (num / 10).toFixed(1);
    }

    return num.toFixed(1);
}

/**
 * Get the best available ratings for a movie using cascading fallback
 * Primary: TMDB vote_average
 * Secondary: Watchmode for additional critic scores
 */
export async function getMovieRatings(
    tmdbId: number,
    _imdbId?: string, // Kept for API compatibility but unused
    tmdbVoteAverage?: number,
    tmdbVoteCount?: number
): Promise<MovieRatings> {
    const ratings: MovieRatings = {
        vote_average: tmdbVoteAverage,
        vote_count: tmdbVoteCount,
    };

    // Step 1: Use TMDB vote_average as primary source (always available)
    if (tmdbVoteAverage) {
        ratings.rating = normalizeRating(tmdbVoteAverage, 'tmdb');
        ratings.rating_source = 'tmdb';
    }

    // Step 2: Try Watchmode for critic scores (Rotten Tomatoes style)
    try {
        const watchmodeResults = await searchWatchmode(String(tmdbId), {
            searchField: 'tmdb_id',
        });

        if (watchmodeResults.length > 0) {
            const watchmodeTitle = watchmodeResults[0];

            // Use Watchmode user_rating as fallback if TMDB unavailable
            if (watchmodeTitle.user_rating && !ratings.rating) {
                ratings.rating = normalizeRating(watchmodeTitle.user_rating, 'watchmode');
                ratings.rating_source = 'watchmode';
            }

            // Use Watchmode critic_score for Rotten Tomatoes style display
            if (watchmodeTitle.critic_score) {
                ratings.critic_score = watchmodeTitle.critic_score;
                ratings.rotten_tomatoes = `${watchmodeTitle.critic_score}%`;
            }

            // Store user_rating for potential use
            if (watchmodeTitle.user_rating) {
                ratings.user_rating = watchmodeTitle.user_rating;
            }
        }
    } catch (error: any) {
        console.warn('[RatingsAgg] Watchmode fetch failed:', error?.message);
        // Non-critical, continue with TMDB data
    }

    return ratings;
}

/**
 * Simple ratings fetch using only TMDB data (no external API calls)
 * Use this when you already have TMDB movie details
 */
export function getMovieRatingsFromTMDB(
    tmdbVoteAverage?: number,
    tmdbVoteCount?: number
): MovieRatings {
    const ratings: MovieRatings = {
        vote_average: tmdbVoteAverage,
        vote_count: tmdbVoteCount,
    };

    if (tmdbVoteAverage) {
        ratings.rating = normalizeRating(tmdbVoteAverage, 'tmdb');
        ratings.rating_source = 'tmdb';
    }

    return ratings;
}
