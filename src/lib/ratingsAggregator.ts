/**
 * Ratings Aggregator Module
 * 
 * Provides a robust fallback system for movie ratings across multiple APIs.
 * Cascading order: OMDb → TMDB → Watchmode → TuiMDB
 * 
 * This ensures ratings are always available even when OMDb hits API limits.
 */

import { getOMDbByIMDB } from './omdb';
import { searchWatchmode } from './watchmode';

export type RatingSource = 'omdb' | 'tmdb' | 'watchmode' | 'tuimdb';

export type MovieRatings = {
    // IMDb-style rating (0-10 scale)
    imdb_rating?: string;
    imdb_source?: RatingSource;
    imdb_votes?: string;

    // Critic scores
    rotten_tomatoes?: string;  // e.g., "91%"
    metacritic?: string;       // e.g., "82"

    // Awards
    awards?: string;

    // TMDB ratings (always available)
    vote_average?: number;
    vote_count?: number;

    // Watchmode ratings
    critic_score?: number;     // 0-100 scale
    user_rating?: number;      // 0-10 scale
};

// Circuit breaker state for OMDb
let omdbAvailable = true;
let omdbCooldownUntil: number | null = null;
const OMDB_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

/**
 * Check if OMDb is currently available (not rate-limited)
 */
export function isOMDbAvailable(): boolean {
    if (!omdbAvailable && omdbCooldownUntil) {
        // Check if cooldown period has passed
        if (Date.now() > omdbCooldownUntil) {
            console.log('[RatingsAgg] OMDb cooldown period ended, re-enabling');
            omdbAvailable = true;
            omdbCooldownUntil = null;
            return true;
        }
        return false;
    }
    return omdbAvailable;
}

/**
 * Mark OMDb as unavailable due to rate limiting
 */
export function markOMDbUnavailable(reason: string): void {
    console.warn('[RatingsAgg] Marking OMDb as unavailable:', reason);
    omdbAvailable = false;
    omdbCooldownUntil = Date.now() + OMDB_COOLDOWN_MS;
}

/**
 * Check if an error indicates OMDb rate limiting
 */
function isOMDbRateLimited(error: any): boolean {
    const message = error?.message?.toLowerCase() || '';
    return (
        error?.status === 401 ||
        message.includes('request limit reached') ||
        message.includes('invalid api key') ||
        message.includes('unauthorized')
    );
}

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
 */
export async function getMovieRatings(
    tmdbId: number,
    imdbId?: string,
    tmdbVoteAverage?: number,
    tmdbVoteCount?: number
): Promise<MovieRatings> {
    const ratings: MovieRatings = {
        vote_average: tmdbVoteAverage,
        vote_count: tmdbVoteCount,
    };

    // Step 1: Try OMDb (if available and we have IMDb ID)
    if (imdbId && isOMDbAvailable()) {
        try {
            console.log('[RatingsAgg] Attempting OMDb fetch for', imdbId);
            const omdbData = await getOMDbByIMDB(imdbId);

            if (omdbData) {
                // OMDb success - use all available data
                ratings.imdb_rating = omdbData.imdbRating;
                ratings.imdb_source = 'omdb';
                ratings.imdb_votes = omdbData.imdbVotes;
                ratings.awards = omdbData.Awards !== 'N/A' ? omdbData.Awards : undefined;

                // Extract RT and Metacritic from Ratings array
                if (omdbData.Ratings) {
                    const rtRating = omdbData.Ratings.find(r => r.Source === 'Rotten Tomatoes');
                    const mcRating = omdbData.Ratings.find(r => r.Source === 'Metacritic');

                    if (rtRating) ratings.rotten_tomatoes = rtRating.Value;
                    if (mcRating) ratings.metacritic = mcRating.Value;
                }

                console.log('[RatingsAgg] OMDb success:', {
                    imdb: ratings.imdb_rating,
                    rt: ratings.rotten_tomatoes,
                    mc: ratings.metacritic,
                });

                return ratings;
            }
        } catch (error: any) {
            console.warn('[RatingsAgg] OMDb fetch failed:', error?.message);

            // Check if it's a rate limit error
            if (isOMDbRateLimited(error)) {
                markOMDbUnavailable(error?.message || 'Rate limited');
            }

            // Continue to fallback
        }
    }

    // Step 2: Fallback to TMDB vote_average (always available)
    if (tmdbVoteAverage && !ratings.imdb_rating) {
        ratings.imdb_rating = normalizeRating(tmdbVoteAverage, 'tmdb');
        ratings.imdb_source = 'tmdb';
        console.log('[RatingsAgg] Using TMDB fallback:', ratings.imdb_rating);
    }

    // Step 3: Try Watchmode for additional ratings (if we don't have critic scores)
    if (!ratings.rotten_tomatoes || !ratings.critic_score) {
        try {
            console.log('[RatingsAgg] Attempting Watchmode fetch for TMDB ID', tmdbId);
            const watchmodeResults = await searchWatchmode(String(tmdbId), {
                searchField: 'tmdb_id',
            });

            if (watchmodeResults.length > 0) {
                const watchmodeTitle = watchmodeResults[0];

                // Use Watchmode user_rating as fallback for IMDb rating if we don't have one
                if (watchmodeTitle.user_rating && !ratings.imdb_rating) {
                    ratings.imdb_rating = normalizeRating(watchmodeTitle.user_rating, 'watchmode');
                    ratings.imdb_source = 'watchmode';
                }

                // Use Watchmode critic_score as fallback for RT
                if (watchmodeTitle.critic_score) {
                    ratings.critic_score = watchmodeTitle.critic_score;

                    // If we don't have RT from OMDb, show Watchmode critic score as RT-style
                    if (!ratings.rotten_tomatoes) {
                        ratings.rotten_tomatoes = `${watchmodeTitle.critic_score}%`;
                    }
                }

                console.log('[RatingsAgg] Watchmode data added:', {
                    user_rating: watchmodeTitle.user_rating,
                    critic_score: watchmodeTitle.critic_score,
                });
            }
        } catch (error: any) {
            console.warn('[RatingsAgg] Watchmode fetch failed:', error?.message);
            // Non-critical, continue
        }
    }

    return ratings;
}

/**
 * Get OMDb health status for monitoring
 */
export function getOMDbHealthStatus(): {
    available: boolean;
    cooldownUntil: Date | null;
    cooldownRemaining: number | null;
} {
    return {
        available: omdbAvailable,
        cooldownUntil: omdbCooldownUntil ? new Date(omdbCooldownUntil) : null,
        cooldownRemaining: omdbCooldownUntil ? Math.max(0, omdbCooldownUntil - Date.now()) : null,
    };
}

/**
 * Manually reset OMDb availability (for testing or admin override)
 */
export function resetOMDbAvailability(): void {
    console.log('[RatingsAgg] Manually resetting OMDb availability');
    omdbAvailable = true;
    omdbCooldownUntil = null;
}
