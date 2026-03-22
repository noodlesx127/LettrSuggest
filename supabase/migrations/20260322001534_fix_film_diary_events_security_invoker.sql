-- Fix: Recreate film_diary_events (and its dependent enriched view) as SECURITY INVOKER.
-- The SECURITY DEFINER property caused the view to execute as its owner (bypassing RLS),
-- potentially exposing any user's diary data. SECURITY INVOKER enforces the querying
-- user's RLS policies on the underlying film_events and film_tmdb_map tables.

-- Drop dependent view first, then base view
DROP VIEW IF EXISTS public.film_diary_events_enriched;
DROP VIEW IF EXISTS public.film_diary_events;

-- Recreate base view with SECURITY INVOKER (explicit, not default, to be unambiguous)
CREATE VIEW public.film_diary_events
WITH (security_invoker = true)
AS
  SELECT
    fe.user_id,
    ftm.tmdb_id,
    CASE
      WHEN fe.last_date ~ '^\d{4}-\d{2}-\d{2}$' THEN fe.last_date::date
      ELSE NULL::date
    END AS watched_at,
    fe.rating
  FROM film_events fe
  JOIN film_tmdb_map ftm ON ftm.user_id = fe.user_id AND ftm.uri = fe.uri;

-- Recreate the enriched dependent view
CREATE VIEW public.film_diary_events_enriched
WITH (security_invoker = true)
AS
  SELECT user_id, tmdb_id, watched_at, rating
  FROM film_diary_events;

NOTIFY pgrst, 'reload schema';
