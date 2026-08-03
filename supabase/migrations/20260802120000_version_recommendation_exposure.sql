-- Version recommendation exposure telemetry (checkpoint 2B.2).
--
-- Adds bounded versioned diagnostics to suggestion_exposure_log so persisted
-- exposures carry the engine version, controlled experiment bucket, hashed
-- input revision, pre/post rank, bounded drop-reason counts, and bounded
-- source-family shares required for versioned online measurement.
--
-- Data minimization: only the minimized canonical exposure fields (owner,
-- tmdb id, server exposure timestamp, retention marker, engine version,
-- bucket, hashed input revision, pre/post rank, and the bounded diagnostic
-- maps) may carry values. A migration-time update clears every legacy
-- telemetry payload column on existing rows, and a SECURITY INVOKER BEFORE
-- INSERT OR UPDATE trigger forces server timestamps plus the bounded 90-day retention
-- boundary, nulls every legacy payload column (category, session_context,
-- base_score, consensus_level, sources, reasons, mmr_lambda, diversity_rank,
-- has_poster, has_trailer, metadata_completeness) regardless of client
-- input, and rejects incomplete or non-canonical records with SQLSTATE
-- 22023. Diagnostic maps are check-constrained to exact allowlisted keys
-- with bounded cardinality, key length, serialized size, and integer values.
-- Retention is bounded (90 days) and enforced by a privileged prune job.

-- ---------------------------------------------------------------------------
-- Forward-only constraint refresh: drop every versioned bounds constraint
-- before recreating it so reruns stay idempotent and the legacy bounded-map
-- helper can be replaced by the exact-allowlist overload below.
-- ---------------------------------------------------------------------------

alter table public.suggestion_exposure_log
  drop constraint if exists suggestion_exposure_log_engine_version_bounds,
  drop constraint if exists suggestion_exposure_log_experiment_bucket_bounds,
  drop constraint if exists suggestion_exposure_log_input_revision_bounds,
  drop constraint if exists suggestion_exposure_log_rank_bounds,
  drop constraint if exists suggestion_exposure_log_drop_reason_counts_bounds,
  drop constraint if exists suggestion_exposure_log_source_shares_bounds,
  drop constraint if exists suggestion_exposure_log_canonical_fields_bounds;

drop function if exists public.bounded_jsonb_object(jsonb, integer, numeric);

-- ---------------------------------------------------------------------------
-- Bounded allowlisted jsonb diagnostic map. Immutable so it can back check
-- constraints; SECURITY INVOKER with an empty search path and no data
-- access, so it exposes no privileged behavior.
--
-- Accepts NULL or a jsonb object satisfying every bound:
--   * at most max_keys entries,
--   * serialized text of at most max_serialized_bytes octets,
--   * every key at most max_key_length chars and present in allowed_keys,
--   * every value a jsonb number that is an integer in [0, max_value].
-- Arbitrary JWT/reason strings cannot hide in keys or values. The CASE
-- forces branch ordering so non-object jsonb fails closed without
-- evaluation errors from key extraction on scalars or arrays.
-- ---------------------------------------------------------------------------

create or replace function public.bounded_jsonb_object(
  value jsonb,
  allowed_keys text[],
  max_keys integer,
  max_key_length integer,
  max_serialized_bytes integer,
  max_value integer
)
returns boolean
language sql
immutable
security invoker
set search_path to ''
as $body$
  select value is null
    or case jsonb_typeof(value)
      when 'object' then
        (select count(*) from jsonb_each(value)) <= max_keys
        and octet_length(value::text) <= max_serialized_bytes
        and not exists (
          select 1
          from jsonb_each(value) as entries(entry_key, entry_value)
          where char_length(entries.entry_key) > max_key_length
            or array_position(allowed_keys, entries.entry_key) is null
            or case jsonb_typeof(entries.entry_value)
              when 'number' then
                trunc((entries.entry_value #>> '{}')::numeric)
                   <> (entries.entry_value #>> '{}')::numeric
                or (entries.entry_value #>> '{}')::numeric < 0
                or (entries.entry_value #>> '{}')::numeric > max_value
              else true
            end
        )
      else false
    end;
$body$;

revoke all on function public.bounded_jsonb_object(jsonb, text[], integer, integer, integer, integer) from public;
revoke all on function public.bounded_jsonb_object(jsonb, text[], integer, integer, integer, integer) from anon;
grant execute on function public.bounded_jsonb_object(jsonb, text[], integer, integer, integer, integer) to authenticated;
grant execute on function public.bounded_jsonb_object(jsonb, text[], integer, integer, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Bounded versioned exposure columns. Nullable for legacy rows except the
-- retention marker, which defaults every row (legacy included) into the
-- bounded 90-day retention window.
-- ---------------------------------------------------------------------------

alter table public.suggestion_exposure_log
  add column if not exists engine_version text,
  add column if not exists experiment_bucket text,
  add column if not exists input_revision text,
  add column if not exists pre_rank integer,
  add column if not exists post_rank integer,
  add column if not exists drop_reason_counts jsonb,
  add column if not exists source_shares jsonb,
  add column if not exists retention_until timestamptz not null default (now() + interval '90 days');

comment on column public.suggestion_exposure_log.engine_version is
  'Canonical engine version from the bounded trace allowlist; null for legacy rows.';
comment on column public.suggestion_exposure_log.experiment_bucket is
  'Controlled experiment bucket from the bounded trace allowlist; null for legacy rows.';
comment on column public.suggestion_exposure_log.input_revision is
  'Hashed 16-char lowercase hex recommendation input revision; never raw inputs.';
comment on column public.suggestion_exposure_log.pre_rank is
  '1-based rank before reranking at exposure time.';
comment on column public.suggestion_exposure_log.post_rank is
  '1-based final presentation rank at exposure time.';
comment on column public.suggestion_exposure_log.drop_reason_counts is
  'Bounded map of allowlisted drop reasons to counts from the canonical trace.';
comment on column public.suggestion_exposure_log.source_shares is
  'Bounded map of allowlisted provider families to result counts from the canonical trace.';
comment on column public.suggestion_exposure_log.retention_until is
  'Bounded retention marker; rows past this instant are pruned by the privileged cron job.';

-- ---------------------------------------------------------------------------
-- Bounded value constraints. Legacy rows (null version fields) remain valid;
-- versioned rows must carry the exact canonical engine version paired with
-- the exact default bucket, a 16-char lowercase hex input revision, ranks in
-- 1..10000, and diagnostic maps restricted to the exact allowlisted keys
-- with bounded integer values. Forward-only: constraints are dropped above
-- and recreated here so reruns stay idempotent.
-- ---------------------------------------------------------------------------

alter table public.suggestion_exposure_log
  add constraint suggestion_exposure_log_engine_version_bounds
    check (
      engine_version is null or (
        engine_version = 'v1-canonical-1'
        and experiment_bucket = 'default'
      )
    ),
  add constraint suggestion_exposure_log_experiment_bucket_bounds
    check (
      experiment_bucket is null or (
        experiment_bucket = 'default'
        and engine_version = 'v1-canonical-1'
      )
    ),
  add constraint suggestion_exposure_log_input_revision_bounds
    check (
      input_revision is null or input_revision ~ '^[0-9a-f]{16}$'
    ),
  add constraint suggestion_exposure_log_rank_bounds
    check (
      (pre_rank is null or pre_rank between 1 and 10000)
      and (post_rank is null or post_rank between 1 and 10000)
    ),
  add constraint suggestion_exposure_log_drop_reason_counts_bounds
    check (public.bounded_jsonb_object(
      drop_reason_counts,
      array[
        'seed', 'excluded', 'blocked', 'watched', 'genre', 'negative',
        'duplicate', 'invalid_score', 'source_failed',
        'insufficient_evidence', 'diversity'
      ],
      11, 32, 1024, 10000
    )),
  add constraint suggestion_exposure_log_source_shares_bounds
    check (public.bounded_jsonb_object(
      source_shares,
      array['letterboxd', 'tastedive', 'tmdb', 'tuimdb', 'vector-similarity', 'watchmode'],
      6, 32, 512, 10000
    )),
  add constraint suggestion_exposure_log_canonical_fields_bounds
    check (
      (
        engine_version is null
        and experiment_bucket is null
        and input_revision is null
        and pre_rank is null
        and post_rank is null
        and drop_reason_counts is null
        and source_shares is null
      )
      or (
        engine_version is not null
        and experiment_bucket is not null
        and input_revision is not null
        and pre_rank is not null
        and post_rank is not null
        and drop_reason_counts is not null
        and source_shares is not null
        and engine_version = 'v1-canonical-1'
        and experiment_bucket = 'default'
        and input_revision ~ '^[0-9a-f]{16}$'
        and pre_rank between 1 and 10000
        and post_rank between 1 and 10000
        and public.bounded_jsonb_object(
          drop_reason_counts,
          array[
            'seed', 'excluded', 'blocked', 'watched', 'genre', 'negative',
            'duplicate', 'invalid_score', 'source_failed',
            'insufficient_evidence', 'diversity'
          ],
          11, 32, 1024, 10000
        )
        and public.bounded_jsonb_object(
          source_shares,
          array['letterboxd', 'tastedive', 'tmdb', 'tuimdb', 'vector-similarity', 'watchmode'],
          6, 32, 512, 10000
        )
      )
    );

-- ---------------------------------------------------------------------------
-- Indexes: retention pruning and owner-scoped recent-exposure lookups.
-- ---------------------------------------------------------------------------

create index if not exists suggestion_exposure_log_retention_until_idx
  on public.suggestion_exposure_log (retention_until);
create index if not exists suggestion_exposure_log_user_exposed_at_idx
  on public.suggestion_exposure_log (user_id, exposed_at desc);

-- ---------------------------------------------------------------------------
-- Restricted bounded aggregate for admin diagnostics. The RPC deliberately
-- exposes one fixed row of capped counts and no exposure rows, reasons, or
-- candidate data. All four aggregates read the table through one SELECT; the
-- owner count preserves the existing admin-health field's owner scope while
-- the other counts remain global.
-- ---------------------------------------------------------------------------

drop function if exists public.get_bounded_exposure_diagnostics();
drop function if exists public.get_bounded_exposure_diagnostics(uuid);

create or replace function public.get_bounded_exposure_diagnostics(
  p_owner_user_id uuid
)
returns table (
  total_count integer,
  owner_count integer,
  current_engine_count integer,
  default_bucket_count integer
)
language sql
stable
security definer
set search_path to ''
as $body$
  select
    least(count(*), 10000::bigint)::integer as total_count,
    least(
      count(*) filter (where user_id = p_owner_user_id),
      10000::bigint
    )::integer as owner_count,
    least(
      count(*) filter (where engine_version = 'v1-canonical-1'),
      10000::bigint
    )::integer as current_engine_count,
    least(
      count(*) filter (where experiment_bucket = 'default'),
      10000::bigint
    )::integer as default_bucket_count
  from public.suggestion_exposure_log;
$body$;

revoke all on function public.get_bounded_exposure_diagnostics(uuid) from public;
revoke all on function public.get_bounded_exposure_diagnostics(uuid) from anon;
revoke all on function public.get_bounded_exposure_diagnostics(uuid) from authenticated;
revoke all on function public.get_bounded_exposure_diagnostics(uuid) from service_role;
grant execute on function public.get_bounded_exposure_diagnostics(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- One-time bounded retention enforcement for rows predating the guard
-- trigger. Legacy rows (null version fields) remain valid; only timestamps
-- are bounded:
--   1. Prune rows already past the 90-day retention window.
--   2. Clamp client-supplied future exposed_at values to the server clock.
--   3. Cap retention_until at exposed_at + 90 days so no row, however
--      dated, can outlive the true retention boundary.
-- ---------------------------------------------------------------------------

-- A rerun may encounter the guard created by an earlier application of this
-- migration. Remove it before the migration-time UPDATEs so legacy-null rows
-- remain deployable; the current guard is recreated after the backfill.
drop trigger if exists suggestion_exposure_log_version_guard on public.suggestion_exposure_log;

delete from public.suggestion_exposure_log
 where exposed_at < now() - interval '90 days'
    or retention_until < now();

update public.suggestion_exposure_log
   set exposed_at = least(exposed_at, now())
 where exposed_at > now();

update public.suggestion_exposure_log
   set retention_until = least(retention_until, exposed_at + interval '90 days')
 where retention_until > exposed_at + interval '90 days';

-- ---------------------------------------------------------------------------
-- One-time legacy telemetry minimization for rows predating the versioned
-- schema. Existing rows keep their identity (id), ownership (user_id),
-- tmdb_id, exposed_at/created_at timestamps, retention marker, and any
-- canonical version fields; every legacy scoring/context payload column is
-- cleared. All legacy payload columns are nullable (no NOT NULL constraint
-- or default in the creating migration), so NULL is the minimal cleared
-- value for each and no empty substitute is required. The WHERE clause keeps
-- the statement rerunnable: it only touches rows still carrying legacy data.
-- ---------------------------------------------------------------------------

update public.suggestion_exposure_log
   set category = null,
       session_context = null,
       base_score = null,
       consensus_level = null,
       sources = null,
       reasons = null,
       mmr_lambda = null,
       diversity_rank = null,
       has_poster = null,
       has_trailer = null,
       metadata_completeness = null
 where category is not null
    or session_context is not null
    or base_score is not null
    or consensus_level is not null
    or sources is not null
    or reasons is not null
    or mmr_lambda is not null
    or diversity_rank is not null
    or has_poster is not null
    or has_trailer is not null
    or metadata_completeness is not null;

-- ---------------------------------------------------------------------------
-- BEFORE INSERT OR UPDATE guard for every exposure write. SECURITY INVOKER
-- with an empty search path: it runs with the writing role's privileges,
-- forces server-controlled timestamps plus the bounded 90-day retention
-- boundary on INSERT, preserves both original timestamps on UPDATE, nulls
-- every legacy payload column regardless of client input, and rejects
-- incomplete or non-canonical records with the stable SQLSTATE 22023
-- message. A write is accepted only with the exact canonical engine version
-- paired with the exact default bucket, a 16-char lowercase hex input
-- revision, ranks in 1..10000, and non-null bounded allowlisted diagnostic
-- maps; the matching check constraints remain as defense in depth for paths
-- that bypass the trigger. EXECUTE is granted only to the roles that write
-- exposure rows (owner RLS inserts and the service-role writer); the trigger
-- cannot run for anyone else.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_versioned_exposure_insert()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $body$
begin
  if tg_op = 'INSERT' then
    new.exposed_at := now();
    new.retention_until := now() + interval '90 days';
  else
    new.exposed_at := old.exposed_at;
    new.retention_until := old.retention_until;
  end if;

  new.category := null;
  new.session_context := null;
  new.base_score := null;
  new.consensus_level := null;
  new.sources := null;
  new.reasons := null;
  new.mmr_lambda := null;
  new.diversity_rank := null;
  new.has_poster := null;
  new.has_trailer := null;
  new.metadata_completeness := null;

  if new.engine_version is distinct from 'v1-canonical-1'
    or new.experiment_bucket is distinct from 'default'
    or new.input_revision is null
    or new.input_revision !~ '^[0-9a-f]{16}$'
    or new.pre_rank is null
    or new.pre_rank not between 1 and 10000
    or new.post_rank is null
    or new.post_rank not between 1 and 10000
    or new.drop_reason_counts is null
    or not public.bounded_jsonb_object(
      new.drop_reason_counts,
      array[
        'seed', 'excluded', 'blocked', 'watched', 'genre', 'negative',
        'duplicate', 'invalid_score', 'source_failed',
        'insufficient_evidence', 'diversity'
      ],
      11, 32, 1024, 10000
    )
    or new.source_shares is null
    or not public.bounded_jsonb_object(
      new.source_shares,
      array['letterboxd', 'tastedive', 'tmdb', 'tuimdb', 'vector-similarity', 'watchmode'],
      6, 32, 512, 10000
    ) then
    raise exception 'incomplete versioned exposure record' using errcode = '22023';
  end if;

  return new;
end;
$body$;

revoke all on function public.enforce_versioned_exposure_insert() from public;
revoke all on function public.enforce_versioned_exposure_insert() from anon;
grant execute on function public.enforce_versioned_exposure_insert() to authenticated;
grant execute on function public.enforce_versioned_exposure_insert() to service_role;

create trigger suggestion_exposure_log_version_guard
  before insert or update on public.suggestion_exposure_log
  for each row
  execute function public.enforce_versioned_exposure_insert();

-- ---------------------------------------------------------------------------
-- Bounded retention enforcement. Privileged definer with an empty search
-- path; only the owner/cron can execute it. Deletes rows past their bounded
-- retention marker and rows older than the retention window itself.
-- ---------------------------------------------------------------------------

create or replace function public.prune_suggestion_exposures(
  retention_days integer default 90
)
returns integer
language plpgsql
security definer
set search_path to ''
as $body$
declare
  cutoff timestamptz := now() - make_interval(days => retention_days);
  deleted_count integer;
begin
  delete from public.suggestion_exposure_log
   where retention_until < now()
      or exposed_at < cutoff;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$body$;

revoke all on function public.prune_suggestion_exposures(integer) from public;
revoke all on function public.prune_suggestion_exposures(integer) from anon;

-- (Re)create the daily prune job. Idempotent: unschedule an existing job with
-- the same name before scheduling. Runs shortly after the cache prune job.
do $migration$
declare
  existing_jobid integer;
begin
  select jobid into existing_jobid
  from cron.job
  where jobname = 'prune_suggestion_exposures_daily'
  limit 1;

  if existing_jobid is not null then
    perform cron.unschedule(existing_jobid);
  end if;

  perform cron.schedule(
    'prune_suggestion_exposures_daily',
    '35 3 * * *',
    'select public.prune_suggestion_exposures(90);'
  );
end $migration$;

-- Notify PostgREST to reload schema
notify pgrst, 'reload schema';
