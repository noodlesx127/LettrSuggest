CREATE OR REPLACE FUNCTION public.get_film_stats(p_user_id uuid)
RETURNS jsonb AS $$
  SELECT jsonb_build_object(
    'total_films', COUNT(*),
    'total_rated', COUNT(rating),
    'avg_rating', ROUND(COALESCE(AVG(rating), 0)::numeric, 2),
    'total_liked', COUNT(*) FILTER (WHERE liked = true),
    'on_watchlist', COUNT(*) FILTER (WHERE on_watchlist = true)
  )
  FROM public.film_events
  WHERE user_id = p_user_id
$$ LANGUAGE sql STABLE SECURITY DEFINER;
