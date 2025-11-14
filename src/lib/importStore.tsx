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
        } catch {}
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

