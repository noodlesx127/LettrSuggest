# Supabase Performance & Security Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create two idempotent SQL migrations that resolve all Supabase advisor warnings (performance + security), eliminating the disk IO issues caused by per-row auth function evaluation and unindexed foreign keys.

**Architecture:** Two timestamped migration files applied via Supabase MCP. Migration 1 targets performance (RLS initplan, indexes, duplicate policies). Migration 2 targets security (function search_path, always-true RLS policies). Both are fully idempotent using DROP IF EXISTS / CREATE patterns — every new policy name is dropped before being created.

**Tech Stack:** PostgreSQL RLS, Supabase MCP (`Supabase_apply_migration`), plpgsql/SQL functions

---

## Background & Root Cause

Supabase advisors flagged 64 policies using bare `auth.uid()` / `auth.role()` calls in USING/WITH CHECK expressions. PostgreSQL re-evaluates these as a correlated sub-expression per row rather than once per query (the "initplan" optimisation only fires when wrapped in a subquery: `(SELECT auth.uid())`). This causes disk IO proportional to result-set size. The fix is mechanical: wrap all bare calls.

Additionally:

- 4 foreign keys lack covering indexes (sequential scan fallback on joins)
- Duplicate indexes waste storage and slow down writes
- Multiple permissive policies on the same role+command cause additive overhead
- 7 functions are missing `SET search_path = ''`, a security hardening requirement
- Several RLS policies use `USING (true)` / `WITH CHECK (true)` without restricting to service_role, allowing any user to mutate shared cache tables

---

## Migration 1: Performance Fixes

**File:** `supabase/migrations/20260405120000_fix_rls_performance.sql`

### Part A – RLS Auth Init Plan (wrap all bare auth.uid() / auth.role() calls)

Drop and recreate each policy, replacing bare `auth.uid()` with `(SELECT auth.uid())` and `auth.role()` with `(SELECT auth.role())`. All changes are semantically equivalent — only the planning optimisation changes.

**IMPORTANT:** Every `CREATE POLICY` that uses a new policy name (different from the currently live name) must be preceded by `DROP POLICY IF EXISTS` of that new name to ensure idempotency. Every policy that uses the same name as currently live is already covered by the DROP before CREATE pattern.

#### `public.profiles`

```sql
DROP POLICY IF EXISTS "profiles self access" ON public.profiles;
CREATE POLICY "profiles self access" ON public.profiles
  FOR SELECT USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "profiles self insert" ON public.profiles;
CREATE POLICY "profiles self insert" ON public.profiles
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = id);
```

#### `public.film_events`

```sql
DROP POLICY IF EXISTS "film_events user read" ON public.film_events;
CREATE POLICY "film_events user read" ON public.film_events
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "film_events user upsert" ON public.film_events;
CREATE POLICY "film_events user upsert" ON public.film_events
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "film_events user update" ON public.film_events;
CREATE POLICY "film_events user update" ON public.film_events
  FOR UPDATE USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
```

#### `public.film_tmdb_map`

```sql
DROP POLICY IF EXISTS "film_tmdb_map user read" ON public.film_tmdb_map;
CREATE POLICY "film_tmdb_map user read" ON public.film_tmdb_map
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "film_tmdb_map user upsert" ON public.film_tmdb_map;
CREATE POLICY "film_tmdb_map user upsert" ON public.film_tmdb_map
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "film_tmdb_map user update" ON public.film_tmdb_map;
CREATE POLICY "film_tmdb_map user update" ON public.film_tmdb_map
  FOR UPDATE USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
```

#### `public.blocked_suggestions`

```sql
DROP POLICY IF EXISTS "blocked_suggestions user read" ON public.blocked_suggestions;
CREATE POLICY "blocked_suggestions user read" ON public.blocked_suggestions
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "blocked_suggestions user insert" ON public.blocked_suggestions;
CREATE POLICY "blocked_suggestions user insert" ON public.blocked_suggestions
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "blocked_suggestions user delete" ON public.blocked_suggestions;
CREATE POLICY "blocked_suggestions user delete" ON public.blocked_suggestions
  FOR DELETE USING ((SELECT auth.uid()) = user_id);
```

#### `public.saved_suggestions`

Note: UPDATE gains explicit WITH CHECK to prevent ownership reassignment.

```sql
DROP POLICY IF EXISTS "Users can view their own saved suggestions" ON public.saved_suggestions;
CREATE POLICY "Users can view their own saved suggestions" ON public.saved_suggestions
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their own saved suggestions" ON public.saved_suggestions;
CREATE POLICY "Users can insert their own saved suggestions" ON public.saved_suggestions
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own saved suggestions" ON public.saved_suggestions;
CREATE POLICY "Users can update their own saved suggestions" ON public.saved_suggestions
  FOR UPDATE USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete their own saved suggestions" ON public.saved_suggestions;
CREATE POLICY "Users can delete their own saved suggestions" ON public.saved_suggestions
  FOR DELETE USING ((SELECT auth.uid()) = user_id);
```

#### `public.user_exploration_stats`

Note: UPDATE gains explicit WITH CHECK to prevent ownership reassignment.

```sql
DROP POLICY IF EXISTS "Users can view own exploration stats" ON public.user_exploration_stats;
CREATE POLICY "Users can view own exploration stats" ON public.user_exploration_stats
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own exploration stats" ON public.user_exploration_stats;
CREATE POLICY "Users can insert own exploration stats" ON public.user_exploration_stats
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own exploration stats" ON public.user_exploration_stats;
CREATE POLICY "Users can update own exploration stats" ON public.user_exploration_stats
  FOR UPDATE USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
```

#### `public.user_adjacent_preferences`

Note: UPDATE gains explicit WITH CHECK to prevent ownership reassignment.

```sql
DROP POLICY IF EXISTS "Users can view own adjacent preferences" ON public.user_adjacent_preferences;
CREATE POLICY "Users can view own adjacent preferences" ON public.user_adjacent_preferences
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own adjacent preferences" ON public.user_adjacent_preferences;
CREATE POLICY "Users can insert own adjacent preferences" ON public.user_adjacent_preferences
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own adjacent preferences" ON public.user_adjacent_preferences;
CREATE POLICY "Users can update own adjacent preferences" ON public.user_adjacent_preferences
  FOR UPDATE USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
```

#### `public.user_reason_preferences`

```sql
DROP POLICY IF EXISTS "Users can read their own reason preferences" ON public.user_reason_preferences;
CREATE POLICY "Users can read their own reason preferences" ON public.user_reason_preferences
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their own reason preferences" ON public.user_reason_preferences;
CREATE POLICY "Users can insert their own reason preferences" ON public.user_reason_preferences
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own reason preferences" ON public.user_reason_preferences;
CREATE POLICY "Users can update their own reason preferences" ON public.user_reason_preferences
  FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
```

#### `public.user_feature_feedback` — CONSOLIDATE 7 policies → 4 clean policies

This table has 7 active policies (duplicated across public/authenticated roles). Consolidate into 4 authenticated-only policies and drop all old ones. New policy names are also pre-dropped for idempotency.

```sql
-- Drop all old policies (7 live policies)
DROP POLICY IF EXISTS "Users can read their own feature feedback" ON public.user_feature_feedback;
DROP POLICY IF EXISTS "Users can view own feature feedback" ON public.user_feature_feedback;
DROP POLICY IF EXISTS "Users can insert their own feature feedback" ON public.user_feature_feedback;
DROP POLICY IF EXISTS "Users can insert own feature feedback" ON public.user_feature_feedback;
DROP POLICY IF EXISTS "Users can update their own feature feedback" ON public.user_feature_feedback;
DROP POLICY IF EXISTS "Users can update own feature feedback" ON public.user_feature_feedback;
DROP POLICY IF EXISTS "Users can delete own feature feedback" ON public.user_feature_feedback;
-- Pre-drop new names for idempotency
DROP POLICY IF EXISTS "feature_feedback_select" ON public.user_feature_feedback;
DROP POLICY IF EXISTS "feature_feedback_insert" ON public.user_feature_feedback;
DROP POLICY IF EXISTS "feature_feedback_update" ON public.user_feature_feedback;
DROP POLICY IF EXISTS "feature_feedback_delete" ON public.user_feature_feedback;

CREATE POLICY "feature_feedback_select" ON public.user_feature_feedback
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "feature_feedback_insert" ON public.user_feature_feedback
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "feature_feedback_update" ON public.user_feature_feedback
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "feature_feedback_delete" ON public.user_feature_feedback
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);
```

#### `public.suggestion_feedback`

```sql
DROP POLICY IF EXISTS "Users can read their own feedback" ON public.suggestion_feedback;
CREATE POLICY "Users can read their own feedback" ON public.suggestion_feedback
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their own feedback" ON public.suggestion_feedback;
CREATE POLICY "Users can insert their own feedback" ON public.suggestion_feedback
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete their own feedback" ON public.suggestion_feedback;
CREATE POLICY "Users can delete their own feedback" ON public.suggestion_feedback
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);
```

#### `public.suggestion_exposure_log`

```sql
DROP POLICY IF EXISTS "Users can view their own exposure logs" ON public.suggestion_exposure_log;
CREATE POLICY "Users can view their own exposure logs" ON public.suggestion_exposure_log
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their own exposure logs" ON public.suggestion_exposure_log;
CREATE POLICY "Users can insert their own exposure logs" ON public.suggestion_exposure_log
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
```

#### `public.pairwise_events`

Note: UPDATE gains WITH CHECK for consistency and to prevent ownership reassignment.

```sql
DROP POLICY IF EXISTS "Users can read their own pairwise events" ON public.pairwise_events;
CREATE POLICY "Users can read their own pairwise events" ON public.pairwise_events
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their own pairwise events" ON public.pairwise_events;
CREATE POLICY "Users can insert their own pairwise events" ON public.pairwise_events
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own pairwise events" ON public.pairwise_events;
CREATE POLICY "Users can update their own pairwise events" ON public.pairwise_events
  FOR UPDATE USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
```

#### `public.user_settings`

```sql
DROP POLICY IF EXISTS "user_settings self read" ON public.user_settings;
CREATE POLICY "user_settings self read" ON public.user_settings
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "user_settings self upsert" ON public.user_settings;
CREATE POLICY "user_settings self upsert" ON public.user_settings
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "user_settings self update" ON public.user_settings;
CREATE POLICY "user_settings self update" ON public.user_settings
  FOR UPDATE USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
```

#### `public.user_roles` — CONSOLIDATE: 3 policies → 4 explicit policies (1 SELECT + 3 write)

The current "Admins can write all roles" uses FOR ALL which includes SELECT, causing permissive policy overlap with 2 explicit SELECT policies. Replace with: one combined SELECT (own row OR admin) and three explicit admin write operations (INSERT/UPDATE/DELETE) — no SELECT overlap.

`public.is_admin()` is SECURITY DEFINER with SET search_path = public, so it reads user_roles as the function owner who bypasses RLS. No recursive RLS risk. Both the SELECT and write checks use `(SELECT auth.uid())` to trigger the initplan optimisation.

```sql
-- Drop all 3 current live policies
DROP POLICY IF EXISTS "Users can read own role" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can read all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can write all roles" ON public.user_roles;
-- Pre-drop new names for idempotency
DROP POLICY IF EXISTS "user_roles_select" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_admin_insert" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_admin_update" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_admin_delete" ON public.user_roles;

-- Combined SELECT: own row OR any row if admin (single policy = no duplicate overhead)
CREATE POLICY "user_roles_select" ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR public.is_admin((SELECT auth.uid()))
  );

-- Admin INSERT
CREATE POLICY "user_roles_admin_insert" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin((SELECT auth.uid())));

-- Admin UPDATE
CREATE POLICY "user_roles_admin_update" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (public.is_admin((SELECT auth.uid())))
  WITH CHECK (public.is_admin((SELECT auth.uid())));

-- Admin DELETE
CREATE POLICY "user_roles_admin_delete" ON public.user_roles
  FOR DELETE TO authenticated
  USING (public.is_admin((SELECT auth.uid())));
```

#### `public.admin_audit_log`

Use `public.is_admin()` instead of inline subquery for consistency and reliability.

```sql
DROP POLICY IF EXISTS "Admins can read audit log" ON public.admin_audit_log;
CREATE POLICY "Admins can read audit log" ON public.admin_audit_log
  FOR SELECT TO authenticated
  USING (public.is_admin((SELECT auth.uid())));
```

#### `public.api_keys`

Note: UPDATE gains explicit WITH CHECK.

```sql
DROP POLICY IF EXISTS "Users can read own keys" ON public.api_keys;
CREATE POLICY "Users can read own keys" ON public.api_keys
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own keys" ON public.api_keys;
CREATE POLICY "Users can insert own keys" ON public.api_keys
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own keys" ON public.api_keys;
CREATE POLICY "Users can update own keys" ON public.api_keys
  FOR UPDATE USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own keys" ON public.api_keys;
CREATE POLICY "Users can delete own keys" ON public.api_keys
  FOR DELETE USING ((SELECT auth.uid()) = user_id);
```

#### `public.film_diary_events_raw`

```sql
DROP POLICY IF EXISTS "diary_raw user read" ON public.film_diary_events_raw;
CREATE POLICY "diary_raw user read" ON public.film_diary_events_raw
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "diary_raw user insert" ON public.film_diary_events_raw;
CREATE POLICY "diary_raw user insert" ON public.film_diary_events_raw
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "diary_raw user update" ON public.film_diary_events_raw;
CREATE POLICY "diary_raw user update" ON public.film_diary_events_raw
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "diary_raw user delete" ON public.film_diary_events_raw;
CREATE POLICY "diary_raw user delete" ON public.film_diary_events_raw
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);
```

#### `public.tastedive_cache` — fix service_role policy scope + auth.role() wrap

The service role ALL policy overlaps the public SELECT policy (causing multiple permissive SELECT). Split FOR ALL into explicit INSERT/UPDATE/DELETE only. New policy names are pre-dropped for idempotency.

```sql
DROP POLICY IF EXISTS "Allow service role to insert/update TasteDive cache" ON public.tastedive_cache;
-- Pre-drop new names for idempotency
DROP POLICY IF EXISTS "tastedive_cache_service_write" ON public.tastedive_cache;
DROP POLICY IF EXISTS "tastedive_cache_service_update" ON public.tastedive_cache;
DROP POLICY IF EXISTS "tastedive_cache_service_delete" ON public.tastedive_cache;

CREATE POLICY "tastedive_cache_service_write" ON public.tastedive_cache
  FOR INSERT WITH CHECK ((SELECT auth.role()) = 'service_role');

CREATE POLICY "tastedive_cache_service_update" ON public.tastedive_cache
  FOR UPDATE USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

CREATE POLICY "tastedive_cache_service_delete" ON public.tastedive_cache
  FOR DELETE USING ((SELECT auth.role()) = 'service_role');
```

#### `public.watchmode_cache` — same fix

```sql
DROP POLICY IF EXISTS "Allow service role to insert/update Watchmode cache" ON public.watchmode_cache;
-- Pre-drop new names for idempotency
DROP POLICY IF EXISTS "watchmode_cache_service_write" ON public.watchmode_cache;
DROP POLICY IF EXISTS "watchmode_cache_service_update" ON public.watchmode_cache;
DROP POLICY IF EXISTS "watchmode_cache_service_delete" ON public.watchmode_cache;

CREATE POLICY "watchmode_cache_service_write" ON public.watchmode_cache
  FOR INSERT WITH CHECK ((SELECT auth.role()) = 'service_role');

CREATE POLICY "watchmode_cache_service_update" ON public.watchmode_cache
  FOR UPDATE USING ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

CREATE POLICY "watchmode_cache_service_delete" ON public.watchmode_cache
  FOR DELETE USING ((SELECT auth.role()) = 'service_role');
```

#### `public.user_taste_profile_cache` — fix FOR ALL overlap, preserve DELETE

The original "Users can upsert own taste cache" FOR ALL covered SELECT+INSERT+UPDATE+DELETE. Splitting into explicit operations prevents SELECT overlap. DELETE is explicitly preserved.

```sql
DROP POLICY IF EXISTS "Users can read own taste cache" ON public.user_taste_profile_cache;
DROP POLICY IF EXISTS "Users can upsert own taste cache" ON public.user_taste_profile_cache;
-- Pre-drop new names for idempotency
DROP POLICY IF EXISTS "taste_cache_select" ON public.user_taste_profile_cache;
DROP POLICY IF EXISTS "taste_cache_insert" ON public.user_taste_profile_cache;
DROP POLICY IF EXISTS "taste_cache_update" ON public.user_taste_profile_cache;
DROP POLICY IF EXISTS "taste_cache_delete" ON public.user_taste_profile_cache;

CREATE POLICY "taste_cache_select" ON public.user_taste_profile_cache
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "taste_cache_insert" ON public.user_taste_profile_cache
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "taste_cache_update" ON public.user_taste_profile_cache
  FOR UPDATE USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "taste_cache_delete" ON public.user_taste_profile_cache
  FOR DELETE USING ((SELECT auth.uid()) = user_id);
```

#### `public.webhooks`

```sql
DROP POLICY IF EXISTS "Users can manage own webhooks" ON public.webhooks;
CREATE POLICY "Users can manage own webhooks" ON public.webhooks
  FOR ALL USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
```

#### `public.ab_test_assignments`

```sql
DROP POLICY IF EXISTS "Users can view their own AB test assignments" ON public.ab_test_assignments;
CREATE POLICY "Users can view their own AB test assignments" ON public.ab_test_assignments
  FOR SELECT USING ((SELECT auth.uid()) = user_id);
```

#### `public.ab_test_metrics`

```sql
DROP POLICY IF EXISTS "Users can insert their own AB test metrics" ON public.ab_test_metrics;
CREATE POLICY "Users can insert their own AB test metrics" ON public.ab_test_metrics
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own AB test metrics" ON public.ab_test_metrics;
CREATE POLICY "Users can view their own AB test metrics" ON public.ab_test_metrics
  FOR SELECT USING ((SELECT auth.uid()) = user_id);
```

#### `public.user_quiz_responses`

```sql
DROP POLICY IF EXISTS "user_quiz_responses_read" ON public.user_quiz_responses;
CREATE POLICY "user_quiz_responses_read" ON public.user_quiz_responses
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "user_quiz_responses_insert" ON public.user_quiz_responses;
CREATE POLICY "user_quiz_responses_insert" ON public.user_quiz_responses
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
```

---

### Part B – Missing Foreign Key Indexes (4)

```sql
CREATE INDEX IF NOT EXISTS idx_ab_test_metrics_user_id
  ON public.ab_test_metrics (user_id);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin_id
  ON public.admin_audit_log (admin_id);

CREATE INDEX IF NOT EXISTS idx_film_tmdb_map_tmdb_id
  ON public.film_tmdb_map (tmdb_id);

CREATE INDEX IF NOT EXISTS idx_webhooks_user_id
  ON public.webhooks (user_id);
```

---

### Part C – Drop Duplicate Indexes (2 exact pairs + 1 superseded)

Keep the `user_feature_feedback_*_idx` variants (without `idx_` prefix); drop the `idx_*` prefix variants. Also drop the 2-column `idx_user_feature_feedback_lookup` (superseded by 3-column `user_feature_feedback_lookup_idx`).

```sql
DROP INDEX IF EXISTS public.idx_user_feature_feedback_user_id;
DROP INDEX IF EXISTS public.idx_user_feature_feedback_feature_type;
DROP INDEX IF EXISTS public.idx_user_feature_feedback_lookup;
```

---

## Migration 2: Security Fixes

**File:** `supabase/migrations/20260405130000_fix_security_advisors.sql`

### Part A – Fix Mutable Search Path on Functions (7 functions)

#### `public.add_liked_suggestion`

Body references `public.saved_suggestions` (fully qualified). Safe to set `search_path = ''`. Note: `RETURNING to_jsonb(saved_suggestions.*)` — `saved_suggestions` here is the DML target alias, not a schema-qualified name, so it resolves correctly without search_path.

```sql
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
```

#### `public.match_movie_embeddings`

**CRITICAL:** pgvector's `<=>` operator lives in `public` schema. With `search_path = ''`, it will not resolve unless schema-qualified with `OPERATOR(public.<=>)`. Must use explicit operator invocation syntax.

```sql
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
```

#### `public.extract_tmdb_keyword_names`

No table references. Safe to set `search_path = ''`. All functions used (`jsonb_path_query_array`, `jsonb_array_elements_text`, `array_agg`, `lower`) are in `pg_catalog`.

```sql
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
```

#### `public.get_film_stats`

Body uses `public.film_events` (fully qualified). Safe to set `search_path = ''`.

```sql
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
```

#### `public.cleanup_tastedive_cache`

**CRITICAL:** Body currently uses unqualified `tastedive_cache`. When `search_path = ''`, bare names fail. Body updated to use `public.tastedive_cache`.

```sql
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
```

#### `public.cleanup_watchmode_cache`

**CRITICAL:** Same issue — unqualified `watchmode_cache`. Body updated to use `public.watchmode_cache`.

```sql
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
```

#### `public.increment_rate_limit`

Body uses `public.api_rate_limits` (fully qualified). Note: `api_rate_limits.request_count` in DO UPDATE is unambiguous (column ref in UPDATE SET context), safe with `search_path = ''`.

```sql
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
```

---

### Part B – Fix Always-True RLS Policies

Restrict write operations to `service_role` on all shared cache/utility tables. Public read access is preserved where it exists. All policy names below are verified from the live `pg_policies` table. New policy names are pre-dropped for idempotency.

#### `public.api_rate_limits`

Currently any unauthenticated user can read/write rate limits. Since `increment_rate_limit()` is SECURITY DEFINER, only the backend service role needs direct table access.

```sql
DROP POLICY IF EXISTS "Service role full access rate limits" ON public.api_rate_limits;
-- Pre-drop new name for idempotency
DROP POLICY IF EXISTS "api_rate_limits_service_role" ON public.api_rate_limits;

CREATE POLICY "api_rate_limits_service_role" ON public.api_rate_limits
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

#### `public.tmdb_movies`

Remove always-true UPDATE and INSERT; keep public SELECT.

```sql
DROP POLICY IF EXISTS "tmdb_movies_authenticated_update" ON public.tmdb_movies;
DROP POLICY IF EXISTS "tmdb_movies_authenticated_upsert" ON public.tmdb_movies;
-- Pre-drop new names for idempotency
DROP POLICY IF EXISTS "tmdb_movies_service_update" ON public.tmdb_movies;
DROP POLICY IF EXISTS "tmdb_movies_service_upsert" ON public.tmdb_movies;

CREATE POLICY "tmdb_movies_service_update" ON public.tmdb_movies
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "tmdb_movies_service_upsert" ON public.tmdb_movies
  FOR INSERT TO service_role WITH CHECK (true);
```

#### `public.tmdb_similar_cache`

```sql
DROP POLICY IF EXISTS "Allow authenticated insert on tmdb_similar_cache" ON public.tmdb_similar_cache;
DROP POLICY IF EXISTS "Allow authenticated update on tmdb_similar_cache" ON public.tmdb_similar_cache;
-- Pre-drop new names for idempotency
DROP POLICY IF EXISTS "tmdb_similar_cache_service_insert" ON public.tmdb_similar_cache;
DROP POLICY IF EXISTS "tmdb_similar_cache_service_update" ON public.tmdb_similar_cache;

CREATE POLICY "tmdb_similar_cache_service_insert" ON public.tmdb_similar_cache
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "tmdb_similar_cache_service_update" ON public.tmdb_similar_cache
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);
```

#### `public.tmdb_trending`

Drop the old duplicate policy set AND restrict writes to service_role. Keep "tmdb_trending_authenticated_read" SELECT (already public, no auth.uid() issue). Defensive drops cover all known name variants. New service_role policy names are pre-dropped for idempotency.

```sql
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
```

#### `public.trakt_related_cache`

```sql
DROP POLICY IF EXISTS "Allow authenticated insert on trakt_related_cache" ON public.trakt_related_cache;
DROP POLICY IF EXISTS "Allow authenticated update on trakt_related_cache" ON public.trakt_related_cache;
-- Pre-drop new names for idempotency
DROP POLICY IF EXISTS "trakt_related_cache_service_insert" ON public.trakt_related_cache;
DROP POLICY IF EXISTS "trakt_related_cache_service_update" ON public.trakt_related_cache;

CREATE POLICY "trakt_related_cache_service_insert" ON public.trakt_related_cache
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "trakt_related_cache_service_update" ON public.trakt_related_cache
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);
```

#### `public.tuimdb_uid_cache`

```sql
DROP POLICY IF EXISTS "Allow authenticated insert on tuimdb_uid_cache" ON public.tuimdb_uid_cache;
DROP POLICY IF EXISTS "Allow authenticated update on tuimdb_uid_cache" ON public.tuimdb_uid_cache;
-- Pre-drop new names for idempotency
DROP POLICY IF EXISTS "tuimdb_uid_cache_service_insert" ON public.tuimdb_uid_cache;
DROP POLICY IF EXISTS "tuimdb_uid_cache_service_update" ON public.tuimdb_uid_cache;

CREATE POLICY "tuimdb_uid_cache_service_insert" ON public.tuimdb_uid_cache
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "tuimdb_uid_cache_service_update" ON public.tuimdb_uid_cache
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);
```

---

## Application Impact Assessment

### Cache write policies restricted to service_role

The following tables will now only allow writes via the `service_role` key (backend API routes using the service-role Supabase client):

| Table                 | Write operations affected                                |
| --------------------- | -------------------------------------------------------- |
| `tmdb_movies`         | INSERT, UPDATE                                           |
| `tmdb_similar_cache`  | INSERT, UPDATE                                           |
| `tmdb_trending`       | INSERT, UPDATE, DELETE                                   |
| `trakt_related_cache` | INSERT, UPDATE                                           |
| `tuimdb_uid_cache`    | INSERT, UPDATE                                           |
| `api_rate_limits`     | ALL                                                      |
| `tastedive_cache`     | INSERT, UPDATE, DELETE (was already service_role intent) |
| `watchmode_cache`     | INSERT, UPDATE, DELETE (was already service_role intent) |

**Verification required before apply:** Confirm all Next.js API routes that write to these tables use `createClient(url, SERVICE_ROLE_KEY)` not the anon key. If any route uses the anon client for cache writes, it will break after this migration.

### user_feature_feedback policy consolidation

7 policies collapsed to 4. All operations remain `TO authenticated`. Anonymous users lose access (previously had public-role SELECT/INSERT/UPDATE). Verify no anonymous feedback submission flow exists.

### user_roles SELECT consolidation

3 policies → 4 explicit (1 SELECT + 3 admin write). The combined SELECT policy uses OR logic: `own row OR is_admin()`. Logic is equivalent to original. No recursive RLS risk: `is_admin()` is SECURITY DEFINER owned by supabase admin role which has BYPASSRLS.

### user_taste_profile_cache

FOR ALL split into explicit SELECT/INSERT/UPDATE/DELETE (4 policies). Functionally equivalent to original. DELETE is explicitly preserved.

---

## Verification Steps

After applying each migration:

1. Re-run Supabase performance advisor — target: 0 auth_rls_initplan, 0 unindexed_fk, 0 duplicate_index, 0 multiple_permissive_policies
2. Re-run Supabase security advisor — target: 0 function_search_path_mutable, 0 rls_policy_always_true
3. Test cleanup functions: `SELECT public.cleanup_tastedive_cache(); SELECT public.cleanup_watchmode_cache();`
4. Test vector search: `SELECT public.match_movie_embeddings('[0.1, ...]'::public.vector(1536), 5);`
5. Test auth flow: sign in, load recommendations page, verify no 403s on cache tables
6. Check API routes that write to cache tables use service_role client
7. Verify admin user can still read/write user_roles entries
