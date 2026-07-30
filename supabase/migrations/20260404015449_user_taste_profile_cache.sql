-- User taste profile cache
-- Stores pre-computed taste profiles to avoid recomputation on every API call
-- Cache is valid if computed_at < 24h ago AND film_count matches current film_events count
CREATE TABLE IF NOT EXISTS public.user_taste_profile_cache (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  profile JSONB NOT NULL,
  film_count INTEGER NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_taste_profile_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own taste cache" ON public.user_taste_profile_cache;
CREATE POLICY "Users can read own taste cache"
  ON public.user_taste_profile_cache FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can upsert own taste cache" ON public.user_taste_profile_cache;
CREATE POLICY "Users can upsert own taste cache"
  ON public.user_taste_profile_cache FOR ALL
  USING (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
