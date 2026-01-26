-- Migration: Fix film_diary_events 404 and keyword query performance issues
-- Addresses three critical production errors found in logs

-- =============================================================================
-- 1) Missing film_diary_events view (fixes 404 errors)
-- =============================================================================
-- Creates a view that joins film_events to film_tmdb_map
-- Expected columns: user_id, tmdb_id, watched_at, rating

create or replace view public.film_diary_events as
select
  fe.user_id,
  ftm.tmdb_id,
  case
    when fe.last_date ~ '^\d{4}-\d{2}-\d{2}$' then fe.last_date::date
    else null
  end as watched_at,
  fe.rating
from public.film_events fe
join public.film_tmdb_map ftm
  on ftm.user_id = fe.user_id
 and ftm.uri = fe.uri;

comment on view public.film_diary_events is
'Diary-style view of film_events joined to film_tmdb_map (tmdb_id, watched_at, rating). Used by taste profile system.';


-- =============================================================================
-- 2) Fast keyword search infrastructure (fixes 500 timeouts + 400 syntax errors)
-- =============================================================================
-- Creates a normalized keyword_names column that's GIN-indexed for fast search
-- Replaces slow JSONB containment queries on data->keywords->keywords/results

-- Function to extract all keyword names from TMDB data
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

-- Add generated column (stored) for fast keyword search
alter table public.tmdb_movies
  add column if not exists keyword_names text[]
  generated always as (public.extract_tmdb_keyword_names(data)) stored;

comment on column public.tmdb_movies.keyword_names is
'Lowercased keyword names from data->keywords->(keywords|results)[*].name for fast array containment search';

-- GIN index for array containment queries (@> operator)
create index if not exists tmdb_movies_keyword_names_gin
  on public.tmdb_movies
  using gin (keyword_names);


-- =============================================================================
-- 3) Optional RPC for clean keyword search (avoids PostgREST filter syntax)
-- =============================================================================
-- Allows queries like: POST /rpc/search_tmdb_movies_by_keyword {"p_keyword":"murder"}
-- Instead of complex PostgREST filter syntax that breaks with special chars

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


-- =============================================================================
-- 4) Backward-compatible JSONB indexes (for existing query patterns)
-- =============================================================================
-- These accelerate existing queries until they're refactored to use keyword_names
-- Uses jsonb_path_ops for optimal @> containment performance

create index if not exists tmdb_movies_keywords_keywords_gin
  on public.tmdb_movies
  using gin ((data->'keywords'->'keywords') jsonb_path_ops)
  where (data->'keywords'->'keywords') is not null;

create index if not exists tmdb_movies_keywords_results_gin
  on public.tmdb_movies
  using gin ((data->'keywords'->'results') jsonb_path_ops)
  where (data->'keywords'->'results') is not null;


-- =============================================================================
-- 5) Update statistics and reload PostgREST schema
-- =============================================================================

analyze public.tmdb_movies;

notify pgrst, 'reload schema';;
