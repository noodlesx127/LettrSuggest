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
  // IMPORTANT: Use whichever source has MORE data (more complete import)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const loadFilms = async () => {
      console.log('[ImportStore] Loading films');
      setLoading(true);

      try {
        // Load from localStorage first
        let localFilms: FilmEvent[] = [];
        try {
          const raw = window.localStorage.getItem(LS_KEY);
          if (raw) {
            localFilms = JSON.parse(raw) as FilmEvent[];
            console.log('[ImportStore] Found localStorage data', { count: localFilms.length });
          }
        } catch (e) {
          console.warn('[ImportStore] Failed to parse localStorage', e);
        }

        // Try to load from Supabase
        let supabaseFilms: FilmEvent[] = [];
        if (supabase) {
          const { data: sessionData } = await supabase.auth.getSession();
          const uid = sessionData?.session?.user?.id;

          if (uid) {
            console.log('[ImportStore] Fetching from Supabase', { uid });
            // IMPORTANT: Supabase/PostgREST commonly defaults to a max of 1000 rows per request.
            // Page through all rows so users with >1000 films get complete data.
            const pageSize = 1000;
            let from = 0;
            const allRows: any[] = [];
            let pagingError: any = null;

            while (true) {
              const { data, error } = await supabase
                .from('film_events')
                .select('*')
                .eq('user_id', uid)
                .order('title', { ascending: true })
                .range(from, from + pageSize - 1);

              if (error) {
                pagingError = error;
                break;
              }

              const rows = data ?? [];
              allRows.push(...rows);

              if (rows.length < pageSize) break;
              from += pageSize;
            }

            if (pagingError) {
              console.error('[ImportStore] Supabase error', { error: pagingError, pageSize, from });
            } else if (allRows.length > 0) {
              console.log('[ImportStore] Loaded from Supabase', { count: allRows.length });
              supabaseFilms = allRows.map(row => ({
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
            }
          }
        }

        // Use whichever source has MORE films (indicates more complete data)
        // This handles the case where enrichment was interrupted and localStorage has the full import
        if (localFilms.length > supabaseFilms.length) {
          console.log('[ImportStore] Using localStorage (more complete)', { 
            localStorage: localFilms.length, 
            supabase: supabaseFilms.length 
          });
          setFilmsState(localFilms);
        } else if (supabaseFilms.length > 0) {
          console.log('[ImportStore] Using Supabase', { 
            localStorage: localFilms.length, 
            supabase: supabaseFilms.length 
          });
          setFilmsState(supabaseFilms);
          // Update localStorage with Supabase data
          window.localStorage.setItem(LS_KEY, JSON.stringify(supabaseFilms));
        } else if (localFilms.length > 0) {
          console.log('[ImportStore] Using localStorage (only source)', { count: localFilms.length });
          setFilmsState(localFilms);
        } else {
          console.log('[ImportStore] No film data found in either source');
          setFilmsState(null);
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

