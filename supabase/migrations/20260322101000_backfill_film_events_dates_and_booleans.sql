-- Backfill legacy film_events rows created before import normalization fixes.
-- Replace null liked/on_watchlist flags with false (boolean) for correct API responses.
-- Note: last_date backfill is intentionally omitted because film_diary_events is a VIEW
-- derived from film_events.last_date itself; there is no independent diary table to backfill from.

UPDATE public.film_events
SET liked = false
WHERE liked IS NULL;

UPDATE public.film_events
SET on_watchlist = false
WHERE on_watchlist IS NULL;
