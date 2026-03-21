CREATE OR REPLACE FUNCTION public.increment_rate_limit(
  p_key_id UUID,
  p_window_start TIMESTAMPTZ
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.api_rate_limits (key_id, window_start, request_count)
  VALUES (p_key_id, p_window_start, 1)
  ON CONFLICT (key_id, window_start)
  DO UPDATE SET request_count = api_rate_limits.request_count + 1;
END;
$$;
