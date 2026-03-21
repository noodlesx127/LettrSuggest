CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL CONSTRAINT valid_key_prefix CHECK (char_length(key_prefix) >= 6),
  key_type text NOT NULL DEFAULT 'user' CHECK (key_type IN ('user', 'admin', 'developer')),
  label text,
  scopes text[] DEFAULT '{}',
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON public.api_keys (key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON public.api_keys (user_id);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own keys" ON public.api_keys;
CREATE POLICY "Users can read own keys"
ON public.api_keys
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own keys" ON public.api_keys;
CREATE POLICY "Users can insert own keys"
ON public.api_keys
FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own keys" ON public.api_keys;
CREATE POLICY "Users can update own keys"
ON public.api_keys
FOR UPDATE
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own keys" ON public.api_keys;
CREATE POLICY "Users can delete own keys"
ON public.api_keys
FOR DELETE
USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  request_count int NOT NULL DEFAULT 1,
  PRIMARY KEY (key_id, window_start)
);

ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access rate limits" ON public.api_rate_limits;
CREATE POLICY "Service role full access rate limits"
ON public.api_rate_limits
FOR ALL
USING (true)
WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
