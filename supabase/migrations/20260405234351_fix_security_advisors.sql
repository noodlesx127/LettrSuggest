/*
  Migration 2: Security Fixes

  Part A: Fix mutable search_path on 7 functions by explicitly setting
          `search_path = ''` and schema-qualifying references where required.

  Part B: Fix always-true RLS policies by restricting shared cache/utility
          table write access to `service_role` only (idempotent policy drops).
*/

-- ============ PART A ============
-- Fix Mutable Search Path on Functions (7 functions)

CREATE OR REPLACE FUNCTION public.add_liked_suggestion(
  p_user_id uuid,
  p_tmdb_id integer,
  p_title text,
  p_year integer,
  p_poster_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing_id uuid;
  v_result jsonb;
BEGIN
  SELECT id INTO v_existing_id
  FROM public.saved_suggestions
  WHERE user_id = p_user_id AND tmdb_id = p_tmdb_id;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('already_exists', true, 'id', v_existing_id);
  END IF;

  INSERT INTO public.saved_suggestions (user_id, tmdb_id, title, year, poster_path, order_index)
  SELECT p_user_id, p_tmdb_id, p_title, p_year, p_poster_path,
         COALESCE((SELECT MAX(order_index) FROM public.saved_suggestions WHERE user_id = p_user_id), -1) + 1
  RETURNING to_jsonb(saved_suggestions.*) INTO v_result;

  RETURN v_result || '{"already_exists": false}'::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION public.match_movie_embeddings(
  query_embedding public.vector(1536),
  match_count integer
)
RETURNS TABLE (tmdb_id integer, similarity float)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    public.movie_embeddings.tmdb_id,
    1 - (public.movie_embeddings.embedding OPERATOR(public.<=>) query_embedding) AS similarity
  FROM public.movie_embeddings
  ORDER BY public.movie_embeddings.embedding OPERATOR(public.<=>) query_embedding
  LIMIT match_count;
$$;

CREATE OR REPLACE FUNCTION public.extract_tmdb_keyword_names(movie jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH names AS (
    SELECT jsonb_array_elements_text(
             COALESCE(jsonb_path_query_array(movie, '$.keywords.keywords[*].name'), '[]'::jsonb)
           ) AS name
    UNION ALL
    SELECT jsonb_array_elements_text(
             COALESCE(jsonb_path_query_array(movie, '$.keywords.results[*].name'), '[]'::jsonb)
           ) AS name
  )
  SELECT COALESCE(
    array_agg(DISTINCT lower(name)) FILTER (WHERE name IS NOT NULL AND name <> ''),
    '{}'::text[]
  )
  FROM names;
$$;

CREATE OR REPLACE FUNCTION public.get_film_stats(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'total_films', COUNT(*),
    'total_rated', COUNT(rating),
    'avg_rating', ROUND(COALESCE(AVG(rating), 0)::numeric, 2),
    'total_liked', COUNT(*) FILTER (WHERE liked = true),
    'on_watchlist', COUNT(*) FILTER (WHERE on_watchlist = true)
  )
  FROM public.film_events
  WHERE user_id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_tastedive_cache()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.tastedive_cache
  WHERE cached_at < NOW() - INTERVAL '7 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_watchmode_cache()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.watchmode_cache
  WHERE cached_at < NOW() - INTERVAL '24 hours';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_rate_limit(
  p_key_id uuid,
  p_window_start timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.api_rate_limits (key_id, window_start, request_count)
  VALUES (p_key_id, p_window_start, 1)
  ON CONFLICT (key_id, window_start)
  DO UPDATE SET request_count = public.api_rate_limits.request_count + 1;
END;
$$;

-- ============ PART B ============
-- Fix Always-True RLS Policies

DROP POLICY IF EXISTS "Service role full access rate limits" ON public.api_rate_limits;
-- Pre-drop new name for idempotency
DROP POLICY IF EXISTS "api_rate_limits_service_role" ON public.api_rate_limits;

CREATE POLICY "api_rate_limits_service_role" ON public.api_rate_limits
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "tmdb_movies_authenticated_update" ON public.tmdb_movies;
DROP POLICY IF EXISTS "tmdb_movies_authenticated_upsert" ON public.tmdb_movies;
-- Pre-drop new names for idempotency
DROP POLICY IF EXISTS "tmdb_movies_service_update" ON public.tmdb_movies;
DROP POLICY IF EXISTS "tmdb_movies_service_upsert" ON public.tmdb_movies;

CREATE POLICY "tmdb_movies_service_update" ON public.tmdb_movies
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "tmdb_movies_service_upsert" ON public.tmdb_movies
  FOR INSERT TO service_role WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated insert on tmdb_similar_cache" ON public.tmdb_similar_cache;
DROP POLICY IF EXISTS "Allow authenticated update on tmdb_similar_cache" ON public.tmdb_similar_cache;
-- Pre-drop new names for idempotency
DROP POLICY IF EXISTS "tmdb_similar_cache_service_insert" ON public.tmdb_similar_cache;
DROP POLICY IF EXISTS "tmdb_similar_cache_service_update" ON public.tmdb_similar_cache;

CREATE POLICY "tmdb_similar_cache_service_insert" ON public.tmdb_similar_cache
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "tmdb_similar_cache_service_update" ON public.tmdb_similar_cache
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

-- Drop old duplicate policy set (verified from live DB)
DROP POLICY IF EXISTS "Allow public read access on tmdb_trending" ON public.tmdb_trending;
DROP POLICY IF EXISTS "Allow authenticated insert on tmdb_trending" ON public.tmdb_trending;
DROP POLICY IF EXISTS "Allow authenticated update on tmdb_trending" ON public.tmdb_trending;
-- Drop any other plausible old names defensively
DROP POLICY IF EXISTS "Allow authenticated read access on tmdb_trending" ON public.tmdb_trending;
DROP POLICY IF EXISTS "Allow authenticated delete on tmdb_trending" ON public.tmdb_trending;
DROP POLICY IF EXISTS "Allow authenticated delete access on tmdb_trending" ON public.tmdb_trending;

-- Drop new write policies (live: authenticated, will be replaced with service_role)
DROP POLICY IF EXISTS "tmdb_trending_authenticated_upsert" ON public.tmdb_trending;
DROP POLICY IF EXISTS "tmdb_trending_authenticated_update" ON public.tmdb_trending;
DROP POLICY IF EXISTS "tmdb_trending_authenticated_delete" ON public.tmdb_trending;
-- Pre-drop new service_role names for idempotency
DROP POLICY IF EXISTS "tmdb_trending_service_insert" ON public.tmdb_trending;
DROP POLICY IF EXISTS "tmdb_trending_service_update" ON public.tmdb_trending;
DROP POLICY IF EXISTS "tmdb_trending_service_delete" ON public.tmdb_trending;

-- Keep: "tmdb_trending_authenticated_read" (SELECT USING (true) — public read, fine as-is)
-- Create service_role-only write policies
CREATE POLICY "tmdb_trending_service_insert" ON public.tmdb_trending
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "tmdb_trending_service_update" ON public.tmdb_trending
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "tmdb_trending_service_delete" ON public.tmdb_trending
  FOR DELETE TO service_role USING (true);

DROP POLICY IF EXISTS "Allow authenticated insert on trakt_related_cache" ON public.trakt_related_cache;
DROP POLICY IF EXISTS "Allow authenticated update on trakt_related_cache" ON public.trakt_related_cache;
-- Pre-drop new names for idempotency
DROP POLICY IF EXISTS "trakt_related_cache_service_insert" ON public.trakt_related_cache;
DROP POLICY IF EXISTS "trakt_related_cache_service_update" ON public.trakt_related_cache;

CREATE POLICY "trakt_related_cache_service_insert" ON public.trakt_related_cache
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "trakt_related_cache_service_update" ON public.trakt_related_cache
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated insert on tuimdb_uid_cache" ON public.tuimdb_uid_cache;
DROP POLICY IF EXISTS "Allow authenticated update on tuimdb_uid_cache" ON public.tuimdb_uid_cache;
-- Pre-drop new names for idempotency
DROP POLICY IF EXISTS "tuimdb_uid_cache_service_insert" ON public.tuimdb_uid_cache;
DROP POLICY IF EXISTS "tuimdb_uid_cache_service_update" ON public.tuimdb_uid_cache;

CREATE POLICY "tuimdb_uid_cache_service_insert" ON public.tuimdb_uid_cache
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "tuimdb_uid_cache_service_update" ON public.tuimdb_uid_cache
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);
