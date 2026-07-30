-- Fix 4: Enable pg_cron and schedule daily cache cleanup (30-day retention)

create schema if not exists extensions;

-- Enable pg_cron extension (pg_cron objects live under the `cron` schema)
create extension if not exists pg_cron with schema extensions;

-- Cache pruning function (runs with definer privileges)
create or replace function public.prune_api_caches(retention_days integer default 30)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  cutoff timestamptz := now() - make_interval(days => retention_days);
begin
  -- External API caches
  delete from public.tmdb_similar_cache where cached_at < cutoff;
  delete from public.trakt_related_cache where cached_at < cutoff;
  delete from public.tuimdb_uid_cache where cached_at < cutoff;
  delete from public.tastedive_cache where cached_at < cutoff;
  delete from public.watchmode_cache where cached_at < cutoff;
  delete from public.vector_similarity_cache where cached_at < cutoff;

  -- Derived/aux caches
  delete from public.tmdb_trending where updated_at < cutoff;
  delete from public.user_taste_profile_cache where computed_at < cutoff;
end;
$$;

revoke all on function public.prune_api_caches(integer) from public;

-- (Re)create cron job: daily at 03:20 UTC
-- Idempotent: unschedule existing job with same name if present.
do $$
declare
  existing_jobid integer;
  command_sql text;
begin
  command_sql := format('select public.prune_api_caches(%s);', 30);

  select jobid into existing_jobid
  from cron.job
  where jobname = 'prune_api_caches_daily'
  limit 1;

  if existing_jobid is not null then
    perform cron.unschedule(existing_jobid);
  end if;

  perform cron.schedule(
    'prune_api_caches_daily',
    '20 3 * * *',
    command_sql
  );
end $$;

-- Notify PostgREST to reload schema
notify pgrst, 'reload schema';
