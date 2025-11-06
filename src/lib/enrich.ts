import { supabase } from './supabaseClient';

export type TMDBMovie = {
  id: number;
  title: string;
  release_date?: string;
  poster_path?: string;
  backdrop_path?: string;
  overview?: string;
};

export async function searchTmdb(query: string, year?: number) {
  const u = new URL('/api/tmdb/search', typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  u.searchParams.set('query', query);
  if (year) u.searchParams.set('year', String(year));
  const r = await fetch(u.toString());
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || 'TMDB search failed');
  return j.results as TMDBMovie[];
}

export async function upsertTmdbCache(movie: TMDBMovie) {
  if (!supabase) throw new Error('Supabase not initialized');
  const { error } = await supabase.from('tmdb_movies').upsert({ tmdb_id: movie.id, data: movie }, { onConflict: 'tmdb_id' });
  if (error) throw error;
}

export async function upsertFilmMapping(userId: string, uri: string, tmdbId: number) {
  if (!supabase) throw new Error('Supabase not initialized');
  const { error } = await supabase.from('film_tmdb_map').upsert({ user_id: userId, uri, tmdb_id: tmdbId }, { onConflict: 'user_id,uri' });
  if (error) throw error;
}
