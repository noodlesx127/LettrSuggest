-- Enable public read access to tmdb_movies table for caching
-- This table stores TMDB movie metadata that's shared across all users

-- First, ensure RLS is enabled
alter table if exists public.tmdb_movies enable row level security;

-- Drop existing policies if any
drop policy if exists "tmdb_movies_public_read" on public.tmdb_movies;
drop policy if exists "tmdb_movies_authenticated_read" on public.tmdb_movies;
drop policy if exists "tmdb_movies_authenticated_upsert" on public.tmdb_movies;

-- Allow all authenticated users to read cached movie data
create policy "tmdb_movies_authenticated_read" on public.tmdb_movies
  for select using (true); -- Allow all authenticated users to read

-- Allow all authenticated users to upsert cached movie data
create policy "tmdb_movies_authenticated_upsert" on public.tmdb_movies
  for insert with check (true); -- Allow all authenticated users to cache movies

-- Allow updates (for refreshing cache)
drop policy if exists "tmdb_movies_authenticated_update" on public.tmdb_movies;
create policy "tmdb_movies_authenticated_update" on public.tmdb_movies
  for update using (true) with check (true);

-- Create index for faster lookups
create index if not exists tmdb_movies_tmdb_id_idx on public.tmdb_movies (tmdb_id);
