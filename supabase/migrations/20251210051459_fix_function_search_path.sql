-- Fix search_path on all functions with mutable search_path
-- Setting search_path to '' (empty) is the most secure option

-- 1. cleanup_expired_cache (void, no args)
CREATE OR REPLACE FUNCTION public.cleanup_expired_cache()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
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
$$;

-- 2. cleanup_tastedive_cache (returns integer, no args)
CREATE OR REPLACE FUNCTION public.cleanup_tastedive_cache()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.tastedive_cache
    WHERE cached_at < NOW() - INTERVAL '7 days';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

-- 3. cleanup_watchmode_cache (returns integer, no args)
CREATE OR REPLACE FUNCTION public.cleanup_watchmode_cache()
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.watchmode_cache
    WHERE cached_at < NOW() - INTERVAL '24 hours';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

-- 4. delete_user_data (returns jsonb, takes uuid arg, SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.delete_user_data(target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
declare
  deleted_blocked integer;
  deleted_mappings integer;
  deleted_events integer;
  deleted_diary integer;
  deleted_feedback integer;
  deleted_exploration integer;
  deleted_adjacent integer;
  deleted_saved integer;
  deleted_reason_prefs integer;
begin
  -- Verify the caller is deleting their own data
  if auth.uid() != target_user_id then
    raise exception 'Unauthorized: can only delete your own data';
  end if;

  -- Delete blocked suggestions
  delete from public.blocked_suggestions where user_id = target_user_id;
  get diagnostics deleted_blocked = row_count;

  -- Delete suggestion feedback
  delete from public.suggestion_feedback where user_id = target_user_id;
  get diagnostics deleted_feedback = row_count;

  -- Delete user exploration stats
  delete from public.user_exploration_stats where user_id = target_user_id;
  get diagnostics deleted_exploration = row_count;

  -- Delete user adjacent preferences
  delete from public.user_adjacent_preferences where user_id = target_user_id;
  get diagnostics deleted_adjacent = row_count;

  -- Delete saved suggestions (watchlist-like saved movies)
  delete from public.saved_suggestions where user_id = target_user_id;
  get diagnostics deleted_saved = row_count;

  -- Delete user reason preferences (which recommendation types work best)
  delete from public.user_reason_preferences where user_id = target_user_id;
  get diagnostics deleted_reason_prefs = row_count;

  -- Delete film mappings
  delete from public.film_tmdb_map where user_id = target_user_id;
  get diagnostics deleted_mappings = row_count;

  -- Delete diary events (may not exist)
  begin
    delete from public.film_diary_events where user_id = target_user_id;
    get diagnostics deleted_diary = row_count;
  exception when undefined_table then
    deleted_diary := 0;
  end;

  -- Delete film events (main import data)
  delete from public.film_events where user_id = target_user_id;
  get diagnostics deleted_events = row_count;

  return jsonb_build_object(
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
end;
$$;

-- 5. handle_new_user (returns trigger, SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;;
