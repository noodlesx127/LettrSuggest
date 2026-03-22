import { supabase } from '@/lib/supabaseClient';

type DiaryRow = {
  user_id: string;
  uri: string;
  watched_date: string | null;
  rating: number | null;
  rewatch: boolean;
};

/**
 * Upsert diary entries into the film_diary_events_raw table.
 * Each row represents one watch event (a film may have multiple entries).
 * The unique constraint (user_id, uri, watched_date, rewatch) prevents
 * duplicate imports. A trigger on the table automatically syncs
 * film_events.last_date to MAX(watched_date) per (user_id, uri).
 */
export async function upsertDiaryEvents(rows: DiaryRow[]) {
  if (!rows.length || !supabase) return;

  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase
      .from('film_diary_events_raw')
      .upsert(chunk, {
        ignoreDuplicates: true,
        onConflict: 'user_id,uri,watched_date,rewatch',
      });
    if (error) throw error;
  }
}
