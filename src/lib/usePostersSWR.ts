'use client';
import useSWR from 'swr';
import { supabase } from '@/lib/supabaseClient';

async function fetchPosters(ids: number[]): Promise<{ posters: Record<number, string | null>; backdrops: Record<number, string | null> }> {
  if (!supabase || !ids.length) {
    console.log('[usePostersSWR] Skip fetch', { hasSupabase: !!supabase, idsCount: ids.length });
    return { posters: {}, backdrops: {} };
  }
  console.log('[usePostersSWR] Fetching posters', { idsCount: ids.length });
  const chunkSize = 500;
  const posters: Record<number, string | null> = {};
  const backdrops: Record<number, string | null> = {};
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('tmdb_movies')
      .select('tmdb_id, data')
      .in('tmdb_id', chunk);
    if (error) {
      console.error('[usePostersSWR] Error fetching chunk', { chunkSize: chunk.length, error });
      throw error;
    }
    console.log('[usePostersSWR] Chunk fetched', { requested: chunk.length, received: data?.length || 0 });
    for (const row of data ?? []) {
      const id = Number(row.tmdb_id);
      posters[id] = row?.data?.poster_path ?? null;
      backdrops[id] = row?.data?.backdrop_path ?? null;
    }
  }
  console.log('[usePostersSWR] Fetch complete', { posterCount: Object.keys(posters).length });
  return { posters, backdrops };
}

export function usePostersSWR(ids: number[]) {
  const key = ids.length ? ['tmdb-posters', ...ids] : null;
  const { data, isLoading, mutate, error } = useSWR(key, () => fetchPosters(ids));
  return { posters: data?.posters ?? {}, backdrops: data?.backdrops ?? {}, loading: isLoading, mutate, error };
}
