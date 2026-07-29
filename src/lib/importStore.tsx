'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { FilmEvent } from '@/lib/normalize';
import {
  clearLocalFilms,
  createImportStateController,
  runForImportIdentity,
  saveLocalFilms,
  type ImportIdentity,
} from '@/lib/importStorage';
import { supabase } from './supabaseClient';

type ImportState = {
  films: FilmEvent[] | null;
  setFilms: (films: FilmEvent[] | null) => void;
  setFilmsForIdentity: (userId: string, films: FilmEvent[] | null) => void;
  clear: () => void;
  loading: boolean;
};

const ImportContext = createContext<ImportState | null>(null);

async function loadCloudFilms(userId: string): Promise<FilmEvent[]> {
  if (!supabase) throw new Error('Supabase not initialized');

  // Supabase/PostgREST commonly defaults to a max of 1000 rows per request.
  const pageSize = 250;
  let from = 0;
  const allRows: Array<Record<string, unknown>> = [];

  while (true) {
    const { data, error } = await supabase
      .from('film_events')
      .select('*')
      .eq('user_id', userId)
      .order('uri', { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      console.error('[ImportStore] Supabase error', {
        message: error.message,
        code: error.code,
        hint: error.hint,
        details: error.details,
        pageSize,
        from,
      });
      throw error;
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    allRows.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return allRows.map((row) => ({
    uri: String(row.uri),
    title: String(row.title ?? ''),
    year: row.year == null ? null : Number(row.year),
    rating: row.rating == null ? undefined : Number(row.rating),
    rewatch: row.rewatch === true,
    lastDate: row.last_date == null ? undefined : String(row.last_date),
    watchCount:
      row.watch_count == null ? undefined : Number(row.watch_count),
    liked: row.liked === true,
    onWatchlist: row.on_watchlist === true,
    watchlistAddedAt:
      row.watchlist_added_at == null
        ? undefined
        : String(row.watchlist_added_at),
  }));
}

export function ImportDataProvider({ children }: { children: ReactNode }) {
  const [films, setFilmsState] = useState<FilmEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const identityRef = useRef<ImportIdentity | undefined>(undefined);
  const controllerRef = useRef<ReturnType<typeof createImportStateController> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let disposed = false;
    const controller = createImportStateController({
      loadCloud: loadCloudFilms,
      onStateChange: (update) => {
        if (disposed) return;
        identityRef.current = update.identity;
        setFilmsState(update.films);
        setLoading(update.loading);
      },
    });
    controllerRef.current = controller;

    const loadForIdentity = (nextIdentity: ImportIdentity) => {
      if (disposed) return;
      void controller.transition(nextIdentity);
    };

    let subscription: { unsubscribe: () => void } | undefined;
    if (supabase) {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        loadForIdentity(session?.user?.id ?? null);
      });
      subscription = data.subscription;

      void supabase.auth
        .getSession()
        .then(({ data: sessionData, error }) => {
          if (disposed || controller.getIdentity() !== undefined) return;
          if (error) {
            console.error('[ImportStore] Failed to determine auth state', error);
            identityRef.current = null;
            setFilmsState(null);
            setLoading(false);
            return;
          }
          loadForIdentity(sessionData.session?.user?.id ?? null);
        })
        .catch((error: unknown) => {
          if (disposed || controller.getIdentity() !== undefined) return;
          console.error('[ImportStore] Failed to determine auth state', error);
          identityRef.current = null;
          setFilmsState(null);
          setLoading(false);
        });
    } else {
      loadForIdentity(null);
    }

    return () => {
      disposed = true;
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
      subscription?.unsubscribe();
      identityRef.current = undefined;
    };
  }, []);

  const setFilms = (next: FilmEvent[] | null) => {
    const identity = identityRef.current;
    if (identity === undefined) {
      setFilmsState(next);
      return;
    }
    const controller = controllerRef.current;
    if (controller) {
      controller.apply(identity, next);
      return;
    }
    setFilmsState(next);
    if (next) saveLocalFilms(identity, next);
    else clearLocalFilms(identity);
  };

  const clear = () => setFilms(null);

  const setFilmsForIdentity = (userId: string, next: FilmEvent[] | null) => {
    const controller = controllerRef.current;
    if (controller) {
      controller.apply(userId, next);
      return;
    }
    runForImportIdentity(userId, identityRef.current, () => {
      setFilmsState(next);
      if (next) saveLocalFilms(userId, next);
      else clearLocalFilms(userId);
    });
  };

  return (
    <ImportContext.Provider value={{ films, setFilms, setFilmsForIdentity, clear, loading }}>{children}</ImportContext.Provider>
  );
}

export function useImportData() {
  const ctx = useContext(ImportContext);
  if (!ctx) throw new Error('useImportData must be used within ImportDataProvider');
  return ctx;
}

