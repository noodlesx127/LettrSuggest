CREATE OR REPLACE FUNCTION public.add_liked_suggestion(
  p_user_id uuid,
  p_tmdb_id integer,
  p_title text,
  p_year integer,
  p_poster_path text
) RETURNS jsonb AS $$
DECLARE
  v_existing_id uuid;
  v_result jsonb;
BEGIN
  -- Check if already exists
  SELECT id INTO v_existing_id
  FROM public.saved_suggestions
  WHERE user_id = p_user_id AND tmdb_id = p_tmdb_id;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('already_exists', true, 'id', v_existing_id);
  END IF;

  -- Atomically insert with next order_index
  INSERT INTO public.saved_suggestions (user_id, tmdb_id, title, year, poster_path, order_index)
  SELECT p_user_id, p_tmdb_id, p_title, p_year, p_poster_path,
         COALESCE((SELECT MAX(order_index) FROM public.saved_suggestions WHERE user_id = p_user_id), -1) + 1
  RETURNING to_jsonb(saved_suggestions.*) INTO v_result;

  RETURN v_result || '{"already_exists": false}'::jsonb;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
