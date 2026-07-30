-- Fix 1: Move pgvector out of public schema.
-- Supabase security advisor: vector extension installed in public.
-- Postgres does not support ALTER EXTENSION ... SET SCHEMA, so we must DROP + CREATE.
-- The vector type is currently used by public.movie_embeddings and public.match_movie_embeddings.
-- This migration recreates those objects against extensions.vector.

create schema if not exists extensions;

-- Drop dependents that reference the public.vector type
drop function if exists public.match_movie_embeddings(vector, integer);
drop table if exists public.movie_embeddings;

-- Drop and recreate extension in extensions schema
-- (will also recreate vector type, operators, and related functions in extensions)
drop extension if exists vector;
create extension if not exists vector with schema extensions;

-- Recreate movie_embeddings using extensions.vector explicitly
create table if not exists public.movie_embeddings (
  tmdb_id integer primary key,
  embedding extensions.vector(1536),
  model_version text default 'text-embedding-ada-002',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on table public.movie_embeddings is
  'OpenAI embeddings for TMDB movies (ada-002, 1536d).';

-- Recreate ivfflat index (requires pgvector)
create index if not exists movie_embeddings_embedding_idx
  on public.movie_embeddings using ivfflat (embedding extensions.vector_cosine_ops);

-- Recreate match function; lock down search_path like other security-hardening migrations
create or replace function public.match_movie_embeddings(
  query_embedding extensions.vector,
  match_count integer
)
returns table (
  tmdb_id integer,
  similarity double precision
)
language sql
stable
set search_path to ''
as $function$
  select
    public.movie_embeddings.tmdb_id,
    1 - (public.movie_embeddings.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.movie_embeddings
  order by public.movie_embeddings.embedding operator(extensions.<=>) query_embedding
  limit match_count;
$function$;

-- RLS: keep existing posture (authenticated read)
alter table public.movie_embeddings enable row level security;

drop policy if exists "Authenticated users can read movie embeddings" on public.movie_embeddings;
create policy "Authenticated users can read movie embeddings"
  on public.movie_embeddings
  for select
  to authenticated
  using (true);

-- Notify PostgREST to reload schema
notify pgrst, 'reload schema';
