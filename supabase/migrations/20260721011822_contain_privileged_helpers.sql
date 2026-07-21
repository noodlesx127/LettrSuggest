-- Contain the remaining public SECURITY DEFINER helpers.
-- Trigger execution and the postgres-owned cache cron do not require direct
-- EXECUTE grants for PostgREST roles.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_admin(check_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS DISTINCT FROM check_user_id THEN
    RAISE EXCEPTION 'Unauthorized: can only check your own admin status'
      USING ERRCODE = '42501';
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = check_user_id
      AND role = 'admin'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.prune_api_caches(
  retention_days integer DEFAULT 30
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF retention_days IS NULL OR retention_days NOT BETWEEN 1 AND 3650 THEN
    RAISE EXCEPTION 'retention_days must be between 1 and 3650'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.trakt_related_cache
   WHERE cached_at < now() - (retention_days * interval '1 day');

  DELETE FROM public.tmdb_similar_cache
   WHERE cached_at < now() - (retention_days * interval '1 day');

  DELETE FROM public.tuimdb_uid_cache
   WHERE cached_at < now() - (retention_days * interval '1 day');

  DELETE FROM public.tastedive_cache
   WHERE cached_at < now() - (retention_days * interval '1 day');

  DELETE FROM public.watchmode_cache
   WHERE cached_at < now() - (retention_days * interval '1 day');

  DELETE FROM public.vector_similarity_cache
   WHERE cached_at < now() - (retention_days * interval '1 day');

  DELETE FROM public.tmdb_trending
   WHERE updated_at < now() - (retention_days * interval '1 day');

  DELETE FROM public.user_taste_profile_cache
   WHERE computed_at < now() - (retention_days * interval '1 day');
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_film_events_last_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  max_date date;
BEGIN
  SELECT MAX(fdr.watched_date)
    INTO max_date
    FROM public.film_diary_events_raw AS fdr
   WHERE fdr.user_id = NEW.user_id
     AND fdr.uri = NEW.uri;

  IF max_date IS NOT NULL THEN
    UPDATE public.film_events
       SET last_date = max_date::text,
           updated_at = now()
     WHERE user_id = NEW.user_id
       AND uri = NEW.uri
       AND (last_date IS NULL OR last_date < max_date::text);
  END IF;

  RETURN NEW;
END;
$function$;

-- Reconcile the production-only role trigger without cascading to auth.users.
DROP TRIGGER IF EXISTS on_auth_user_created_role ON auth.users;
CREATE TRIGGER on_auth_user_created_role
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_role();

-- Reconcile the trigger-backed event helper definition without changing its
-- firing contract.
DROP TRIGGER IF EXISTS trg_sync_film_events_last_date ON public.film_diary_events_raw;
CREATE TRIGGER trg_sync_film_events_last_date
  AFTER INSERT OR UPDATE ON public.film_diary_events_raw
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_film_events_last_date();

-- Remove inherited PUBLIC and client-role execution from every helper.
REVOKE ALL ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.handle_new_user_role()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_admin(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prune_api_caches(integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sync_film_events_last_date()
  FROM PUBLIC, anon, authenticated, service_role;

-- RLS policies use is_admin(auth.uid()) as an authenticated-only helper.
GRANT EXECUTE ON FUNCTION public.is_admin(uuid)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
