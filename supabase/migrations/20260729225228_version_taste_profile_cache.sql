-- Version the taste profile cache so changes to any profile input cannot reuse
-- a profile built from an older input snapshot or profile implementation.

ALTER TABLE public.user_taste_profile_cache
  ADD COLUMN IF NOT EXISTS input_revision TEXT,
  ADD COLUMN IF NOT EXISTS profile_model_version TEXT;

-- Existing rows cannot be reconstructed from the old film-count-only contract.
-- Mark them with a legacy sentinel; the application intentionally rejects this
-- revision/model pair and rebuilds the profile on the next request.
UPDATE public.user_taste_profile_cache
SET
  input_revision = COALESCE(input_revision, 'legacy-v0'),
  profile_model_version = COALESCE(profile_model_version, 'legacy-v0')
WHERE input_revision IS NULL OR profile_model_version IS NULL;

ALTER TABLE public.user_taste_profile_cache
  ALTER COLUMN input_revision SET DEFAULT 'legacy-v0',
  ALTER COLUMN profile_model_version SET DEFAULT 'legacy-v0',
  ALTER COLUMN input_revision SET NOT NULL,
  ALTER COLUMN profile_model_version SET NOT NULL;

COMMENT ON COLUMN public.user_taste_profile_cache.input_revision IS
  'Deterministic hash of the canonical user taste-profile inputs.';

COMMENT ON COLUMN public.user_taste_profile_cache.profile_model_version IS
  'Version of the server-side taste profile implementation.';

NOTIFY pgrst, 'reload schema';
