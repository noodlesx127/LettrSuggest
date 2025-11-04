'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { FilmEvent } from '@/lib/normalize';

type ImportState = {
  films: FilmEvent[] | null;
  setFilms: (films: FilmEvent[] | null) => void;
  clear: () => void;
};

const ImportContext = createContext<ImportState | null>(null);
const LS_KEY = 'lettr-import-v1';

export function ImportDataProvider({ children }: { children: ReactNode }) {
  const [films, setFilmsState] = useState<FilmEvent[] | null>(null);

  // load from localStorage once
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as FilmEvent[];
        setFilmsState(parsed);
      }
    } catch (e) {
      // ignore malformed localStorage content
      console.debug('No valid import cache found');
    }
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
    <ImportContext.Provider value={{ films, setFilms, clear }}>{children}</ImportContext.Provider>
  );
}

export function useImportData() {
  const ctx = useContext(ImportContext);
  if (!ctx) throw new Error('useImportData must be used within ImportDataProvider');
  return ctx;
}
