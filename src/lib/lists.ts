import { supabase } from './supabaseClient';

export type SavedMovie = {
    id: string;
    user_id: string;
    tmdb_id: number;
    title: string;
    year?: string | null;
    poster_path?: string | null;
    order_index: number;
    created_at: string;
};

export type MovieToSave = {
    tmdb_id: number;
    title: string;
    year?: string | null;
    poster_path?: string | null;
};

/**
 * Save a movie to the user's list
 */
export async function saveMovie(userId: string, movie: MovieToSave): Promise<{ success: boolean; error?: string }> {
    if (!supabase) {
        return { success: false, error: 'Supabase client not initialized' };
    }

    try {
        // Get the current max order_index for this user
        const { data: existingMovies, error: fetchError } = await supabase
            .from('saved_suggestions')
            .select('order_index')
            .eq('user_id', userId)
            .order('order_index', { ascending: false })
            .limit(1);

        if (fetchError) {
            console.error('Error fetching existing movies:', fetchError);
            return { success: false, error: fetchError.message };
        }

        const maxOrder = existingMovies && existingMovies.length > 0 ? existingMovies[0].order_index : -1;

        // Insert the new movie
        const { error: insertError } = await supabase
            .from('saved_suggestions')
            .insert({
                user_id: userId,
                tmdb_id: movie.tmdb_id,
                title: movie.title,
                year: movie.year,
                poster_path: movie.poster_path,
                order_index: maxOrder + 1,
            });

        if (insertError) {
            console.error('Error saving movie:', insertError);
            return { success: false, error: insertError.message };
        }

        return { success: true };
    } catch (error: any) {
        console.error('Unexpected error saving movie:', error);
        return { success: false, error: error.message || 'Unknown error' };
    }
}

/**
 * Remove a movie from the user's list
 */
export async function removeMovie(userId: string, tmdbId: number): Promise<{ success: boolean; error?: string }> {
    if (!supabase) {
        return { success: false, error: 'Supabase client not initialized' };
    }

    try {
        const { error } = await supabase
            .from('saved_suggestions')
            .delete()
            .eq('user_id', userId)
            .eq('tmdb_id', tmdbId);

        if (error) {
            console.error('Error removing movie:', error);
            return { success: false, error: error.message };
        }

        return { success: true };
    } catch (error: any) {
        console.error('Unexpected error removing movie:', error);
        return { success: false, error: error.message || 'Unknown error' };
    }
}

/**
 * Get all saved movies for the user
 */
export async function getSavedMovies(userId: string): Promise<{ movies: SavedMovie[]; error?: string }> {
    if (!supabase) {
        return { movies: [], error: 'Supabase client not initialized' };
    }

    try {
        const { data, error } = await supabase
            .from('saved_suggestions')
            .select('*')
            .eq('user_id', userId)
            .order('order_index', { ascending: true });

        if (error) {
            console.error('Error fetching saved movies:', error);
            return { movies: [], error: error.message };
        }

        return { movies: data || [] };
    } catch (error: any) {
        console.error('Unexpected error fetching saved movies:', error);
        return { movies: [], error: error.message || 'Unknown error' };
    }
}

/**
 * Reorder saved movies
 * @param userId - The user's ID
 * @param movieIds - Array of tmdb_ids in the new order
 */
export async function reorderMovies(userId: string, movieIds: number[]): Promise<{ success: boolean; error?: string }> {
    if (!supabase) {
        return { success: false, error: 'Supabase client not initialized' };
    }

    try {
        // Update each movie's order_index based on its position in the array
        const updates = movieIds.map((tmdbId, index) =>
            supabase!
                .from('saved_suggestions')
                .update({ order_index: index })
                .eq('user_id', userId)
                .eq('tmdb_id', tmdbId)
        );

        const results = await Promise.all(updates);

        // Check if any updates failed
        const errors = results.filter(r => r.error);
        if (errors.length > 0) {
            console.error('Error reordering movies:', errors);
            return { success: false, error: errors[0].error!.message };
        }

        return { success: true };
    } catch (error: any) {
        console.error('Unexpected error reordering movies:', error);
        return { success: false, error: error.message || 'Unknown error' };
    }
}

/**
 * Check if a movie is already saved
 */
export async function isMovieSaved(userId: string, tmdbId: number): Promise<boolean> {
    if (!supabase) {
        return false;
    }

    try {
        const { data, error } = await supabase
            .from('saved_suggestions')
            .select('id')
            .eq('user_id', userId)
            .eq('tmdb_id', tmdbId)
            .limit(1);

        if (error) {
            console.error('Error checking if movie is saved:', error);
            return false;
        }

        return data && data.length > 0;
    } catch (error: any) {
        console.error('Unexpected error checking if movie is saved:', error);
        return false;
    }
}

/**
 * Export saved movies to Letterboxd CSV format
 */
export function exportToLetterboxd(movies: SavedMovie[]): string {
    // Letterboxd watchlist import format uses "Name" not "Title"
    // Format: Name,Year,tmdbID
    const headers = 'Name,Year,tmdbID';
    const rows = movies.map(movie => {
        const name = `"${movie.title.replace(/"/g, '""')}"`;
        const year = movie.year || '';
        const tmdbId = movie.tmdb_id;
        return `${name},${year},${tmdbId}`;
    });

    return [headers, ...rows].join('\n');
}
