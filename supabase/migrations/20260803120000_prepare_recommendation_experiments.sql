-- Prepare recommendation experiment telemetry (checkpoint 2C.2).
--
-- Extends the bounded versioned exposure schema from 2B.2 so persisted
-- exposures can carry a controlled experiment assignment for online
-- measurement:
--   * adds experiment_config_version with the zero default/backfill
--     ('0000000000000000' marks default/no-experiment traffic),
--   * adds assignment_hash with the zero default/backfill (active exposures
--     carry the bounded 16-char lowercase hex assignment hash that matches a
--     server-owned registry row; default traffic carries the zero hash),
--   * permits only the controlled experiment buckets
--     (default/control/treatment) instead of only 'default',
--   * enforces the bucket/config/hash pairing invariant: the default bucket
--     pairs only with the zero config version and zero assignment hash, and
--     active buckets (control/treatment) pair only with a nonzero 16-char
--     lowercase hex config version and assignment hash,
--   * creates the server-owned assignment registry
--     (recommendation_experiment_assignments) with bounded checks, indexes,
--     and RLS: only service_role holds policies, authenticated holds none,
--   * replaces the write guard trigger so it validates the experiment fields
--     and requires a matching registry row (assignment hash + same owner +
--     engine/config/bucket) for every active exposure while preserving every
--     2B.2 minimization and retention behavior. Browser default exposures
--     (zero config + zero assignment hash) remain writable by their owner,
--   * adds a service-role-only SECURITY DEFINER registration RPC with an
--     empty search path and bounded validation,
--   * adds the indexes required by the bounded exposure-to-feedback joins,
--   * adds the additive server-controlled suggestion_feedback.feedback_event_at
--     event time (backfilled from created_at, NOT NULL/default now(), forced
--     on every insert and update by an idempotent BEFORE trigger) so the
--     pure join has a reliable time projection, and adds the idempotent
--     owner-scoped authenticated UPDATE policy production upserts require
--     (USING and WITH CHECK (select auth.uid()) = user_id); every existing
--     feedback policy remains intact.
--
-- Data minimization is unchanged: only the canonical version fields and the
-- bounded diagnostic maps may carry values. The experiment config version
-- and assignment hash are hashes; the registry stores only the bounded
-- subject hash, never raw assignment/experiment keys or material.

-- ---------------------------------------------------------------------------
-- Forward-only constraint refresh: drop every constraint this migration
-- replaces before recreating it so reruns stay idempotent. The input
-- revision, rank, and bounded diagnostic-map constraints from 2B.2 are
-- unchanged and remain in force.
-- ---------------------------------------------------------------------------

alter table public.suggestion_exposure_log
  drop constraint if exists suggestion_exposure_log_engine_version_bounds,
  drop constraint if exists suggestion_exposure_log_experiment_bucket_bounds,
  drop constraint if exists suggestion_exposure_log_experiment_config_version_bounds,
  drop constraint if exists suggestion_exposure_log_assignment_hash_bounds,
  drop constraint if exists suggestion_exposure_log_canonical_fields_bounds;

-- Drop the write guard before schema and backfill work so rerunnable
-- migration-time updates never trip the record validation; the updated
-- guard is recreated after the constraints and indexes are in place.
drop trigger if exists suggestion_exposure_log_version_guard on public.suggestion_exposure_log;

-- ---------------------------------------------------------------------------
-- Experiment config version column. NOT NULL with the zero default so the
-- ADD COLUMN backfills every existing row (legacy rows included) with the
-- default/no-experiment marker.
-- ---------------------------------------------------------------------------

alter table public.suggestion_exposure_log
  add column if not exists experiment_config_version text not null default '0000000000000000';

comment on column public.suggestion_exposure_log.experiment_config_version is
  'Hashed 16-char lowercase hex experiment config version; zero for default/no-experiment traffic.';

-- ---------------------------------------------------------------------------
-- Assignment hash column. NOT NULL with the zero default so the ADD COLUMN
-- backfills every existing row (legacy rows included) with the
-- default/no-experiment marker. Active exposures carry the bounded hash
-- that matches a server-owned registry row.
-- ---------------------------------------------------------------------------

alter table public.suggestion_exposure_log
  add column if not exists assignment_hash text not null default '0000000000000000';

comment on column public.suggestion_exposure_log.assignment_hash is
  'Hashed 16-char lowercase hex experiment assignment hash; zero for default/no-experiment traffic.';

-- Rerunnable zero backfill: default-bucket and legacy rows always carry the
-- zero config version and zero assignment hash, even on a rerun that
-- encounters dirty values. Active bucket rows keep their nonzero values.
update public.suggestion_exposure_log
   set experiment_config_version = '0000000000000000'
 where experiment_config_version <> '0000000000000000'
   and (experiment_bucket is null or experiment_bucket = 'default');

update public.suggestion_exposure_log
   set assignment_hash = '0000000000000000'
 where assignment_hash <> '0000000000000000'
   and (experiment_bucket is null or experiment_bucket = 'default');

-- ---------------------------------------------------------------------------
-- Server-owned assignment registry. One row per deterministic experiment
-- assignment, written only by the service role (via the registration RPC).
-- Stores only bounded hashes and controlled labels: the assignment hash,
-- the owner, the assignment unit, the bounded subject hash (never the raw
-- subject), the engine version, the config version, the bucket, and the
-- assignment time. RLS is enabled with service_role-only policies:
-- authenticated and anon hold no policies, so authenticated writers can
-- never read or write registry rows; the exposure write guard relies on
-- that boundary to reject forged active exposures.
-- ---------------------------------------------------------------------------

create table if not exists public.recommendation_experiment_assignments (
  assignment_hash text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_unit text not null,
  subject_hash text not null,
  engine_version text not null,
  config_version text not null,
  bucket text not null,
  assigned_at timestamptz not null default now(),
  primary key (assignment_hash, user_id)
);

comment on table public.recommendation_experiment_assignments is
  'Server-owned deterministic experiment assignment registry; service_role writes only; bounded hashes, never raw keys.';
comment on column public.recommendation_experiment_assignments.assignment_hash is
  'Bounded 16-char lowercase hex assignment hash; part of the primary key.';
comment on column public.recommendation_experiment_assignments.user_id is
  'Owner of the assignment; cascades with the auth user.';
comment on column public.recommendation_experiment_assignments.assignment_unit is
  'Controlled assignment unit: user or request.';
comment on column public.recommendation_experiment_assignments.subject_hash is
  'Bounded 16-char lowercase hex hash of the assignment subject; never the raw subject.';
comment on column public.recommendation_experiment_assignments.engine_version is
  'Canonical engine version recorded at assignment time.';
comment on column public.recommendation_experiment_assignments.config_version is
  'Nonzero 16-char lowercase hex experiment config version derived from the operative config.';
comment on column public.recommendation_experiment_assignments.bucket is
  'Controlled bucket: control or treatment.';
comment on column public.recommendation_experiment_assignments.assigned_at is
  'Server assignment timestamp; preserved across idempotent re-registration.';

alter table public.recommendation_experiment_assignments
  drop constraint if exists recommendation_experiment_assignments_assignment_hash_bounds,
  drop constraint if exists recommendation_experiment_assignments_unit_bounds,
  drop constraint if exists recommendation_experiment_assignments_subject_hash_bounds,
  drop constraint if exists recommendation_experiment_assignments_engine_bounds,
  drop constraint if exists recommendation_experiment_assignments_config_bounds,
  drop constraint if exists recommendation_experiment_assignments_bucket_bounds;

alter table public.recommendation_experiment_assignments
  add constraint recommendation_experiment_assignments_assignment_hash_bounds
    check (
      assignment_hash ~ '^[0-9a-f]{16}$'
      and assignment_hash <> '0000000000000000'
    ),
  add constraint recommendation_experiment_assignments_unit_bounds
    check (assignment_unit in ('user', 'request')),
  add constraint recommendation_experiment_assignments_subject_hash_bounds
    check (subject_hash ~ '^[0-9a-f]{16}$'),
  add constraint recommendation_experiment_assignments_engine_bounds
    check (engine_version = 'v1-canonical-1'),
  add constraint recommendation_experiment_assignments_config_bounds
    check (
      config_version ~ '^[0-9a-f]{16}$'
      and config_version <> '0000000000000000'
    ),
  add constraint recommendation_experiment_assignments_bucket_bounds
    check (bucket in ('control', 'treatment'));

-- Bounded indexes: the primary key serves the write-guard evidence lookup
-- (assignment_hash, user_id); the owner index serves owner-scoped lifecycle
-- queries.
create index if not exists recommendation_experiment_assignments_user_idx
  on public.recommendation_experiment_assignments (user_id, assigned_at desc);

alter table public.recommendation_experiment_assignments
  enable row level security;

-- Service-role-only policies, created idempotently without dropping any
-- existing policy. Authenticated and anon intentionally hold no policy on
-- this table.
do $migration$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'recommendation_experiment_assignments'
      and policyname = 'recommendation_experiment_assignments_service_select'
  ) then
    create policy "recommendation_experiment_assignments_service_select"
      on public.recommendation_experiment_assignments
      for select
      to service_role
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'recommendation_experiment_assignments'
      and policyname = 'recommendation_experiment_assignments_service_insert'
  ) then
    create policy "recommendation_experiment_assignments_service_insert"
      on public.recommendation_experiment_assignments
      for insert
      to service_role
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'recommendation_experiment_assignments'
      and policyname = 'recommendation_experiment_assignments_service_delete'
  ) then
    create policy "recommendation_experiment_assignments_service_delete"
      on public.recommendation_experiment_assignments
      for delete
      to service_role
      using (true);
  end if;
end;
$migration$;

-- ---------------------------------------------------------------------------
-- Controlled bucket, config-version, and assignment-hash constraints. Legacy
-- rows (null version fields) remain valid with the zero config version and
-- zero assignment hash; versioned rows must carry the canonical engine
-- version, one of the exact controlled buckets, and the bucket/config/hash
-- pairing invariant.
-- ---------------------------------------------------------------------------

alter table public.suggestion_exposure_log
  add constraint suggestion_exposure_log_engine_version_bounds
    check (
      engine_version is null or (
        engine_version = 'v1-canonical-1'
        and experiment_bucket in ('default', 'control', 'treatment')
      )
    ),
  add constraint suggestion_exposure_log_experiment_bucket_bounds
    check (
      experiment_bucket is null or (
        experiment_bucket in ('default', 'control', 'treatment')
        and engine_version = 'v1-canonical-1'
      )
    ),
  add constraint suggestion_exposure_log_experiment_config_version_bounds
    check (
      experiment_config_version ~ '^[0-9a-f]{16}$'
      and (
        (
          experiment_bucket in ('control', 'treatment')
          and experiment_config_version <> '0000000000000000'
        )
        or (
          (experiment_bucket is null or experiment_bucket = 'default')
          and experiment_config_version = '0000000000000000'
        )
      )
    ),
  add constraint suggestion_exposure_log_assignment_hash_bounds
    check (
      assignment_hash ~ '^[0-9a-f]{16}$'
      and (
        (
          experiment_bucket in ('control', 'treatment')
          and assignment_hash <> '0000000000000000'
        )
        or (
          (experiment_bucket is null or experiment_bucket = 'default')
          and assignment_hash = '0000000000000000'
        )
      )
    ),
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
        and experiment_config_version = '0000000000000000'
        and assignment_hash = '0000000000000000'
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
        and experiment_bucket in ('default', 'control', 'treatment')
        and input_revision ~ '^[0-9a-f]{16}$'
        and pre_rank between 1 and 10000
        and post_rank between 1 and 10000
        and assignment_hash ~ '^[0-9a-f]{16}$'
        and (
          (
            experiment_bucket = 'default'
            and experiment_config_version = '0000000000000000'
            and assignment_hash = '0000000000000000'
          )
          or (
            experiment_bucket in ('control', 'treatment')
            and experiment_config_version ~ '^[0-9a-f]{16}$'
            and experiment_config_version <> '0000000000000000'
            and assignment_hash <> '0000000000000000'
          )
        )
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
-- Indexes for the bounded exposure-to-feedback joins: owner-scoped
-- per-movie latest-exposure lookups and bucket/config aggregate scans.
-- ---------------------------------------------------------------------------

create index if not exists suggestion_exposure_log_experiment_join_idx
  on public.suggestion_exposure_log (user_id, tmdb_id, exposed_at desc);
create index if not exists suggestion_exposure_log_experiment_bucket_idx
  on public.suggestion_exposure_log (experiment_bucket, experiment_config_version);

-- ---------------------------------------------------------------------------
-- Replaced write guard. SECURITY INVOKER with an empty search path, exactly
-- as in 2B.2: server-controlled timestamps plus the bounded 90-day retention
-- boundary on INSERT, preserved timestamps on UPDATE, every legacy payload
-- column nulled regardless of client input, and incomplete or non-canonical
-- records rejected with the stable SQLSTATE 22023 message. The experiment
-- validation now accepts the exact controlled buckets, enforces the
-- bucket/config/hash pairing invariant, defaults absent config/hash values
-- to the zero markers, and requires a matching server-owned registry row
-- (assignment hash + same owner + engine/config/bucket) for every active
-- exposure. The registry lookup runs as the invoking role: the service role
-- sees registered rows, while authenticated writers see none through RLS,
-- so authenticated direct active exposures are rejected and browser default
-- exposures (zero config + zero hash, no registry lookup) keep working.
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

  if new.experiment_config_version is null then
    new.experiment_config_version := '0000000000000000';
  end if;

  if new.assignment_hash is null then
    new.assignment_hash := '0000000000000000';
  end if;

  if new.engine_version is distinct from 'v1-canonical-1'
    or new.experiment_bucket is null
    or new.experiment_bucket not in ('default', 'control', 'treatment')
    or (
      new.experiment_bucket = 'default'
      and new.experiment_config_version is distinct from '0000000000000000'
    )
    or (
      new.experiment_bucket = 'default'
      and new.assignment_hash is distinct from '0000000000000000'
    )
    or (
      new.experiment_bucket in ('control', 'treatment')
      and (
        new.experiment_config_version is null
        or new.experiment_config_version !~ '^[0-9a-f]{16}$'
        or new.experiment_config_version = '0000000000000000'
      )
    )
    or (
      new.experiment_bucket in ('control', 'treatment')
      and (
        new.assignment_hash !~ '^[0-9a-f]{16}$'
        or new.assignment_hash = '0000000000000000'
      )
    )
    or (
      new.experiment_bucket in ('control', 'treatment')
      and not exists (
        select 1
        from public.recommendation_experiment_assignments as assignment_evidence
        where assignment_evidence.assignment_hash = new.assignment_hash
          and assignment_evidence.user_id = new.user_id
          and assignment_evidence.engine_version = new.engine_version
          and assignment_evidence.config_version = new.experiment_config_version
          and assignment_evidence.bucket = new.experiment_bucket
      )
    )
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
-- Service-role-only registration RPC. SECURITY DEFINER with an empty search
-- path so the service role can write registry rows regardless of RLS on the
-- caller path; the explicit role guard and the EXECUTE grant keep it out of
-- authenticated and anon reach. Validates every bounded field and rejects
-- zero/malformed hashes, unknown units/buckets, and non-canonical engine
-- versions with the stable SQLSTATE 22023 message.
--
-- Registration is immutable: it is idempotent only for an exact existing
-- match. A new key inserts; an exact replay returns true and keeps the
-- existing row and its original assigned_at verbatim. If the key exists with
-- any different assignment_unit, subject_hash, engine_version,
-- config_version, or bucket, the RPC raises the stable SQLSTATE 22023 and
-- never rewrites assignment evidence or assigned_at. Accepts only hashes
-- and controlled labels; raw subjects never cross this boundary.
-- ---------------------------------------------------------------------------

create or replace function public.register_recommendation_experiment_assignment(
  p_assignment_hash text,
  p_user_id uuid,
  p_assignment_unit text,
  p_subject_hash text,
  p_engine_version text,
  p_config_version text,
  p_bucket text
)
returns boolean
language plpgsql
volatile
security definer
set search_path to ''
as $body$
declare
  v_existing record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_assignment_hash is null
    or p_assignment_hash !~ '^[0-9a-f]{16}$'
    or p_assignment_hash = '0000000000000000'
    or p_user_id is null
    or p_assignment_unit is null
    or p_assignment_unit not in ('user', 'request')
    or p_subject_hash is null
    or p_subject_hash !~ '^[0-9a-f]{16}$'
    or p_engine_version is distinct from 'v1-canonical-1'
    or p_config_version is null
    or p_config_version !~ '^[0-9a-f]{16}$'
    or p_config_version = '0000000000000000'
    or p_bucket is null
    or p_bucket not in ('control', 'treatment') then
    raise exception 'invalid experiment assignment' using errcode = '22023';
  end if;

  -- Never rewrite evidence: a conflicting key skips the insert entirely,
  -- then the persisted row is verified as an exact match. on conflict do
  -- nothing serializes concurrent registrations on the same key, so the
  -- read-back always sees the surviving row.
  insert into public.recommendation_experiment_assignments (
    assignment_hash, user_id, assignment_unit, subject_hash,
    engine_version, config_version, bucket
  ) values (
    p_assignment_hash, p_user_id, p_assignment_unit, p_subject_hash,
    p_engine_version, p_config_version, p_bucket
  )
  on conflict (assignment_hash, user_id) do nothing;

  select assignment_unit, subject_hash, engine_version, config_version, bucket
    into v_existing
    from public.recommendation_experiment_assignments
   where assignment_hash = p_assignment_hash
     and user_id = p_user_id;

  if not found
    or v_existing.assignment_unit is distinct from p_assignment_unit
    or v_existing.subject_hash is distinct from p_subject_hash
    or v_existing.engine_version is distinct from p_engine_version
    or v_existing.config_version is distinct from p_config_version
    or v_existing.bucket is distinct from p_bucket then
    raise exception 'conflicting experiment assignment' using errcode = '22023';
  end if;

  return true;
end;
$body$;

revoke all on function public.register_recommendation_experiment_assignment(text, uuid, text, text, text, text, text) from public;
revoke all on function public.register_recommendation_experiment_assignment(text, uuid, text, text, text, text, text) from anon;
revoke all on function public.register_recommendation_experiment_assignment(text, uuid, text, text, text, text, text) from authenticated;
grant execute on function public.register_recommendation_experiment_assignment(text, uuid, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Server-controlled feedback event time (checkpoint 2C.2 join input).
-- suggestion_feedback is unique per user/movie and created_at does not
-- advance on upsert, so the pure exposure-to-feedback join needs a reliable
-- server-controlled event time: add the additive feedback_event_at column,
-- backfill every existing row from created_at, then make it NOT NULL with a
-- now() default, and force it on every insert and update through an
-- idempotent BEFORE trigger. Client-supplied event times never persist.
-- The only RLS change is the additive owner-scoped authenticated UPDATE
-- policy required by production upserts (added below, after the trigger);
-- every existing feedback policy remains untouched. No production query or
-- RPC is added by this checkpoint.
-- ---------------------------------------------------------------------------

alter table public.suggestion_feedback
  add column if not exists feedback_event_at timestamptz;

-- Rerunnable backfill: every pre-existing row projects its original event
-- time from created_at before the NOT NULL constraint is applied.
update public.suggestion_feedback
   set feedback_event_at = created_at
 where feedback_event_at is null;

alter table public.suggestion_feedback
  alter column feedback_event_at set default now();

alter table public.suggestion_feedback
  alter column feedback_event_at set not null;

comment on column public.suggestion_feedback.feedback_event_at is
  'Server-controlled feedback event timestamp; forced to now() on every insert and update; backfilled from created_at.';

create or replace function public.enforce_feedback_event_at()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $body$
begin
  new.feedback_event_at := now();
  return new;
end;
$body$;

revoke all on function public.enforce_feedback_event_at() from public;
revoke all on function public.enforce_feedback_event_at() from anon;
grant execute on function public.enforce_feedback_event_at() to authenticated;
grant execute on function public.enforce_feedback_event_at() to service_role;

drop trigger if exists suggestion_feedback_event_at_guard on public.suggestion_feedback;
create trigger suggestion_feedback_event_at_guard
  before insert or update on public.suggestion_feedback
  for each row
  execute function public.enforce_feedback_event_at();

-- ---------------------------------------------------------------------------
-- Owner-scoped authenticated update policy (checkpoint 2C.2 upsert path).
-- Production feedback writes upsert on (user_id, tmdb_id): the DO UPDATE arm
-- requires an owner-scoped authenticated UPDATE policy in addition to the
-- existing select/insert/delete policies, or every conflicting upsert fails
-- closed. Adds exactly that one policy, idempotently guarded by pg_policies;
-- every existing policy remains intact and untouched. Both USING and WITH
-- CHECK are owner-scoped, so an owner can only rewrite their own row and can
-- never move it to another owner.
-- ---------------------------------------------------------------------------

do $migration$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'suggestion_feedback'
      and policyname = 'suggestion_feedback_owner_update'
  ) then
    create policy "suggestion_feedback_owner_update"
      on public.suggestion_feedback
      for update
      to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;
end;
$migration$;

-- Notify PostgREST to reload schema
notify pgrst, 'reload schema';
