/*
  Migration 1: Performance Fixes

  Drop and recreate each policy, replacing bare `auth.uid()` with `(SELECT auth.uid())` and `auth.role()` with `(SELECT auth.role())`. All changes are semantically equivalent — only the planning optimisation changes.

  Additionally:
  - 4 foreign keys lack covering indexes (sequential scan fallback on joins)
  - Duplicate indexes waste storage and slow down writes
*/

-- ============ PART A ============
-- Part A – RLS Auth Init Plan (wrap all bare auth.uid() / auth.role() calls)

DROP POLICY IF EXISTS "profiles self access" ON public.profiles;
CREATE POLICY "profiles self access" ON public.profiles
  FOR SELECT USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "profiles self insert" ON public.profiles;
CREATE POLICY "profiles self insert" ON public.profiles
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = id);

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

DROP POLICY IF EXISTS "blocked_suggestions user read" ON public.blocked_suggestions;
CREATE POLICY "blocked_suggestions user read" ON public.blocked_suggestions
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "blocked_suggestions user insert" ON public.blocked_suggestions;
CREATE POLICY "blocked_suggestions user insert" ON public.blocked_suggestions
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "blocked_suggestions user delete" ON public.blocked_suggestions;
CREATE POLICY "blocked_suggestions user delete" ON public.blocked_suggestions
  FOR DELETE USING ((SELECT auth.uid()) = user_id);

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

DROP POLICY IF EXISTS "Users can read their own feedback" ON public.suggestion_feedback;
CREATE POLICY "Users can read their own feedback" ON public.suggestion_feedback
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their own feedback" ON public.suggestion_feedback;
CREATE POLICY "Users can insert their own feedback" ON public.suggestion_feedback
  FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete their own feedback" ON public.suggestion_feedback;
CREATE POLICY "Users can delete their own feedback" ON public.suggestion_feedback
  FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own exposure logs" ON public.suggestion_exposure_log;
CREATE POLICY "Users can view their own exposure logs" ON public.suggestion_exposure_log
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their own exposure logs" ON public.suggestion_exposure_log;
CREATE POLICY "Users can insert their own exposure logs" ON public.suggestion_exposure_log
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

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

DROP POLICY IF EXISTS "Admins can read audit log" ON public.admin_audit_log;
CREATE POLICY "Admins can read audit log" ON public.admin_audit_log
  FOR SELECT TO authenticated
  USING (public.is_admin((SELECT auth.uid())));

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

DROP POLICY IF EXISTS "Users can manage own webhooks" ON public.webhooks;
CREATE POLICY "Users can manage own webhooks" ON public.webhooks
  FOR ALL USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own AB test assignments" ON public.ab_test_assignments;
CREATE POLICY "Users can view their own AB test assignments" ON public.ab_test_assignments
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their own AB test metrics" ON public.ab_test_metrics;
CREATE POLICY "Users can insert their own AB test metrics" ON public.ab_test_metrics
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own AB test metrics" ON public.ab_test_metrics;
CREATE POLICY "Users can view their own AB test metrics" ON public.ab_test_metrics
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "user_quiz_responses_read" ON public.user_quiz_responses;
CREATE POLICY "user_quiz_responses_read" ON public.user_quiz_responses
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "user_quiz_responses_insert" ON public.user_quiz_responses;
CREATE POLICY "user_quiz_responses_insert" ON public.user_quiz_responses
  FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);

-- ============ PART B ============
-- Part B – Missing Foreign Key Indexes (4)

CREATE INDEX IF NOT EXISTS idx_ab_test_metrics_user_id
  ON public.ab_test_metrics (user_id);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin_id
  ON public.admin_audit_log (admin_id);

CREATE INDEX IF NOT EXISTS idx_film_tmdb_map_tmdb_id
  ON public.film_tmdb_map (tmdb_id);

CREATE INDEX IF NOT EXISTS idx_webhooks_user_id
  ON public.webhooks (user_id);

-- ============ PART C ============
-- Part C – Drop Duplicate Indexes (2 exact pairs + 1 superseded)

DROP INDEX IF EXISTS public.idx_user_feature_feedback_user_id;
DROP INDEX IF EXISTS public.idx_user_feature_feedback_feature_type;
DROP INDEX IF EXISTS public.idx_user_feature_feedback_lookup;
