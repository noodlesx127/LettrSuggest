-- Enforce NOT NULL with DEFAULT false on film_events boolean columns.
-- The previous migration (20260322101000) already backfilled all NULL values to false.
-- This migration adds the constraints so future inserts cannot introduce NULLs.

ALTER TABLE public.film_events
  ALTER COLUMN liked SET DEFAULT false,
  ALTER COLUMN liked SET NOT NULL;

ALTER TABLE public.film_events
  ALTER COLUMN on_watchlist SET DEFAULT false,
  ALTER COLUMN on_watchlist SET NOT NULL;

NOTIFY pgrst, 'reload schema';
