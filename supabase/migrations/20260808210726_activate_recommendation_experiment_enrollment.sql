-- Recommendation experiment enrollment control plane (checkpoint 3.1A).
--
-- Builds INACTIVE infrastructure only: this migration activates nothing.
-- Enrollment activation can happen only through the service-role-only RPCs
-- below (production activation is owned by checkpoint 3.1B) or inside
-- transaction-isolated tests.
--
--   * creates the service-owned recommendation_experiment_enrollments table
--     bounded to the frozen A/A contract: bounded experiment key regex,
--     unique nonzero 16-char lowercase hex config version, exact
--     v1-canonical-1 engine, exact user assignment unit, exact 0.5/0.5
--     split, exact 14-day windows (ends_at = starts_at + 14 days), and a
--     deactivated_at that is null or at/after the window start,
--   * enables RLS with no policies and revokes every direct table privilege
--     from PUBLIC, anon, authenticated, and service_role: enrollment rows are
--     reachable only through the SECURITY DEFINER RPCs below,
--   * adds a SECURITY DEFINER BEFORE UPDATE OR DELETE guard trigger with an
--     empty search path: DELETE is always rejected, every metadata change is
--     rejected, and only a single null -> timestamp deactivated_at transition
--     plus the exact idempotent unchanged row are permitted,
--   * recreates the existing exposure write guard
--     public.enforce_versioned_exposure_insert() as SECURITY DEFINER with
--     an empty search path, preserving the exact 2C.2 body (server
--     timestamps, legacy payload nulling, zero defaulting, bucket
--     allowlist, assignment-triple pairing, bounded diagnostics, and the
--     registry evidence check) and adding the enrollment lifecycle gate:
--     controlled buckets serialize on the lifecycle advisory lock and
--     require the exact active frozen enrollment at one captured clock
--     timestamp, while default exposures take neither the lock nor the
--     check. The definer identity lets the guard's registry evidence
--     lookup see service-owned registry rows for every writer, so an
--     authenticated owner can persist an active exposure only when the
--     exact service registry evidence exists; no direct registry table
--     access is granted, and the prior EXECUTE revokes/grants are
--     reissued unchanged,
--   * activation RPC: validates the exact frozen contract, serializes on the
--     fixed advisory transaction lock, assigns clock_timestamp() once with
--     the exact 14-day end, rejects duplicates and undeactivated half-open
--     overlaps with stable 22023 messages, inserts once, never updates,
--   * deactivation RPC: unknown enrollments return zero rows; an active row
--     gains deactivated_at = clock_timestamp() and is returned; an already
--     deactivated row is returned unchanged,
--   * active read RPC: at most one undeactivated row whose half-open window
--     contains clock_timestamp(),
--   * PARTIAL unique registry index (user_id, assignment_unit,
--     engine_version, config_version) WHERE assignment_unit = 'user',
--     backing exactly one stored assignment per user-level
--     user/unit/engine/config tuple, created only after an explicit
--     user-scoped duplicate-group check fails clearly instead of removing
--     evidence; request-level assignments keep their (assignment_hash,
--     user_id) primary-key semantics and may carry distinct subject hashes
--     for one user/config,
--   * redefines the existing registration RPC
--     register_recommendation_experiment_assignment(text, uuid, text, text,
--     text, text, text) via CREATE OR REPLACE without changing its
--     signature, boolean return, or service-role-only ACL: every bounded
--     validation and the exact replay contract are preserved; user-level
--     tuples serialize on the same deterministic advisory transaction lock
--     the resolver uses and are preflied by user/unit/engine/config before
--     insert (exact full replay returns true; differing hash/subject/bucket
--     raises the stable 22023 conflict, never raw 23505); any post-insert
--     unique violation is recovered deterministically by rereading;
--     request-level registrations keep the original assignment-hash/user
--     behavior without user tuple uniqueness,
--   * the atomic service-only resolver RPC, frozen to this user-level run:
--     every assignment unit other than user is rejected; the lifecycle
--     advisory lock is taken before the per-user lock and the exact frozen
--     active enrollment is revalidated at one captured clock timestamp with
--     the half-open window, returning zero rows when inactive; a stored
--     assignment wins after subject hash verification; otherwise the
--     registration RPC runs under the same reentrant transaction lock and
--     the exact row is re-read and returned,
--   * every RPC is revoked from PUBLIC, anon, and authenticated and granted
--     to service_role only.

-- ---------------------------------------------------------------------------
-- Enrollment table, bounded to the frozen A/A contract.
-- ---------------------------------------------------------------------------

create table if not exists public.recommendation_experiment_enrollments (
  experiment_key text not null,
  config_version text not null unique,
  engine_version text not null,
  assignment_unit text not null,
  control_traffic numeric not null,
  treatment_traffic numeric not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  deactivated_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (experiment_key)
);

comment on table public.recommendation_experiment_enrollments is
  'Service-owned experiment enrollment control plane; RPC-only access; frozen A/A contract bounds.';
comment on column public.recommendation_experiment_enrollments.experiment_key is
  'Bounded experiment key; primary key; single-use per run identity.';
comment on column public.recommendation_experiment_enrollments.config_version is
  'Unique nonzero 16-char lowercase hex experiment config version.';
comment on column public.recommendation_experiment_enrollments.engine_version is
  'Exact canonical engine version; frozen to v1-canonical-1.';
comment on column public.recommendation_experiment_enrollments.assignment_unit is
  'Assignment unit; frozen to user.';
comment on column public.recommendation_experiment_enrollments.control_traffic is
  'Control arm traffic share; frozen to 0.5.';
comment on column public.recommendation_experiment_enrollments.treatment_traffic is
  'Treatment arm traffic share; frozen to 0.5.';
comment on column public.recommendation_experiment_enrollments.starts_at is
  'Activation instant assigned from clock_timestamp() by the activation RPC.';
comment on column public.recommendation_experiment_enrollments.ends_at is
  'Enrollment close; exactly starts_at plus 14 days.';
comment on column public.recommendation_experiment_enrollments.deactivated_at is
  'Emergency deactivation timestamp; null while active; set at most once.';
comment on column public.recommendation_experiment_enrollments.created_at is
  'Row creation timestamp; defaults to now().';

alter table public.recommendation_experiment_enrollments
  drop constraint if exists recommendation_experiment_enrollments_key_bounds,
  drop constraint if exists recommendation_experiment_enrollments_config_bounds,
  drop constraint if exists recommendation_experiment_enrollments_engine_bounds,
  drop constraint if exists recommendation_experiment_enrollments_unit_bounds,
  drop constraint if exists recommendation_experiment_enrollments_split_bounds,
  drop constraint if exists recommendation_experiment_enrollments_window_bounds,
  drop constraint if exists recommendation_experiment_enrollments_deactivated_bounds;

alter table public.recommendation_experiment_enrollments
  add constraint recommendation_experiment_enrollments_key_bounds
    check (experiment_key ~ '^[a-z0-9][a-z0-9-]{0,127}$'),
  add constraint recommendation_experiment_enrollments_config_bounds
    check (
      config_version ~ '^[0-9a-f]{16}$'
      and config_version <> '0000000000000000'
    ),
  add constraint recommendation_experiment_enrollments_engine_bounds
    check (engine_version = 'v1-canonical-1'),
  add constraint recommendation_experiment_enrollments_unit_bounds
    check (assignment_unit = 'user'),
  add constraint recommendation_experiment_enrollments_split_bounds
    check (control_traffic = 0.5 and treatment_traffic = 0.5),
  add constraint recommendation_experiment_enrollments_window_bounds
    check (ends_at = starts_at + interval '14 days'),
  add constraint recommendation_experiment_enrollments_deactivated_bounds
    check (deactivated_at is null or deactivated_at >= starts_at);

-- RLS enabled with no policies: combined with the privilege revokes below,
-- enrollment rows are reachable only through the SECURITY DEFINER RPCs.
alter table public.recommendation_experiment_enrollments
  enable row level security;

revoke all on table public.recommendation_experiment_enrollments from public;
revoke all on table public.recommendation_experiment_enrollments from anon;
revoke all on table public.recommendation_experiment_enrollments from authenticated;
revoke all on table public.recommendation_experiment_enrollments from service_role;

-- ---------------------------------------------------------------------------
-- Enrollment guard trigger. SECURITY DEFINER with an empty search path.
-- DELETE is always rejected; every metadata field is immutable; the only
-- permitted change is a single null -> timestamp deactivated_at transition,
-- plus the exact idempotent unchanged row.
-- ---------------------------------------------------------------------------

create or replace function public.guard_recommendation_experiment_enrollment()
returns trigger
language plpgsql
security definer
set search_path to ''
as $body$
begin
  if tg_op = 'DELETE' then
    raise exception 'experiment enrollment delete denied' using errcode = '22023';
  end if;

  -- Exact idempotent unchanged row: every field verbatim.
  if new.experiment_key = old.experiment_key
    and new.config_version = old.config_version
    and new.engine_version = old.engine_version
    and new.assignment_unit = old.assignment_unit
    and new.control_traffic = old.control_traffic
    and new.treatment_traffic = old.treatment_traffic
    and new.starts_at = old.starts_at
    and new.ends_at = old.ends_at
    and new.deactivated_at is not distinct from old.deactivated_at
    and new.created_at = old.created_at then
    return new;
  end if;

  -- Every metadata field is immutable.
  if new.experiment_key is distinct from old.experiment_key
    or new.config_version is distinct from old.config_version
    or new.engine_version is distinct from old.engine_version
    or new.assignment_unit is distinct from old.assignment_unit
    or new.control_traffic is distinct from old.control_traffic
    or new.treatment_traffic is distinct from old.treatment_traffic
    or new.starts_at is distinct from old.starts_at
    or new.ends_at is distinct from old.ends_at
    or new.created_at is distinct from old.created_at then
    raise exception 'experiment enrollment metadata immutable' using errcode = '22023';
  end if;

  -- The only permitted change: deactivated_at null -> timestamp, once.
  if old.deactivated_at is not null
    or new.deactivated_at is null then
    raise exception 'experiment enrollment metadata immutable' using errcode = '22023';
  end if;

  return new;
end;
$body$;

revoke all on function public.guard_recommendation_experiment_enrollment() from public;
revoke all on function public.guard_recommendation_experiment_enrollment() from anon;
revoke all on function public.guard_recommendation_experiment_enrollment() from authenticated;
revoke all on function public.guard_recommendation_experiment_enrollment() from service_role;

drop trigger if exists recommendation_experiment_enrollments_guard on public.recommendation_experiment_enrollments;
create trigger recommendation_experiment_enrollments_guard
  before update or delete on public.recommendation_experiment_enrollments
  for each row
  execute function public.guard_recommendation_experiment_enrollment();

-- ---------------------------------------------------------------------------
-- Exposure write guard, recreated (never dropped) as SECURITY DEFINER with
-- an empty search path, preserving the exact 2C.2 body from the preparation
-- migration: server-controlled timestamps plus the bounded 90-day retention
-- boundary on INSERT, preserved timestamps on UPDATE, every legacy payload
-- column nulled regardless of client input, zero defaulting for absent
-- config/hash values, the bucket allowlist, the assignment-triple pairing,
-- the bounded diagnostics, and the service registry evidence check with the
-- stable SQLSTATE 22023 message.
--
-- New enrollment lifecycle gate: controlled buckets alone serialize on the
-- exact advisory transaction lock the activation and deactivation RPCs use,
-- capture clock_timestamp() once, and require the exact currently active
-- frozen enrollment (frozen key, matching config/engine, frozen user unit,
-- frozen 0.5/0.5 split, undeactivated, half-open window containing the
-- captured instant); otherwise the same stable 22023 message is raised.
-- Default exposures take neither the lock nor the check.
--
-- The definer identity lets the guard's registry evidence lookup see
-- service-owned registry rows for every writer, so an authenticated owner
-- can persist an active exposure only when the exact service registry
-- evidence exists; no direct registry table access is granted. The prior
-- EXECUTE revokes/grants are reissued unchanged and the owner RLS on
-- suggestion_exposure_log is untouched.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_versioned_exposure_insert()
returns trigger
language plpgsql
security definer
set search_path to ''
as $body$
declare
  v_enrollment_now timestamptz;
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

  -- Enrollment lifecycle gate: controlled buckets serialize on the exact
  -- lifecycle advisory lock and require the exact active frozen enrollment
  -- at one captured clock timestamp; default exposures take neither the
  -- lock nor the check.
  if new.experiment_bucket in ('control', 'treatment') then
    perform pg_advisory_xact_lock(hashtextextended('recommendation_experiment_enrollment_activation', 0));
    v_enrollment_now := clock_timestamp();

    if not exists (
      select 1
      from public.recommendation_experiment_enrollments as enrollment_evidence
      where enrollment_evidence.experiment_key = 'phase-3-1-canonical-aa-baseline-r1'
        and enrollment_evidence.config_version = new.experiment_config_version
        and enrollment_evidence.engine_version = new.engine_version
        and enrollment_evidence.assignment_unit = 'user'
        and enrollment_evidence.control_traffic = 0.5
        and enrollment_evidence.treatment_traffic = 0.5
        and enrollment_evidence.deactivated_at is null
        and enrollment_evidence.starts_at <= v_enrollment_now
        and v_enrollment_now < enrollment_evidence.ends_at
    ) then
      raise exception 'incomplete versioned exposure record' using errcode = '22023';
    end if;
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

-- ---------------------------------------------------------------------------
-- Activation RPC. Single-use atomic insert of the exact frozen contract:
-- validation first, then the fixed advisory transaction lock, one
-- clock_timestamp() assignment with the exact 14-day end, duplicate and
-- undeactivated half-open overlap rejection with stable 22023 messages, and
-- exactly one insert (never an update).
-- ---------------------------------------------------------------------------

create or replace function public.activate_recommendation_experiment_enrollment(
  p_experiment_key text,
  p_config_version text,
  p_engine_version text,
  p_assignment_unit text,
  p_control_traffic numeric,
  p_treatment_traffic numeric,
  p_duration interval
)
returns table (
  experiment_key text,
  config_version text,
  engine_version text,
  assignment_unit text,
  control_traffic numeric,
  treatment_traffic numeric,
  starts_at timestamptz,
  ends_at timestamptz,
  deactivated_at timestamptz
)
language plpgsql
volatile
security definer
set search_path to ''
as $body$
declare
  v_starts_at timestamptz;
  v_ends_at timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- The frozen A/A contract is compiled, not negotiated.
  if p_experiment_key is distinct from 'phase-3-1-canonical-aa-baseline-r1'
    or p_config_version is distinct from '37ed98ccebd44c08'
    or p_engine_version is distinct from 'v1-canonical-1'
    or p_assignment_unit is distinct from 'user'
    or p_control_traffic is distinct from 0.5
    or p_treatment_traffic is distinct from 0.5
    or p_duration is distinct from interval '14 days' then
    raise exception 'invalid experiment enrollment contract' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('recommendation_experiment_enrollment_activation', 0));

  -- Single-use for the experiment key and config version, regardless of any
  -- deactivation state.
  if exists (
    select 1
    from public.recommendation_experiment_enrollments as existing
    where existing.experiment_key = p_experiment_key
       or existing.config_version = p_config_version
  ) then
    raise exception 'duplicate experiment enrollment' using errcode = '22023';
  end if;

  v_starts_at := clock_timestamp();
  v_ends_at := v_starts_at + p_duration;

  -- Reject every undeactivated enrollment whose window overlaps the
  -- requested half-open window [v_starts_at, v_ends_at).
  if exists (
    select 1
    from public.recommendation_experiment_enrollments as existing
    where existing.deactivated_at is null
      and existing.starts_at < v_ends_at
      and v_starts_at < existing.ends_at
  ) then
    raise exception 'overlapping experiment enrollment' using errcode = '22023';
  end if;

  insert into public.recommendation_experiment_enrollments (
    experiment_key, config_version, engine_version, assignment_unit,
    control_traffic, treatment_traffic, starts_at, ends_at
  ) values (
    p_experiment_key, p_config_version, p_engine_version, p_assignment_unit,
    p_control_traffic, p_treatment_traffic, v_starts_at, v_ends_at
  );

  experiment_key := p_experiment_key;
  config_version := p_config_version;
  engine_version := p_engine_version;
  assignment_unit := p_assignment_unit;
  control_traffic := p_control_traffic;
  treatment_traffic := p_treatment_traffic;
  starts_at := v_starts_at;
  ends_at := v_ends_at;
  deactivated_at := null;
  return next;
end;
$body$;

revoke all on function public.activate_recommendation_experiment_enrollment(text, text, text, text, numeric, numeric, interval) from public;
revoke all on function public.activate_recommendation_experiment_enrollment(text, text, text, text, numeric, numeric, interval) from anon;
revoke all on function public.activate_recommendation_experiment_enrollment(text, text, text, text, numeric, numeric, interval) from authenticated;
grant execute on function public.activate_recommendation_experiment_enrollment(text, text, text, text, numeric, numeric, interval) to service_role;

-- ---------------------------------------------------------------------------
-- Deactivation RPC. Unknown enrollments return zero rows; an active row
-- gains deactivated_at = clock_timestamp() and is returned; an already
-- deactivated row is returned unchanged (idempotent).
-- ---------------------------------------------------------------------------

create or replace function public.deactivate_recommendation_experiment_enrollment(
  p_experiment_key text,
  p_config_version text
)
returns table (
  experiment_key text,
  config_version text,
  engine_version text,
  assignment_unit text,
  control_traffic numeric,
  treatment_traffic numeric,
  starts_at timestamptz,
  ends_at timestamptz,
  deactivated_at timestamptz
)
language plpgsql
volatile
security definer
set search_path to ''
as $body$
declare
  v_existing record;
  v_now timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_experiment_key is null or p_config_version is null then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('recommendation_experiment_enrollment_activation', 0));

  select e.experiment_key, e.config_version, e.engine_version,
         e.assignment_unit, e.control_traffic, e.treatment_traffic,
         e.starts_at, e.ends_at, e.deactivated_at
    into v_existing
    from public.recommendation_experiment_enrollments as e
   where e.experiment_key = p_experiment_key
     and e.config_version = p_config_version;

  if not found then
    return;
  end if;

  if v_existing.deactivated_at is null then
    v_now := clock_timestamp();
    update public.recommendation_experiment_enrollments as e
       set deactivated_at = v_now
     where e.experiment_key = p_experiment_key
       and e.config_version = p_config_version;
    v_existing.deactivated_at := v_now;
  end if;

  experiment_key := v_existing.experiment_key;
  config_version := v_existing.config_version;
  engine_version := v_existing.engine_version;
  assignment_unit := v_existing.assignment_unit;
  control_traffic := v_existing.control_traffic;
  treatment_traffic := v_existing.treatment_traffic;
  starts_at := v_existing.starts_at;
  ends_at := v_existing.ends_at;
  deactivated_at := v_existing.deactivated_at;
  return next;
end;
$body$;

revoke all on function public.deactivate_recommendation_experiment_enrollment(text, text) from public;
revoke all on function public.deactivate_recommendation_experiment_enrollment(text, text) from anon;
revoke all on function public.deactivate_recommendation_experiment_enrollment(text, text) from authenticated;
grant execute on function public.deactivate_recommendation_experiment_enrollment(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Active enrollment read RPC. Returns at most one row: undeactivated, with
-- the half-open window [starts_at, ends_at) containing clock_timestamp().
-- ---------------------------------------------------------------------------

create or replace function public.get_active_recommendation_experiment_enrollment()
returns table (
  experiment_key text,
  config_version text,
  engine_version text,
  assignment_unit text,
  control_traffic numeric,
  treatment_traffic numeric,
  starts_at timestamptz,
  ends_at timestamptz,
  deactivated_at timestamptz
)
language plpgsql
volatile
security definer
set search_path to ''
as $body$
declare
  v_now timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_now := clock_timestamp();

  return query
  select e.experiment_key, e.config_version, e.engine_version,
         e.assignment_unit, e.control_traffic, e.treatment_traffic,
         e.starts_at, e.ends_at, e.deactivated_at
    from public.recommendation_experiment_enrollments as e
   where e.deactivated_at is null
     and e.starts_at <= v_now
     and v_now < e.ends_at
   order by e.starts_at desc
   limit 1;
end;
$body$;

revoke all on function public.get_active_recommendation_experiment_enrollment() from public;
revoke all on function public.get_active_recommendation_experiment_enrollment() from anon;
revoke all on function public.get_active_recommendation_experiment_enrollment() from authenticated;
grant execute on function public.get_active_recommendation_experiment_enrollment() to service_role;

-- ---------------------------------------------------------------------------
-- One stored assignment per user-level user/unit/engine/config tuple. The
-- frozen A/A run is explicitly user-level, so the unique index is PARTIAL
-- for assignment_unit = 'user': request-level assignments keep their
-- (assignment_hash, user_id) primary-key semantics and may carry distinct
-- subject hashes for one user/config. The index backs the resolver below;
-- it is created only after an explicit user-scoped duplicate-group check
-- fails clearly instead of removing existing evidence.
-- ---------------------------------------------------------------------------

do $migration$
declare
  v_duplicate_groups bigint;
begin
  select count(*)
    into v_duplicate_groups
    from (
      select 1
      from public.recommendation_experiment_assignments
      where assignment_unit = 'user'
      group by user_id, assignment_unit, engine_version, config_version
      having count(*) > 1
    ) as duplicate_groups;

  if v_duplicate_groups > 0 then
    raise exception 'duplicate experiment assignment groups block the unique assignment index' using errcode = '22023';
  end if;
end;
$migration$;

create unique index if not exists recommendation_experiment_assignments_one_assignment_idx
  on public.recommendation_experiment_assignments (user_id, assignment_unit, engine_version, config_version)
  where assignment_unit = 'user';

-- ---------------------------------------------------------------------------
-- Redefined registration RPC. CREATE OR REPLACE keeps the exact 2C.2
-- signature, boolean return, and service-role-only ACL while hardening the
-- frozen user-level run:
--   * every bounded validation and the exact replay contract are preserved:
--     a new key inserts; an exact replay returns true and keeps the
--     existing row and its original assigned_at verbatim; conflicting
--     evidence raises the stable SQLSTATE 22023 and never rewrites
--     assignment evidence,
--   * user-level tuples serialize on the same deterministic advisory
--     transaction lock the resolver below uses, then preflight the
--     user/unit/engine/config tuple before insert: an exact full replay
--     returns true; any differing hash/subject/bucket raises the stable
--     conflict, never a raw 23505 from the partial unique index,
--   * any unique violation after the insert (a racing writer or an
--     assignment hash already bound to this user) is recovered
--     deterministically by rereading the tuple and returning the exact
--     replay or raising the stable conflict,
--   * request-level registrations keep the original assignment-hash/user
--     primary-key behavior and no user tuple uniqueness is imposed.
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

  if p_assignment_unit = 'user' then
    -- The frozen run is user-level: serialize on the exact advisory lock
    -- derivation the resolver uses, then preflight the user tuple.
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || '/' || p_assignment_unit || '/' || p_engine_version || '/' || p_config_version, 0));

    select assignment_hash, subject_hash, bucket
      into v_existing
      from public.recommendation_experiment_assignments
     where user_id = p_user_id
       and assignment_unit = p_assignment_unit
       and engine_version = p_engine_version
       and config_version = p_config_version;

    if found then
      -- Exact full replay returns true and keeps the existing row verbatim;
      -- any differing hash/subject/bucket raises the stable conflict, never
      -- a raw unique violation.
      if v_existing.assignment_hash is distinct from p_assignment_hash
        or v_existing.subject_hash is distinct from p_subject_hash
        or v_existing.bucket is distinct from p_bucket then
        raise exception 'conflicting experiment assignment' using errcode = '22023';
      end if;

      return true;
    end if;

    begin
      insert into public.recommendation_experiment_assignments (
        assignment_hash, user_id, assignment_unit, subject_hash,
        engine_version, config_version, bucket
      ) values (
        p_assignment_hash, p_user_id, p_assignment_unit, p_subject_hash,
        p_engine_version, p_config_version, p_bucket
      );
    exception when unique_violation then
      -- Deterministic recovery: a racing writer won the user tuple, or the
      -- assignment hash is already bound to this user. Reread the tuple and
      -- return the exact replay or the stable conflict; never raw 23505.
      select assignment_hash, subject_hash, bucket
        into v_existing
        from public.recommendation_experiment_assignments
       where user_id = p_user_id
         and assignment_unit = p_assignment_unit
         and engine_version = p_engine_version
         and config_version = p_config_version;

      if found
        and v_existing.assignment_hash = p_assignment_hash
        and v_existing.subject_hash = p_subject_hash
        and v_existing.bucket = p_bucket then
        return true;
      end if;

      raise exception 'conflicting experiment assignment' using errcode = '22023';
    end;

    return true;
  end if;

  -- Request-level assignments keep the original behavior: never rewrite
  -- evidence; a conflicting key skips the insert entirely, then the
  -- persisted row is verified as an exact match. on conflict do nothing
  -- serializes concurrent registrations on the same key, so the read-back
  -- always sees the surviving row. No user tuple uniqueness is imposed.
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
-- Atomic assignment resolver RPC for this frozen user-level run only: every
-- assignment unit other than user is rejected. Validates the same bounded
-- fields as the registration RPC, then serializes on the exact enrollment
-- lifecycle advisory transaction lock the activation and deactivation RPCs
-- use and revalidates the exact frozen active enrollment at one captured
-- clock timestamp with the half-open window; an inactive or closed
-- enrollment returns zero rows instead of raising, so the server resolver
-- fails closed as registry-response-invalid rather than surfacing an error.
-- With an active enrollment it serializes per user/unit/engine/config on
-- the exact advisory transaction lock the redefined registration RPC shares
-- (stable lock order: lifecycle first, then the per-user lock; the lock is
-- reentrant, so the registration call below stays valid inside the
-- resolver's own transaction) and returns the stored assignment when one
-- exists (subject hash verified; the stored row wins). Otherwise it invokes
-- the registration RPC, re-reads the exact row, and returns it.
-- ---------------------------------------------------------------------------

create or replace function public.resolve_recommendation_experiment_assignment(
  p_assignment_hash text,
  p_user_id uuid,
  p_assignment_unit text,
  p_subject_hash text,
  p_engine_version text,
  p_config_version text,
  p_bucket text
)
returns table (
  assignment_hash text,
  config_version text,
  bucket text
)
language plpgsql
volatile
security definer
set search_path to ''
as $body$
declare
  v_stored record;
  v_now timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_assignment_hash is null
    or p_assignment_hash !~ '^[0-9a-f]{16}$'
    or p_assignment_hash = '0000000000000000'
    or p_user_id is null
    or p_assignment_unit is distinct from 'user'
    or p_subject_hash is null
    or p_subject_hash !~ '^[0-9a-f]{16}$'
    or p_engine_version is distinct from 'v1-canonical-1'
    or p_config_version is null
    or p_config_version !~ '^[0-9a-f]{16}$'
    or p_config_version = '0000000000000000'
    or p_config_version is distinct from '37ed98ccebd44c08'
    or p_bucket is null
    or p_bucket not in ('control', 'treatment') then
    raise exception 'invalid experiment assignment' using errcode = '22023';
  end if;

  -- Enrollment lifecycle gate: serialize on the exact lifecycle advisory
  -- lock activation and deactivation use BEFORE the per-user lock (stable
  -- lock order), then require the exact frozen active enrollment at one
  -- captured clock timestamp with the half-open window. Inactive or closed
  -- enrollments return zero rows rather than raising.
  perform pg_advisory_xact_lock(hashtextextended('recommendation_experiment_enrollment_activation', 0));

  v_now := clock_timestamp();

  if not exists (
    select 1
    from public.recommendation_experiment_enrollments as enrollment_evidence
    where enrollment_evidence.experiment_key = 'phase-3-1-canonical-aa-baseline-r1'
      and enrollment_evidence.config_version = '37ed98ccebd44c08'
      and enrollment_evidence.engine_version = 'v1-canonical-1'
      and enrollment_evidence.assignment_unit = 'user'
      and enrollment_evidence.control_traffic = 0.5
      and enrollment_evidence.treatment_traffic = 0.5
      and enrollment_evidence.deactivated_at is null
      and enrollment_evidence.starts_at <= v_now
      and v_now < enrollment_evidence.ends_at
  ) then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || '/' || p_assignment_unit || '/' || p_engine_version || '/' || p_config_version, 0));

  select a.assignment_hash, a.config_version, a.bucket, a.subject_hash
    into v_stored
    from public.recommendation_experiment_assignments as a
   where a.user_id = p_user_id
     and a.assignment_unit = p_assignment_unit
     and a.engine_version = p_engine_version
     and a.config_version = p_config_version;

  if found then
    -- The stored assignment wins; conflicting subject evidence fails closed.
    if v_stored.subject_hash is distinct from p_subject_hash then
      raise exception 'conflicting experiment assignment' using errcode = '22023';
    end if;

    assignment_hash := v_stored.assignment_hash;
    config_version := v_stored.config_version;
    bucket := v_stored.bucket;
    return next;
    return;
  end if;

  perform public.register_recommendation_experiment_assignment(
    p_assignment_hash, p_user_id, p_assignment_unit, p_subject_hash,
    p_engine_version, p_config_version, p_bucket
  );

  select a.assignment_hash, a.config_version, a.bucket, a.subject_hash
    into v_stored
    from public.recommendation_experiment_assignments as a
   where a.user_id = p_user_id
     and a.assignment_unit = p_assignment_unit
     and a.engine_version = p_engine_version
     and a.config_version = p_config_version;

  if not found
    or v_stored.subject_hash is distinct from p_subject_hash then
    raise exception 'conflicting experiment assignment' using errcode = '22023';
  end if;

  assignment_hash := v_stored.assignment_hash;
  config_version := v_stored.config_version;
  bucket := v_stored.bucket;
  return next;
end;
$body$;

revoke all on function public.resolve_recommendation_experiment_assignment(text, uuid, text, text, text, text, text) from public;
revoke all on function public.resolve_recommendation_experiment_assignment(text, uuid, text, text, text, text, text) from anon;
revoke all on function public.resolve_recommendation_experiment_assignment(text, uuid, text, text, text, text, text) from authenticated;
grant execute on function public.resolve_recommendation_experiment_assignment(text, uuid, text, text, text, text, text) to service_role;

-- Notify PostgREST to reload schema
notify pgrst, 'reload schema';
