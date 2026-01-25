-- Migration: Fix keyword query performance issues
-- Addresses 60+ production 500 errors (8-38 second timeouts) and 400 syntax errors
-- Replaces slow JSONB containment queries with fast GIN-indexed array containment

-- =============================================================================
-- 1) Function to extract all keyword names from TMDB data
-- =============================================================================
-- Extracts keywords from both data->keywords->keywords and data->keywords->results
-- TMDB API returns keywords in either path depending on endpoint used
-- Normalizes to lowercase for case-insensitive matching

create or replace function public.extract_tmdb_keyword_names(movie jsonb)
returns text[]
language sql
immutable
as $$
  with names as (
    select jsonb_array_elements_text(
             coalesce(jsonb_path_query_array(movie, '$.keywords.keywords[*].name'), '[]'::jsonb)
           ) as name
    union all
    select jsonb_array_elements_text(
             coalesce(jsonb_path_query_array(movie, '$.keywords.results[*].name'), '[]'::jsonb)
           ) as name
  )
  select coalesce(
    array_agg(distinct lower(name)) filter (where name is not null and name <> ''),
    '{}'::text[]
  )
  from names;
$$;

comment on function public.extract_tmdb_keyword_names(jsonb) is
'Extracts lowercase keyword names from both data->keywords->keywords and data->keywords->results arrays';


-- =============================================================================
-- 2) Add generated column for fast keyword search
-- =============================================================================
-- Stored generated column computes automatically for new/updated rows
-- Uses lowercase for case-insensitive matching
-- WARNING: On large tables, this causes a table rewrite (takes time + locks)

alter table public.tmdb_movies
  add column if not exists keyword_names text[]
  generated always as (public.extract_tmdb_keyword_names(data)) stored;

comment on column public.tmdb_movies.keyword_names is
'Lowercased keyword names from data->keywords->(keywords|results)[*].name for fast array containment search. Generated column.';


-- =============================================================================
-- 3) GIN index for array containment queries (@> operator)
-- =============================================================================
-- Primary index for new query pattern: WHERE keyword_names @> array['keyword']
-- Provides ~100x speedup over JSONB containment on nested arrays

create index if not exists tmdb_movies_keyword_names_gin
  on public.tmdb_movies
  using gin (keyword_names);


-- =============================================================================
-- 4) Backward-compatible JSONB indexes (for existing query patterns)
-- =============================================================================
-- Accelerate existing queries until all code is refactored to use keyword_names
-- Uses jsonb_path_ops for optimal @> containment performance
-- Can be dropped after all code migrated to keyword_names

create index if not exists tmdb_movies_keywords_keywords_gin
  on public.tmdb_movies
  using gin ((data->'keywords'->'keywords') jsonb_path_ops)
  where (data->'keywords'->'keywords') is not null;

create index if not exists tmdb_movies_keywords_results_gin
  on public.tmdb_movies
  using gin ((data->'keywords'->'results') jsonb_path_ops)
  where (data->'keywords'->'results') is not null;


-- =============================================================================
-- 5) Optional RPC for clean keyword search (avoids PostgREST filter syntax)
-- =============================================================================
-- Allows queries like: POST /rpc/search_tmdb_movies_by_keyword {"p_keyword":"murder"}
-- Cleaner than PostgREST or= filters, avoids special character escaping issues

create or replace function public.search_tmdb_movies_by_keyword(p_keyword text)
returns table (tmdb_id bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select tmdb_id
  from public.tmdb_movies
  where keyword_names @> array[lower(p_keyword)];
$$;

comment on function public.search_tmdb_movies_by_keyword(text) is
'Returns tmdb_ids whose keyword_names contains p_keyword (case-insensitive). Cleaner than PostgREST or= filters.';

grant execute on function public.search_tmdb_movies_by_keyword(text) to authenticated;


-- =============================================================================
-- 6) Update statistics and reload PostgREST schema
-- =============================================================================

analyze public.tmdb_movies;

notify pgrst, 'reload schema';
