-- Create an enriched diary view that works with film_diary_events VIEW
-- NOTE: film_diary_events is a VIEW (from migration 20260125223141) that already
-- joins film_events + film_tmdb_map, so we can SELECT directly from it
-- Provides compatibility for taste profile system (user_id, tmdb_id, watched_at, rating)

drop view if exists public.film_diary_events_enriched;

create view public.film_diary_events_enriched
with (security_invoker = true)
as
select
  user_id,
  tmdb_id,
  watched_at,
  rating
from public.film_diary_events;

grant select on public.film_diary_events_enriched to authenticated;

notify pgrst, 'reload schema';
