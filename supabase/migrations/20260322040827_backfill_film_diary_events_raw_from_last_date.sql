-- =============================================================================
-- Migration: Backfill film_diary_events_raw from existing film_events.last_date
-- =============================================================================
-- Context:
--   After creating film_diary_events_raw, existing users who had already
--   imported their Letterboxd data had no rows in the new table because the
--   table did not exist when they imported (and the catch block was silent).
--
-- This migration backfills film_diary_events_raw for every film_events row
-- that has a valid last_date (YYYY-MM-DD format) but no existing diary entry.
-- It uses INSERT ... ON CONFLICT DO NOTHING to be safely re-runnable.
-- =============================================================================

INSERT INTO public.film_diary_events_raw (user_id, uri, watched_date, rating, rewatch)
SELECT
  fe.user_id,
  fe.uri,
  fe.last_date::date AS watched_date,
  fe.rating,
  COALESCE(fe.rewatch, false) AS rewatch
FROM public.film_events fe
WHERE
  fe.last_date IS NOT NULL
  AND fe.last_date ~ '^\d{4}-\d{2}-\d{2}$'
  AND NOT EXISTS (
    SELECT 1
    FROM public.film_diary_events_raw fdr
    WHERE fdr.user_id = fe.user_id
      AND fdr.uri     = fe.uri
  )
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';
