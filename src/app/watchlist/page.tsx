'use client';
import { useEffect, useMemo, useState } from 'react';
import AuthGate from '@/components/AuthGate';
import { supabase } from '@/lib/supabaseClient';
import { useImportData } from '@/lib/importStore';
import { getFilmMappings } from '@/lib/enrich';
import Image from 'next/image';
import { usePostersSWR } from '@/lib/usePostersSWR';
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

export default function WatchlistPage() {
  const { films, loading: loadingFilms } = useImportData();
  const uid = useUserId();
  const [mappings, setMappings] = useState<Map<string, number>>(new Map());
  const [loadingMappings, setLoadingMappings] = useState(false);
  const [trailerKeys, setTrailerKeys] = useState<Map<number, string>>(new Map());

  // Filter to only watchlist films
  const watchlistFilms = useMemo(() => {
    if (!films) return [];
    return films.filter(f => f.onWatchlist);
  }, [films]);

  useEffect(() => {
    if (!uid || !watchlistFilms || watchlistFilms.length === 0) return;
    const load = async () => {
      setLoadingMappings(true);
      try {
        const m = await getFilmMappings(uid, watchlistFilms.map((f) => f.uri));
        setMappings(m);
      } catch (e: any) {
        console.error('[Watchlist] error loading mappings', e);
      } finally {
        setLoadingMappings(false);
      }
    };
    void load();
  }, [uid, watchlistFilms]);

  const mappedIds = useMemo(() => Array.from(new Set(Array.from(mappings.values()))), [mappings]);

  // Fetch trailer data for mapped films
  useEffect(() => {
    if (mappedIds.length === 0) return;
    const fetchTrailers = async () => {
      try {
        const trailerMap = new Map<number, string>();
        await Promise.all(
          mappedIds.slice(0, 50).map(async (tmdbId) => {
            try {
              // Try TuiMDB first, fallback to TMDB
            let data = null;
            try {
                const tuiResponse = await fetch(`/api/tuimdb/movie?uid=${tmdbId}&_t=${Date.now()}`);
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
    if (!watchlistFilms) return [];
    return watchlistFilms.map((f) => ({ ...f, tmdbId: mappings.get(f.uri) }));
  }, [watchlistFilms, mappings]);

  const unmappedCount = gridFilms.filter(f => !f.tmdbId).length;

  return (
    <AuthGate>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Watchlist</h1>
        {(loadingFilms || loadingMappings) && (
          <span className="text-sm text-gray-600">
            {loadingFilms ? 'Loading films…' : 'Loading mappings…'}
          </span>
        )}
      </div>
      <p className="text-sm text-gray-700 mb-4">
        Films you want to watch. These are not used for suggestions but you can browse them here.
      </p>
      {unmappedCount > 0 && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
          <p className="text-sm text-yellow-800">
            <strong>{unmappedCount} of {gridFilms.length} watchlist films</strong> don&apos;t have poster images yet. 
            Re-import your data to map them to TMDB and see their posters.
          </p>
        </div>
      )}
      {loadingFilms && <p className="text-sm text-gray-600">Loading your watchlist from database…</p>}
      {!loadingFilms && gridFilms.length === 0 && (
        <p className="text-sm text-gray-600">No films in your watchlist yet.</p>
      )}
      <MovieGrid films={gridFilms} mappedIds={mappedIds} trailerKeys={trailerKeys} />
    </AuthGate>
  );
}

function MovieGrid({ films, mappedIds, trailerKeys }: { films: GridFilm[]; mappedIds: number[]; trailerKeys: Map<number, string> }) {
  const { posters, backdrops, loading } = usePostersSWR(mappedIds);
  if (!films.length) return null;
  
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
      {films.map((f) => (
        <MovieCard key={f.uri} film={f} posters={posters} backdrops={backdrops} trailerKey={f.tmdbId ? trailerKeys.get(f.tmdbId) : undefined} loading={loading} />
      ))}
    </div>
  );
}

function MovieCard({ film, posters, backdrops, trailerKey, loading }: { film: GridFilm; posters: Record<number, string | null>; backdrops: Record<number, string | null>; trailerKey?: string; loading: boolean }) {
  const mapped = film.tmdbId != null;
  const posterPath = mapped && film.tmdbId ? (posters[film.tmdbId] ?? null) : null;
  const backdropPath = mapped && film.tmdbId ? (backdrops[film.tmdbId] ?? null) : null;
  const [imgError, setImgError] = useState(false);
  const [showVideo, setShowVideo] = useState(false);

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
        {/* Hover overlay with backdrop */}
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
            <p className="text-[10px] text-gray-200">{film.year || '—'}</p>
          </div>
        </div>
      </div>
      <div className="p-2">
        <p className="text-xs font-medium leading-tight truncate" title={film.title}>{film.title || film.uri}</p>
        <p className="text-[10px] text-gray-500">{film.year || '—'}</p>
        <p className="text-[10px] mt-1 text-blue-700">
          On Watchlist
        </p>
      </div>
    </div>
  );
}
