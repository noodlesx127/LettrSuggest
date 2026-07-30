-- Preserve the Letterboxd watchlist-add timestamp used for intent recency.
-- The column is nullable because older imports and non-watchlist films have no
-- timestamp. This migration is safe to rerun on environments with the column.
ALTER TABLE public.film_events
  ADD COLUMN IF NOT EXISTS watchlist_added_at timestamptz;

COMMENT ON COLUMN public.film_events.watchlist_added_at IS
  'Timestamp when Letterboxd added the film to the user watchlist, when supplied by the import.';

NOTIFY pgrst, 'reload schema';
