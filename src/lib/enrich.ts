import { supabase } from './supabaseClient';

export type TMDBMovie = {
  id: number;
  title: string;
  release_date?: string;
  poster_path?: string;
  backdrop_path?: string;
  overview?: string;
  credits?: { cast?: Array<{ id: number; name: string; known_for_department?: string; order?: number }>; crew?: Array<{ id: number; name: string; job?: string; department?: string }> };
  keywords?: { keywords?: Array<{ id: number; name: string }>; results?: Array<{ id: number; name: string }> };
};

export async function searchTmdb(query: string, year?: number) {
  console.log('[TMDB] search start', { query, year });
  const u = new URL('/api/tmdb/search', typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  u.searchParams.set('query', query);
  if (year) u.searchParams.set('year', String(year));
  try {
    const r = await fetch(u.toString());
    const j = await r.json();
    if (!r.ok || !j.ok) {
      console.error('[TMDB] search error', { status: r.status, body: j });
      throw new Error(j.error || 'TMDB search failed');
    }
    console.log('[TMDB] search ok', { count: (j.results ?? []).length });
    return j.results as TMDBMovie[];
  } catch (e) {
    console.error('[TMDB] search exception', e);
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

export async function fetchTmdbMovie(id: number): Promise<TMDBMovie> {
  console.log('[TMDB] fetch movie start', { id });
  const u = new URL('/api/tmdb/movie', typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  u.searchParams.set('id', String(id));
  try {
    const r = await fetch(u.toString(), { cache: 'no-store' });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      console.error('[TMDB] fetch movie error', { id, status: r.status, body: j });
      throw new Error(j.error || 'TMDB fetch failed');
    }
    console.log('[TMDB] fetch movie ok');
    return j.movie as TMDBMovie;
  } catch (e) {
    console.error('[TMDB] fetch movie exception', e);
    throw e;
  }
}

export type FilmEventLite = { uri: string; title: string; year: number | null; rating?: number; liked?: boolean };

function extractFeatures(movie: TMDBMovie) {
  const genres: string[] = Array.isArray((movie as any).genres) ? (movie as any).genres.map((g: any) => g.name).filter(Boolean) : [];
  const genreIds: number[] = Array.isArray((movie as any).genres) ? (movie as any).genres.map((g: any) => g.id).filter(Boolean) : [];
  const directors = (movie.credits?.crew || []).filter((c) => c.job === 'Director').map((c) => c.name);
  const directorIds = (movie.credits?.crew || []).filter((c) => c.job === 'Director').map((c) => c.id);
  const cast = (movie.credits?.cast || []).slice(0, 5).map((c) => c.name);
  const keywordsList = movie.keywords?.keywords || movie.keywords?.results || [];
  const keywords = (keywordsList as Array<{ id: number; name: string }>).map((k) => k.name);
  const keywordIds = (keywordsList as Array<{ id: number; name: string }>).map((k) => k.id);
  const original_language = (movie as any).original_language as string | undefined;
  const runtime = (movie as any).runtime as number | undefined;
  
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
    genreCombo,
    directors,
    directorIds,
    cast, 
    keywords,
    keywordIds,
    original_language,
    runtime,
    isAnimation,
    isFamily,
    isChildrens
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
    keywords: new Map<string, number>(),
    // Track directors/actors within specific subgenres for better matching
    directorKeywords: new Map<string, Set<string>>(), // director -> keywords they work in
    castKeywords: new Map<string, Set<string>>(), // cast -> keywords they work in
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
    
    for (const k of f.keywords) pref.keywords.set(k, (pref.keywords.get(k) ?? 0) + weight);
    
    if (f.isAnimation) likedAnimationCount++;
    if (f.isFamily) likedFamilyCount++;
    if (f.isChildrens) likedChildrensCount++;
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
    
    let score = 0;
    const reasons: string[] = [];
    
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
      const similarDirectors = feats.directors.filter(d => {
        // Find directors who share many keywords with this candidate
        const candidateKeywords = new Set(feats.keywords);
        for (const [likedDir, dirKeywords] of pref.directorKeywords.entries()) {
          const sharedKeywords = Array.from(dirKeywords).filter(k => candidateKeywords.has(k));
          if (sharedKeywords.length >= 2 && feats.directors.includes(d)) {
            return true;
          }
        }
        return false;
      });
      if (similarDirectors.length) {
        score += 0.8 * weights.director; // Lower boost than exact director match
        reasons.push(`Director works in similar subgenres you enjoy`);
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
      const similarCast = feats.cast.filter(c => {
        const candidateKeywords = new Set(feats.keywords);
        for (const [likedCast, castKeywords] of pref.castKeywords.entries()) {
          const sharedKeywords = Array.from(castKeywords).filter(k => candidateKeywords.has(k));
          if (sharedKeywords.length >= 2 && feats.cast.includes(c)) {
            return true;
          }
        }
        return false;
      });
      if (similarCast.length) {
        score += 0.3 * weights.cast; // Small boost for similar actors
        reasons.push(`Features actors who work in similar themes you enjoy`);
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
    
    if (score <= 0) return null;
    const r = { tmdbId: cid, score, reasons, title: m.title, release_date: m.release_date, genres: feats.genres, poster_path: m.poster_path };
    resultsAcc.push(r);
    // Early return the result; caller will slice after sorting
    return r;
  });
  const results = pool.filter(Boolean) as Array<{ tmdbId: number; score: number; reasons: string[]; title?: string; release_date?: string; genres?: string[]; poster_path?: string | null }>;
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
