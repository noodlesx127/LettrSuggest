alter table public.saved_suggestions
  add column if not exists liked boolean not null default true;

create index if not exists saved_suggestions_user_liked_created_at_idx
  on public.saved_suggestions (user_id, liked, created_at desc);

create or replace function public.add_liked_suggestion(
  p_user_id uuid,
  p_tmdb_id integer,
  p_title text,
  p_year integer,
  p_poster_path text
) returns jsonb as $$
declare
  v_existing_id uuid;
  v_existing_liked boolean;
  v_result jsonb;
begin
  select id, liked
  into v_existing_id, v_existing_liked
  from public.saved_suggestions
  where user_id = p_user_id and tmdb_id = p_tmdb_id
  limit 1;

  if v_existing_id is not null and v_existing_liked = true then
    return jsonb_build_object('already_exists', true, 'id', v_existing_id);
  end if;

  if v_existing_id is not null and coalesce(v_existing_liked, false) = false then
    update public.saved_suggestions
    set
      liked = true,
      title = p_title,
      year = p_year,
      poster_path = p_poster_path
    where id = v_existing_id
    returning to_jsonb(saved_suggestions.*) into v_result;

    return v_result || '{"already_exists": false}'::jsonb;
  end if;

  insert into public.saved_suggestions (
    user_id,
    tmdb_id,
    title,
    year,
    poster_path,
    order_index,
    liked
  )
  select
    p_user_id,
    p_tmdb_id,
    p_title,
    p_year,
    p_poster_path,
    coalesce(
      (
        select max(order_index)
        from public.saved_suggestions
        where user_id = p_user_id and liked = true
      ),
      -1
    ) + 1,
    true
  returning to_jsonb(saved_suggestions.*) into v_result;

  return v_result || '{"already_exists": false}'::jsonb;
end;
$$ language plpgsql security definer;

notify pgrst, 'reload schema';
