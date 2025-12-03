-- Function to delete all user data, bypassing RLS
create or replace function public.delete_user_data(target_user_id uuid)
returns jsonb as $$
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

  -- Delete user adjacent preferences (genre transition learning)
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
$$ language plpgsql security definer;

-- Grant execute to authenticated users
grant execute on function public.delete_user_data(uuid) to authenticated;
