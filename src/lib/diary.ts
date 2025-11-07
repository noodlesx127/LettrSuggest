import { supabase } from '@/lib/supabaseClient';

type DiaryRow = {
  user_id: string;
  uri: string;
  watched_date: string | null;
  rating: number | null;
  rewatch: boolean | null;
};

export async function upsertDiaryEvents(rows: DiaryRow[]) {
  if (!rows.length || !supabase) return;
  // Chunked upsert by unique index (user_id, uri, watched_date, rewatch) using insert with on conflict do nothing, then optional update
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase
      .from('film_diary_events')
      .upsert(chunk, {
        ignoreDuplicates: true,
        onConflict: 'user_id,uri,watched_date,rewatch',
      });
    if (error) throw error;
  }
}
