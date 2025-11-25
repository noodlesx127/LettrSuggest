'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { FilmEvent } from '@/lib/normalize';
import { supabase } from './supabaseClient';

type ImportState = {
  films: FilmEvent[] | null;
  setFilms: (films: FilmEvent[] | null) => void;
  clear: () => void;
  loading: boolean;
};

const ImportContext = createContext<ImportState | null>(null);
const LS_KEY = 'lettr-import-v1';

export function ImportDataProvider({ children }: { children: ReactNode }) {
  const [films, setFilmsState] = useState<FilmEvent[] | null>(null);
  const [loading, setLoading] = useState(true);

  // Load from Supabase on mount, with localStorage as fallback
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const loadFilms = async () => {
      console.log('[ImportStore] Loading films');
      setLoading(true);

      try {
        // First, try to load from Supabase
        if (supabase) {
          const { data: sessionData } = await supabase.auth.getSession();
          const uid = sessionData?.session?.user?.id;

          if (uid) {
            console.log('[ImportStore] Fetching from Supabase', { uid });
            const { data, error } = await supabase
              .from('film_events')
              .select('*')
              .eq('user_id', uid)
              .order('title', { ascending: true });

            if (!error && data && data.length > 0) {
              console.log('[ImportStore] Loaded from Supabase', { count: data.length });
              const mapped: FilmEvent[] = data.map(row => ({
                uri: row.uri,
                title: row.title,
                year: row.year,
                rating: row.rating ? Number(row.rating) : undefined,
                rewatch: row.rewatch ?? false,
                lastDate: row.last_date ?? undefined,
                watchCount: row.watch_count ?? undefined,
                liked: row.liked ?? false,
                onWatchlist: row.on_watchlist ?? false
              }));
              setFilmsState(mapped);
              // Cache to localStorage
              window.localStorage.setItem(LS_KEY, JSON.stringify(mapped));
              setLoading(false);
              return;
            }
          }
        }

        // Fallback to localStorage if Supabase fails or no data
        console.log('[ImportStore] Falling back to localStorage');
        const raw = window.localStorage.getItem(LS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as FilmEvent[];
          console.log('[ImportStore] Loaded from localStorage', { count: parsed.length });
          setFilmsState(parsed);
        }
      } catch (e) {
        console.error('[ImportStore] Error loading films', e);
        // Try localStorage as final fallback
        try {
          const raw = window.localStorage.getItem(LS_KEY);
          if (raw) {
            const parsed = JSON.parse(raw) as FilmEvent[];
            setFilmsState(parsed);
          }
        } catch { }
      } finally {
        setLoading(false);
      }
    };

    void loadFilms();
  }, []);

  // Effect to trigger adaptive learning updates when films are loaded
  useEffect(() => {
    if (!films || films.length === 0 || loading) return;

    const updateAdaptiveStats = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const uid = sessionData?.session?.user?.id;
        if (!uid) return;

        // We need top genres for exploration stats. 
        // Ideally we'd calculate them here or fetch them.
        // For now, let's do a quick calculation of top genres from the films locally 
        // or just pass an empty array and let the function handle it (it needs them though).
        // Since we don't have enriched data here easily, we might skip the topGenres arg 
        // and let the function fetch what it needs? 
        // Actually, let's import the adaptive learning functions and call them.
        // We'll need to dynamically import or just import at top.

        // Note: We are in a client component context here.
        // Let's import the functions at the top of the file.

        // To avoid blocking the UI, we run this without awaiting it in the main flow
        import('./adaptiveLearning').then(async ({ updateExplorationStats, updateGenreTransitions }) => {
          // We need to get top genres first to pass to updateExplorationStats
          // This is a bit circular. Let's fetch the profile or just calculate top genres from local films if possible.
          // But local films don't have genres.
          // Let's modify updateExplorationStats to fetch top genres internally if not provided?
          // Or just fetch the profile here.

          // For V1, let's just run the transitions update which doesn't need top genres input (it discovers them).
          await updateGenreTransitions(uid, films);

          // For exploration stats, we really need to know what "Exploratory" means (i.e. not top genre).
          // Let's try to fetch the user's top genres from a previous profile build if stored?
          // Or just skip exploration update here for now until we have a better place (like after profile build).
          // Actually, `enrich.ts` builds the profile. Maybe we should call this IN `enrich.ts`?

          // RE-EVALUATION: `importStore` is just raw data. `enrich.ts` -> `buildTasteProfile` is where we know the top genres!
          // It makes MUCH more sense to call `updateExplorationStats` inside `buildTasteProfile` or `suggestByOverlap` 
          // where we already have the profile!

          // However, the user asked to "ensure user data is correctly fed".
          // If I put it in `enrich.ts`, it will run whenever we generate suggestions, which is good!
          // But `updateGenreTransitions` can be run here as it only depends on the sequence of films.

          // Let's put `updateGenreTransitions` here.
        });

      } catch (e) {
        console.error('[ImportStore] Error triggering adaptive learning', e);
      }
    };

    // Debounce this slightly to avoid running on every tiny state change if any
    const timer = setTimeout(updateAdaptiveStats, 2000);
    return () => clearTimeout(timer);
  }, [films, loading]);

  const setFilms = (next: FilmEvent[] | null) => {
    setFilmsState(next);
    if (typeof window !== 'undefined') {
      if (next) window.localStorage.setItem(LS_KEY, JSON.stringify(next));
      else window.localStorage.removeItem(LS_KEY);
    }
  };

  const clear = () => setFilms(null);

  return (
    <ImportContext.Provider value={{ films, setFilms, clear, loading }}>{children}</ImportContext.Provider>
  );
}

export function useImportData() {
  const ctx = useContext(ImportContext);
  if (!ctx) throw new Error('useImportData must be used within ImportDataProvider');
  return ctx;
}

