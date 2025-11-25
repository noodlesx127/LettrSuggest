-- Migration: Add API response caching tables
-- Created: 2025-11-25
-- Purpose: Cache Trakt, TMDB, and TuiMDB API responses to reduce API calls

-- Cache for Trakt related movies
-- Stores the list of related movie IDs for each seed movie
create table if not exists public.trakt_related_cache (
  tmdb_id bigint primary key,
  related_ids jsonb not null, -- Array of TMDB IDs
  cached_at timestamp with time zone default now()
);

-- Index for cache invalidation queries
create index if not exists trakt_related_cache_cached_at_idx 
  on public.trakt_related_cache (cached_at);

comment on table public.trakt_related_cache is 
  'Cache for Trakt API related movies responses. TTL: 7 days';

-- Cache for TMDB similar and recommendations
-- Stores both similar and recommendation IDs for each movie
create table if not exists public.tmdb_similar_cache (
  tmdb_id bigint primary key,
  similar_ids jsonb not null, -- Array of similar movie TMDB IDs
  recommendations_ids jsonb not null, -- Array of recommendation TMDB IDs
  cached_at timestamp with time zone default now()
);

create index if not exists tmdb_similar_cache_cached_at_idx 
  on public.tmdb_similar_cache (cached_at);

comment on table public.tmdb_similar_cache is 
  'Cache for TMDB similar and recommendations API responses. TTL: 7 days';

-- Cache for TuiMDB UID lookups
-- Maps TMDB IDs to TuiMDB UIDs (null if not found in TuiMDB)
create table if not exists public.tuimdb_uid_cache (
  tmdb_id bigint primary key,
  tuimdb_uid bigint, -- NULL if movie not found in TuiMDB
  cached_at timestamp with time zone default now()
);

create index if not exists tuimdb_uid_cache_cached_at_idx 
  on public.tuimdb_uid_cache (cached_at);

comment on table public.tuimdb_uid_cache is 
  'Cache for TuiMDB UID lookups. TTL: 30 days. NULL tuimdb_uid means movie not found in TuiMDB.';

-- No RLS needed - these are shared caches for all users
-- Data is public movie information, not user-specific

-- Optional: Function to clean up expired cache entries
-- Run this periodically (e.g., daily cron job)
create or replace function public.cleanup_expired_cache()
returns void as $$
begin
  -- Clean up Trakt cache older than 7 days
  delete from public.trakt_related_cache
  where cached_at < now() - interval '7 days';
  
  -- Clean up TMDB similar cache older than 7 days
  delete from public.tmdb_similar_cache
  where cached_at < now() - interval '7 days';
  
  -- Clean up TuiMDB UID cache older than 30 days
  delete from public.tuimdb_uid_cache
  where cached_at < now() - interval '30 days';
end;
$$ language plpgsql;

comment on function public.cleanup_expired_cache is 
  'Removes expired cache entries. Run daily via cron or manually.';
