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
      const uris = sourceFilms.map((f) => f.uri);
      const mappings = await getFilmMappings(uid, uris);
      // Candidates: try watchlist mapped films not yet liked/rated high
      const candidateIds = sourceFilms
        .filter((f) => f.onWatchlist && mappings.get(f.uri))
        .map((f) => mappings.get(f.uri)!) as number[];
      // Fallback: if no watchlist candidates, pick first 100 mappings
      const allMappedIds = uris.map((u) => mappings.get(u)).filter(Boolean) as number[];
      const candidates = candidateIds.length ? candidateIds.slice(0, 200) : allMappedIds.slice(0, 200);
      const lite = sourceFilms.map((f) => ({ uri: f.uri, title: f.title, year: f.year, rating: f.rating, liked: f.liked }));
      const suggestions = await suggestByOverlap({ userId: uid, films: lite, mappings, candidates });
      // materialize titles/years for display
      const details = await Promise.all(
        suggestions.slice(0, 20).map(async (s) => {
          const m = await fetchTmdbMovie(s.tmdbId).catch(() => null);
          return { id: s.tmdbId, title: (m?.title ?? `#${s.tmdbId}`), year: m?.release_date?.slice(0, 4), reasons: s.reasons };
        })
      );
      setItems(details.filter(Boolean) as any);
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

  return (
    <AuthGate>
      <h1 className="text-xl font-semibold mb-4">Suggestions</h1>
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
