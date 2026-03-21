/**
 * Unified Movie API
 * Tries TuiMDB first (better genre data, more relaxed rate limits),
 * falls back to TMDB if needed.
 */

import { type TMDBMovie } from './enrich';

/**
 * Helper to get the base URL for internal API calls
 */
function getBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
}

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
 * When TuiMDB returns results, we also search TMDB to get TMDB IDs and merge results
 */
export async function searchMovies(options: MovieSearchOptions): Promise<UnifiedMovie[]> {
  const { query, year, preferTuiMDB = true } = options;
  
  // Try TuiMDB first if preferred
  if (preferTuiMDB) {
    try {
      console.log('[UnifiedAPI] Searching TuiMDB', { query, year });
      const tuiUrl = new URL('/api/tuimdb/search', getBaseUrl());
      tuiUrl.searchParams.set('query', query);
      if (year) tuiUrl.searchParams.set('year', String(year));
      tuiUrl.searchParams.set('_t', String(Date.now()));
      
      const tuiR = await fetch(tuiUrl.toString());
      const tuiJ = await tuiR.json();
      
      if (tuiR.ok && tuiJ.ok && tuiJ.results && tuiJ.results.length > 0) {
        console.log('[UnifiedAPI] TuiMDB search successful', { count: tuiJ.results.length });
        
        // Also search TMDB to get TMDB IDs and merge
        console.log('[UnifiedAPI] Also searching TMDB to get TMDB IDs');
        const tmdbUrl = new URL('/api/tmdb/search', getBaseUrl());
        tmdbUrl.searchParams.set('query', query);
        if (year) tmdbUrl.searchParams.set('year', String(year));
        tmdbUrl.searchParams.set('_t', String(Date.now()));
        
        try {
          const tmdbR = await fetch(tmdbUrl.toString());
          const tmdbJ = await tmdbR.json();
          
          if (tmdbR.ok && tmdbJ.ok && tmdbJ.results && tmdbJ.results.length > 0) {
            // Merge TuiMDB UIDs into TMDB results by matching titles
            const tuiResults = tuiJ.results as Array<{ UID: number; Title: string; ReleaseDate?: string }>;
            const tmdbResults = tmdbJ.results as TMDBMovie[];
            
            // Match by title (case-insensitive) and optionally year
            for (const tmdbMovie of tmdbResults) {
              const tmdbTitle = tmdbMovie.title?.toLowerCase();
              const tmdbYear = tmdbMovie.release_date ? new Date(tmdbMovie.release_date).getFullYear() : null;
              
              for (const tuiMovie of tuiResults) {
                const tuiTitle = tuiMovie.Title?.toLowerCase();
                const tuiYear = tuiMovie.ReleaseDate ? new Date(tuiMovie.ReleaseDate).getFullYear() : null;
                
                // Match if titles are the same and years match (if both exist)
                if (tmdbTitle === tuiTitle && (!tmdbYear || !tuiYear || tmdbYear === tuiYear)) {
                  tmdbMovie.tuimdb_uid = tuiMovie.UID;
                  console.log('[UnifiedAPI] Linked TuiMDB UID', { 
                    title: tmdbMovie.title, 
                    tmdbId: tmdbMovie.id, 
                    tuiUid: tuiMovie.UID 
                  });
                  break;
                }
              }
            }
            
            return tmdbResults;
          }
        } catch (tmdbError) {
          console.error('[UnifiedAPI] TMDB search failed during TuiMDB merge', tmdbError);
        }
        
        // If TMDB search failed, we can't use TuiMDB results (need TMDB IDs)
        console.log('[UnifiedAPI] Could not get TMDB IDs, falling through to TMDB-only search');
      } else {
        console.log('[UnifiedAPI] TuiMDB returned no results, trying TMDB');
      }
    } catch (error) {
      console.error('[UnifiedAPI] TuiMDB search failed, falling back to TMDB', error);
    }
  }
  
  // Fall back to TMDB
  console.log('[UnifiedAPI] Searching TMDB', { query, year });
  const u = new URL('/api/tmdb/search', getBaseUrl());
  u.searchParams.set('query', query);
  if (year) u.searchParams.set('year', String(year));
  u.searchParams.set('_t', String(Date.now())); // Cache buster
  
  const r = await fetch(u.toString());
  const j = await r.json();
  if (!r.ok || !j.ok) {
    console.error('[UnifiedAPI] TMDB search error', { status: r.status, body: j });
    // Treat TMDB search failures as an empty result set instead of throwing so
    // callers (like import enrichment) can continue without hard-failing.
    return [] as TMDBMovie[];
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
      const u = new URL('/api/tuimdb/movie', getBaseUrl());
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
  const u = new URL('/api/tmdb/movie', getBaseUrl());
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
