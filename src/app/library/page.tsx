'use client';
import { useEffect, useMemo, useState } from 'react';
import AuthGate from '@/components/AuthGate';
import { supabase } from '@/lib/supabaseClient';
import { useImportData } from '@/lib/importStore';
import { getFilmMappings, searchTmdb, upsertFilmMapping, upsertTmdbCache, deleteFilmMapping } from '@/lib/enrich';
import Image from 'next/image';
import { usePostersSWR } from '@/lib/usePostersSWR';
import { FixedSizeGrid as Grid } from 'react-window';
import type { FilmEvent } from '@/lib/normalize';

type GridFilm = FilmEvent & { tmdbId?: number | null };

function useUserId() {
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => {
    const init = async () => {
      try {
        if (!supabase) return;
        const { data: sessionRes } = await supabase.auth.getSession();
        setUid(sessionRes.session?.user?.id ?? null);
      } catch {
        setUid(null);
      }
    };
    void init();
  }, []);
  return uid;
}

export default function LibraryPage() {
  const { films, loading: loadingFilms } = useImportData();
  const uid = useUserId();
  const [mappings, setMappings] = useState<Map<string, number>>(new Map());
  const [loadingMappings, setLoadingMappings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trailerKeys, setTrailerKeys] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    if (!uid || !films || films.length === 0) return;
    const load = async () => {
      console.log('[Library] start loading mappings', { uid, filmCount: films.length });
      setLoadingMappings(true);
      setError(null);
      try {
        const m = await getFilmMappings(uid, films.map((f) => f.uri));
        console.log('[Library] mappings loaded', { mappingCount: m.size });
        setMappings(m);
      } catch (e: any) {
        console.error('[Library] error loading mappings', e);
        setError(e?.message ?? 'Failed to load mappings');
      } finally {
        console.log('[Library] finished loading mappings');
        setLoadingMappings(false);
      }
    };
    void load();
  }, [uid, films]);

  const mappedIds = useMemo(() => Array.from(new Set(Array.from(mappings.values()))), [mappings]);

  // Fetch trailer data for mapped films
  useEffect(() => {
    if (mappedIds.length === 0) return;
    const fetchTrailers = async () => {
      try {
        const trailerMap = new Map<number, string>();
        await Promise.all(
          mappedIds.slice(0, 50).map(async (tmdbId) => { // Limit to first 50 to avoid rate limits
            try {
              // Try TuiMDB first, fallback to TMDB
              let data = null;
              try {
                const tuiResponse = await fetch(`/api/tuimdb/movie?id=${tmdbId}&_t=${Date.now()}`);
                if (tuiResponse.ok) {
                  const tuiData = await tuiResponse.json();
                  if (tuiData.ok && tuiData.movie) data = tuiData.movie;
                }
              } catch (e) { /* fallback to TMDB */ }
              
              if (!data) {
                const response = await fetch(`/api/tmdb/movie/${tmdbId}`);
                if (response.ok) {
                  const tmdbData = await response.json();
                  if (tmdbData.ok && tmdbData.movie) data = tmdbData.movie;
                }
              }
              
              if (data && data.videos?.results) {
                const trailer = data.videos.results.find(
                  (v: any) => v.site === 'YouTube' && v.type === 'Trailer' && v.official
                ) || data.videos.results.find(
                  (v: any) => v.site === 'YouTube' && v.type === 'Trailer'
                );
                if (trailer) {
                  trailerMap.set(tmdbId, trailer.key);
                }
              }
            } catch (e) {
              // Ignore individual fetch errors
            }
          })
        );
        setTrailerKeys(trailerMap);
      } catch (e) {
        console.error('Error fetching trailers:', e);
      }
    };
    void fetchTrailers();
  }, [mappedIds]);

  const gridFilms: GridFilm[] = useMemo(() => {
    if (!films) return [];
    // Only show watched films (not watchlist-only)
    return films
      .filter(f => (f.watchCount ?? 0) > 0)
      .map((f) => ({ ...f, tmdbId: mappings.get(f.uri) }));
  }, [films, mappings]);

  return (
    <AuthGate>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Library</h1>
        {(loadingFilms || loadingMappings) && (
          <span className="text-sm text-gray-600">
            {loadingFilms ? 'Loading films…' : 'Loading mappings…'}
          </span>
        )}
      </div>
      <p className="text-sm text-gray-700 mb-4">
        Your watched films. Use this page to review mapping accuracy and edit any mismatched titles.
      </p>
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
      {loadingFilms && <p className="text-sm text-gray-600">Loading your library from database…</p>}
      <MovieGrid films={gridFilms} uid={uid} mappedIds={mappedIds} trailerKeys={trailerKeys} onMappingChange={(uri, id) => {
        setMappings((prev) => new Map(prev).set(uri, id));
      }} onDeleteMapping={(uri) => {
        const next = new Map(mappings);
        next.delete(uri);
        setMappings(next);
      }} />
    </AuthGate>
  );
}

function MovieGrid({ films, uid, mappedIds, trailerKeys, onMappingChange, onDeleteMapping }: { films: GridFilm[]; uid: string | null; mappedIds: number[]; trailerKeys: Map<number, string>; onMappingChange: (uri: string, id: number) => void; onDeleteMapping: (uri: string) => void }) {
  const { posters, backdrops, loading } = usePostersSWR(mappedIds);
  if (!films.length) return <p className="text-sm text-gray-600">No films loaded yet. Import your data first.</p>;
  
  // Use simple grid layout instead of virtualization for now to avoid sizing issues
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
      {films.map((f) => (
        <MovieCard key={f.uri} film={f} uid={uid} posters={posters} backdrops={backdrops} trailerKey={f.tmdbId ? trailerKeys.get(f.tmdbId) : undefined} loading={loading} onMappingChange={onMappingChange} onDeleteMapping={onDeleteMapping} />
      ))}
    </div>
  );
}

function MovieCard({ film, uid, posters, backdrops, trailerKey, loading, onMappingChange, onDeleteMapping }: { film: GridFilm; uid: string | null; posters: Record<number, string | null>; backdrops: Record<number, string | null>; trailerKey?: string; loading: boolean; onMappingChange: (uri: string, id: number) => void; onDeleteMapping: (uri: string) => void }) {
  const [open, setOpen] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchYear, setSearchYear] = useState<number | undefined>(film.year ?? undefined);
  const [results, setResults] = useState<any[] | null>(null);
  const [searching, setSearching] = useState(false);
  const mapped = film.tmdbId != null;
  const posterPath = mapped && film.tmdbId ? (posters[film.tmdbId] ?? null) : null;
  const backdropPath = mapped && film.tmdbId ? (backdrops[film.tmdbId] ?? null) : null;
  const [imgError, setImgError] = useState(false);

  const runSearch = async () => {
    if (!searchQ.trim()) return;
    setSearching(true);
    try {
      const r = await searchTmdb(searchQ.trim(), searchYear);
      setResults(r);
    } catch (e) {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const applyMapping = async (tmdbId: number) => {
    if (!uid) return;
    try {
      const chosen = results?.find((r) => r.id === tmdbId);
      if (chosen) {
        await upsertTmdbCache(chosen);
      }
      await upsertFilmMapping(uid, film.uri, tmdbId);
      onMappingChange(film.uri, tmdbId);
      setOpen(false);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('lettr:mappings-updated'));
      }
    } catch (e) {
      // swallow
    }
  };

  const removeMapping = async () => {
    if (!uid || film.tmdbId == null) return;
    try {
      await deleteFilmMapping(uid, film.uri);
      onDeleteMapping(film.uri);
    } catch {}
  };

  return (
    <div className="group relative bg-white rounded shadow-sm border overflow-hidden">
      <div className="aspect-[2/3] bg-gray-200 relative overflow-hidden">
        {loading && !posterPath ? (
          <div className="w-full h-full animate-pulse bg-gray-300" />
        ) : showVideo && trailerKey ? (
          <iframe
            width="100%"
            height="100%"
            src={`https://www.youtube.com/embed/${trailerKey}?autoplay=1&mute=1`}
            title={`${film.title} trailer`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 w-full h-full"
          />
        ) : posterPath && !imgError ? (
          <Image
            src={`https://image.tmdb.org/t/p/w342${posterPath}`}
            alt={film.title}
            fill
            sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 16vw"
            className="object-cover"
            priority={false}
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-gray-500 p-2 text-center">
            {film.title || film.uri}
          </div>
        )}
        
        {/* Trailer play button */}
        {!showVideo && trailerKey && posterPath && !imgError && (
          <button
            onClick={() => setShowVideo(true)}
            className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-40 transition-all flex items-center justify-center group"
            aria-label="Play trailer"
          >
            <div className="w-10 h-10 bg-black bg-opacity-70 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
              </svg>
            </div>
          </button>
        )}
        
        {/* Close trailer button */}
        {showVideo && (
          <button
            onClick={() => setShowVideo(false)}
            className="absolute top-1 right-1 w-6 h-6 bg-black bg-opacity-70 rounded-full flex items-center justify-center text-white text-xs hover:bg-opacity-90 z-10"
            aria-label="Close trailer"
          >
            ✕
          </button>
        )}
        {/* Hover overlay with optional blurred backdrop */}
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          {backdropPath && (
            <Image
              src={`https://image.tmdb.org/t/p/w780${backdropPath}`}
              alt=""
              fill
              sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 16vw"
              className="object-cover blur-sm scale-105"
              priority={false}
              onError={() => {/* ignore backdrop errors */}}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-2">
            <p className="text-[11px] text-white font-medium line-clamp-2" title={film.title}>{film.title}</p>
            <p className="text-[10px] text-gray-200">{film.year || '—'} · Watches: {film.watchCount ?? 0}</p>
          </div>
        </div>
      </div>
      <div className="p-2">
        <p className="text-xs font-medium leading-tight truncate" title={film.title}>{film.title || film.uri}</p>
        <p className="text-[10px] text-gray-500">{film.year || '—'} · Watches: {film.watchCount ?? 0}</p>
        <p className={`text-[10px] mt-1 ${mapped ? 'text-green-700' : 'text-red-700'}`}>
          {mapped ? `Mapped (${film.tmdbId})` : 'Unmapped'}
        </p>
        <div className="mt-2 flex gap-1">
          <button className="flex-1 bg-gray-100 hover:bg-gray-200 text-[10px] rounded py-1" onClick={() => setOpen(true)}>Edit</button>
          {mapped && (
            <button className="flex-1 bg-red-50 hover:bg-red-100 text-[10px] rounded py-1" onClick={removeMapping}>Clear</button>
          )}
        </div>
        {mapped && (
          <div className="mt-2">
            <RefreshTmdbButton tmdbId={film.tmdbId!} />
          </div>
        )}
      </div>
      {open && (
        <div className="absolute inset-0 bg-white/95 backdrop-blur-sm p-2 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold">Map Film</span>
            <button className="text-[10px] px-1" onClick={() => setOpen(false)}>✕</button>
          </div>
          <input
            className="text-xs border rounded px-2 py-1 mb-1"
            placeholder="Search title"
            value={searchQ || film.title}
            onChange={(e) => setSearchQ(e.target.value)}
          />
          <input
            className="text-xs border rounded px-2 py-1 mb-2"
            placeholder="Year"
            type="number"
            value={searchYear ?? ''}
            onChange={(e) => setSearchYear(e.target.value ? Number(e.target.value) : undefined)}
          />
          <button disabled={searching} onClick={runSearch} className="text-[10px] bg-blue-600 text-white rounded py-1 mb-2 disabled:opacity-50">
            {searching ? 'Searching…' : 'Search'}
          </button>
          <div className="flex-1 overflow-auto space-y-1">
            {results?.map((r) => (
              <button
                key={r.id}
                className="w-full text-left text-[10px] border rounded px-2 py-1 hover:bg-blue-50"
                onClick={() => applyMapping(r.id)}
              >
                {r.title} {r.release_date ? `(${r.release_date.slice(0,4)})` : ''}
              </button>
            ))}
            {results && results.length === 0 && <p className="text-[10px] text-gray-500">No results</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function RefreshTmdbButton({ tmdbId }: { tmdbId: number }) {
  const [loading, setLoading] = useState(false);
  const [ok, setOk] = useState<boolean | null>(null);
  const refresh = async () => {
    setLoading(true);
    setOk(null);
    try {
      const u = new URL('/api/tmdb/refresh', typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
      u.searchParams.set('id', String(tmdbId));
      const r = await fetch(u.toString(), { cache: 'no-store' });
      const j = await r.json();
      setOk(Boolean(j?.ok));
    } catch {
      setOk(false);
    } finally {
      setLoading(false);
    }
  };
  return (
    <button
      onClick={refresh}
      disabled={loading}
      className="w-full text-[10px] bg-blue-50 hover:bg-blue-100 rounded py-1 disabled:opacity-50"
    >
      {loading ? 'Refreshing…' : ok == null ? 'Refresh TMDB' : ok ? 'Refreshed ✓' : 'Failed'}
    </button>
  );
}

// simple module-level registry to share posters state across cards without prop drilling
const posterState: { current: Record<number, string | null> } = { current: {} };
function postersGlobal() { return posterState.current; }
function setPostersGlobal(p: Record<number, string | null>) { posterState.current = p; }

const backdropState: { current: Record<number, string | null> } = { current: {} };
function backdropsGlobal() { return backdropState.current; }
function setBackdropsGlobal(p: Record<number, string | null>) { backdropState.current = p; }
