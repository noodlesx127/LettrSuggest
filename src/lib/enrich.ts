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
import { updateExplorationStats } from './adaptiveLearning';

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
  // OMDb enrichment fields
  imdb_id?: string; // IMDB ID from TMDB (e.g., "tt0111161")
  imdb_rating?: string; // IMDB rating from OMDb (e.g., "9.3")
  imdb_votes?: string; // IMDB vote count (e.g., "2,500,000")
  rotten_tomatoes?: string; // Rotten Tomatoes score (e.g., "91%")
  metacritic?: string; // Metacritic score (e.g., "82")
  awards?: string; // Awards text (e.g., "Won 3 Oscars. 145 wins & 142 nominations")
  box_office?: string; // Box office gross (e.g., "$28,767,189")
  rated?: string; // Content rating (e.g., "PG-13", "R")
  omdb_plot_full?: string; // Full plot from OMDb
  omdb_poster?: string; // OMDb poster URL (fallback if TMDB missing)
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

export async function addFeedback(userId: string, tmdbId: number, type: 'negative' | 'positive') {
  if (!supabase) throw new Error('Supabase not initialized');
  const { error } = await supabase.from('suggestion_feedback').insert({ user_id: userId, tmdb_id: tmdbId, feedback_type: type });
  if (error) {
    console.error('[Supabase] addFeedback error', { userId, tmdbId, type, error });
    throw error;
  }
}

export async function getFeedback(userId: string): Promise<Map<number, 'negative' | 'positive'>> {
  if (!supabase) throw new Error('Supabase not initialized');
  const { data, error } = await supabase
    .from('suggestion_feedback')
    .select('tmdb_id, feedback_type')
    .eq('user_id', userId);

  if (error) {
    console.error('[Supabase] getFeedback error', { userId, error });
    return new Map();
  }

  const map = new Map<number, 'negative' | 'positive'>();
  data?.forEach((row: any) => {
    map.set(row.tmdb_id, row.feedback_type);
  });
  return map;
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
    if (!supabase) {
      // No database - fetch fresh from TMDB
      const fresh = await withTimeout(fetchTmdbMovie(id));


      // OMDb enrichment is handled server-side through /api/tmdb/movie route
      // Client-side code should not attempt OMDb enrichment

      return fresh;
    }

    // Check cache
    const { data, error } = await supabase
      .from('tmdb_movies')
      .select('data, omdb_fetched_at, imdb_rating')
      .eq('tmdb_id', id)
      .maybeSingle();

    if (!error && data && data.data) {
      const cached = data.data as TMDBMovie;

      // If cached has credits/keywords AND recent OMDb data, use it directly
      const hasCompleteMetadata = (cached.credits && cached.credits.cast && cached.credits.crew) || cached.keywords;
      const hasRecentOMDb = data.omdb_fetched_at &&
        (Date.now() - new Date(data.omdb_fetched_at).getTime()) < (7 * 24 * 60 * 60 * 1000); // 7 days

      if (hasCompleteMetadata && (hasRecentOMDb || !cached.imdb_id)) {
        return cached;
      }

      // OMDb enrichment is handled server-side through /api/tmdb/movie route
      // Client-side code should not attempt to refresh OMDb data
      // Just return the cached data (which may include OMDb fields if previously enriched)

      // Otherwise fall through to refetch enriched details
    }
  } catch {
    // ignore cache errors
  }

  // Fetch from API route which handles both TMDB and OMDb enrichment server-side
  try {
    const apiUrl = new URL('/api/tmdb/movie', typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
    apiUrl.searchParams.set('id', String(id));
    apiUrl.searchParams.set('_t', String(Date.now()));

    const response = await fetch(apiUrl.toString());
    if (!response.ok) {
      console.warn('[Enrich] API route failed, falling back to direct TMDB fetch');
      const fresh = await withTimeout(fetchTmdbMovie(id));
      return fresh;
    }

    const json = await response.json();
    if (json.ok && json.movie) {
      return json.movie;
    }

    // Fallback to direct fetch if API response is malformed
    const fresh = await withTimeout(fetchTmdbMovie(id));
    return fresh;
  } catch (apiError) {
    console.warn('[Enrich] API route error, falling back to direct TMDB fetch:', apiError);
    const fresh = await withTimeout(fetchTmdbMovie(id));
    return fresh;
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
 * Build an enhanced taste profile with IDs for TMDB discovery
 * Extracts top genres, keywords, directors, actors, studios with weighted preferences
 * Includes negative signals, user statistics, and recency-aware weighting
 */
export async function buildTasteProfile(params: {
  films: Array<{ uri: string; rating?: number; liked?: boolean; rewatch?: boolean; lastDate?: string }>;
  mappings: Map<string, number>;
  topN?: number;
  negativeFeedbackIds?: number[]; // IDs of movies explicitly dismissed/disliked
  tmdbDetails?: Map<number, any>; // Pre-fetched details to avoid API calls
}): Promise<{
  topGenres: Array<{ id: number; name: string; weight: number }>;
  topKeywords: Array<{ id: number; name: string; weight: number }>;
  topDirectors: Array<{ id: number; name: string; weight: number }>;
  topDecades: Array<{ decade: number; weight: number }>;
  topActors: Array<{ id: number; name: string; weight: number }>;
  topStudios: Array<{ id: number; name: string; weight: number }>;
  avoidGenres: Array<{ id: number; name: string; weight: number }>;
  avoidKeywords: Array<{ id: number; name: string; weight: number }>;
  avoidDirectors: Array<{ id: number; name: string; weight: number }>;
  userStats: {
    avgRating: number;
    stdDevRating: number;
    totalFilms: number;
    rewatchRate: number;
  };
}> {
  const topN = params.topN ?? 10;

  // Calculate user statistics
  const ratedFilms = params.films.filter(f => f.rating != null);
  const ratings = ratedFilms.map(f => f.rating!);
  const avgRating = ratings.length > 0
    ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length
    : 3.0;
  const variance = ratings.length > 0
    ? ratings.reduce((sum, r) => sum + Math.pow(r - avgRating, 2), 0) / ratings.length
    : 1.0;
  const stdDevRating = Math.sqrt(variance);
  const rewatchCount = params.films.filter(f => f.rewatch).length;
  const rewatchRate = params.films.length > 0 ? rewatchCount / params.films.length : 0;

  const userStats = {
    avgRating,
    stdDevRating,
    totalFilms: params.films.length,
    rewatchRate
  };

  // Enhanced weighting function with recency and rewatch signals
  const getEnhancedWeight = (film: typeof params.films[0]): number => {
    const r = film.rating ?? avgRating;
    const now = new Date();
    const watchDate = film.lastDate ? new Date(film.lastDate) : new Date();
    const daysSinceWatch = (now.getTime() - watchDate.getTime()) / (1000 * 60 * 60 * 24);

    // Normalize rating to user's scale (z-score), only positive weights
    const normalizedRating = (r - avgRating) / Math.max(stdDevRating, 0.5);
    let weight = Math.max(0, normalizedRating + 1); // Shift to ensure positive

    // Boost for liked films
    if (film.liked) weight *= 1.5;

    // Strong boost for rewatches (indicates strong preference)
    if (film.rewatch) weight *= 1.8;

    // Recency decay (exponential, half-life of 1 year)
    const recencyFactor = Math.exp(-daysSinceWatch / 365);
    weight *= (0.5 + 0.5 * recencyFactor); // 50% base + 50% recency-based

    return weight;
  };

  // Get highly-rated/liked films for positive profile
  // Include "watched" films (unrated) as weak positive signals, unless explicitly disliked
  const likedFilms = params.films.filter(f =>
    params.mappings.has(f.uri) &&
    (f.liked || (f.rating ?? 3.0) >= 2.5) // Include if Liked OR (Unrated/Rated >= 2.5)
  );

  // Get low-rated films for negative signals
  // IMPORTANT: Exclude "liked" films even if rated low (guilty pleasures)
  const dislikedFilms = params.films.filter(f =>
    (f.rating ?? 0) < 2.5 && f.rating != null && params.mappings.has(f.uri) && !f.liked
  );

  const limit = params.tmdbDetails ? 2000 : 100; // Higher limit if details are pre-fetched

  const likedIds = likedFilms
    .map(f => params.mappings.get(f.uri)!)
    .filter(Boolean)
    .slice(0, limit);

  const dislikedIds = dislikedFilms
    .map(f => params.mappings.get(f.uri)!)
    .filter(Boolean)
    .slice(0, 50); // Cap negative signals

  // Fetch movie details (use pre-fetched if available)
  const fetchDetails = async (id: number) => {
    if (params.tmdbDetails?.has(id)) {
      return params.tmdbDetails.get(id);
    }
    return fetchTmdbMovieCached(id);
  };

  const [likedMovies, dislikedMovies, negativeFeedbackMovies] = await Promise.all([
    Promise.all(likedIds.map(id => fetchDetails(id))),
    Promise.all(dislikedIds.map(id => fetchDetails(id))),
    Promise.all((params.negativeFeedbackIds || []).map(id => fetchDetails(id)))
  ]);

  // Positive profile weights
  const genreWeights = new Map<number, { name: string; weight: number }>();
  const keywordWeights = new Map<number, { name: string; weight: number }>();
  const directorWeights = new Map<number, { name: string; weight: number }>();
  const actorWeights = new Map<number, { name: string; weight: number }>();
  const studioWeights = new Map<number, { name: string; weight: number }>();
  const decadeWeights = new Map<number, number>();

  // Negative profile weights
  const avoidGenreWeights = new Map<number, { name: string; weight: number }>();
  const avoidKeywordWeights = new Map<number, { name: string; weight: number }>();
  const avoidDirectorWeights = new Map<number, { name: string; weight: number }>();

  // Accumulate positive weighted preferences
  for (let i = 0; i < likedMovies.length; i++) {
    const movie = likedMovies[i];
    if (!movie) continue;

    const film = likedFilms[i];
    const weight = getEnhancedWeight(film);
    const feats = extractFeatures(movie);

    // Decades
    if (movie.release_date) {
      const year = parseInt(movie.release_date.slice(0, 4));
      if (!isNaN(year)) {
        const decade = Math.floor(year / 10) * 10;
        decadeWeights.set(decade, (decadeWeights.get(decade) || 0) + weight);
      }
    }

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

    // Actors with IDs (top 5 billed, with billing position weighting)
    const castData = movie.credits?.cast || [];
    castData.slice(0, 5).forEach((actor: { id: number; name: string }, idx: number) => {
      const billingWeight = 1 / (idx + 1); // Lead = 1.0, 2nd = 0.5, 3rd = 0.33, etc.
      const current = actorWeights.get(actor.id) || { name: actor.name, weight: 0 };
      actorWeights.set(actor.id, {
        name: actor.name,
        weight: current.weight + (weight * billingWeight)
      });
    });

    // Production companies/studios with IDs
    feats.productionCompanyIds.forEach((id, idx) => {
      const name = feats.productionCompanies[idx];
      const current = studioWeights.get(id) || { name, weight: 0 };
      studioWeights.set(id, { name, weight: current.weight + weight });
    });
  }

  // Accumulate negative signals from disliked films
  for (let i = 0; i < dislikedMovies.length; i++) {
    const movie = dislikedMovies[i];
    if (!movie) continue;

    const film = dislikedFilms[i];
    const negWeight = Math.abs((film.rating ?? 2.5) - 2.5); // Stronger signal for lower ratings
    const feats = extractFeatures(movie);

    // Genres to avoid
    feats.genreIds.forEach((id, idx) => {
      const name = feats.genres[idx];
      const current = avoidGenreWeights.get(id) || { name, weight: 0 };
      avoidGenreWeights.set(id, { name, weight: current.weight + negWeight });
    });

    // Keywords to avoid
    feats.keywordIds.forEach((id, idx) => {
      const name = feats.keywords[idx];
      const current = avoidKeywordWeights.get(id) || { name, weight: 0 };
      avoidKeywordWeights.set(id, { name, weight: current.weight + negWeight });
    });

    // Directors to avoid
    feats.directorIds.forEach((id, idx) => {
      const name = feats.directors[idx];
      const current = avoidDirectorWeights.get(id) || { name, weight: 0 };
      avoidDirectorWeights.set(id, { name, weight: current.weight + negWeight });
    });
  }

  // Accumulate negative signals from explicitly dismissed/negative feedback movies
  // These are treated as VERY strong negative signals (weight = 3.0)
  for (const movie of negativeFeedbackMovies) {
    if (!movie) continue;

    const negWeight = 3.0; // Strong penalty for explicitly dismissed items
    const feats = extractFeatures(movie);

    // Genres to avoid
    feats.genreIds.forEach((id, idx) => {
      const name = feats.genres[idx];
      const current = avoidGenreWeights.get(id) || { name, weight: 0 };
      avoidGenreWeights.set(id, { name, weight: current.weight + negWeight });
    });

    // Keywords to avoid
    feats.keywordIds.forEach((id, idx) => {
      const name = feats.keywords[idx];
      const current = avoidKeywordWeights.get(id) || { name, weight: 0 };
      avoidKeywordWeights.set(id, { name, weight: current.weight + negWeight });
    });

    // Directors to avoid
    feats.directorIds.forEach((id, idx) => {
      const name = feats.directors[idx];
      const current = avoidDirectorWeights.get(id) || { name, weight: 0 };
      avoidDirectorWeights.set(id, { name, weight: current.weight + negWeight });
    });
  }

  // Sort and return top N for each category
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

  const topActors = Array.from(actorWeights.entries())
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, topN)
    .map(([id, { name, weight }]) => ({ id, name, weight }));

  const topStudios = Array.from(studioWeights.entries())
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, topN)
    .map(([id, { name, weight }]) => ({ id, name, weight }));

  const topDecades = Array.from(decadeWeights.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([decade, weight]) => ({ decade, weight }));

  const avoidGenres = Array.from(avoidGenreWeights.entries())
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, 5) // Top 5 to avoid
    .map(([id, { name, weight }]) => ({ id, name, weight }));

  const avoidKeywords = Array.from(avoidKeywordWeights.entries())
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, 5)
    .map(([id, { name, weight }]) => ({ id, name, weight }));

  const avoidDirectors = Array.from(avoidDirectorWeights.entries())
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, 3)
    .map(([id, { name, weight }]) => ({ id, name, weight }));

  console.log('[TasteProfile] Enhanced profile built', {
    topGenres: topGenres.slice(0, 3).map(g => `${g.name}(${g.weight.toFixed(1)})`),
    topKeywords: topKeywords.slice(0, 3).map(k => `${k.name}(${k.weight.toFixed(1)})`),
    topDirectors: topDirectors.slice(0, 3).map(d => `${d.name}(${d.weight.toFixed(1)})`),
    topActors: topActors.slice(0, 3).map(a => `${a.name}(${a.weight.toFixed(1)})`),
    topStudios: topStudios.slice(0, 3).map(s => `${s.name}(${s.weight.toFixed(1)})`),
    topDecades: topDecades.map(d => `${d.decade}s(${d.weight.toFixed(1)})`),
    avoidGenres: avoidGenres.map(g => g.name),
    userStats: {
      avgRating: avgRating.toFixed(2),
      stdDev: stdDevRating.toFixed(2),
      rewatchRate: (rewatchRate * 100).toFixed(1) + '%'
    }
  });

  return {
    topGenres,
    topKeywords,
    topDirectors,
    topDecades,
    topActors,
    topStudios,
    avoidGenres,
    avoidKeywords,
    avoidDirectors,
    userStats
  };
}

/**
 * Apply diversity filtering to prevent too many similar suggestions
 * Limits the number of films from the same director, genre, decade, studio, or actor
 */
function applyDiversityFilter<T extends {
  directors?: string[];
  genres?: string[];
  release_date?: string;
  studios?: string[];
  actors?: string[];
  score: number;
}>(
  suggestions: T[],
  options?: {
    maxSameDirector?: number;
    maxSameGenre?: number;
    maxSameDecade?: number;
    maxSameStudio?: number;
    maxSameActor?: number;
  }
): T[] {
  const defaults = {
    maxSameDirector: 2,
    maxSameGenre: 5,
    maxSameDecade: 4,
    maxSameStudio: 3,
    maxSameActor: 3
  };

  const limits = { ...defaults, ...options };

  // Track counts
  const directorCounts = new Map<string, number>();
  const genreCounts = new Map<string, number>();
  const decadeCounts = new Map<number, number>();
  const studioCounts = new Map<string, number>();
  const actorCounts = new Map<string, number>();

  const filtered: T[] = [];
  let skippedCount = 0;

  for (const suggestion of suggestions) {
    let shouldInclude = true;
    const skipReasons: string[] = [];

    // Check directors
    if (shouldInclude && suggestion.directors) {
      for (const director of suggestion.directors) {
        if ((directorCounts.get(director) || 0) >= limits.maxSameDirector) {
          shouldInclude = false;
          skipReasons.push(`max ${limits.maxSameDirector} from ${director}`);
          break;
        }
      }
    }

    // Check genres (primary genre only)
    if (shouldInclude && suggestion.genres && suggestion.genres.length > 0) {
      const primaryGenre = suggestion.genres[0];
      if ((genreCounts.get(primaryGenre) || 0) >= limits.maxSameGenre) {
        shouldInclude = false;
        skipReasons.push(`max ${limits.maxSameGenre} ${primaryGenre} films`);
      }
    }

    // Check decade
    if (shouldInclude && suggestion.release_date) {
      const year = parseInt(suggestion.release_date.slice(0, 4));
      if (!isNaN(year)) {
        const decade = Math.floor(year / 10) * 10;
        if ((decadeCounts.get(decade) || 0) >= limits.maxSameDecade) {
          shouldInclude = false;
          skipReasons.push(`max ${limits.maxSameDecade} from ${decade}s`);
        }
      }
    }

    // Check studios
    if (shouldInclude && suggestion.studios) {
      for (const studio of suggestion.studios) {
        if ((studioCounts.get(studio) || 0) >= limits.maxSameStudio) {
          shouldInclude = false;
          skipReasons.push(`max ${limits.maxSameStudio} from ${studio}`);
          break;
        }
      }
    }

    // Check actors (top billed only)
    if (shouldInclude && suggestion.actors) {
      for (const actor of suggestion.actors.slice(0, 2)) {
        if ((actorCounts.get(actor) || 0) >= limits.maxSameActor) {
          shouldInclude = false;
          skipReasons.push(`max ${limits.maxSameActor} with ${actor}`);
          break;
        }
      }
    }

    if (shouldInclude) {
      filtered.push(suggestion);

      // Update counts
      if (suggestion.directors) {
        for (const director of suggestion.directors) {
          directorCounts.set(director, (directorCounts.get(director) || 0) + 1);
        }
      }
      if (suggestion.genres && suggestion.genres.length > 0) {
        const primaryGenre = suggestion.genres[0];
        genreCounts.set(primaryGenre, (genreCounts.get(primaryGenre) || 0) + 1);
      }
      if (suggestion.release_date) {
        const year = parseInt(suggestion.release_date.slice(0, 4));
        if (!isNaN(year)) {
          const decade = Math.floor(year / 10) * 10;
          decadeCounts.set(decade, (decadeCounts.get(decade) || 0) + 1);
        }
      }
      if (suggestion.studios) {
        for (const studio of suggestion.studios) {
          studioCounts.set(studio, (studioCounts.get(studio) || 0) + 1);
        }
      }
      if (suggestion.actors) {
        for (const actor of suggestion.actors.slice(0, 2)) {
          actorCounts.set(actor, (actorCounts.get(actor) || 0) + 1);
        }
      }
    } else {
      skippedCount++;
    }
  }

  console.log('[DiversityFilter] Applied diversity filtering', {
    original: suggestions.length,
    filtered: filtered.length,
    skipped: skippedCount,
    directorCounts: Array.from(directorCounts.entries()).filter(([_, count]) => count > 1).slice(0, 3),
    genreCounts: Array.from(genreCounts.entries()).slice(0, 5)
  });

  return filtered;
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
  feedbackMap?: Map<number, 'negative' | 'positive'>;
  enhancedProfile?: {
    topActors: Array<{ id: number; name: string; weight: number }>;
    topStudios: Array<{ id: number; name: string; weight: number }>;
    avoidGenres: Array<{ id: number; name: string; weight: number }>;
    avoidKeywords: Array<{ id: number; name: string; weight: number }>;
    avoidDirectors: Array<{ id: number; name: string; weight: number }>;
    adjacentGenres?: Map<string, Array<{ genre: string; weight: number }>>; // Adaptive learning transitions
    recentGenres?: string[]; // Recent genres to trigger transitions
  };
}): Promise<Array<{
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
  contributingFilms?: Record<string, Array<{ id: number; title: string }>>;
  // Phase 3: For diversity filtering
  directors?: string[];
  studios?: string[];
  actors?: string[];
}>> {
  // Build user profile from liked/highly-rated mapped films.
  // Use as much history as possible, but cap TMDB fetches to avoid huge fan-out
  // for extremely large libraries. We bias towards the most recent entries when
  // trimming.
  const liked = params.films.filter((f) => (f.liked || (f.rating ?? 0) >= 4) && params.mappings.get(f.uri));
  const likedIdsAll = liked.map((f) => params.mappings.get(f.uri)!).filter(Boolean) as number[];

  // Fetch user feedback to adjust weights and filter candidates
  const feedbackMap = params.feedbackMap ?? await getFeedback(params.userId);
  const negativeFeedbackIds = new Set<number>();
  const positiveFeedbackIds = new Set<number>();

  for (const [id, type] of feedbackMap.entries()) {
    if (type === 'negative') negativeFeedbackIds.add(id);
    else if (type === 'positive') positiveFeedbackIds.add(id);
  }

  // Filter out candidates with negative feedback
  // We modify the input candidates array in place or filter it
  // But wait, candidates is a number[], we should filter it before processing?
  // The function signature takes candidates as input.
  // However, the logic below uses `candidates` to find overlaps.
  // We should filter `candidates` here if possible, but `candidates` is passed in.
  // Let's filter it effectively by ignoring them during scoring or just removing them from the set if we could.
  // Actually, `suggestByOverlap` iterates over `candidates` later?
  // No, it iterates over `params.films` (the user's library) and finds overlaps with `candidates`.
  // Wait, let's check how `candidates` is used.

  // Also identify watched but NOT liked films for negative signals
  const watchedNotLiked = params.films.filter((f) =>
    !f.liked &&
    (f.rating ?? 0) < 3 &&
    params.mappings.get(f.uri)
  );
  const dislikedIdsAll = watchedNotLiked.map((f) => params.mappings.get(f.uri)!).filter(Boolean) as number[];

  // Add negative feedback IDs to disliked list to penalize their features
  dislikedIdsAll.push(...Array.from(negativeFeedbackIds));

  // Add positive feedback IDs to liked list to boost their features
  likedIdsAll.push(...Array.from(positiveFeedbackIds));

  // Filter out candidates that have negative feedback
  // We need to modify the candidates array that will be used for scoring
  // Since params.candidates is passed by value (reference to array), we can just use a local filtered version
  // But wait, suggestByOverlap uses params.candidates later?
  // Let's check the rest of the file.
  // Actually, we should probably filter it right here.
  const validCandidates = params.candidates.filter(id => !negativeFeedbackIds.has(id));

  // Use validCandidates instead of params.candidates in the rest of the function
  // We need to make sure we replace usages of params.candidates with validCandidates
  // Or we can just reassign params.candidates if it wasn't const (it is in the function signature object)
  // So we'll define a new variable and use it.

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

  const likedMovies = await mapLimit(likedIds, 10, (id) => fetchTmdbMovieCached(id));
  const dislikedMovies = await mapLimit(dislikedIds, 10, (id) => fetchTmdbMovieCached(id));

  const likedFeats = likedMovies.filter(Boolean).map((m) => extractFeatures(m as TMDBMovie));
  const dislikedFeats = dislikedMovies.filter(Boolean).map((m) => extractFeatures(m as TMDBMovie));

  // Map TMDB IDs back to original film data for weighting
  const likedFilmData = liked.filter(f => params.mappings.has(f.uri));

  // Multi-factor scoring weights (Phase 2 enhancements)
  // Total positive weights: 100% distributed across factors
  // Negative penalties applied separately
  const weights = {
    // Primary factors (70%)
    genre: 1.2,           // 30% - Genre matching (base weight, scaled by matches)
    genreCombo: 1.8,      // Bonus for exact genre combinations (subgenre specificity)
    director: 1.0,        // 20% - Director matching
    actor: 0.75,          // 15% - Actor matching (NEW)

    // Secondary factors (20%)
    keyword: 0.5,         // 10% - Keyword/subgenre matching
    studio: 0.5,          // 10% - Production company matching (NEW)

    // Tertiary factors (10%)
    cast: 0.2,            // 5% - Supporting cast matching
    crossGenre: 0.2,      // 5% - Cross-genre pattern bonus

    // Negative penalties (applied as deductions)
    avoidGenrePenalty: -2.0,    // Strong penalty for avoided genres
    avoidKeywordPenalty: -1.0,  // Moderate penalty for avoided keywords
    avoidDirectorPenalty: -3.0, // Very strong penalty for avoided directors
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

  // Build lookup maps: track which films contribute to each feature
  // This allows us to show users which specific films triggered each recommendation
  const filmLookup = {
    genres: new Map<string, Array<{ id: number; title: string }>>(),
    directors: new Map<string, Array<{ id: number; title: string }>>(),
    cast: new Map<string, Array<{ id: number; title: string }>>(),
    keywords: new Map<string, Array<{ id: number; title: string }>>(),
    studios: new Map<string, Array<{ id: number; title: string }>>(),
  };

  // Build film lookup from liked films (limit to top films by weight for each feature)
  for (let i = 0; i < likedFeats.length; i++) {
    const f = likedFeats[i];
    const filmData = likedFilmData[i];
    const movie = likedMovies[i];
    const weight = getPreferenceWeight(filmData?.rating, filmData?.liked);

    // Only track films with meaningful weight (>= 1.0)
    if (weight < 1.0 || !movie) continue;

    const filmInfo = { id: likedIds[i], title: movie.title || `Film #${likedIds[i]}` };

    // Track genres
    for (const g of f.genres) {
      if (!filmLookup.genres.has(g)) filmLookup.genres.set(g, []);
      const list = filmLookup.genres.get(g)!;
      if (list.length < 20) list.push(filmInfo); // Cap at 20 per feature
    }

    // Track directors
    for (const d of f.directors) {
      if (!filmLookup.directors.has(d)) filmLookup.directors.set(d, []);
      const list = filmLookup.directors.get(d)!;
      if (list.length < 20) list.push(filmInfo);
    }

    // Track cast
    for (const c of f.cast) {
      if (!filmLookup.cast.has(c)) filmLookup.cast.set(c, []);
      const list = filmLookup.cast.get(c)!;
      if (list.length < 20) list.push(filmInfo);
    }

    // Track keywords
    for (const k of f.keywords) {
      if (!filmLookup.keywords.has(k)) filmLookup.keywords.set(k, []);
      const list = filmLookup.keywords.get(k)!;
      if (list.length < 20) list.push(filmInfo);
    }

    // Track studios
    for (const studio of f.productionCompanies) {
      if (!filmLookup.studios.has(studio)) filmLookup.studios.set(studio, []);
      const list = filmLookup.studios.get(studio)!;
      if (list.length < 20) list.push(filmInfo);
    }
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
  const moviesForAnalysis = await mapLimit(mappedIds, 10, (id) => fetchTmdbMovieCached(id));

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

  // Pre-process adjacent genres for fast lookup
  // We want to boost genres that are "adjacent" to the user's recent watches
  const adjacentBoosts = new Map<string, number>();
  if (params.enhancedProfile?.adjacentGenres && params.enhancedProfile?.recentGenres) {
    // For each recent genre, find its adjacent targets
    for (const recent of params.enhancedProfile.recentGenres) {
      const targets = params.enhancedProfile.adjacentGenres.get(recent);
      if (targets) {
        for (const t of targets) {
          // Accumulate boosts (max 2.0)
          const current = adjacentBoosts.get(t.genre) || 0;
          adjacentBoosts.set(t.genre, Math.min(2.0, current + (t.weight * 0.5)));
        }
      }
    }
  }

  const maxC = Math.min(params.maxCandidates ?? 120, validCandidates.length);
  const desired = Math.max(10, Math.min(30, params.desiredResults ?? 20));

  // Helper to fetch from cache first in bulk where possible
  async function fetchFromCache(id: number): Promise<TMDBMovie | null> {
    return await fetchTmdbMovieCached(id);
  }

  const resultsAcc: Array<{ tmdbId: number; score: number; reasons: string[]; title?: string; release_date?: string; genres?: string[]; poster_path?: string | null; contributingFilms?: Record<string, Array<{ id: number; title: string }>> }> = [];
  const pool = await mapLimit(validCandidates.slice(0, maxC), params.concurrency ?? 8, async (cid) => {
    if (seenIds.has(cid)) return null; // skip already-liked
    const m = await fetchFromCache(cid);
    if (!m) return null;
    const feats = extractFeatures(m);

    // Exclude by genres early if requested
    if (params.excludeGenres && feats.genres.some((g) => params.excludeGenres!.has(g.toLowerCase()))) {
      return null;
    }

    // QUALITY FILTER: Exclude low-quality movies
    // Filter out "B" movies and low-rated content to ensure quality suggestions
    const minVoteAverage = 6.0;  // Minimum rating of 6.0/10
    const minVoteCount = 50;      // Minimum 50 votes for statistical relevance

    if (feats.voteAverage < minVoteAverage || feats.voteCount < minVoteCount) {
      return null; // Skip low-quality or unrated movies
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

    // ADAPTIVE LEARNING BOOST: Check if matches learned genre transitions
    // E.g. User watched Drama recently -> Boost Sci-Fi if that's a learned transition
    if (adjacentBoosts.size > 0) {
      let maxAdjBoost = 0;
      let boostedGenre = '';

      for (const g of feats.genres) {
        const boost = adjacentBoosts.get(g);
        if (boost && boost > maxAdjBoost) {
          maxAdjBoost = boost;
          boostedGenre = g;
        }
      }

      if (maxAdjBoost > 0) {
        // Prevent double boosting: If user already loves this genre (high weight), 
        // the transition boost is redundant or should be minimal.
        const existingWeight = pref.genres.get(boostedGenre) || 0;

        if (existingWeight > 5.0) {
          // User already strongly loves this genre, no need for transition boost
          maxAdjBoost = 0;
        } else if (existingWeight > 2.0) {
          // User likes this genre, reduce transition boost
          maxAdjBoost *= 0.5;
        }

        if (maxAdjBoost > 0) {
          score += maxAdjBoost;
          reasons.push(`Matches your learned preference for ${boostedGenre} after recent watches`);
        }
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

    // PHASE 2: Enhanced actor matching using taste profile
    if (params.enhancedProfile?.topActors) {
      const actorIds = new Set(m.credits?.cast?.map(c => c.id) || []);
      const matchedActors = params.enhancedProfile.topActors.filter(a => actorIds.has(a.id));

      if (matchedActors.length > 0) {
        // Weight by actor preference strength and billing position
        const actorScore = matchedActors.reduce((sum, actor) => {
          const castMember = m.credits?.cast?.find(c => c.id === actor.id);
          const billingBonus = castMember && castMember.order != null ? (1 / (castMember.order + 1)) : 0.5;
          return sum + (actor.weight * billingBonus);
        }, 0);

        score += actorScore * weights.actor;

        const topActor = matchedActors[0];
        const actorCount = matchedActors.length;
        if (actorCount === 1) {
          reasons.push(`Stars ${topActor.name} — one of your favorite actors`);
        } else {
          reasons.push(`Stars ${matchedActors.slice(0, 2).map(a => a.name).join(' and ')} — ${actorCount} actors you love`);
        }
      }
    }

    // PHASE 2: Enhanced studio matching using taste profile
    if (params.enhancedProfile?.topStudios) {
      const studioIds = new Set(feats.productionCompanyIds);
      const matchedStudios = params.enhancedProfile.topStudios.filter(s => studioIds.has(s.id));

      if (matchedStudios.length > 0) {
        const studioScore = matchedStudios.reduce((sum, studio) => sum + studio.weight, 0);
        score += studioScore * weights.studio;

        // Only add reason if not already added by legacy studio matching
        if (!studioHits.length) {
          const topStudio = matchedStudios[0];
          reasons.push(`From ${topStudio.name} — a studio whose films you consistently enjoy`);
        }
      }
    }

    // PHASE 2: Negative signal penalties (avoid genres/keywords/directors)
    let totalPenalty = 0;
    const penaltyReasons: string[] = [];

    if (params.enhancedProfile?.avoidGenres) {
      const avoidedGenreIds = new Set(params.enhancedProfile.avoidGenres.map(g => g.id));
      const matchedAvoidGenres = feats.genreIds.filter(id => avoidedGenreIds.has(id));

      if (matchedAvoidGenres.length > 0) {
        const genrePenalty = matchedAvoidGenres.length * weights.avoidGenrePenalty;
        totalPenalty += genrePenalty;
        const avoidedGenre = params.enhancedProfile.avoidGenres.find(g => g.id === matchedAvoidGenres[0]);
        penaltyReasons.push(`Contains ${avoidedGenre?.name || 'genre'} you typically avoid`);
      }
    }

    if (params.enhancedProfile?.avoidKeywords) {
      const avoidedKeywordIds = new Set(params.enhancedProfile.avoidKeywords.map(k => k.id));
      const matchedAvoidKeywords = feats.keywordIds.filter(id => avoidedKeywordIds.has(id));

      if (matchedAvoidKeywords.length > 0) {
        const keywordPenalty = matchedAvoidKeywords.length * weights.avoidKeywordPenalty;
        totalPenalty += keywordPenalty;
        const avoidedKeyword = params.enhancedProfile.avoidKeywords.find(k => k.id === matchedAvoidKeywords[0]);
        penaltyReasons.push(`Has themes (${avoidedKeyword?.name || 'keyword'}) you dislike`);
      }
    }

    if (params.enhancedProfile?.avoidDirectors) {
      const avoidedDirectorIds = new Set(params.enhancedProfile.avoidDirectors.map(d => d.id));
      const matchedAvoidDirectors = feats.directorIds.filter(id => avoidedDirectorIds.has(id));

      if (matchedAvoidDirectors.length > 0) {
        const directorPenalty = matchedAvoidDirectors.length * weights.avoidDirectorPenalty;
        totalPenalty += directorPenalty;
        const avoidedDirector = params.enhancedProfile.avoidDirectors.find(d => d.id === matchedAvoidDirectors[0]);
        penaltyReasons.push(`Directed by ${avoidedDirector?.name || 'director'} whose films you don't enjoy`);
      }
    }

    // Apply penalties to score
    if (totalPenalty < 0) {
      score += totalPenalty; // totalPenalty is negative, so this reduces the score
      console.log(`[NegativePenalty] Penalized "${m.title}" by ${Math.abs(totalPenalty).toFixed(2)} - ${penaltyReasons.join('; ')}`);
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

    // Give base score to quality films even without direct taste matches
    // This allows hidden gems, crowd pleasers, and trending films to appear
    if (score <= 0) {
      // Award small base score for high-quality films (hidden gems, crowd pleasers, cult classics)
      if (feats.voteCategory === 'hidden-gem') {
        score = 0.3; // Hidden gems get small boost to ensure they appear
        reasons.push('Highly-rated hidden gem worth discovering');
      } else if (feats.voteCategory === 'crowd-pleaser') {
        score = 0.2; // Crowd pleasers get small boost
        reasons.push('Widely loved crowd-pleaser');
      } else if (feats.voteCategory === 'cult-classic') {
        score = 0.25; // Cult classics get small boost
        reasons.push('Cult classic with dedicated following');
      }
      // If still no score, filter out standard films with no taste matches
      if (score <= 0) return null;
    }

    // Build contributingFilms map for this suggestion
    // Map each matched feature to the user's films that have that feature
    const contributingFilms: Record<string, Array<{ id: number; title: string }>> = {};

    // Add films for matched genres
    const gHitsForLookup = feats.genres.filter((g) => pref.genres.has(g));
    for (const g of gHitsForLookup) {
      const films = filmLookup.genres.get(g) || [];
      if (films.length > 0) {
        contributingFilms[`genre:${g}`] = films.slice(0, 10); // Limit to 10 films per feature
      }
    }

    // Add films for matched directors
    const dHitsForLookup = feats.directors.filter((d) => pref.directors.has(d));
    for (const d of dHitsForLookup) {
      const films = filmLookup.directors.get(d) || [];
      if (films.length > 0) {
        contributingFilms[`director:${d}`] = films.slice(0, 10);
      }
    }

    // Add films for matched cast
    const cHitsForLookup = feats.cast.filter((c) => pref.cast.has(c));
    for (const c of cHitsForLookup) {
      const films = filmLookup.cast.get(c) || [];
      if (films.length > 0) {
        contributingFilms[`cast:${c}`] = films.slice(0, 10);
      }
    }

    // Add films for matched keywords
    const kHitsForLookup = feats.keywords.filter((k) => pref.keywords.has(k));
    for (const k of kHitsForLookup) {
      const films = filmLookup.keywords.get(k) || [];
      if (films.length > 0) {
        contributingFilms[`keyword:${k}`] = films.slice(0, 10);
      }
    }

    // Add films for matched studios
    const studioHitsForLookup = feats.productionCompanies.filter(s => pref.productionCompanies.has(s));
    for (const s of studioHitsForLookup) {
      const films = filmLookup.studios.get(s) || [];
      if (films.length > 0) {
        contributingFilms[`studio:${s}`] = films.slice(0, 10);
      }
    }

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
      voteCount: feats.voteCount,
      contributingFilms,
      // Phase 3: For diversity filtering
      directors: feats.directors,
      studios: feats.productionCompanies,
      actors: feats.cast.slice(0, 3) // Top 3 billed actors
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
    contributingFilms?: Record<string, Array<{ id: number; title: string }>>;
    directors?: string[];
    studios?: string[];
    actors?: string[];
  }>;
  results.sort((a, b) => b.score - a.score);

  // Phase 3: Apply diversity filtering
  const diversified = applyDiversityFilter(results, {
    maxSameDirector: 2,
    maxSameGenre: 5,
    maxSameDecade: 4,
    maxSameStudio: 3,
    maxSameActor: 3
  });

  return diversified.slice(0, desired);
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

// ============================================================================
// Phase 5+: Adaptive Exploration & Personalized Learning
// ============================================================================

/**
 * Get adaptive exploration rate based on user's response to exploratory picks
 * Rate adjusts between 5-30% based on how user rates exploratory suggestions
 */
export async function getAdaptiveExplorationRate(userId: string): Promise<number> {
  if (!supabase) return 0.15; // Default 15%

  try {
    const { data, error } = await supabase
      .from('user_exploration_stats')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('[AdaptiveExploration] Error fetching stats:', error);
      return 0.15;
    }

    if (!data || data.exploratory_films_rated < 10) {
      // Need at least 10 rated exploratory films to adjust
      console.log('[AdaptiveExploration] Using default rate (insufficient data)', {
        ratedCount: data?.exploratory_films_rated || 0
      });
      return 0.15;
    }

    const avgRating = data.exploratory_avg_rating;
    let newRate = data.exploration_rate;

    // Adjust rate based on average rating
    if (avgRating >= 4.0) {
      // User loves exploratory picks - increase discovery
      newRate = Math.min(0.30, data.exploration_rate + 0.05);
      console.log('[AdaptiveExploration] Increasing rate (high satisfaction)', {
        avgRating,
        oldRate: data.exploration_rate,
        newRate
      });
    } else if (avgRating < 3.0) {
      // User dislikes exploratory picks - decrease discovery
      newRate = Math.max(0.05, data.exploration_rate - 0.05);
      console.log('[AdaptiveExploration] Decreasing rate (low satisfaction)', {
        avgRating,
        oldRate: data.exploration_rate,
        newRate
      });
    } else {
      console.log('[AdaptiveExploration] Maintaining rate (neutral satisfaction)', {
        avgRating,
        rate: data.exploration_rate
      });
    }

    // Update rate if changed
    if (newRate !== data.exploration_rate) {
      await supabase
        .from('user_exploration_stats')
        .update({
          exploration_rate: newRate,
          last_updated: new Date().toISOString()
        })
        .eq('user_id', userId);
    }

    return newRate;
  } catch (e) {
    console.error('[AdaptiveExploration] Exception:', e);
    return 0.15;
  }
}

/**
 * Update exploration feedback when user rates an exploratory film
 * This feeds into the adaptive exploration rate calculation
 */
export async function updateExplorationFeedback(
  userId: string,
  tmdbId: number,
  rating: number,
  wasExploratory: boolean
) {
  if (!supabase || !wasExploratory) return;

  try {
    const { data: current } = await supabase
      .from('user_exploration_stats')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (!current) {
      // Create initial record
      await supabase.from('user_exploration_stats').insert({
        user_id: userId,
        exploration_rate: 0.15,
        exploratory_films_rated: 1,
        exploratory_avg_rating: rating,
        last_updated: new Date().toISOString()
      });

      console.log('[ExplorationFeedback] Created initial stats', { userId, rating });
    } else {
      // Update running average
      const newCount = current.exploratory_films_rated + 1;
      const newAvg = ((current.exploratory_avg_rating * current.exploratory_films_rated) + rating) / newCount;

      await supabase.from('user_exploration_stats').update({
        exploratory_films_rated: newCount,
        exploratory_avg_rating: Number(newAvg.toFixed(2)),
        last_updated: new Date().toISOString()
      }).eq('user_id', userId);

      console.log('[ExplorationFeedback] Updated stats', {
        userId,
        newCount,
        newAvg: newAvg.toFixed(2),
        rating
      });
    }
  } catch (e) {
    console.error('[ExplorationFeedback] Error:', e);
  }
}

/**
 * Get personalized adjacent genres based on learned preferences
 * Falls back to generic adjacency map if insufficient data
 */
export async function getPersonalizedAdjacentGenres(
  userId: string,
  topGenres: Array<{ id: number; name: string }>
): Promise<Array<{ genreId: number; genreName: string; confidence: number }>> {
  if (!supabase) return [];

  try {
    const adjacentGenres: Array<{ genreId: number; genreName: string; confidence: number }> = [];

    for (const genre of topGenres.slice(0, 3)) {
      // Get learned adjacencies for this genre
      const { data, error } = await supabase
        .from('user_adjacent_preferences')
        .select('to_genre_id, to_genre_name, success_rate, rating_count')
        .eq('user_id', userId)
        .eq('from_genre_id', genre.id)
        .gte('rating_count', 3) // Need at least 3 ratings
        .gte('success_rate', 0.6) // 60%+ success rate
        .order('success_rate', { ascending: false });

      if (error) {
        console.error('[PersonalizedAdjacency] Error:', error);
        continue;
      }

      if (data && data.length > 0) {
        // Use learned adjacencies
        console.log('[PersonalizedAdjacency] Found learned preferences', {
          fromGenre: genre.name,
          count: data.length
        });

        data.slice(0, 3).forEach(row => {
          adjacentGenres.push({
            genreId: row.to_genre_id,
            genreName: row.to_genre_name,
            confidence: row.success_rate
          });
        });
      }
    }

    return adjacentGenres;
  } catch (e) {
    console.error('[PersonalizedAdjacency] Exception:', e);
    return [];
  }
}

/**
 * Update adjacent genre preferences when user rates a film
 * Tracks which genre transitions are successful for this user
 */
export async function updateAdjacentPreferences(
  userId: string,
  filmGenres: Array<{ id: number; name: string }>,
  userTopGenres: Array<{ id: number; name: string }>,
  rating: number
) {
  if (!supabase || !filmGenres || filmGenres.length === 0) return;

  try {
    const topGenreIds = new Set(userTopGenres.map(g => g.id));
    const isSuccess = rating >= 3.5;

    // Find adjacent transitions (film genres not in user's top genres)
    for (const filmGenre of filmGenres) {
      if (topGenreIds.has(filmGenre.id)) continue; // Skip if already a top genre

      // This is an adjacent genre - find which top genre it's adjacent to
      for (const topGenre of userTopGenres.slice(0, 3)) {
        // Check if this transition exists
        const { data: existing } = await supabase
          .from('user_adjacent_preferences')
          .select('*')
          .eq('user_id', userId)
          .eq('from_genre_id', topGenre.id)
          .eq('to_genre_id', filmGenre.id)
          .maybeSingle();

        if (existing) {
          // Update existing preference
          const newCount = existing.rating_count + 1;
          const newAvg = ((existing.avg_rating * existing.rating_count) + rating) / newCount;
          const successCount = (existing.success_rate * existing.rating_count) + (isSuccess ? 1 : 0);
          const newSuccessRate = successCount / newCount;

          await supabase
            .from('user_adjacent_preferences')
            .update({
              rating_count: newCount,
              avg_rating: Number(newAvg.toFixed(2)),
              success_rate: Number(newSuccessRate.toFixed(2)),
              last_updated: new Date().toISOString()
            })
            .eq('id', existing.id);

          console.log('[AdjacentPreferences] Updated', {
            from: topGenre.name,
            to: filmGenre.name,
            newCount,
            newSuccessRate: newSuccessRate.toFixed(2)
          });
        } else {
          // Create new preference
          await supabase
            .from('user_adjacent_preferences')
            .insert({
              user_id: userId,
              from_genre_id: topGenre.id,
              from_genre_name: topGenre.name,
              to_genre_id: filmGenre.id,
              to_genre_name: filmGenre.name,
              rating_count: 1,
              avg_rating: rating,
              success_rate: isSuccess ? 1.0 : 0.0,
              last_updated: new Date().toISOString()
            });

          console.log('[AdjacentPreferences] Created', {
            from: topGenre.name,
            to: filmGenre.name,
            rating
          });
        }
      }
    }
  } catch (e) {
    console.error('[AdjacentPreferences] Error:', e);
  }
}

/**
 * Batch process historical ratings on import to populate adaptive learning data
 * This gives new users personalized recommendations immediately
 */
export async function learnFromHistoricalData(userId: string) {
  if (!supabase) {
    console.log('[BatchLearning] Supabase not initialized');
    return;
  }

  try {
    console.log('[BatchLearning] Starting analysis of historical data for user:', userId);

    // 1. Get all film events for this user
    const { data: films, error: filmsError } = await supabase
      .from('film_events')
      .select('uri, title, rating, liked')
      .eq('user_id', userId);
    // .not('rating', 'is', null); // Removed to include all watched films

    if (filmsError) {
      console.error('[BatchLearning] Error fetching films:', filmsError);
      return;
    }

    if (!films || films.length < 10) {
      console.log('[BatchLearning] Not enough rated films for learning', { count: films?.length || 0 });
      return;
    }

    console.log('[BatchLearning] Processing', films.length, 'rated films');

    // 2. Get film mappings to TMDB IDs
    const { data: mappings, error: mappingsError } = await supabase
      .from('film_tmdb_map')
      .select('uri, tmdb_id')
      .eq('user_id', userId);

    if (mappingsError || !mappings) {
      console.error('[BatchLearning] Error fetching mappings:', mappingsError);
      return;
    }

    const uriToTmdbId = new Map(mappings.map(m => [m.uri, m.tmdb_id]));
    console.log('[BatchLearning] Found', mappings.length, 'TMDB mappings');

    // 3. Get TMDB details for mapped films (in batches)
    const tmdbIds = Array.from(new Set(mappings.map(m => m.tmdb_id)));
    const batchSize = 100;
    const tmdbDetails = new Map<number, any>();

    for (let i = 0; i < tmdbIds.length; i += batchSize) {
      const batch = tmdbIds.slice(i, i + batchSize);
      const { data: cached } = await supabase
        .from('tmdb_movies')
        .select('tmdb_id, data')
        .in('tmdb_id', batch);

      cached?.forEach(row => {
        if (row.data) {
          tmdbDetails.set(row.tmdb_id, row.data);
        }
      });
    }

    console.log('[BatchLearning] Loaded TMDB details for', tmdbDetails.size, 'films');

    // 4. Build taste profile to get top genres
    const mappingsMap = new Map(mappings.map(m => [m.uri, m.tmdb_id]));
    const profile = await buildTasteProfile({
      films: films.map(f => ({
        uri: f.uri,
        title: f.title,
        rating: f.rating,
        liked: f.liked
      })),
      mappings: mappingsMap,
      topN: 10,
      tmdbDetails: tmdbDetails // Pass pre-fetched details
    });

    console.log('[BatchLearning] Built taste profile', {
      topGenres: profile.topGenres.length,
      totalFilms: films.length
    });

    // 5. Analyze genre transitions and populate adjacency preferences
    let transitionsProcessed = 0;
    const topGenreIds = new Set(profile.topGenres.slice(0, 3).map(g => g.id));

    for (const film of films) {
      const tmdbId = uriToTmdbId.get(film.uri);
      if (!tmdbId) continue;

      const details = tmdbDetails.get(tmdbId);
      if (!details || !details.genres) continue;

      const rating = film.rating ?? 0;
      if (rating < 1) continue; // Skip unrated

      // Check for adjacent genre transitions
      const filmGenres = details.genres as Array<{ id: number; name: string }>;

      await updateAdjacentPreferences(
        userId,
        filmGenres,
        profile.topGenres,
        rating
      );

      transitionsProcessed++;
    }

    console.log('[BatchLearning] Processed', transitionsProcessed, 'genre transitions');

    // 6. Calculate initial exploration stats based on high-rated variety
    const highRated = films.filter(f => (f.rating ?? 0) >= 4);
    const exploratory = films.filter(f => {
      const tmdbId = uriToTmdbId.get(f.uri);
      if (!tmdbId) return false;

      const details = tmdbDetails.get(tmdbId);
      if (!details || !details.genres) return false;

      // Film is exploratory if it has genres outside top 3
      const filmGenres = details.genres as Array<{ id: number }>;
      return filmGenres.some(g => !topGenreIds.has(g.id));
    });

    if (exploratory.length > 0) {
      const exploratoryAvg = exploratory.reduce((sum, f) => sum + (f.rating ?? 0), 0) / exploratory.length;

      // Seed exploration stats
      await supabase
        .from('user_exploration_stats')
        .upsert({
          user_id: userId,
          exploration_rate: 0.15, // Start at default
          exploratory_films_rated: exploratory.length,
          exploratory_avg_rating: Number(exploratoryAvg.toFixed(2)),
          last_updated: new Date().toISOString()
        });

      console.log('[BatchLearning] Seeded exploration stats', {
        exploratoryFilms: exploratory.length,
        avgRating: exploratoryAvg.toFixed(2)
      });
    }

    console.log('[BatchLearning] ✅ Historical learning complete!', {
      totalFilms: films.length,
      highRated: highRated.length,
      exploratoryFilms: exploratory.length,
      transitionsTracked: transitionsProcessed
    });

  } catch (e) {
    console.error('[BatchLearning] Error during batch learning:', e);
  }
}
