/**
 * Unified Movie API
 * Tries TuiMDB first (better genre data, more relaxed rate limits),
 * falls back to TMDB if needed.
 */

import { type TMDBMovie } from './enrich';

export type UnifiedMovie = TMDBMovie;

export type MovieSearchOptions = {
  query: string;
  year?: number;
  preferTuiMDB?: boolean; // Default true
};

export type MovieDetailsOptions = {
  id: number;
  preferTuiMDB?: boolean; // Default true
};

/**
 * Search for movies, trying TuiMDB first then TMDB
 * This is a client-side function that calls the API routes
 */
export async function searchMovies(options: MovieSearchOptions): Promise<UnifiedMovie[]> {
  const { query, year, preferTuiMDB = true } = options;
  
  // Try TuiMDB first if preferred
  if (preferTuiMDB) {
    try {
      console.log('[UnifiedAPI] Searching TuiMDB', { query, year });
      const u = new URL('/api/tuimdb/search', typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
      u.searchParams.set('query', query);
      if (year) u.searchParams.set('year', String(year));
      u.searchParams.set('_t', String(Date.now())); // Cache buster
      
      const r = await fetch(u.toString());
      const j = await r.json();
      
      if (r.ok && j.ok && j.results && j.results.length > 0) {
        console.log('[UnifiedAPI] TuiMDB search successful', { count: j.results.length });
        return j.results;
      }
      
      console.log('[UnifiedAPI] TuiMDB returned no results, trying TMDB');
    } catch (error) {
      console.error('[UnifiedAPI] TuiMDB search failed, falling back to TMDB', error);
    }
  }
  
  // Fall back to TMDB
  console.log('[UnifiedAPI] Searching TMDB', { query, year });
  const u = new URL('/api/tmdb/search', typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  u.searchParams.set('query', query);
  if (year) u.searchParams.set('year', String(year));
  u.searchParams.set('_t', String(Date.now())); // Cache buster
  
  const r = await fetch(u.toString());
  const j = await r.json();
  
  if (!r.ok || !j.ok) {
    console.error('[UnifiedAPI] TMDB search error', { status: r.status, body: j });
    throw new Error(j.error || 'Movie search failed');
  }
  
  return j.results as TMDBMovie[];
}

/**
 * Get movie details, trying TuiMDB first then TMDB
 * This is a client-side function that calls the API routes
 */
export async function getMovieDetails(options: MovieDetailsOptions): Promise<UnifiedMovie | null> {
  const { id, preferTuiMDB = true } = options;
  
  // Try TuiMDB first if preferred
  if (preferTuiMDB) {
    try {
      console.log('[UnifiedAPI] Fetching movie from TuiMDB', { id });
      const u = new URL('/api/tuimdb/movie', typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
      u.searchParams.set('id', String(id));
      u.searchParams.set('_t', String(Date.now())); // Cache buster
      
      const r = await fetch(u.toString());
      const j = await r.json();
      
      if (r.ok && j.ok && j.movie) {
        console.log('[UnifiedAPI] TuiMDB fetch successful', { id, title: j.movie.title });
        return j.movie;
      }
      
      console.log('[UnifiedAPI] TuiMDB returned no movie, trying TMDB');
    } catch (error) {
      console.error('[UnifiedAPI] TuiMDB fetch failed, falling back to TMDB', error);
    }
  }
  
  // Fall back to TMDB
  console.log('[UnifiedAPI] Fetching movie from TMDB', { id });
  const u = new URL('/api/tmdb/movie', typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  u.searchParams.set('id', String(id));
  u.searchParams.set('_t', String(Date.now())); // Cache buster
  
  try {
    const r = await fetch(u.toString());
    const j = await r.json();
    
    if (!r.ok || !j.ok) {
      console.error('[UnifiedAPI] TMDB fetch error', { status: r.status, body: j });
      return null;
    }
    
    return j.movie as TMDBMovie;
  } catch (e) {
    console.error('[UnifiedAPI] TMDB fetch exception', e);
    return null;
  }
}

/**
 * Check which API is currently being used based on environment
 */
export function getCurrentMovieAPI(): 'tuimdb' | 'tmdb' | 'both' {
  const hasTuiMDB = !!process.env.TUIMDB_API_KEY;
  const hasTMDB = !!process.env.TMDB_API_KEY;
  
  if (hasTuiMDB && hasTMDB) return 'both';
  if (hasTuiMDB) return 'tuimdb';
  if (hasTMDB) return 'tmdb';
  return 'tmdb'; // default
}

/**
 * Get API status information
 */
export function getAPIStatus() {
  return {
    tuimdb: {
      configured: !!process.env.TUIMDB_API_KEY,
      endpoint: 'https://tuimdb.com/api',
    },
    tmdb: {
      configured: !!process.env.TMDB_API_KEY,
      endpoint: 'https://api.themoviedb.org/3',
    },
    current: getCurrentMovieAPI(),
  };
}
