'use client';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabaseClient';

type PostersState = {
  posters: Record<number, string | null>;
  backdrops: Record<number, string | null>;
  loading: boolean;
  refresh: (ids: number[]) => Promise<void>;
};

const PostersContext = createContext<PostersState | null>(null);

export function PostersProvider({ children, ids }: { children: ReactNode; ids: number[] }) {
  const [posters, setPosters] = useState<Record<number, string | null>>({});
  const [backdrops, setBackdrops] = useState<Record<number, string | null>>({});
  const [loading, setLoading] = useState(false);

  const fetchChunked = async (tmdbIds: number[]) => {
    if (!tmdbIds.length || !supabase) return;
    const chunkSize = 500;
    const acc: Record<number, string | null> = {};
    const accBd: Record<number, string | null> = {};
    for (let i = 0; i < tmdbIds.length; i += chunkSize) {
      const chunk = tmdbIds.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from('tmdb_movies')
        .select('tmdb_id, data')
        .in('tmdb_id', chunk);
      if (error) throw error;
      for (const row of data ?? []) {
        const id = Number(row.tmdb_id);
        acc[id] = row?.data?.poster_path ?? null;
        accBd[id] = row?.data?.backdrop_path ?? null;
      }
    }
    setPosters((p) => ({ ...p, ...acc }));
    setBackdrops((b) => ({ ...b, ...accBd }));
  };

  useEffect(() => {
    const distinct = Array.from(new Set(ids.filter(Boolean)));
    if (!distinct.length) return;
    setLoading(true);
    fetchChunked(distinct).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(',')]);

  const value: PostersState = useMemo(() => ({ posters, backdrops, loading, refresh: fetchChunked }), [posters, backdrops, loading]);
  return <PostersContext.Provider value={value}>{children}</PostersContext.Provider>;
}

export function usePosters() {
  const ctx = useContext(PostersContext);
  if (!ctx) throw new Error('usePosters must be used within PostersProvider');
  return ctx;
}
