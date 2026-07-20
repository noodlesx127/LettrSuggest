-- Contain the five privileged RPCs to the callers that the application verifies.
-- The function bodies retain the deployed data behavior while enforcing identity
-- inside SECURITY DEFINER execution rather than trusting caller-supplied IDs.

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
AS $function$
DECLARE
  v_existing_id uuid;
  v_result jsonb;
BEGIN
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF auth.role() = 'authenticated'
    AND auth.uid() IS NOT NULL
    AND auth.uid() IS NOT DISTINCT FROM p_user_id THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Unauthorized: can only access your own data'
      USING ERRCODE = '42501';
  END IF;

  SELECT id
    INTO v_existing_id
    FROM public.saved_suggestions
   WHERE user_id = p_user_id
     AND tmdb_id = p_tmdb_id;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('already_exists', true, 'id', v_existing_id);
  END IF;

  INSERT INTO public.saved_suggestions AS saved_suggestion (
    user_id,
    tmdb_id,
    title,
    year,
    poster_path,
    order_index
  )
  SELECT
    p_user_id,
    p_tmdb_id,
    p_title,
    p_year,
    p_poster_path,
    COALESCE(
      (
        SELECT MAX(order_index)
          FROM public.saved_suggestions
         WHERE user_id = p_user_id
      ),
      -1
    ) + 1
  RETURNING to_jsonb(saved_suggestion.*) INTO v_result;

  RETURN v_result || '{"already_exists": false}'::jsonb;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_film_stats(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF auth.role() = 'authenticated'
    AND auth.uid() IS NOT NULL
    AND auth.uid() IS NOT DISTINCT FROM p_user_id THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Unauthorized: can only access your own data'
      USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'total_films', COUNT(*),
      'total_rated', COUNT(rating),
      'avg_rating', ROUND(COALESCE(AVG(rating), 0)::numeric, 2),
      'total_liked', COUNT(*) FILTER (WHERE liked = true),
      'on_watchlist', COUNT(*) FILTER (WHERE on_watchlist = true)
    )
      FROM public.film_events
     WHERE user_id = p_user_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.increment_rate_limit(
  p_key_id uuid,
  p_window_start timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: service role required'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.api_rate_limits (key_id, window_start, request_count)
  VALUES (p_key_id, p_window_start, 1)
  ON CONFLICT (key_id, window_start)
  DO UPDATE
    SET request_count = public.api_rate_limits.request_count + 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_user_data(target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  deleted_blocked integer;
  deleted_mappings integer;
  deleted_events integer;
  deleted_diary integer;
  deleted_feedback integer;
  deleted_exploration integer;
  deleted_adjacent integer;
  deleted_saved integer;
  deleted_reason_prefs integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
    OR auth.uid() IS NULL
    OR auth.uid() IS DISTINCT FROM target_user_id THEN
    RAISE EXCEPTION 'Unauthorized: can only delete your own data'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.blocked_suggestions
   WHERE user_id = target_user_id;
  GET DIAGNOSTICS deleted_blocked = ROW_COUNT;

  DELETE FROM public.suggestion_feedback
   WHERE user_id = target_user_id;
  GET DIAGNOSTICS deleted_feedback = ROW_COUNT;

  DELETE FROM public.user_exploration_stats
   WHERE user_id = target_user_id;
  GET DIAGNOSTICS deleted_exploration = ROW_COUNT;

  DELETE FROM public.user_adjacent_preferences
   WHERE user_id = target_user_id;
  GET DIAGNOSTICS deleted_adjacent = ROW_COUNT;

  DELETE FROM public.saved_suggestions
   WHERE user_id = target_user_id;
  GET DIAGNOSTICS deleted_saved = ROW_COUNT;

  DELETE FROM public.user_reason_preferences
   WHERE user_id = target_user_id;
  GET DIAGNOSTICS deleted_reason_prefs = ROW_COUNT;

  DELETE FROM public.film_tmdb_map
   WHERE user_id = target_user_id;
  GET DIAGNOSTICS deleted_mappings = ROW_COUNT;

  BEGIN
    DELETE FROM public.film_diary_events_raw
     WHERE user_id = target_user_id;
    GET DIAGNOSTICS deleted_diary = ROW_COUNT;
  EXCEPTION
    WHEN undefined_table THEN
      deleted_diary := 0;
  END;

  DELETE FROM public.film_events
   WHERE user_id = target_user_id;
  GET DIAGNOSTICS deleted_events = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'deleted', jsonb_build_object(
      'blocked_suggestions', deleted_blocked,
      'suggestion_feedback', deleted_feedback,
      'user_exploration_stats', deleted_exploration,
      'user_adjacent_preferences', deleted_adjacent,
      'saved_suggestions', deleted_saved,
      'user_reason_preferences', deleted_reason_prefs,
      'film_tmdb_map', deleted_mappings,
      'film_diary_events', deleted_diary,
      'film_events', deleted_events
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_delete_user_data(
  target_user_id uuid,
  scope text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  result jsonb := '{}';
  deleted_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
    OR auth.uid() IS NULL
    OR NOT EXISTS (
      SELECT 1
        FROM public.user_roles
       WHERE user_id = auth.uid()
         AND role = 'admin'
    ) THEN
    RAISE EXCEPTION 'Unauthorized: admin role required'
      USING ERRCODE = '42501';
  END IF;

  CASE scope
    WHEN 'blocked' THEN
      DELETE FROM public.blocked_suggestions
       WHERE user_id = target_user_id;
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
      result := jsonb_build_object('blocked_suggestions', deleted_count);

    WHEN 'liked' THEN
      DELETE FROM public.suggestion_feedback
       WHERE user_id = target_user_id
         AND feedback_type = 'positive';
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
      result := jsonb_build_object('liked_suggestions', deleted_count);

    WHEN 'import' THEN
      DELETE FROM public.film_tmdb_map
       WHERE user_id = target_user_id;
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
      result := jsonb_build_object('film_tmdb_map', deleted_count);

      BEGIN
        DELETE FROM public.film_diary_events_raw
         WHERE user_id = target_user_id;
        GET DIAGNOSTICS deleted_count = ROW_COUNT;
        result := result || jsonb_build_object(
          'film_diary_events', deleted_count
        );
      EXCEPTION
        WHEN undefined_table THEN
          result := result || jsonb_build_object('film_diary_events', 0);
      END;

      DELETE FROM public.film_events
       WHERE user_id = target_user_id;
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
      result := result || jsonb_build_object('film_events', deleted_count);

    WHEN 'all' THEN
      DELETE FROM public.blocked_suggestions
       WHERE user_id = target_user_id;
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
      result := result || jsonb_build_object(
        'blocked_suggestions', deleted_count
      );

      DELETE FROM public.suggestion_feedback
       WHERE user_id = target_user_id;
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
      result := result || jsonb_build_object(
        'suggestion_feedback', deleted_count
      );

      DELETE FROM public.user_exploration_stats
       WHERE user_id = target_user_id;
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
      result := result || jsonb_build_object(
        'user_exploration_stats', deleted_count
      );

      DELETE FROM public.user_adjacent_preferences
       WHERE user_id = target_user_id;
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
      result := result || jsonb_build_object(
        'user_adjacent_preferences', deleted_count
      );

      DELETE FROM public.saved_suggestions
       WHERE user_id = target_user_id;
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
      result := result || jsonb_build_object(
        'saved_suggestions', deleted_count
      );

      DELETE FROM public.user_reason_preferences
       WHERE user_id = target_user_id;
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
      result := result || jsonb_build_object(
        'user_reason_preferences', deleted_count
      );

      DELETE FROM public.film_tmdb_map
       WHERE user_id = target_user_id;
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
      result := result || jsonb_build_object(
        'film_tmdb_map', deleted_count
      );

      BEGIN
        DELETE FROM public.film_diary_events_raw
         WHERE user_id = target_user_id;
        GET DIAGNOSTICS deleted_count = ROW_COUNT;
        result := result || jsonb_build_object(
          'film_diary_events', deleted_count
        );
      EXCEPTION
        WHEN undefined_table THEN
          result := result || jsonb_build_object('film_diary_events', 0);
      END;

      DELETE FROM public.film_events
       WHERE user_id = target_user_id;
      GET DIAGNOSTICS deleted_count = ROW_COUNT;
      result := result || jsonb_build_object('film_events', deleted_count);

    ELSE
      RAISE EXCEPTION 'Invalid scope: %', scope;
  END CASE;

  RETURN jsonb_build_object(
    'success', true,
    'scope', scope,
    'deleted', result
  );
END;
$function$;

-- Remove inherited PUBLIC/client execution before granting the minimum matrix.
REVOKE ALL ON FUNCTION public.add_liked_suggestion(
  uuid, integer, text, integer, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_film_stats(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.increment_rate_limit(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_user_data(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_delete_user_data(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.add_liked_suggestion(
  uuid, integer, text, integer, text
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_film_stats(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_rate_limit(uuid, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_user_data(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user_data(uuid, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
