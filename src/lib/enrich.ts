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

export async function getFilmMappings(userId: string, uris: string[]) {
  if (!supabase) throw new Error('Supabase not initialized');
  if (!uris.length) return new Map<string, number>();
  // Supabase has a limit of values in .in(); chunk if large
  const chunkSize = 500;
  const map = new Map<string, number>();
  for (let i = 0; i < uris.length; i += chunkSize) {
    const chunk = uris.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('film_tmdb_map')
      .select('uri, tmdb_id')
      .eq('user_id', userId)
      .in('uri', chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.uri != null && row.tmdb_id != null) map.set(row.uri, Number(row.tmdb_id));
    }
  }
  return map;
}

export async function fetchTmdbMovie(id: number): Promise<TMDBMovie> {
  const u = new URL('/api/tmdb/movie', typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  u.searchParams.set('id', String(id));
  const r = await fetch(u.toString(), { cache: 'no-store' });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || 'TMDB fetch failed');
  return j.movie as TMDBMovie;
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

export async function suggestByOverlap(params: {
  userId: string;
  films: FilmEventLite[];
  mappings: Map<string, number>;
  candidates: number[]; // tmdb ids to consider (e.g., from watchlist mapping or popular)
}): Promise<Array<{ tmdbId: number; score: number; reasons: string[] }>> {
  // Build user profile from liked/highly-rated mapped films
  const liked = params.films.filter((f) => (f.liked || (f.rating ?? 0) >= 4) && params.mappings.get(f.uri));
  const likedIds = liked.map((f) => params.mappings.get(f.uri)!).filter(Boolean) as number[];
  const likedMovies = await Promise.all(likedIds.map((id) => fetchTmdbMovie(id).catch(() => null)));
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

  const results: Array<{ tmdbId: number; score: number; reasons: string[] }> = [];
  for (const cid of params.candidates) {
    if (seenIds.has(cid)) continue; // skip already-liked
    const m = await fetchTmdbMovie(cid).catch(() => null);
    if (!m) continue;
    const feats = extractFeatures(m);
    let score = 0;
    const reasons: string[] = [];
    const gHits = feats.genres.filter((g) => pref.genres.has(g));
    if (gHits.length) {
      score += gHits.length * weights.genre;
      reasons.push(`Genres: ${gHits.slice(0, 3).join(', ')}`);
    }
    const dHits = feats.directors.filter((d) => pref.directors.has(d));
    if (dHits.length) {
      score += dHits.length * weights.director;
      reasons.push(`Director: ${dHits.slice(0, 2).join(', ')}`);
    }
    const cHits = feats.cast.filter((c) => pref.cast.has(c));
    if (cHits.length) {
      score += Math.min(3, cHits.length) * weights.cast;
      reasons.push(`Cast overlap: ${cHits.slice(0, 3).join(', ')}`);
    }
    const kHits = feats.keywords.filter((k) => pref.keywords.has(k));
    if (kHits.length) {
      score += Math.min(5, kHits.length) * weights.keyword;
      reasons.push(`Keywords: ${kHits.slice(0, 5).join(', ')}`);
    }
    if (score > 0) results.push({ tmdbId: cid, score, reasons });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 20);
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
