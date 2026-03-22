-- Recreate the enriched diary view with full film metadata.
-- This view must expose the same fields used by /api/v1/profile/diary while
-- still joining through film_tmdb_map for tmdb_id.

DROP VIEW IF EXISTS public.film_diary_events_enriched;

CREATE VIEW public.film_diary_events_enriched
WITH (security_invoker = true)
AS
  SELECT
    fe.user_id,
    ftm.tmdb_id,
    CASE
      WHEN fe.last_date ~ '^\d{4}-\d{2}-\d{2}$' THEN fe.last_date::date
      ELSE NULL::date
    END AS watched_at,
    fe.rating,
    fe.title,
    fe.year,
    fe.uri,
    fe.liked,
    fe.on_watchlist,
    fe.watch_count,
    fe.rewatch
  FROM public.film_events fe
  JOIN public.film_tmdb_map ftm
    ON ftm.user_id = fe.user_id
   AND ftm.uri = fe.uri;

GRANT SELECT ON public.film_diary_events_enriched TO authenticated;

NOTIFY pgrst, 'reload schema';
