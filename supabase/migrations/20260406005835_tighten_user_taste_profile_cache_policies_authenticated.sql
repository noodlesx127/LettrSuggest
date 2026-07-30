-- Tighten user_taste_profile_cache: replace public-scoped policies with authenticated.
-- Note: the USING clause is already user-scoped via auth.uid().

alter table public.user_taste_profile_cache enable row level security;

drop policy if exists taste_cache_select on public.user_taste_profile_cache;
drop policy if exists taste_cache_insert on public.user_taste_profile_cache;
drop policy if exists taste_cache_update on public.user_taste_profile_cache;
drop policy if exists taste_cache_delete on public.user_taste_profile_cache;

create policy taste_cache_select
  on public.user_taste_profile_cache
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy taste_cache_insert
  on public.user_taste_profile_cache
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy taste_cache_update
  on public.user_taste_profile_cache
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy taste_cache_delete
  on public.user_taste_profile_cache
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
