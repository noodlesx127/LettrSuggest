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
  // Supabase has a limit of values in .in(); chunk if large
  const chunkSize = 500;
  const map = new Map<string, number>();
  for (let i = 0; i < uris.length; i += chunkSize) {
    const chunk = uris.slice(i, i + chunkSize);
    console.log('[Mappings] fetching chunk', { userId, offset: i, chunkSize: chunk.length });
    try {
      const queryPromise = supabase
        .from('film_tmdb_map')
        .select('uri, tmdb_id')
        .eq('user_id', userId)
        .in('uri', chunk);
      const { data, error } = await withTimeout(queryPromise as unknown as Promise<{ data: Array<{ uri: string; tmdb_id: number }>; error: any }>, 8000);
      if (error) {
        console.error('[Mappings] error fetching chunk', { offset: i, chunkSize: chunk.length, error });
        break;
      }
      console.log('[Mappings] chunk loaded', { offset: i, rowCount: (data ?? []).length });
      for (const row of data ?? []) {
        if (row.uri != null && row.tmdb_id != null) map.set(row.uri, Number(row.tmdb_id));
      }
    } catch (e) {
      console.error('[Mappings] timeout or exception fetching chunk', { offset: i, chunkSize: chunk.length, error: e });
      break;
    }
  }
  console.log('[Mappings] finished getFilmMappings', { totalMappings: map.size });
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
  const directors = (movie.credits?.crew || []).filter((c) => c.job === 'Director').map((c) => c.name);
  const cast = (movie.credits?.cast || []).slice(0, 5).map((c) => c.name);
  const keywordsList = movie.keywords?.keywords || movie.keywords?.results || [];
  const keywords = (keywordsList as Array<{ id: number; name: string }>).map((k) => k.name);
  return { genres, directors, cast, keywords };
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
  const likedCap = 800;
  // If the user has an enormous number of liked films, bias towards
  // the most recent ones (assuming input films are roughly chronological).
  const likedIds = likedIdsAll.length > likedCap ? likedIdsAll.slice(-likedCap) : likedIdsAll;
  const likedMovies = await Promise.all(likedIds.map((id) => fetchTmdbMovieCached(id)));
  const likedFeats = likedMovies.filter(Boolean).map((m) => extractFeatures(m as TMDBMovie));

  const weights = {
    genre: 1.0,
    director: 1.5,
    cast: 0.5,
    keyword: 0.4,
  };

  // Build simple feature bags
  const pref = {
    genres: new Map<string, number>(),
    directors: new Map<string, number>(),
    cast: new Map<string, number>(),
    keywords: new Map<string, number>(),
  };
  for (const f of likedFeats) {
    for (const g of f.genres) pref.genres.set(g, (pref.genres.get(g) ?? 0) + 1);
    for (const d of f.directors) pref.directors.set(d, (pref.directors.get(d) ?? 0) + 1);
    for (const c of f.cast) pref.cast.set(c, (pref.cast.get(c) ?? 0) + 1);
    for (const k of f.keywords) pref.keywords.set(k, (pref.keywords.get(k) ?? 0) + 1);
  }

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
    let score = 0;
    const reasons: string[] = [];
    const gHits = feats.genres.filter((g) => pref.genres.has(g));
    if (gHits.length) {
      score += gHits.length * weights.genre;
      const genreCount = pref.genres.get(gHits[0]) ?? 1;
      reasons.push(`Matches your taste in ${gHits.slice(0, 3).join(', ')} (${genreCount} similar ${genreCount === 1 ? 'film' : 'films'} in your collection)`);
    }
    const dHits = feats.directors.filter((d) => pref.directors.has(d));
    if (dHits.length) {
      score += dHits.length * weights.director;
      const dirCount = pref.directors.get(dHits[0]) ?? 1;
      reasons.push(`Directed by ${dHits.slice(0, 2).join(', ')} — you've enjoyed ${dirCount} ${dirCount === 1 ? 'film' : 'films'} by ${dHits.length === 1 ? 'this director' : 'these directors'}`);
    }
    const cHits = feats.cast.filter((c) => pref.cast.has(c));
    if (cHits.length) {
      score += Math.min(3, cHits.length) * weights.cast;
      reasons.push(`Stars ${cHits.slice(0, 3).join(', ')} — ${cHits.length} cast ${cHits.length === 1 ? 'member' : 'members'} you've liked before`);
    }
    const kHits = feats.keywords.filter((k) => pref.keywords.has(k));
    if (kHits.length) {
      score += Math.min(5, kHits.length) * weights.keyword;
      reasons.push(`Similar themes: ${kHits.slice(0, 5).join(', ')}`);
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
