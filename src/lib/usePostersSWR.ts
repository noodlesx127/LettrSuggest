'use client';
import useSWR from 'swr';
import { supabase } from '@/lib/supabaseClient';

async function fetchPosters(ids: number[]): Promise<{ posters: Record<number, string | null>; backdrops: Record<number, string | null> }> {
  if (!supabase || !ids.length) return { posters: {}, backdrops: {} };
  const chunkSize = 500;
  const posters: Record<number, string | null> = {};
  const backdrops: Record<number, string | null> = {};
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('tmdb_movies')
      .select('tmdb_id, data')
      .in('tmdb_id', chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      const id = Number(row.tmdb_id);
      posters[id] = row?.data?.poster_path ?? null;
      backdrops[id] = row?.data?.backdrop_path ?? null;
    }
  }
  return { posters, backdrops };
}

export function usePostersSWR(ids: number[]) {
  const key = ids.length ? ['tmdb-posters', ...ids] : null;
  const { data, isLoading, mutate, error } = useSWR(key, () => fetchPosters(ids));
  return { posters: data?.posters ?? {}, backdrops: data?.backdrops ?? {}, loading: isLoading, mutate, error };
}
