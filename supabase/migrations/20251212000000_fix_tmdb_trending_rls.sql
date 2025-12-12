-- Fix RLS policies for tmdb_trending table
-- This table caches trending movie IDs and should be accessible by all authenticated users

-- Ensure RLS is enabled
alter table if exists public.tmdb_trending enable row level security;

-- Drop existing policies if any
drop policy if exists "tmdb_trending_public_read" on public.tmdb_trending;
drop policy if exists "tmdb_trending_authenticated_read" on public.tmdb_trending;
drop policy if exists "tmdb_trending_authenticated_upsert" on public.tmdb_trending;
drop policy if exists "tmdb_trending_authenticated_update" on public.tmdb_trending;

-- Allow all authenticated users to read trending data
create policy "tmdb_trending_authenticated_read" on public.tmdb_trending
  for select using (true);

-- Allow all authenticated users to insert trending data (for caching)
create policy "tmdb_trending_authenticated_upsert" on public.tmdb_trending
  for insert with check (true);

-- Allow updates (for refreshing cache)
create policy "tmdb_trending_authenticated_update" on public.tmdb_trending
  for update using (true) with check (true);

-- Allow deletes (for cache cleanup)
drop policy if exists "tmdb_trending_authenticated_delete" on public.tmdb_trending;
create policy "tmdb_trending_authenticated_delete" on public.tmdb_trending
  for delete using (true);
