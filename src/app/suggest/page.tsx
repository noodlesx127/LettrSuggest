'use client';
import AuthGate from '@/components/AuthGate';
import { useEffect, useMemo, useState } from 'react';
import { useImportData } from '@/lib/importStore';
import { supabase } from '@/lib/supabaseClient';
import { getFilmMappings, suggestByOverlap, fetchTmdbMovie } from '@/lib/enrich';
import type { FilmEvent } from '@/lib/normalize';

export default function SuggestPage() {
  const { films } = useImportData();
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Array<{ id: number; title: string; year?: string; reasons: string[] }> | null>(null);
  const [fallbackFilms, setFallbackFilms] = useState<FilmEvent[] | null>(null);
  const [excludeGenres, setExcludeGenres] = useState<string>('');
  const [yearMin, setYearMin] = useState<string>('');
  const [yearMax, setYearMax] = useState<string>('');
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const init = async () => {
      if (!supabase) return;
      const { data } = await supabase.auth.getSession();
      setUid(data.session?.user?.id ?? null);
    };
    void init();
  }, []);

  const sourceFilms = useMemo(() => (films && films.length ? films : (fallbackFilms ?? [])), [films, fallbackFilms]);

  const runSuggest = async () => {
    try {
      setError(null);
      setLoading(true);
      if (!supabase) throw new Error('Supabase not initialized');
      if (!uid) throw new Error('Not signed in');
      // Apply quick filters to source films
      const gExclude = new Set(
        excludeGenres
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      );
      const yMin = Number(yearMin) || undefined;
      const yMax = Number(yearMax) || undefined;
      const filteredFilms = sourceFilms.filter((f) => {
        if (yMin && f.year != null && f.year < yMin) return false;
        if (yMax && f.year != null && f.year > yMax) return false;
        return true; // genre filter will apply on candidates via overlap features
      });
      const uris = filteredFilms.map((f) => f.uri);
      const mappings = await getFilmMappings(uid, uris);
      // Candidates: try watchlist mapped films not yet liked/rated high
      const candidateIds = filteredFilms
        .filter((f) => f.onWatchlist && mappings.get(f.uri))
        .map((f) => mappings.get(f.uri)!) as number[];
      // Fallback: if no watchlist candidates, pick first 100 mappings
      const allMappedIds = uris.map((u) => mappings.get(u)).filter(Boolean) as number[];
      const candidates = candidateIds.length ? candidateIds.slice(0, 200) : allMappedIds.slice(0, 200);
      const lite = filteredFilms.map((f) => ({ uri: f.uri, title: f.title, year: f.year, rating: f.rating, liked: f.liked }));
      const suggestions = await suggestByOverlap({
        userId: uid,
        films: lite,
        mappings,
        candidates,
        excludeGenres: gExclude.size ? gExclude : undefined,
        maxCandidates: 120,
        concurrency: 8,
      });
      const details = suggestions.map((s) => ({ id: s.tmdbId, title: s.title ?? `#${s.tmdbId}`, year: s.release_date?.slice(0, 4), reasons: s.reasons }));
      setItems(details);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to get suggestions');
    } finally {
      setLoading(false);
    }
  };

  // Fallback: if no local films, load from Supabase once
  useEffect(() => {
    const maybeLoad = async () => {
      try {
        if (!supabase || !uid) return;
        if (films && films.length) return;
        const { data, error } = await supabase
          .from('film_events')
          .select('uri,title,year,rating,rewatch,last_date,liked,on_watchlist')
          .eq('user_id', uid)
          .limit(5000);
        if (error) throw error;
        if (data && data.length) {
          const mapped = data.map((r) => ({
            uri: r.uri,
            title: r.title,
            year: r.year ?? null,
            rating: r.rating ?? undefined,
            rewatch: r.rewatch ?? undefined,
            lastDate: r.last_date ?? undefined,
            liked: r.liked ?? undefined,
            onWatchlist: r.on_watchlist ?? undefined,
          })) as FilmEvent[];
          setFallbackFilms(mapped);
        }
      } catch (e) {
        // swallow for now; suggestions can still run with 0 films
      }
    };
    void maybeLoad();
  }, [uid, films]);

  // Auto-run suggestions when we have user and films
  useEffect(() => {
    if (!uid) return;
    if (sourceFilms.length === 0) return;
    if (loading) return;
    if (items !== null) return;
    void runSuggest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, sourceFilms.length]);

  // Recompute when mapping updates are emitted
  useEffect(() => {
    const handler = () => {
      setItems(null);
      void runSuggest();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('lettr:mappings-updated', handler);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('lettr:mappings-updated', handler);
      }
    };
  }, [runSuggest]);

  return (
    <AuthGate>
      <h1 className="text-xl font-semibold mb-4">Suggestions</h1>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-600">Exclude genres (comma)</label>
          <input
            value={excludeGenres}
            onChange={(e) => setExcludeGenres(e.target.value)}
            placeholder="e.g., horror, musical"
            className="border rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600">Year min</label>
          <input value={yearMin} onChange={(e) => setYearMin(e.target.value)} placeholder="e.g., 1990" className="border rounded px-2 py-1 text-sm w-24" />
        </div>
        <div>
          <label className="block text-xs text-gray-600">Year max</label>
          <input value={yearMax} onChange={(e) => setYearMax(e.target.value)} placeholder="e.g., 2025" className="border rounded px-2 py-1 text-sm w-24" />
        </div>
        <button
          className="ml-auto px-2 py-2 rounded border text-sm hover:bg-gray-50"
          title="Recompute"
          onClick={() => { setItems(null); setRefreshTick((x) => x + 1); void runSuggest(); }}
        >
          🔄 Refresh
        </button>
      </div>
      {loading && <p className="text-sm text-gray-600">Computing your recommendations…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {items && (
        <ul className="space-y-3">
          {items.map((it) => (
            <li key={it.id} className="border bg-white rounded p-3">
              <div className="font-medium">{it.title} {it.year ? `(${it.year})` : ''}</div>
              {it.reasons.length > 0 && (
                <ul className="list-disc ml-5 text-sm text-gray-700 mt-1">
                  {it.reasons.slice(0, 3).map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {!items && (
        <p className="text-gray-700">Your personalized recommendations will appear here.</p>
      )}
    </AuthGate>
  );
}
