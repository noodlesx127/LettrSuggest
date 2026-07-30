-- Fix 2: Require authenticated role for cache table reads (no anon/public reads).
-- We implement this by dropping the permissive public SELECT policies and replacing with authenticated-only.

-- tastedive_cache
alter table public.tastedive_cache enable row level security;
drop policy if exists "Allow public read access to TasteDive cache" on public.tastedive_cache;
create policy "Allow authenticated read access to TasteDive cache"
  on public.tastedive_cache
  for select
  to authenticated
  using (true);

-- tmdb_similar_cache
alter table public.tmdb_similar_cache enable row level security;
drop policy if exists "Allow public read access on tmdb_similar_cache" on public.tmdb_similar_cache;
create policy "Allow authenticated read access on tmdb_similar_cache"
  on public.tmdb_similar_cache
  for select
  to authenticated
  using (true);

-- trakt_related_cache
alter table public.trakt_related_cache enable row level security;
drop policy if exists "Allow public read access on trakt_related_cache" on public.trakt_related_cache;
create policy "Allow authenticated read access on trakt_related_cache"
  on public.trakt_related_cache
  for select
  to authenticated
  using (true);

-- tuimdb_uid_cache
alter table public.tuimdb_uid_cache enable row level security;
drop policy if exists "Allow public read access on tuimdb_uid_cache" on public.tuimdb_uid_cache;
create policy "Allow authenticated read access on tuimdb_uid_cache"
  on public.tuimdb_uid_cache
  for select
  to authenticated
  using (true);

-- watchmode_cache
alter table public.watchmode_cache enable row level security;
drop policy if exists "Allow public read access to Watchmode cache" on public.watchmode_cache;
create policy "Allow authenticated read access to Watchmode cache"
  on public.watchmode_cache
  for select
  to authenticated
  using (true);

-- tmdb_trending (currently has policy name suggesting authenticated but roles are public)
alter table public.tmdb_trending enable row level security;
drop policy if exists tmdb_trending_authenticated_read on public.tmdb_trending;
create policy tmdb_trending_authenticated_read
  on public.tmdb_trending
  for select
  to authenticated
  using (true);

-- Notify PostgREST to reload schema
notify pgrst, 'reload schema';
