-- Create an enriched diary view without conflicting with the base table.
-- Provides compatibility columns used by the taste profile system.

drop view if exists public.film_diary_events_enriched;

create view public.film_diary_events_enriched
with (security_invoker = true)
as
select
  e.user_id,
  m.tmdb_id,
  e.watched_date as watched_at,
  e.rating
from public.film_diary_events e
left join public.film_tmdb_map m
  on m.user_id = e.user_id
 and m.uri = e.uri;

grant select on public.film_diary_events_enriched to authenticated;

notify pgrst, 'reload schema';
