-- Align remaining tables with "no anon reads" posture.
-- tmdb_movies: change read policy from public to authenticated.
-- film_tmdb_map: change user-scoped policies from public to authenticated.

-- tmdb_movies
alter table public.tmdb_movies enable row level security;
drop policy if exists tmdb_movies_authenticated_read on public.tmdb_movies;
create policy tmdb_movies_authenticated_read
  on public.tmdb_movies
  for select
  to authenticated
  using (true);

-- film_tmdb_map
alter table public.film_tmdb_map enable row level security;

drop policy if exists "film_tmdb_map user read" on public.film_tmdb_map;
drop policy if exists "film_tmdb_map user update" on public.film_tmdb_map;
drop policy if exists "film_tmdb_map user upsert" on public.film_tmdb_map;

create policy "film_tmdb_map user read"
  on public.film_tmdb_map
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "film_tmdb_map user update"
  on public.film_tmdb_map
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "film_tmdb_map user upsert"
  on public.film_tmdb_map
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
