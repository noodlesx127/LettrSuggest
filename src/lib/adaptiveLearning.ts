import { supabase } from './supabaseClient';
import { FilmEvent } from './normalize';

// Types for our stats
type ExplorationStats = {
    user_id: string;
    exploration_rate: number;
    exploratory_films_rated: number;
    exploratory_avg_rating: number;
    last_updated: string;
};

type GenreTransition = {
    user_id: string;
    from_genre_name: string;
    to_genre_name: string;
    success_rate: number;
    rating_count: number;
    last_updated: string;
};

/**
 * Get the current exploration rate for a user
 * Returns 0.15 (default) if not found
 */
export async function getAdaptiveExplorationRate(userId: string | null): Promise<number> {
    if (!supabase || !userId) return 0.15;

    try {
        const { data } = await supabase
            .from('user_exploration_stats')
            .select('exploration_rate')
            .eq('user_id', userId)
            .maybeSingle();

        return data?.exploration_rate ?? 0.15;
    } catch (e) {
        console.error('[AdaptiveLearning] Error fetching exploration rate', e);
        return 0.15;
    }
}

/**
 * Get learned genre transitions for a user
 * Returns a map of "FromGenre" -> list of "ToGenre" with success rates
 */
export async function getGenreTransitions(userId: string | null): Promise<Map<string, Array<{ genre: string; weight: number }>>> {
    if (!supabase || !userId) return new Map();

    try {
        const { data } = await supabase
            .from('user_adjacent_preferences')
            .select('from_genre_name, to_genre_name, success_rate, rating_count')
            .eq('user_id', userId)
            .gte('rating_count', 3) // Minimum sample size
            .gte('success_rate', 0.5) // Only positive transitions
            .order('success_rate', { ascending: false });

        const transitions = new Map<string, Array<{ genre: string; weight: number }>>();

        data?.forEach((row: any) => {
            const from = row.from_genre_name;
            const to = row.to_genre_name;
            // Calculate boost weight based on success rate (0.5 - 1.0) -> (1.0 - 1.5 multiplier?)
            // Or just a flat score boost.
            const weight = row.success_rate;

            if (!transitions.has(from)) {
                transitions.set(from, []);
            }
            transitions.get(from)?.push({ genre: to, weight });
        });

        return transitions;
    } catch (e) {
        console.error('[AdaptiveLearning] Error fetching transitions', e);
        return new Map();
    }
}

/**
 * Update user's exploration stats based on new ratings
 * This adjusts the exploration_rate (epsilon) for the bandit algorithm
 */
export async function updateExplorationStats(
    userId: string,
    films: FilmEvent[],
    topGenres: string[] // User's top 3 genres
) {
    if (!supabase) return;

    console.log('[AdaptiveLearning] Updating exploration stats', { userId, filmCount: films.length });

    try {
        // 1. Fetch current stats
        const { data: currentStats, error: fetchError } = await supabase
            .from('user_exploration_stats')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();

        if (fetchError) throw fetchError;

        // Default values if no stats exist
        let explorationRate = currentStats?.exploration_rate ?? 0.15;
        let exploratoryFilmsRated = currentStats?.exploratory_films_rated ?? 0;
        let exploratoryAvgRating = currentStats?.exploratory_avg_rating ?? 0.0;

        // 2. Identify exploratory films in the new batch
        // We only care about films rated/watched *after* the last update if we were tracking incrementally,
        // but for now, we'll recalculate based on the provided 'films' which are likely the user's recent history or full history.
        // To avoid double counting, we should ideally only look at recent ones, but 'films' here is usually the full list from import.
        // Let's filter for films that are NOT in the top genres.

        const topGenreSet = new Set(topGenres.map(g => g.toLowerCase()));

        // We need genre info for these films. Since FilmEvent doesn't have genres directly, 
        // we might need to rely on what's passed or fetch it. 
        // However, fetching genres for ALL films is expensive.
        // Assumption: The caller might need to provide enriched films or we do a best-effort check.
        // For this V1, let's assume we can't easily get genres for *every* historical film without a massive fetch.
        // BUT, we can look at the *recent* films if we had their metadata.

        // Alternative: The system should call this with *enriched* data. 
        // Since `importStore` has `FilmEvent` which is just basic info, we have a gap.
        // We need to fetch genres for at least a subset of films to calculate this.
        // Let's fetch details for the last 20 rated films to adjust the rate.

        const recentRated = films
            .filter(f => f.rating !== undefined)
            .sort((a, b) => {
                const dateA = a.lastDate ? new Date(a.lastDate).getTime() : 0;
                const dateB = b.lastDate ? new Date(b.lastDate).getTime() : 0;
                return dateB - dateA;
            })
            .slice(0, 20);

        if (recentRated.length === 0) return;

        // We need to fetch TMDB data to know their genres
        // We'll use the existing cache or fetcher from another module if possible, 
        // but to keep this decoupled, we might need a direct fetch helper or pass it in.
        // For now, let's do a quick fetch for these 20 IDs if we have mappings.
        // Wait, `FilmEvent` has `uri`. We need `tmdb_id`.

        // Let's rely on the `film_tmdb_map` table which we can query efficiently.
        const uris = recentRated.map(f => f.uri);
        const { data: mappings } = await supabase
            .from('film_tmdb_map')
            .select('uri, tmdb_id')
            .in('uri', uris);

        const uriToTmdb = new Map(mappings?.map(m => [m.uri, m.tmdb_id]));
        const tmdbIds = recentRated.map(f => uriToTmdb.get(f.uri)).filter(id => id !== undefined) as number[];

        if (tmdbIds.length === 0) return;

        // Fetch genres for these TMDB IDs
        const { data: movieData } = await supabase
            .from('tmdb_movies')
            .select('tmdb_id, data')
            .in('tmdb_id', tmdbIds);

        let newExploratoryCount = 0;
        let newExploratoryRatingSum = 0;

        movieData?.forEach(row => {
            const movie = row.data;
            const genres: string[] = movie.genres?.map((g: any) => g.name) || [];

            // Check if ANY genre is in top genres. If NOT, it's exploratory.
            // (Strict definition: purely outside comfort zone)
            const isComfortZone = genres.some(g => topGenreSet.has(g.toLowerCase()));

            if (!isComfortZone && genres.length > 0) {
                // Find the rating for this movie
                const film = recentRated.find(f => uriToTmdb.get(f.uri) === row.tmdb_id);
                if (film?.rating) {
                    newExploratoryCount++;
                    newExploratoryRatingSum += film.rating;
                }
            }
        });

        if (newExploratoryCount === 0) {
            console.log('[AdaptiveLearning] No recent exploratory films found to update stats');
            return;
        }

        const recentExploratoryAvg = newExploratoryRatingSum / newExploratoryCount;
        console.log('[AdaptiveLearning] Recent exploratory stats', { count: newExploratoryCount, avg: recentExploratoryAvg });

        // 3. Update exploration rate (Simple Bandit Logic)
        // If user likes exploratory films (avg > 3.5), increase exploration.
        // If user dislikes them (avg < 3.0), decrease exploration.
        // Otherwise, keep steady or slight decay.

        const LEARNING_RATE = 0.05;
        const MAX_EXPLORATION = 0.30;
        const MIN_EXPLORATION = 0.05;

        if (recentExploratoryAvg >= 3.5) {
            explorationRate = Math.min(MAX_EXPLORATION, explorationRate + LEARNING_RATE);
        } else if (recentExploratoryAvg < 3.0) {
            explorationRate = Math.max(MIN_EXPLORATION, explorationRate - LEARNING_RATE);
        }

        // Update cumulative stats (weighted average for simplicity or just cumulative)
        // Let's just update the running average
        const totalRated = exploratoryFilmsRated + newExploratoryCount;
        const totalSum = (exploratoryAvgRating * exploratoryFilmsRated) + newExploratoryRatingSum;
        exploratoryAvgRating = totalSum / totalRated;
        exploratoryFilmsRated = totalRated;

        // 4. Persist changes
        const { error: updateError } = await supabase
            .from('user_exploration_stats')
            .upsert({
                user_id: userId,
                exploration_rate: explorationRate,
                exploratory_films_rated: exploratoryFilmsRated,
                exploratory_avg_rating: exploratoryAvgRating,
                last_updated: new Date().toISOString()
            });

        if (updateError) throw updateError;

        console.log('[AdaptiveLearning] Stats updated', { explorationRate, exploratoryFilmsRated });

    } catch (e) {
        console.error('[AdaptiveLearning] Error updating stats', e);
    }
}

/**
 * Update learned genre transitions based on watch history
 * e.g., If user watches Drama -> Sci-Fi often and rates highly, record that transition.
 */
export async function updateGenreTransitions(
    userId: string,
    films: FilmEvent[]
) {
    if (!supabase) return;

    console.log('[AdaptiveLearning] Updating genre transitions');

    try {
        // 1. Sort films by date to find sequences
        const sortedFilms = films
            .filter(f => f.lastDate && f.rating !== undefined)
            .sort((a, b) => new Date(a.lastDate!).getTime() - new Date(b.lastDate!).getTime());

        if (sortedFilms.length < 2) return;

        // 2. Get TMDB IDs and Genres
        // We need to batch fetch mappings and movie data again. 
        // For efficiency, let's just look at the last 50 films.
        const recentFilms = sortedFilms.slice(-50);
        const uris = recentFilms.map(f => f.uri);

        const { data: mappings } = await supabase
            .from('film_tmdb_map')
            .select('uri, tmdb_id')
            .in('uri', uris);

        const uriToTmdb = new Map(mappings?.map(m => [m.uri, m.tmdb_id]));
        const tmdbIds = recentFilms.map(f => uriToTmdb.get(f.uri)).filter(id => id !== undefined) as number[];

        if (tmdbIds.length === 0) return;

        const { data: movieData } = await supabase
            .from('tmdb_movies')
            .select('tmdb_id, data')
            .in('tmdb_id', tmdbIds);

        // Store both genre names AND ids
        const tmdbToGenres = new Map<number, Array<{ id: number; name: string }>>();
        movieData?.forEach(row => {
            const genres = row.data.genres?.map((g: any) => ({ id: g.id, name: g.name })) || [];
            tmdbToGenres.set(row.tmdb_id, genres);
        });

        // 3. Analyze transitions
        const transitions = new Map<string, { success: number, total: number, fromId: number, toId: number, fromName: string, toName: string }>();

        for (let i = 0; i < recentFilms.length - 1; i++) {
            const current = recentFilms[i];
            const next = recentFilms[i + 1];

            const currentId = uriToTmdb.get(current.uri);
            const nextId = uriToTmdb.get(next.uri);

            if (!currentId || !nextId) continue;

            const currentGenres = tmdbToGenres.get(currentId) || [];
            const nextGenres = tmdbToGenres.get(nextId) || [];

            // We are looking for Cross-Genre transitions.
            // e.g. Drama -> Sci-Fi
            // If they share a genre, it's less of a "transition" and more of "staying in lane", 
            // but we can still track it.
            // Let's focus on primary genre (first one) for simplicity of the graph.

            if (currentGenres.length > 0 && nextGenres.length > 0) {
                const fromGenre = currentGenres[0];
                const toGenre = nextGenres[0];

                if (fromGenre.name === toGenre.name) continue; // Skip same-genre transitions for now

                const key = `${fromGenre.id}|${toGenre.id}`;
                const stats = transitions.get(key) || { success: 0, total: 0, fromId: fromGenre.id, toId: toGenre.id, fromName: fromGenre.name, toName: toGenre.name };

                stats.total++;
                // A "successful" transition is one where the NEXT film was rated highly (>= 3.5)
                if ((next.rating || 0) >= 3.5) {
                    stats.success++;
                }

                transitions.set(key, stats);
            }
        }

        // 4. Update Database
        for (const [key, stats] of transitions.entries()) {
            const { fromId, toId, fromName, toName } = stats as any;

            // Fetch existing using genre IDs (which is the unique constraint)
            const { data: existing } = await supabase
                .from('user_adjacent_preferences')
                .select('*')
                .eq('user_id', userId)
                .eq('from_genre_id', fromId)
                .eq('to_genre_id', toId)
                .maybeSingle();

            const oldTotal = existing?.rating_count || 0;
            const oldSuccessRate = existing?.success_rate || 0;
            const oldSuccessCount = Math.round(oldTotal * oldSuccessRate);

            const newTotal = oldTotal + stats.total;
            const newSuccessCount = oldSuccessCount + stats.success;
            const newSuccessRate = newTotal > 0 ? newSuccessCount / newTotal : 0;

            const { error } = await supabase
                .from('user_adjacent_preferences')
                .upsert({
                    user_id: userId,
                    from_genre_id: fromId,
                    from_genre_name: fromName,
                    to_genre_id: toId,
                    to_genre_name: toName,
                    success_rate: newSuccessRate,
                    rating_count: newTotal,
                    last_updated: new Date().toISOString()
                }, { onConflict: 'user_id,from_genre_id,to_genre_id' });
            
            if (error) {
                console.error('[AdaptiveLearning] Error upserting transition', { fromName, toName, error });
            }
        }

        console.log('[AdaptiveLearning] Transitions updated', { count: transitions.size });

    } catch (e) {
        console.error('[AdaptiveLearning] Error updating transitions', e);
    }
}

/**
 * Handle negative feedback (blocked suggestion)
 * If the user blocks an exploratory film, we should decrease the exploration rate.
 * BUT, if the film matches a known "avoid" genre, we shouldn't penalize the exploration rate
 * because that's just the system failing to filter a known dislike, not a failed exploration attempt.
 */
export async function handleNegativeFeedback(
    userId: string,
    tmdbId: number,
    topGenres: string[],
    avoidGenres: string[] = []
) {
    if (!supabase) return;

    console.log('[AdaptiveLearning] Handling negative feedback', { userId, tmdbId });

    try {
        // 1. Fetch movie genres to see if it was exploratory
        const { data: movieRow } = await supabase
            .from('tmdb_movies')
            .select('data')
            .eq('tmdb_id', tmdbId)
            .maybeSingle();

        if (!movieRow?.data?.genres) return;

        const genres: string[] = movieRow.data.genres.map((g: any) => g.name);
        const topGenreSet = new Set(topGenres.map(g => g.toLowerCase()));
        const avoidGenreSet = new Set(avoidGenres.map(g => g.toLowerCase()));

        const isComfortZone = genres.some(g => topGenreSet.has(g.toLowerCase()));
        const isKnownAvoid = genres.some(g => avoidGenreSet.has(g.toLowerCase()));

        // If it's NOT in comfort zone, it was likely an exploratory pick (or just random/trending)
        // If user blocks it, they are rejecting exploration in this direction.
        // EXCEPTION: If it's a known avoid genre, don't penalize exploration rate.
        if (!isComfortZone && !isKnownAvoid) {
            console.log('[AdaptiveLearning] Blocked exploratory film. Penalizing exploration rate.');

            // 2. Fetch current stats
            const { data: currentStats } = await supabase
                .from('user_exploration_stats')
                .select('*')
                .eq('user_id', userId)
                .maybeSingle();

            let explorationRate = currentStats?.exploration_rate ?? 0.15;

            // Decrease rate
            // We penalize stronger than we reward to avoid annoying the user
            const PENALTY = 0.02;
            const MIN_EXPLORATION = 0.05;

            explorationRate = Math.max(MIN_EXPLORATION, explorationRate - PENALTY);

            // 3. Update stats
            await supabase
                .from('user_exploration_stats')
                .upsert({
                    user_id: userId,
                    exploration_rate: explorationRate,
                    last_updated: new Date().toISOString()
                });

            console.log('[AdaptiveLearning] Exploration rate penalized', { newRate: explorationRate });
        } else if (isKnownAvoid) {
            console.log('[AdaptiveLearning] Blocked film was already in avoid list. Skipping exploration penalty.');
        }

    } catch (e) {
        console.error('[AdaptiveLearning] Error handling negative feedback', e);
    }
}
