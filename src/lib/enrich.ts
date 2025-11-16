import { supabase } from './supabaseClient';
import { searchMovies } from './movieAPI';
import { 
  analyzeSubgenrePatterns, 
  analyzeCrossGenrePatterns,
  shouldFilterBySubgenre,
  boostForCrossGenreMatch,
  type SubgenrePattern,
  type CrossGenrePattern
} from './subgenreDetection';
import { checkNicheCompatibility } from './advancedFiltering';
import { getTuiMDBMovie, type TuiMDBMovie } from './tuimdb';
import { mergeEnhancedGenres, getCurrentSeasonalGenres, boostSeasonalGenres } from './genreEnhancement';

export type TMDBMovie = {
  id: number;
  title: string;
  release_date?: string;
  poster_path?: string;
  backdrop_path?: string;
  overview?: string;
  vote_average?: number;
  vote_count?: number;
  genres?: Array<{ id: number; name: string }>;
  production_companies?: Array<{ id: number; name: string; logo_path?: string }>;
  credits?: { cast?: Array<{ id: number; name: string; known_for_department?: string; order?: number }>; crew?: Array<{ id: number; name: string; job?: string; department?: string }> };
  keywords?: { keywords?: Array<{ id: number; name: string }>; results?: Array<{ id: number; name: string }> };
  belongs_to_collection?: { id: number; name: string; poster_path?: string; backdrop_path?: string } | null;
  videos?: { results?: Array<{ id: string; key: string; site: string; type: string; name: string; official?: boolean }> };
  images?: { backdrops?: Array<{ file_path: string; vote_average?: number }>; posters?: Array<{ file_path: string; vote_average?: number }> };
  lists?: { results?: Array<{ id: number; name: string; description?: string; item_count?: number }> };
  tuimdb_uid?: number; // TuiMDB's internal UID for cross-referencing
  enhanced_genres?: Array<{ id: number; name: string; source: 'tmdb' | 'tuimdb' }>; // Merged TMDB + TuiMDB genres
};

/**
 * Search for movies using unified API (tries TuiMDB first to get UIDs, then TMDB)
 */
export async function searchTmdb(query: string, year?: number) {
  console.log('[MovieAPI] search start', { query, year });
  try {
    const results = await searchMovies({ query, year, preferTuiMDB: true });
    console.log('[MovieAPI] search ok', { count: results.length });
    return results;
  } catch (e) {
    console.error('[MovieAPI] search exception', e);
    throw e;
  }
}

export async function upsertTmdbCache(movie: TMDBMovie) {
  if (!supabase) throw new Error('Supabase not initialized');
  const { error } = await supabase.from('tmdb_movies').upsert({ tmdb_id: movie.id, data: movie }, { onConflict: 'tmdb_id' });
  if (error) {
    console.error('[Supabase] upsertTmdbCache error', { tmdbId: movie.id, error });
    throw error;
  }
}

export async function upsertFilmMapping(userId: string, uri: string, tmdbId: number) {
  if (!supabase) throw new Error('Supabase not initialized');
  const { error } = await supabase.from('film_tmdb_map').upsert({ user_id: userId, uri, tmdb_id: tmdbId }, { onConflict: 'user_id,uri' });
  if (error) {
    console.error('[Supabase] upsertFilmMapping error', { userId, uri, tmdbId, error });
    throw error;
  }
}

export async function getFilmMappings(userId: string, uris: string[]) {
  if (!supabase) throw new Error('Supabase not initialized');
  if (!uris.length) return new Map<string, number>();
  
  // First verify auth is working
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session) {
      console.error('[Mappings] No active session - cannot fetch mappings');
      return new Map<string, number>();
    }
    console.log('[Mappings] Auth verified', { uid: sessionData.session.user.id });
  } catch (e) {
    console.error('[Mappings] Auth check failed', e);
    return new Map<string, number>();
  }
  
  // Instead of chunking by URIs (which can hit query size limits),
  // fetch ALL mappings for this user, then filter in memory
  console.log('[Mappings] fetching all mappings for user', { userId, uriCount: uris.length });
  const map = new Map<string, number>();
  
  try {
    // Increase timeout to 15 seconds for large datasets
    const queryPromise = supabase
      .from('film_tmdb_map')
      .select('uri, tmdb_id')
      .eq('user_id', userId);
    
    const { data, error } = await withTimeout(
      queryPromise as unknown as Promise<{ data: Array<{ uri: string; tmdb_id: number }>; error: any }>, 
      15000
    );
    
    if (error) {
      console.error('[Mappings] error fetching mappings', { error, code: error.code, message: error.message, details: error.details });
      return map;
    }
    
    console.log('[Mappings] all mappings loaded', { totalRows: (data ?? []).length });
    
    // Filter to only the URIs we care about
    const uriSet = new Set(uris);
    for (const row of data ?? []) {
      if (row.uri != null && row.tmdb_id != null && uriSet.has(row.uri)) {
        map.set(row.uri, Number(row.tmdb_id));
      }
    }
    
  } catch (e: any) {
    console.error('[Mappings] timeout or exception', { 
      error: e, 
      message: e?.message, 
      name: e?.name,
      stack: e?.stack?.split('\n').slice(0, 3).join('\n')
    });
  }
  
  console.log('[Mappings] finished getFilmMappings', { totalMappings: map.size, requestedUris: uris.length });
  return map;
}

export async function blockSuggestion(userId: string, tmdbId: number) {
  if (!supabase) throw new Error('Supabase not initialized');
  const { error } = await supabase.from('blocked_suggestions').insert({ user_id: userId, tmdb_id: tmdbId });
  if (error && error.code !== '23505') { // Ignore duplicate key errors
    console.error('[Supabase] blockSuggestion error', { userId, tmdbId, error });
    throw error;
  }
}

export async function unblockSuggestion(userId: string, tmdbId: number) {
  if (!supabase) throw new Error('Supabase not initialized');
  const { error } = await supabase.from('blocked_suggestions').delete().eq('user_id', userId).eq('tmdb_id', tmdbId);
  if (error) {
    console.error('[Supabase] unblockSuggestion error', { userId, tmdbId, error });
    throw error;
  }
}

export async function getBlockedSuggestions(userId: string): Promise<Set<number>> {
  if (!supabase) throw new Error('Supabase not initialized');
  const { data, error } = await supabase
    .from('blocked_suggestions')
    .select('tmdb_id')
    .eq('user_id', userId);
  
  if (error) {
    console.error('[Supabase] getBlockedSuggestions error', { userId, error });
    return new Set();
  }
  
  return new Set((data ?? []).map(row => Number(row.tmdb_id)));
}

export async function fetchTmdbMovie(id: number): Promise<TMDBMovie> {
  // Fetch from TMDB (primary source)
  console.log('[UnifiedAPI] fetch movie from TMDB', { id });
  const u = new URL('/api/tmdb/movie', typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  u.searchParams.set('id', String(id));
  u.searchParams.set('_t', String(Date.now())); // Cache buster
  
  let movie: TMDBMovie;
  try {
    const r = await fetch(u.toString(), { cache: 'no-store' });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      console.error('[UnifiedAPI] TMDB fetch movie error', { id, status: r.status, body: j });
      throw new Error(j.error || 'Movie fetch failed');
    }
    console.log('[UnifiedAPI] TMDB fetch movie ok', { id });
    movie = j.movie as TMDBMovie;
  } catch (e) {
    console.error('[UnifiedAPI] TMDB fetch movie exception', { id, error: e });
    throw e;
  }

  // Try to get TuiMDB UID by searching for the movie
  try {
    console.log('[UnifiedAPI] searching TuiMDB for UID', { tmdbId: id, title: movie.title });
    const tuiUrl = new URL('/api/tuimdb/search', typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
    const year = movie.release_date ? new Date(movie.release_date).getFullYear() : undefined;
    tuiUrl.searchParams.set('query', movie.title);
    if (year) tuiUrl.searchParams.set('year', String(year));
    tuiUrl.searchParams.set('_t', String(Date.now()));
    
    const tuiR = await fetch(tuiUrl.toString(), { cache: 'no-store' });
    const tuiJ = await tuiR.json();
    
    if (tuiR.ok && tuiJ.ok && tuiJ.results?.length > 0) {
      // Use first result (best match)
      const tuimdbUid = tuiJ.results[0].UID;
      console.log('[UnifiedAPI] TuiMDB UID found', { tmdbId: id, tuimdbUid });
      movie.tuimdb_uid = tuimdbUid;
      
      // Fetch full TuiMDB movie details to get enhanced genres
      try {
        const tuiMovie = await getTuiMDBMovie(tuimdbUid);
        if (tuiMovie && tuiMovie.genres) {
          // Merge TuiMDB genres with TMDB genres
          movie.enhanced_genres = mergeEnhancedGenres(
            movie.genres || [],
            tuiMovie.genres
          );
          console.log('[UnifiedAPI] Enhanced genres merged', {
            tmdbId: id,
            tmdbGenres: movie.genres?.length || 0,
            tuimdbGenres: tuiMovie.genres.length,
            enhancedTotal: movie.enhanced_genres?.length || 0
          });
        }
      } catch (tuiErr) {
        console.warn('[UnifiedAPI] Failed to fetch TuiMDB details', { tuimdbUid, error: tuiErr });
      }
    } else {
      console.log('[UnifiedAPI] TuiMDB UID not found', { tmdbId: id });
    }
  } catch (e) {
    console.log('[UnifiedAPI] TuiMDB UID search failed', { tmdbId: id, error: e });
  }
  
  return movie;
}

export type FilmEventLite = { uri: string; title: string; year: number | null; rating?: number; liked?: boolean };

function extractFeatures(movie: TMDBMovie) {
  // Use enhanced genres if available (includes TuiMDB data), otherwise fall back to TMDB genres
  const genreSource = (movie as any).enhanced_genres || (movie as any).genres || [];
  const genres: string[] = Array.isArray(genreSource) ? genreSource.map((g: any) => g.name).filter(Boolean) : [];
  const genreIds: number[] = Array.isArray(genreSource) ? genreSource.map((g: any) => g.id).filter(Boolean) : [];
  const genreSources: string[] = Array.isArray(genreSource) ? genreSource.map((g: any) => g.source || 'tmdb') : [];
  
  // Check for seasonal genres from TuiMDB (e.g., Christmas, Halloween)
  const seasonalInfo = getCurrentSeasonalGenres();
  const hasSeasonalGenre = genreIds.some(id => seasonalInfo.genres.includes(id));
  const directors = (movie.credits?.crew || []).filter((c) => c.job === 'Director').map((c) => c.name);
  const directorIds = (movie.credits?.crew || []).filter((c) => c.job === 'Director').map((c) => c.id);
  const cast = (movie.credits?.cast || []).slice(0, 5).map((c) => c.name);
  const keywordsList = movie.keywords?.keywords || movie.keywords?.results || [];
  const keywords = (keywordsList as Array<{ id: number; name: string }>).map((k) => k.name);
  const keywordIds = (keywordsList as Array<{ id: number; name: string }>).map((k) => k.id);
  const original_language = (movie as any).original_language as string | undefined;
  const runtime = (movie as any).runtime as number | undefined;
  
  // Extract production companies/studios
  const productionCompanies = (movie.production_companies || []).map(c => c.name);
  const productionCompanyIds = (movie.production_companies || []).map(c => c.id);
  
  // Extract collection info
  const collection = movie.belongs_to_collection ? {
    id: movie.belongs_to_collection.id,
    name: movie.belongs_to_collection.name,
    poster_path: movie.belongs_to_collection.poster_path
  } : null;
  
  // Extract video data (trailers, teasers, etc.)
  const videos = (movie.videos?.results || [])
    .filter(v => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'))
    .sort((a, b) => {
      // Prioritize official trailers
      if (a.official && !b.official) return -1;
      if (!a.official && b.official) return 1;
      if (a.type === 'Trailer' && b.type !== 'Trailer') return -1;
      if (a.type !== 'Trailer' && b.type === 'Trailer') return 1;
      return 0;
    });
  
  // Extract lists this movie appears in
  const lists = (movie.lists?.results || [])
    .slice(0, 10) // Limit to top 10 lists
    .map(l => ({ id: l.id, name: l.name, description: l.description, item_count: l.item_count }));
  
  // Extract high-quality images
  const images = {
    backdrops: (movie.images?.backdrops || [])
      .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))
      .slice(0, 5)
      .map(i => i.file_path),
    posters: (movie.images?.posters || [])
      .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))
      .slice(0, 5)
      .map(i => i.file_path)
  };
  
  // Categorize by vote distribution
  const voteAverage = movie.vote_average || 0;
  const voteCount = movie.vote_count || 0;
  let voteCategory: 'hidden-gem' | 'crowd-pleaser' | 'cult-classic' | 'standard' = 'standard';
  
  if (voteAverage >= 7.5 && voteCount < 1000) {
    voteCategory = 'hidden-gem';
  } else if (voteAverage >= 7.0 && voteCount > 10000) {
    voteCategory = 'crowd-pleaser';
  } else if (voteAverage >= 7.0 && voteCount >= 1000 && voteCount <= 5000) {
    voteCategory = 'cult-classic';
  }
  
  // Detect animation/children's/family content markers
  const isAnimation = genres.includes('Animation') || genreIds.includes(16);
  const isFamily = genres.includes('Family') || genreIds.includes(10751);
  const isChildrens = keywords.some(k => 
    k.toLowerCase().includes('children') || 
    k.toLowerCase().includes('kids') || 
    k.toLowerCase().includes('cartoon')
  );
  
  // Create genre combination signature for more precise matching
  const genreCombo = genres.slice().sort().join('+');
  
  return { 
    genres, 
    genreIds,
    genreSources,
    hasSeasonalGenre,
    genreCombo,
    directors,
    directorIds,
    cast,
    productionCompanies,
    productionCompanyIds,
    keywords,
    keywordIds,
    original_language,
    runtime,
    isAnimation,
    isFamily,
    isChildrens,
    collection,
    videos,
    lists,
    images,
    voteCategory,
    voteAverage,
    voteCount
  };
}

// Basic timeout helper for fetches
async function withTimeout<T>(p: Promise<T>, ms = 8000): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

// Fetch with simple cache: prefer Supabase row if present; if missing/partial, fetch from API and upsert
export async function fetchTmdbMovieCached(id: number): Promise<TMDBMovie | null> {
  try {
    if (!supabase) return await withTimeout(fetchTmdbMovie(id));
    const { data, error } = await supabase
      .from('tmdb_movies')
      .select('data')
      .eq('tmdb_id', id)
      .single();
    if (!error && data && data.data) {
      const cached = data.data as TMDBMovie;
      // If cached has credits/keywords, use it directly
      if ((cached.credits && cached.credits.cast && cached.credits.crew) || cached.keywords) {
        return cached;
      }
      // Otherwise fall through to refetch enriched details
    }
  } catch {
    // ignore cache errors
  }
  try {
    const fresh = await withTimeout(fetchTmdbMovie(id));
    // best-effort upsert
    try { await upsertTmdbCache(fresh); } catch {}
    return fresh;
  } catch {
    return null;
  }
}

// Best-effort refresh of TMDB cache rows for a set of ids.
// Used by UI "refresh posters" actions to backfill missing poster/backdrop
// metadata without changing any mappings.
export async function refreshTmdbCacheForIds(ids: number[]): Promise<void> {
  const distinct = Array.from(new Set(ids.filter(Boolean)));
  if (!distinct.length) return;
  // We intentionally do not parallelize too aggressively here; callers can
  // choose when to invoke this (e.g., behind a button).
  for (const id of distinct) {
    try {
      const fresh = await withTimeout(fetchTmdbMovie(id));
      try {
        await upsertTmdbCache(fresh);
      } catch {
        // ignore individual upsert failures
      }
    } catch {
      // ignore individual fetch failures
    }
  }
}

// Concurrency-limited async mapper
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const ret: R[] = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      ret[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return ret;
}

/**
 * Analyze user's library to find incomplete collections/franchises
 * Returns collections where user has watched some but not all films
 */
export async function findIncompleteCollections(
  watchedFilms: Array<{ tmdbId: number; title: string; rating?: number; liked?: boolean }>
): Promise<Array<{ 
  collectionId: number; 
  collectionName: string; 
  watchedCount: number; 
  totalCount: number;
  watchedFilms: Array<{ id: number; title: string; rating?: number }>;
  missingFilms: number[];
  avgRating: number;
}>> {
  console.log('[Collections] Analyzing collections', { filmCount: watchedFilms.length });
  
  // Group films by collection
  const collectionMap = new Map<number, {
    name: string;
    watched: Array<{ id: number; title: string; rating?: number }>;
    ratings: number[];
  }>();
  
  // Fetch TMDB data for watched films to get collection info
  for (const film of watchedFilms) {
    try {
      const movie = await fetchTmdbMovieCached(film.tmdbId);
      if (!movie?.belongs_to_collection) continue;
      
      const collId = movie.belongs_to_collection.id;
      if (!collectionMap.has(collId)) {
        collectionMap.set(collId, {
          name: movie.belongs_to_collection.name,
          watched: [],
          ratings: []
        });
      }
      
      const coll = collectionMap.get(collId)!;
      coll.watched.push({ id: film.tmdbId, title: film.title, rating: film.rating });
      if (film.rating && film.rating >= 4) {
        coll.ratings.push(film.rating);
      }
    } catch (e) {
      console.error(`[Collections] Failed to fetch ${film.tmdbId}`, e);
    }
  }
  
  console.log('[Collections] Found collections', { count: collectionMap.size });
  
  // For each collection with watched films, fetch full collection to find missing films
  const incomplete: Array<{
    collectionId: number;
    collectionName: string;
    watchedCount: number;
    totalCount: number;
    watchedFilms: Array<{ id: number; title: string; rating?: number }>;
    missingFilms: number[];
    avgRating: number;
  }> = [];
  
  for (const [collId, data] of collectionMap.entries()) {
    try {
      // Fetch collection details
      const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY || process.env.TMDB_API_KEY;
      if (!apiKey) continue;
      
      const collUrl = `https://api.themoviedb.org/3/collection/${collId}?api_key=${apiKey}`;
      const r = await fetch(collUrl, { cache: 'no-store' });
      if (!r.ok) continue;
      
      const collData = await r.json();
      const allParts = (collData.parts || []) as Array<{ id: number }>;
      const watchedIds = new Set(data.watched.map(f => f.id));
      const missingFilms = allParts.filter(p => !watchedIds.has(p.id)).map(p => p.id);
      
      // Only include if there are missing films and user liked what they've seen
      if (missingFilms.length > 0 && data.ratings.length > 0) {
        const avgRating = data.ratings.reduce((sum, r) => sum + r, 0) / data.ratings.length;
        
        incomplete.push({
          collectionId: collId,
          collectionName: data.name,
          watchedCount: data.watched.length,
          totalCount: allParts.length,
          watchedFilms: data.watched,
          missingFilms,
          avgRating
        });
      }
    } catch (e) {
      console.error(`[Collections] Failed to fetch collection ${collId}`, e);
    }
  }
  
  // Sort by avg rating (highest first)
  incomplete.sort((a, b) => b.avgRating - a.avgRating);
  
  console.log('[Collections] Incomplete collections found', { count: incomplete.length });
  return incomplete;
}

/**
 * Get films from curated lists that contain movies the user loved
 * This discovers hidden connections between films
 */
export async function discoverFromLists(
  seedFilms: Array<{ tmdbId: number; title: string; rating?: number }>
): Promise<number[]> {
  console.log('[Lists] Discovering from curated lists', { seedCount: seedFilms.length });
  
  // Use top 5 highest-rated films as seeds
  const seeds = seedFilms
    .filter(f => f.rating && f.rating >= 4.5)
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .slice(0, 5);
  
  const discoveredIds = new Set<number>();
  const listIds = new Set<number>();
  
  // For each seed, get lists it appears in
  for (const seed of seeds) {
    try {
      const movie = await fetchTmdbMovieCached(seed.tmdbId);
      const lists = movie?.lists?.results || [];
      
      // Add films from lists with substantial content (20+ items)
      for (const list of lists) {
        if (list.item_count && list.item_count >= 20 && list.item_count <= 200) {
          listIds.add(list.id);
        }
      }
    } catch (e) {
      console.error(`[Lists] Failed to fetch lists for ${seed.tmdbId}`, e);
    }
  }
  
  console.log('[Lists] Found relevant lists', { count: listIds.size });
  
  // Fetch films from each list (up to 10 lists)
  const limitedLists = Array.from(listIds).slice(0, 10);
  for (const listId of limitedLists) {
    try {
      const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY || process.env.TMDB_API_KEY;
      if (!apiKey) continue;
      
      const listUrl = `https://api.themoviedb.org/3/list/${listId}?api_key=${apiKey}`;
      const r = await fetch(listUrl, { cache: 'no-store' });
      if (!r.ok) continue;
      
      const listData = await r.json();
      const items = (listData.items || []) as Array<{ id: number }>;
      
      // Add up to 10 films from each list
      items.slice(0, 10).forEach(item => discoveredIds.add(item.id));
    } catch (e) {
      console.error(`[Lists] Failed to fetch list ${listId}`, e);
    }
  }
  
  console.log('[Lists] Discovered films from lists', { count: discoveredIds.size });
  return Array.from(discoveredIds);
}

/**
 * Build a taste profile with IDs for TMDB discovery
 * Extracts top genres, keywords, and directors with their IDs and weights
 */
export async function buildTasteProfile(params: {
  films: Array<{ uri: string; rating?: number; liked?: boolean }>;
  mappings: Map<string, number>;
  topN?: number;
}): Promise<{
  topGenres: Array<{ id: number; name: string; weight: number }>;
  topKeywords: Array<{ id: number; name: string; weight: number }>;
  topDirectors: Array<{ id: number; name: string; weight: number }>;
}> {
  const topN = params.topN ?? 10;
  
  // Helper to calculate preference weight
  const getWeight = (rating?: number, isLiked?: boolean): number => {
    const r = rating ?? 3;
    if (r >= 4.5) return isLiked ? 2.0 : 1.5;
    if (r >= 3.5) return isLiked ? 1.5 : 1.2;
    if (r >= 2.5) return isLiked ? 1.0 : 0.3;
    if (r >= 1.5) return isLiked ? 0.7 : 0.1;
    return isLiked ? 0.5 : 0.0;
  };
  
  // Get highly-rated/liked films
  const likedFilms = params.films.filter(f => 
    (f.liked || (f.rating ?? 0) >= 4) && params.mappings.has(f.uri)
  );
  
  const likedIds = likedFilms
    .map(f => params.mappings.get(f.uri)!)
    .filter(Boolean)
    .slice(0, 100); // Cap to avoid too many API calls
  
  // Fetch movie details
  const movies = await Promise.all(
    likedIds.map(id => fetchTmdbMovieCached(id))
  );
  
  const genreWeights = new Map<number, { name: string; weight: number }>();
  const keywordWeights = new Map<number, { name: string; weight: number }>();
  const directorWeights = new Map<number, { name: string; weight: number }>();
  
  // Accumulate weighted preferences
  for (let i = 0; i < movies.length; i++) {
    const movie = movies[i];
    if (!movie) continue;
    
    const film = likedFilms[i];
    const weight = getWeight(film.rating, film.liked);
    const feats = extractFeatures(movie);
    
    // Genres with IDs
    feats.genreIds.forEach((id, idx) => {
      const name = feats.genres[idx];
      const current = genreWeights.get(id) || { name, weight: 0 };
      genreWeights.set(id, { name, weight: current.weight + weight });
    });
    
    // Keywords with IDs
    feats.keywordIds.forEach((id, idx) => {
      const name = feats.keywords[idx];
      const current = keywordWeights.get(id) || { name, weight: 0 };
      keywordWeights.set(id, { name, weight: current.weight + weight });
    });
    
    // Directors with IDs
    feats.directorIds.forEach((id, idx) => {
      const name = feats.directors[idx];
      const current = directorWeights.get(id) || { name, weight: 0 };
      directorWeights.set(id, { name, weight: current.weight + weight });
    });
  }
  
  // Sort and return top N
  const topGenres = Array.from(genreWeights.entries())
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, topN)
    .map(([id, { name, weight }]) => ({ id, name, weight }));
  
  const topKeywords = Array.from(keywordWeights.entries())
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, topN)
    .map(([id, { name, weight }]) => ({ id, name, weight }));
  
  const topDirectors = Array.from(directorWeights.entries())
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, topN)
    .map(([id, { name, weight }]) => ({ id, name, weight }));
  
  console.log('[TasteProfile] Built', {
    topGenres: topGenres.slice(0, 3).map(g => `${g.name}(${g.weight.toFixed(1)})`),
    topKeywords: topKeywords.slice(0, 3).map(k => `${k.name}(${k.weight.toFixed(1)})`),
    topDirectors: topDirectors.slice(0, 3).map(d => `${d.name}(${d.weight.toFixed(1)})`)
  });
  
  return { topGenres, topKeywords, topDirectors };
}

export async function suggestByOverlap(params: {
  userId: string;
  films: FilmEventLite[];
  mappings: Map<string, number>;
  candidates: number[]; // tmdb ids to consider (e.g., from watchlist mapping or popular)
  excludeGenres?: Set<string>;
  maxCandidates?: number;
  concurrency?: number;
  excludeWatchedIds?: Set<number>;
  desiredResults?: number;
}): Promise<Array<{ tmdbId: number; score: number; reasons: string[]; title?: string; release_date?: string; genres?: string[]; poster_path?: string | null }>> {
  // Build user profile from liked/highly-rated mapped films.
  // Use as much history as possible, but cap TMDB fetches to avoid huge fan-out
  // for extremely large libraries. We bias towards the most recent entries when
  // trimming.
  const liked = params.films.filter((f) => (f.liked || (f.rating ?? 0) >= 4) && params.mappings.get(f.uri));
  const likedIdsAll = liked.map((f) => params.mappings.get(f.uri)!).filter(Boolean) as number[];
  
  // Also identify watched but NOT liked films for negative signals
  const watchedNotLiked = params.films.filter((f) => 
    !f.liked && 
    (f.rating ?? 0) < 3 && 
    params.mappings.get(f.uri)
  );
  const dislikedIdsAll = watchedNotLiked.map((f) => params.mappings.get(f.uri)!).filter(Boolean) as number[];
  
  const likedCap = 800;
  const dislikedCap = 400;
  // If the user has an enormous number of liked films, bias towards
  // the most recent ones (assuming input films are roughly chronological).
  const likedIds = likedIdsAll.length > likedCap ? likedIdsAll.slice(-likedCap) : likedIdsAll;
  const dislikedIds = dislikedIdsAll.length > dislikedCap ? dislikedIdsAll.slice(-dislikedCap) : dislikedIdsAll;
  
  // Create a map of film URI to its rating and liked status for weighted profile building
  const filmPreferenceMap = new Map<string, { rating?: number; liked?: boolean }>();
  for (const f of params.films) {
    filmPreferenceMap.set(f.uri, { rating: f.rating, liked: f.liked });
  }
  
  const likedMovies = await Promise.all(likedIds.map((id) => fetchTmdbMovieCached(id)));
  const dislikedMovies = await Promise.all(dislikedIds.map((id) => fetchTmdbMovieCached(id)));
  
  const likedFeats = likedMovies.filter(Boolean).map((m) => extractFeatures(m as TMDBMovie));
  const dislikedFeats = dislikedMovies.filter(Boolean).map((m) => extractFeatures(m as TMDBMovie));
  
  // Map TMDB IDs back to original film data for weighting
  const likedFilmData = liked.filter(f => params.mappings.has(f.uri));

  // Adjusted weights: keywords are now more important for subgenre detection
  const weights = {
    genre: 0.8,
    genreCombo: 1.2, // Reward exact genre combinations
    director: 1.5,
    cast: 0.5,
    keyword: 1.0, // Increased from 0.4 to better capture subgenres
  };

  // Build positive feature bags (things the user likes)
  // Now with weighted scoring based on rating and liked status
  const pref = {
    genres: new Map<string, number>(),
    genreCombos: new Map<string, number>(),
    directors: new Map<string, number>(),
    cast: new Map<string, number>(),
    productionCompanies: new Map<string, number>(), // Track studio preferences
    keywords: new Map<string, number>(),
    // Track directors/actors within specific subgenres for better matching
    directorKeywords: new Map<string, Set<string>>(), // director -> keywords they work in
    castKeywords: new Map<string, Set<string>>(), // cast -> keywords they work in
    // Track recent watches for recency boost
    recentGenres: new Set<string>(),
    recentDirectors: new Set<string>(),
    recentCast: new Set<string>(),
    recentKeywords: new Set<string>(),
    recentStudios: new Set<string>(),
  };
  
  // Build negative feature bags (things the user avoids)
  const avoid = {
    keywords: new Map<string, number>(),
    genreCombos: new Map<string, number>(),
  };
  
  // Helper function to calculate preference weight for a film
  // Takes into account both rating and liked status
  const getPreferenceWeight = (rating?: number, isLiked?: boolean): number => {
    // Base cases:
    // - 5 stars + liked = 2.0 (strongest signal)
    // - 5 stars, not liked = 1.5 (strong rating but no explicit like)
    // - 4 stars + liked = 1.5
    // - 4 stars, not liked = 1.2
    // - 3 stars + liked = 1.0 (liked but mediocre rating - respect the like)
    // - 2 stars + liked = 0.7 (edge case: low rating but liked - nuanced preference)
    // - 1 star + liked = 0.5 (very rare edge case)
    
    const r = rating ?? 3; // Default to 3 if no rating
    let weight = 0.0;
    
    if (r >= 4.5) {
      weight = isLiked ? 2.0 : 1.5;
    } else if (r >= 3.5) {
      weight = isLiked ? 1.5 : 1.2;
    } else if (r >= 2.5) {
      weight = isLiked ? 1.0 : 0.3; // Mediocre rating: liked matters more
    } else if (r >= 1.5) {
      weight = isLiked ? 0.7 : 0.1; // Low rating but liked: nuanced taste
    } else {
      weight = isLiked ? 0.5 : 0.0; // Very low: only count if explicitly liked
    }
    
    return weight;
  };
  
  // Track patterns
  let totalLiked = likedFeats.length;
  let likedAnimationCount = 0;
  let likedFamilyCount = 0;
  let likedChildrensCount = 0;
  
  for (let i = 0; i < likedFeats.length; i++) {
    const f = likedFeats[i];
    const filmData = likedFilmData[i];
    const weight = getPreferenceWeight(filmData?.rating, filmData?.liked);
    
    // Weight all features by the preference strength
    for (const g of f.genres) pref.genres.set(g, (pref.genres.get(g) ?? 0) + weight);
    if (f.genreCombo) pref.genreCombos.set(f.genreCombo, (pref.genreCombos.get(f.genreCombo) ?? 0) + weight);
    
    for (const d of f.directors) {
      pref.directors.set(d, (pref.directors.get(d) ?? 0) + weight);
      // Track which keywords/subgenres this director works in
      if (!pref.directorKeywords.has(d)) pref.directorKeywords.set(d, new Set());
      f.keywords.forEach(k => pref.directorKeywords.get(d)!.add(k));
    }
    
    for (const c of f.cast) {
      pref.cast.set(c, (pref.cast.get(c) ?? 0) + weight);
      // Track which keywords/subgenres this cast member works in
      if (!pref.castKeywords.has(c)) pref.castKeywords.set(c, new Set());
      f.keywords.forEach(k => pref.castKeywords.get(c)!.add(k));
    }
    
    // Track production companies/studios
    for (const studio of f.productionCompanies) {
      pref.productionCompanies.set(studio, (pref.productionCompanies.get(studio) ?? 0) + weight);
    }
    
    for (const k of f.keywords) pref.keywords.set(k, (pref.keywords.get(k) ?? 0) + weight);
    
    if (f.isAnimation) likedAnimationCount++;
    if (f.isFamily) likedFamilyCount++;
    if (f.isChildrens) likedChildrensCount++;
  }
  
  // Track recent watches (last 20 liked films) for recency boost
  const recentLiked = likedFeats.slice(-20);
  for (const f of recentLiked) {
    f.genres.forEach(g => pref.recentGenres.add(g));
    f.directors.forEach(d => pref.recentDirectors.add(d));
    f.cast.forEach(c => pref.recentCast.add(c));
    f.keywords.forEach(k => pref.recentKeywords.add(k));
    f.productionCompanies.forEach(s => pref.recentStudios.add(s));
  }
  
  // Build avoidance patterns from disliked films
  for (const f of dislikedFeats) {
    if (f.genreCombo) avoid.genreCombos.set(f.genreCombo, (avoid.genreCombos.get(f.genreCombo) ?? 0) + 1);
    for (const k of f.keywords) avoid.keywords.set(k, (avoid.keywords.get(k) ?? 0) + 1);
  }
  
  // Detect if user avoids animation/family/children's content
  // If less than 10% of liked films are in these categories, consider them avoided
  const animationThreshold = 0.1;
  const avoidsAnimation = totalLiked > 10 && (likedAnimationCount / totalLiked) < animationThreshold;
  const avoidsFamily = totalLiked > 10 && (likedFamilyCount / totalLiked) < animationThreshold;
  const avoidsChildrens = totalLiked > 10 && (likedChildrensCount / totalLiked) < animationThreshold;
  
  console.log('[Suggest] User profile analysis', {
    totalLiked,
    likedAnimationCount,
    likedFamilyCount,
    likedChildrensCount,
    avoidsAnimation,
    avoidsFamily,
    avoidsChildrens,
    topKeywords: Array.from(pref.keywords.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}(${v.toFixed(1)})`),
    topGenreCombos: Array.from(pref.genreCombos.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}(${v.toFixed(1)})`),
    topDirectors: Array.from(pref.directors.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([d, v]) => `${d}(${v.toFixed(1)})`),
    topCast: Array.from(pref.cast.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, v]) => `${c}(${v.toFixed(1)})`),
  });
  
  // Build advanced subgenre patterns for nuanced filtering
  // E.g., "likes Action but avoids Superhero Action"
  // Fetch TMDB data for all mapped films (with reasonable cap to avoid huge fan-out)
  const mappedFilmsForAnalysis = params.films
    .filter(f => params.mappings.get(f.uri))
    .slice(-400); // Cap at 400 most recent to avoid excessive fetches
  
  const mappedIds = mappedFilmsForAnalysis.map(f => params.mappings.get(f.uri)!);
  const moviesForAnalysis = await Promise.all(mappedIds.map(id => fetchTmdbMovieCached(id)));
  
  const filmsForSubgenreAnalysis = mappedFilmsForAnalysis.map((f, idx) => {
    const cached = moviesForAnalysis[idx];
    return {
      title: f.title,
      genres: cached?.genres?.map(g => g.name) || [],
      keywords: (cached as any)?.keywords?.keywords?.map((k: any) => k.name) || 
                (cached as any)?.keywords?.results?.map((k: any) => k.name) || [],
      rating: f.rating,
      liked: f.liked
    };
  });
  
  const subgenrePatterns = analyzeSubgenrePatterns(filmsForSubgenreAnalysis);
  const crossGenrePatterns = analyzeCrossGenrePatterns(filmsForSubgenreAnalysis);
  
  console.log('[Suggest] Subgenre analysis complete', {
    patternsDetected: subgenrePatterns.size,
    crossPatternsDetected: crossGenrePatterns.size,
    exampleAvoidances: Array.from(subgenrePatterns.entries())
      .filter(([_, p]) => p.avoidedSubgenres.size > 0)
      .slice(0, 3)
      .map(([genre, p]) => `${genre}: avoids ${Array.from(p.avoidedSubgenres).slice(0, 2).join(', ')}`)
  });

  const seenIds = new Set(likedIds);
  // Also treat already-watched mapped films as seen to avoid recommending
  for (const f of params.films) {
    const id = params.mappings.get(f.uri);
    if (id) seenIds.add(id);
  }
  if (params.excludeWatchedIds) {
    for (const id of params.excludeWatchedIds) seenIds.add(id);
  }

  const maxC = Math.min(params.maxCandidates ?? 120, params.candidates.length);
  const desired = Math.max(10, Math.min(30, params.desiredResults ?? 20));

  // Helper to fetch from cache first in bulk where possible
  async function fetchFromCache(id: number): Promise<TMDBMovie | null> {
    return await fetchTmdbMovieCached(id);
  }

  const resultsAcc: Array<{ tmdbId: number; score: number; reasons: string[]; title?: string; release_date?: string; genres?: string[]; poster_path?: string | null }> = [];
  const pool = await mapLimit(params.candidates.slice(0, maxC), params.concurrency ?? 8, async (cid) => {
    if (seenIds.has(cid)) return null; // skip already-liked
    const m = await fetchFromCache(cid);
    if (!m) return null;
    const feats = extractFeatures(m);
    
    // Exclude by genres early if requested
    if (params.excludeGenres && feats.genres.some((g) => params.excludeGenres!.has(g.toLowerCase()))) {
      return null;
    }
    
    // Apply negative filters: exclude animation/family/children's if user avoids them
    if (avoidsAnimation && feats.isAnimation) return null;
    if (avoidsFamily && feats.isFamily) return null;
    if (avoidsChildrens && feats.isChildrens) return null;
    
    // Check if genre combo is in avoided patterns (appears more in disliked than liked)
    if (feats.genreCombo && avoid.genreCombos.has(feats.genreCombo)) {
      const avoidCount = avoid.genreCombos.get(feats.genreCombo) ?? 0;
      const likeCount = pref.genreCombos.get(feats.genreCombo) ?? 0;
      if (avoidCount > likeCount * 2) return null; // Skip if strongly avoided
    }
    
    // Check for avoided keywords (appear more in disliked than liked)
    const strongAvoidedKeywords = feats.keywords.filter(k => {
      const avoidCount = avoid.keywords.get(k) ?? 0;
      const likeCount = pref.keywords.get(k) ?? 0;
      return avoidCount > 2 && avoidCount > likeCount * 2;
    });
    if (strongAvoidedKeywords.length > 2) return null; // Skip if multiple strong avoid signals
    
    // ADVANCED FILTERING: Apply subgenre-level filtering
    // E.g., filter "Superhero Action" if user avoids that subgenre within Action
    const subgenreCheck = shouldFilterBySubgenre(
      feats.genres,
      feats.keywords,
      m.title || '',
      subgenrePatterns
    );
    
    if (subgenreCheck.shouldFilter) {
      console.log(`[SubgenreFilter] Filtered "${m.title}" - ${subgenreCheck.reason}`);
      return null;
    }
    
    // Check niche compatibility (anime, stand-up, food/travel docs)
    const nicheProfile = {
      nichePreferences: {
        likesAnime: (likedAnimationCount / totalLiked) >= 0.1,
        likesStandUp: Array.from(pref.keywords.keys()).some(k => k.toLowerCase().includes('stand-up') || k.toLowerCase().includes('stand up')),
        likesFoodDocs: Array.from(pref.keywords.keys()).some(k => k.toLowerCase().includes('food') || k.toLowerCase().includes('cooking')),
        likesTravelDocs: Array.from(pref.keywords.keys()).some(k => k.toLowerCase().includes('travel') || k.toLowerCase().includes('journey'))
      }
    };
    
    const nicheCheck = checkNicheCompatibility(m, nicheProfile as any);
    if (!nicheCheck.compatible) {
      console.log(`[NicheFilter] Filtered "${m.title}" - ${nicheCheck.reason}`);
      return null;
    }
    
    let score = 0;
    const reasons: string[] = [];
    
    // CROSS-GENRE BOOST: Check if candidate matches user's preferred genre combinations
    // E.g., boost "Action+Thriller with spy themes" if user loves that pattern
    const crossGenreBoost = boostForCrossGenreMatch(
      feats.genres,
      feats.keywords,
      crossGenrePatterns
    );
    
    if (crossGenreBoost.boost > 0) {
      score += crossGenreBoost.boost;
      if (crossGenreBoost.reason) {
        reasons.push(crossGenreBoost.reason);
        console.log(`[CrossGenreBoost] Boosted "${m.title}" by ${crossGenreBoost.boost.toFixed(2)} - ${crossGenreBoost.reason}`);
      }
    }
    
    // Genre combo matching (more specific than individual genres)
    if (feats.genreCombo && pref.genreCombos.has(feats.genreCombo)) {
      const comboWeight = pref.genreCombos.get(feats.genreCombo) ?? 1;
      score += comboWeight * weights.genreCombo;
      const comboCountRounded = Math.round(comboWeight);
      reasons.push(`Matches your specific taste in ${feats.genres.join(' + ')} films (${comboCountRounded} highly-rated similar ${comboCountRounded === 1 ? 'film' : 'films'})`);
    } else {
      // Fallback to individual genre matching if combo doesn't match
      const gHits = feats.genres.filter((g) => pref.genres.has(g));
      if (gHits.length) {
        const totalGenreWeight = gHits.reduce((sum, g) => sum + (pref.genres.get(g) ?? 0), 0);
        score += totalGenreWeight * weights.genre;
        const genreWeight = pref.genres.get(gHits[0]) ?? 1;
        const genreCountRounded = Math.round(genreWeight);
        reasons.push(`Matches your taste in ${gHits.slice(0, 3).join(', ')} (${genreCountRounded} similar ${genreCountRounded === 1 ? 'film' : 'films'})`);
      }
    }
    
    const dHits = feats.directors.filter((d) => pref.directors.has(d));
    if (dHits.length) {
      const totalDirWeight = dHits.reduce((sum, d) => sum + (pref.directors.get(d) ?? 0), 0);
      score += totalDirWeight * weights.director;
      const dirWeight = pref.directors.get(dHits[0]) ?? 1;
      const dirCountRounded = Math.round(dirWeight);
      const dirQuality = dirWeight >= 3.0 ? 'highly rated' : 'enjoyed';
      reasons.push(`Directed by ${dHits.slice(0, 2).join(', ')} — you've ${dirQuality} ${dirCountRounded} ${dirCountRounded === 1 ? 'film' : 'films'} by ${dHits.length === 1 ? 'this director' : 'these directors'}`);
    } else {
      // Check for similar directors (directors who work in the same subgenres/keywords)
      const similarDirectors: Array<{ director: string; likedDirector: string; sharedThemes: string[] }> = [];
      
      for (const candidateDir of feats.directors) {
        const candidateKeywords = new Set(feats.keywords);
        
        // Check each director the user likes
        for (const [likedDir, dirKeywords] of pref.directorKeywords.entries()) {
          const sharedKeywords = Array.from(dirKeywords).filter(k => candidateKeywords.has(k));
          if (sharedKeywords.length >= 2) {
            similarDirectors.push({
              director: candidateDir,
              likedDirector: likedDir,
              sharedThemes: sharedKeywords.slice(0, 3)
            });
            break; // Only match once per candidate director
          }
        }
      }
      
      if (similarDirectors.length) {
        score += 0.8 * weights.director; // Lower boost than exact director match
        const firstMatch = similarDirectors[0];
        reasons.push(`Similar to ${firstMatch.likedDirector} you love — shares themes like ${firstMatch.sharedThemes.slice(0, 2).join(', ')}`);
      }
    }
    
    const cHits = feats.cast.filter((c) => pref.cast.has(c));
    if (cHits.length) {
      const totalCastWeight = cHits.slice(0, 3).reduce((sum, c) => sum + (pref.cast.get(c) ?? 0), 0);
      score += totalCastWeight * weights.cast;
      const topCastWeight = Math.max(...cHits.map(c => pref.cast.get(c) ?? 0));
      const castCountRounded = Math.round(topCastWeight);
      reasons.push(`Stars ${cHits.slice(0, 3).join(', ')} — ${cHits.length} cast ${cHits.length === 1 ? 'member' : 'members'} you've liked before`);
    } else {
      // Check for similar actors (actors who work in the same subgenres)
      const similarCast: Array<{ actor: string; likedActor: string; sharedThemes: string[] }> = [];
      
      for (const candidateActor of feats.cast) {
        const candidateKeywords = new Set(feats.keywords);
        
        // Check each actor the user likes
        for (const [likedActor, actorKeywords] of pref.castKeywords.entries()) {
          const sharedKeywords = Array.from(actorKeywords).filter(k => candidateKeywords.has(k));
          if (sharedKeywords.length >= 2) {
            similarCast.push({
              actor: candidateActor,
              likedActor: likedActor,
              sharedThemes: sharedKeywords.slice(0, 3)
            });
            break; // Only match once per candidate actor
          }
        }
      }
      
      if (similarCast.length) {
        score += 0.3 * weights.cast; // Small boost for similar actors
        const firstMatch = similarCast[0];
        reasons.push(`Similar to ${firstMatch.likedActor} you enjoy — works in ${firstMatch.sharedThemes.slice(0, 2).join(', ')} themes`);
      }
    }
    
    // Keyword matching - now more important for subgenre detection
    const kHits = feats.keywords.filter((k) => pref.keywords.has(k));
    if (kHits.length) {
      // Sort keywords by weighted frequency in user's liked films
      const sortedKHits = kHits
        .map(k => ({ keyword: k, weight: pref.keywords.get(k) ?? 0 }))
        .sort((a, b) => b.weight - a.weight);
      
      const topKeywords = sortedKHits.slice(0, 5);
      const totalKeywordWeight = topKeywords.reduce((sum, k) => sum + k.weight, 0);
      const keywordScore = topKeywords.reduce((sum, k) => sum + Math.log(k.weight + 1), 0);
      score += keywordScore * weights.keyword;
      
      const topKeywordNames = topKeywords.slice(0, 3).map(k => k.keyword);
      const topKeywordWeight = topKeywords[0]?.weight ?? 1;
      const isStrongPattern = topKeywordWeight >= 3.0;
      const strengthText = isStrongPattern ? 'especially love' : 'enjoy';
      const countRounded = Math.round(topKeywordWeight);
      reasons.push(`Matches specific themes you ${strengthText}: ${topKeywordNames.join(', ')} (${countRounded}+ highly-rated films)`);
    }
    
    // Studio/Production company matching
    const studioHits = feats.productionCompanies.filter(s => pref.productionCompanies.has(s));
    if (studioHits.length) {
      const totalStudioWeight = studioHits.reduce((sum, s) => sum + (pref.productionCompanies.get(s) ?? 0), 0);
      score += totalStudioWeight * 0.7; // Meaningful boost for favorite studios
      const topStudio = studioHits[0];
      const studioWeight = pref.productionCompanies.get(topStudio) ?? 1;
      const studioCountRounded = Math.round(studioWeight);
      
      // Special callouts for notable indie/boutique studios
      const notableStudios = ['A24', 'Neon', 'Annapurna Pictures', 'Focus Features', 'Blumhouse Productions', 
                              'Studio Ghibli', 'Searchlight Pictures', 'IFC Films', 'Magnolia Pictures', 
                              'Miramax', '24 Frames', 'Plan B Entertainment', 'Legendary Pictures'];
      const isNotableStudio = notableStudios.some(n => topStudio.includes(n));
      
      if (isNotableStudio) {
        reasons.push(`From ${topStudio} — you've loved ${studioCountRounded} ${studioCountRounded === 1 ? 'film' : 'films'} from this studio`);
      } else {
        reasons.push(`From ${studioHits.slice(0, 2).join(', ')} — studios you enjoy`);
      }
    }
    
    // Recent watches boost - if matches genres/directors/cast/keywords from last 20 films
    let recentBoost = 0;
    const recentMatches: string[] = [];
    
    const recentGenreMatches = feats.genres.filter(g => pref.recentGenres.has(g));
    if (recentGenreMatches.length) {
      recentBoost += 0.5 * recentGenreMatches.length;
      recentMatches.push(`similar to recent ${recentGenreMatches.slice(0, 2).join('/')} films`);
    }
    
    const recentDirectorMatches = feats.directors.filter(d => pref.recentDirectors.has(d));
    if (recentDirectorMatches.length) {
      recentBoost += 1.0 * recentDirectorMatches.length;
      recentMatches.push(`from ${recentDirectorMatches[0]} you recently enjoyed`);
    }
    
    const recentCastMatches = feats.cast.filter(c => pref.recentCast.has(c)).slice(0, 2);
    if (recentCastMatches.length) {
      recentBoost += 0.3 * recentCastMatches.length;
      recentMatches.push(`stars ${recentCastMatches[0]} from recent watches`);
    }
    
    const recentKeywordMatches = feats.keywords.filter(k => pref.recentKeywords.has(k)).slice(0, 3);
    if (recentKeywordMatches.length >= 2) {
      recentBoost += 0.4 * recentKeywordMatches.length;
      recentMatches.push(`explores ${recentKeywordMatches.slice(0, 2).join('/')} themes from recent favorites`);
    }
    
    const recentStudioMatches = feats.productionCompanies.filter(s => pref.recentStudios.has(s));
    if (recentStudioMatches.length) {
      recentBoost += 0.6 * recentStudioMatches.length;
      recentMatches.push(`from ${recentStudioMatches[0]} you recently enjoyed`);
    }
    
    if (recentBoost > 0) {
      score += recentBoost;
      reasons.push(`Based on recent watches: ${recentMatches.slice(0, 2).join('; ')}`);
    }
    
    // REMOVED: Seasonal boost no longer affects scoring to avoid limiting suggestions by time of year
    // Users should see movies from all seasons regardless of current date
    // Seasonal data remains visible on Stats page for informational purposes only
    // if (feats.hasSeasonalGenre) {
    //   const seasonalBoost = boostSeasonalGenres(score, feats.genreIds);
    //   if (seasonalBoost > score) {
    //     const boostAmount = seasonalBoost - score;
    //     score = seasonalBoost;
    //     const seasonalInfo = getCurrentSeasonalGenres();
    //     reasons.push(`Perfect for ${seasonalInfo.labels.join(' & ')} season`);
    //     console.log(`[SeasonalBoost] Boosted "${m.title}" by ${boostAmount.toFixed(2)} for seasonal relevance`);
    //   }
    // }
    
    if (score <= 0) return null;
    const r = { 
      tmdbId: cid, 
      score, 
      reasons, 
      title: m.title, 
      release_date: m.release_date, 
      genres: feats.genres, 
      poster_path: m.poster_path,
      voteCategory: feats.voteCategory,
      voteAverage: feats.voteAverage,
      voteCount: feats.voteCount
    };
    resultsAcc.push(r);
    // Early return the result; caller will slice after sorting
    return r;
  });
  const results = pool.filter(Boolean) as Array<{ 
    tmdbId: number; 
    score: number; 
    reasons: string[]; 
    title?: string; 
    release_date?: string; 
    genres?: string[]; 
    poster_path?: string | null;
    voteCategory?: 'hidden-gem' | 'crowd-pleaser' | 'cult-classic' | 'standard';
    voteAverage?: number;
    voteCount?: number;
  }>;
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, desired);
}

export async function deleteFilmMapping(userId: string, uri: string) {
  if (!supabase) throw new Error('Supabase not initialized');
  const { error } = await supabase
    .from('film_tmdb_map')
    .delete()
    .eq('user_id', userId)
    .eq('uri', uri);
  if (error) throw error;
}
