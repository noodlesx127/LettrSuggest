-- =============================================================================
-- pgTAP: recommendation experiment telemetry preparation (checkpoint 2C.2)
-- =============================================================================
-- Runs entirely inside begin/rollback; every fixture row (auth users,
-- profiles, registry rows, and exposure rows) is removed by the outer
-- ROLLBACK, so no test data persists. Identifiers are randomized per run to
-- avoid collisions.
--
-- Coverage:
--   * experiment_config_version and assignment_hash columns: existence, NOT
--     NULL, zero defaults
--   * replaced bounds constraints exist (engine/bucket/config pairing/
--     assignment hash pairing/canonical field set)
--   * bounded join indexes exist
--   * write guard source contract: controlled bucket allowlist, zero config
--     and zero assignment hash defaulting, and registry evidence lookup
--   * server-owned registry: existence, bounded columns, primary key, RLS
--     enabled, service_role-only policies, no authenticated/anon policies
--   * registration RPC: bounded signature, SECURITY DEFINER, EXECUTE granted
--     to service_role only
--   * behavior: browser default exposures (zero config + zero assignment
--     hash) keep persisting for their owner; authenticated direct active
--     exposures are rejected because registry evidence is unreachable
--     through RLS; service-role active exposures persist only with a
--     matching registry row (hash + owner + engine/config/bucket); forged,
--     unregistered, and cross-owner evidence is rejected
--   * server-controlled suggestion_feedback.feedback_event_at: column,
--     NOT NULL, now() default, idempotent BEFORE INSERT OR UPDATE trigger;
--     client-supplied event times never persist on insert or update while
--     non-timestamp changes still apply
--   * owner-scoped authenticated update policy on suggestion_feedback
--     (production upsert path): existence, owner-scoped USING and WITH
--     CHECK, existing select/insert/delete policies intact; an owner
--     conflicting upsert changes feedback_type and the server-controlled
--     feedback_event_at, while a cross-owner update is denied
--   * checkpoint 3.1A enrollment control plane (inactive infrastructure):
--     enrollment table schema/columns/PK/RLS/no policies and the denial of
--     every direct SELECT/INSERT/UPDATE/DELETE for PUBLIC, anon,
--     authenticated, and service_role; the SECURITY DEFINER BEFORE UPDATE OR
--     DELETE guard trigger; the four service-only SECURITY DEFINER RPCs with
--     empty search paths (activation, deactivation, active read, assignment
--     resolver) and their anon/authenticated denial; frozen activation
--     duration/timestamp/read semantics; duplicate, reachable-overlap, and
--     invalid contract/duration rejections; deactivation immutability,
--     idempotence, and no-active behavior; assignment evidence preservation;
--     the SECURITY DEFINER exposure guard letting an authenticated owner
--     persist an active exposure only with exact service registry evidence
--     while the frozen enrollment is active
--   * review-fix contract: PARTIAL user-only one-stored-assignment index,
--     user-only resolver, and the redefined registration RPC sharing the
--     resolver advisory lock with stable 22023 conflicts (never raw 23505):
--     a different-hash registration on the same user tuple raises the
--     stable conflict, exact replays still return true, the stored
--     assignment wins in the resolver, and two request-level subjects for
--     one user/config remain independently registrable
--   * lifecycle review-fix contract: the assignment resolver and the
--     exposure guard serialize on the exact activation/deactivation
--     advisory lock (lifecycle lock first, then the per-user lock in the
--     resolver) and revalidate the exact frozen enrollment at one captured
--     clock timestamp with the half-open window: controlled exposures and
--     resolver rows are accepted only while the frozen enrollment is
--     active, the same registry evidence is rejected after deactivation,
--     the resolver returns zero rows instead of raising, and browser
--     default exposures stay unaffected by the lifecycle gate
--   * global pairing/backfill invariants and registry-evidence integrity
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(147);

-- ---------------------------------------------------------------------------
-- Static contract: experiment config version column.
-- ---------------------------------------------------------------------------

select has_column(
  'public',
  'suggestion_exposure_log',
  'experiment_config_version',
  'suggestion_exposure_log has the experiment config version column'
);

select col_not_null(
  'public',
  'suggestion_exposure_log',
  'experiment_config_version',
  'experiment config version column is NOT NULL'
);

select col_default_is(
  'public',
  'suggestion_exposure_log',
  'experiment_config_version',
  '0000000000000000',
  'experiment config version defaults to the zero marker'
);

-- ---------------------------------------------------------------------------
-- Static contract: assignment hash column.
-- ---------------------------------------------------------------------------

select has_column(
  'public',
  'suggestion_exposure_log',
  'assignment_hash',
  'suggestion_exposure_log has the assignment hash column'
);

select col_not_null(
  'public',
  'suggestion_exposure_log',
  'assignment_hash',
  'assignment hash column is NOT NULL'
);

select col_default_is(
  'public',
  'suggestion_exposure_log',
  'assignment_hash',
  '0000000000000000',
  'assignment hash defaults to the zero marker'
);

-- ---------------------------------------------------------------------------
-- Static contract: replaced and new bounds constraints.
-- ---------------------------------------------------------------------------

select ok(
  exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'suggestion_exposure_log'
      and c.conname = 'suggestion_exposure_log_engine_version_bounds'
      and c.contype = 'c'
  ),
  'engine_version bounds check constraint is replaced for controlled buckets'
);

select ok(
  exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'suggestion_exposure_log'
      and c.conname = 'suggestion_exposure_log_experiment_bucket_bounds'
      and c.contype = 'c'
  ),
  'experiment_bucket bounds check constraint permits only controlled buckets'
);

select ok(
  exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'suggestion_exposure_log'
      and c.conname = 'suggestion_exposure_log_experiment_config_version_bounds'
      and c.contype = 'c'
  ),
  'experiment config version pairing check constraint exists'
);

select ok(
  exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'suggestion_exposure_log'
      and c.conname = 'suggestion_exposure_log_assignment_hash_bounds'
      and c.contype = 'c'
  ),
  'assignment hash pairing check constraint exists'
);

select ok(
  exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'suggestion_exposure_log'
      and c.conname = 'suggestion_exposure_log_canonical_fields_bounds'
      and c.contype = 'c'
  ),
  'canonical exposure fields constraint is replaced with the config version and assignment hash'
);

-- ---------------------------------------------------------------------------
-- Static contract: bounded join indexes.
-- ---------------------------------------------------------------------------

select has_index(
  'public',
  'suggestion_exposure_log',
  'suggestion_exposure_log_experiment_join_idx',
  'bounded experiment join index exists on suggestion_exposure_log'
);

select has_index(
  'public',
  'suggestion_exposure_log',
  'suggestion_exposure_log_experiment_bucket_idx',
  'bounded experiment bucket index exists on suggestion_exposure_log'
);

-- ---------------------------------------------------------------------------
-- Static contract: write guard experiment validation source fragments.
-- ---------------------------------------------------------------------------

select ok(
  (select position(
      $frag$new.experiment_bucket not in ('default', 'control', 'treatment')$frag$
      in prosrc) > 0
     from pg_proc
    where oid = 'public.enforce_versioned_exposure_insert()'::regprocedure),
  'guard restricts experiment buckets to the exact controlled allowlist'
);

select ok(
  (select position(
      $frag$new.experiment_config_version := '0000000000000000';$frag$
      in prosrc) > 0
     from pg_proc
    where oid = 'public.enforce_versioned_exposure_insert()'::regprocedure),
  'guard defaults an absent experiment config version to the zero marker'
);

select ok(
  (select position(
      $frag$new.assignment_hash := '0000000000000000';$frag$
      in prosrc) > 0
     from pg_proc
    where oid = 'public.enforce_versioned_exposure_insert()'::regprocedure),
  'guard defaults an absent assignment hash to the zero marker'
);

select ok(
  (select position(
      $frag$from public.recommendation_experiment_assignments as assignment_evidence$frag$
      in prosrc) > 0
     from pg_proc
    where oid = 'public.enforce_versioned_exposure_insert()'::regprocedure),
  'guard requires matching server-owned registry evidence for active exposures'
);

-- ---------------------------------------------------------------------------
-- Static contract: server-owned assignment registry.
-- ---------------------------------------------------------------------------

select has_table(
  'public',
  'recommendation_experiment_assignments',
  'server-owned assignment registry table exists'
);

select has_column(
  'public',
  'recommendation_experiment_assignments',
  'assignment_hash',
  'registry has the assignment hash column'
);

select has_column(
  'public',
  'recommendation_experiment_assignments',
  'subject_hash',
  'registry has the subject hash column'
);

select has_index(
  'public',
  'recommendation_experiment_assignments',
  'recommendation_experiment_assignments_pkey',
  'registry primary key index exists'
);

select ok(
  (select relrowsecurity
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'recommendation_experiment_assignments'),
  'registry row level security is enabled'
);

select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'recommendation_experiment_assignments'
      and ('authenticated' = any (roles) or 'anon' = any (roles))
  ),
  'no authenticated or anon policy exists on the registry'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'recommendation_experiment_assignments'
      and cmd = 'SELECT'
      and 'service_role' = any (roles)
  )
  and exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'recommendation_experiment_assignments'
      and cmd = 'INSERT'
      and 'service_role' = any (roles)
  ),
  'service_role holds the registry select and insert policies'
);

-- ---------------------------------------------------------------------------
-- Static contract: service-role-only registration RPC.
-- ---------------------------------------------------------------------------

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'register_recommendation_experiment_assignment'
      and oidvectortypes(p.proargtypes) =
        'text, uuid, text, text, text, text, text'
  ),
  'registration RPC exists with the bounded seven-field signature'
);

select ok(
  (select p.prosecdef
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'register_recommendation_experiment_assignment'
    limit 1),
  'registration RPC is SECURITY DEFINER'
);

select ok(
  (select has_function_privilege('service_role', p.oid, 'EXECUTE')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'register_recommendation_experiment_assignment'
    limit 1),
  'service_role can execute the registration RPC'
);

select ok(
  not (select has_function_privilege('authenticated', p.oid, 'EXECUTE')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'register_recommendation_experiment_assignment'
    limit 1),
  'authenticated cannot execute the registration RPC'
);

-- Registration immutability contract: a conflicting key never rewrites the
-- existing registry row; an exact-match replay keeps it verbatim.
select ok(
  (select position(
      $frag$on conflict (assignment_hash, user_id) do nothing$frag$
      in prosrc) > 0
     from pg_proc
    where oid = 'public.register_recommendation_experiment_assignment(text, uuid, text, text, text, text, text)'::regprocedure),
  'registration RPC never upserts over an existing registry row'
);

select ok(
  (select position(
      $frag$raise exception 'conflicting experiment assignment' using errcode = '22023'$frag$
      in prosrc) > 0
     from pg_proc
    where oid = 'public.register_recommendation_experiment_assignment(text, uuid, text, text, text, text, text)'::regprocedure),
  'registration RPC rejects conflicting re-registration with the stable SQLSTATE 22023'
);

select ok(
  (select position(
      $frag$do update$frag$
      in prosrc) = 0
     from pg_proc
    where oid = 'public.register_recommendation_experiment_assignment(text, uuid, text, text, text, text, text)'::regprocedure),
  'registration RPC source contains no attribute rewrite path'
);

-- ---------------------------------------------------------------------------
-- Static contract: server-controlled feedback event time on
-- suggestion_feedback (reliable time projection for the pure join).
-- ---------------------------------------------------------------------------

select has_column(
  'public',
  'suggestion_feedback',
  'feedback_event_at',
  'suggestion_feedback has the feedback event time column'
);

select col_not_null(
  'public',
  'suggestion_feedback',
  'feedback_event_at',
  'feedback event time column is NOT NULL'
);

select col_default_is(
  'public',
  'suggestion_feedback',
  'feedback_event_at',
  'now()',
  'feedback event time defaults to the server now()'
);

select has_trigger(
  'public',
  'suggestion_feedback',
  'suggestion_feedback_event_at_guard',
  'feedback event time guard trigger exists on suggestion_feedback'
);

select ok(
  (select position(
      $frag$new.feedback_event_at := now();$frag$
      in prosrc) > 0
     from pg_proc
    where oid = 'public.enforce_feedback_event_at()'::regprocedure),
  'feedback event time trigger forces the server transaction time'
);

-- ---------------------------------------------------------------------------
-- Static contract: owner-scoped authenticated update policy on
-- suggestion_feedback. Production feedback writes upsert on (user_id,
-- tmdb_id), and the DO UPDATE arm requires an owner-scoped update policy.
-- The migration adds exactly that policy idempotently and keeps every
-- existing policy intact.
-- ---------------------------------------------------------------------------

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'suggestion_feedback'
      and policyname = 'suggestion_feedback_owner_update'
      and cmd = 'UPDATE'
      and 'authenticated' = any (roles)
  ),
  'owner-scoped authenticated update policy exists on suggestion_feedback'
);

select ok(
  (select position('auth.uid()' in qual) > 0
     from pg_policies
    where schemaname = 'public'
      and tablename = 'suggestion_feedback'
      and policyname = 'suggestion_feedback_owner_update'),
  'feedback update policy USING clause is owner-scoped by auth.uid()'
);

select ok(
  (select position('auth.uid()' in with_check) > 0
     from pg_policies
    where schemaname = 'public'
      and tablename = 'suggestion_feedback'
      and policyname = 'suggestion_feedback_owner_update'),
  'feedback update policy WITH CHECK clause is owner-scoped by auth.uid()'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'suggestion_feedback'
      and cmd = 'SELECT'
      and 'authenticated' = any (roles)
  )
  and exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'suggestion_feedback'
      and cmd = 'INSERT'
      and 'authenticated' = any (roles)
  )
  and exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'suggestion_feedback'
      and cmd = 'DELETE'
      and 'authenticated' = any (roles)
  ),
  'existing authenticated select, insert, and delete feedback policies remain intact'
);

-- ---------------------------------------------------------------------------
-- Fixtures: two auth users for owner and cross-owner behavior.
-- ---------------------------------------------------------------------------

create temporary table experiment_test_ids (
  user_a uuid not null,
  user_b uuid not null
);

do $setup$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values
    (a, 'authenticated', 'authenticated', a::text || '@experiment.test',
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    (b, 'authenticated', 'authenticated', b::text || '@experiment.test',
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

  -- Keep the profile FK valid even when the auth trigger is absent on reset.
  insert into public.profiles (id, email)
  values
    (a, a::text || '@experiment.test'),
    (b, b::text || '@experiment.test')
  on conflict (id) do update set email = excluded.email;

  insert into experiment_test_ids (user_a, user_b) values (a, b);
end;
$setup$;

grant select on experiment_test_ids to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Service role registers a bounded assignment through the RPC.
-- ---------------------------------------------------------------------------

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', (select user_a::text from experiment_test_ids), true);
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  public.register_recommendation_experiment_assignment(
    'abcdef0123456789',
    (select user_a from experiment_test_ids),
    'user',
    'fedcba9876543210',
    'v1-canonical-1',
    '0123456789abcdef',
    'control'
  ),
  true,
  'service-role registration RPC persists a bounded assignment row'
);

select ok(
  exists (
    select 1
    from public.recommendation_experiment_assignments
    where assignment_hash = 'abcdef0123456789'
      and user_id = (select user_a from experiment_test_ids)
      and assignment_unit = 'user'
      and subject_hash = 'fedcba9876543210'
      and engine_version = 'v1-canonical-1'
      and config_version = '0123456789abcdef'
      and bucket = 'control'
  ),
  'registry row persists with only bounded hashed fields'
);

-- ---------------------------------------------------------------------------
-- Registration immutability: re-registration is idempotent only for an exact
-- existing match. Exact replays return true and keep the original row and
-- assigned_at verbatim; any differing assignment_unit, subject_hash,
-- engine_version, config_version, or bucket raises the stable SQLSTATE 22023
-- and never rewrites assignment evidence. Snapshot the registered row first
-- so later assertions compare against immutable baseline evidence.
-- ---------------------------------------------------------------------------

create temporary table experiment_assignment_baseline (
  assignment_unit text not null,
  subject_hash text not null,
  engine_version text not null,
  config_version text not null,
  bucket text not null,
  assigned_at timestamptz not null
);

insert into experiment_assignment_baseline (
  assignment_unit, subject_hash, engine_version, config_version, bucket,
  assigned_at
)
select assignment_unit, subject_hash, engine_version, config_version, bucket,
       assigned_at
  from public.recommendation_experiment_assignments
 where assignment_hash = 'abcdef0123456789'
   and user_id = (select user_a from experiment_test_ids);

grant select on experiment_assignment_baseline to anon, authenticated, service_role;

select is(
  public.register_recommendation_experiment_assignment(
    'abcdef0123456789',
    (select user_a from experiment_test_ids),
    'user',
    'fedcba9876543210',
    'v1-canonical-1',
    '0123456789abcdef',
    'control'
  ),
  true,
  'exact registration replay returns true'
);

select is(
  (select jsonb_build_object(
      'assignment_unit', assignment_unit,
      'subject_hash', subject_hash,
      'engine_version', engine_version,
      'config_version', config_version,
      'bucket', bucket,
      'assigned_at', assigned_at)
    from public.recommendation_experiment_assignments
    where assignment_hash = 'abcdef0123456789'
      and user_id = (select user_a from experiment_test_ids)),
  (select jsonb_build_object(
      'assignment_unit', assignment_unit,
      'subject_hash', subject_hash,
      'engine_version', engine_version,
      'config_version', config_version,
      'bucket', bucket,
      'assigned_at', assigned_at)
    from experiment_assignment_baseline),
  'exact registration replay keeps the existing row and assigned_at verbatim'
);

select is(
  (select count(*)
     from public.recommendation_experiment_assignments
    where assignment_hash = 'abcdef0123456789'
      and user_id = (select user_a from experiment_test_ids)),
  1::bigint,
  'exact registration replay never duplicates the registry row'
);

select throws_ok(
  format(
    'select public.register_recommendation_experiment_assignment(%L, %L::uuid, %L, %L, %L, %L, %L)',
    'abcdef0123456789',
    (select user_a from experiment_test_ids),
    'request',
    'fedcba9876543210',
    'v1-canonical-1',
    '0123456789abcdef',
    'control'
  ),
  '22023',
  'conflicting experiment assignment',
  're-registration with a different assignment unit is rejected'
);

select throws_ok(
  format(
    'select public.register_recommendation_experiment_assignment(%L, %L::uuid, %L, %L, %L, %L, %L)',
    'abcdef0123456789',
    (select user_a from experiment_test_ids),
    'user',
    '9999999999999999',
    'v1-canonical-1',
    '0123456789abcdef',
    'control'
  ),
  '22023',
  'conflicting experiment assignment',
  're-registration with a different subject hash is rejected'
);

select throws_ok(
  format(
    'select public.register_recommendation_experiment_assignment(%L, %L::uuid, %L, %L, %L, %L, %L)',
    'abcdef0123456789',
    (select user_a from experiment_test_ids),
    'user',
    'fedcba9876543210',
    'v1-canonical-1',
    'fedcba9876543210',
    'control'
  ),
  '22023',
  'conflicting experiment assignment',
  're-registration with a different config version is rejected'
);

select throws_ok(
  format(
    'select public.register_recommendation_experiment_assignment(%L, %L::uuid, %L, %L, %L, %L, %L)',
    'abcdef0123456789',
    (select user_a from experiment_test_ids),
    'user',
    'fedcba9876543210',
    'v1-canonical-1',
    '0123456789abcdef',
    'treatment'
  ),
  '22023',
  'conflicting experiment assignment',
  're-registration with a different bucket is rejected'
);

select is(
  (select jsonb_build_object(
      'assignment_unit', assignment_unit,
      'subject_hash', subject_hash,
      'engine_version', engine_version,
      'config_version', config_version,
      'bucket', bucket,
      'assigned_at', assigned_at)
    from public.recommendation_experiment_assignments
    where assignment_hash = 'abcdef0123456789'
      and user_id = (select user_a from experiment_test_ids)),
  (select jsonb_build_object(
      'assignment_unit', assignment_unit,
      'subject_hash', subject_hash,
      'engine_version', engine_version,
      'config_version', config_version,
      'bucket', bucket,
      'assigned_at', assigned_at)
    from experiment_assignment_baseline),
  'rejected conflicting replays never rewrite assignment evidence or assigned_at'
);

-- ---------------------------------------------------------------------------
-- Browser default exposure path: owner insert with the zero config version
-- and zero assignment hash keeps working without any registry row.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_a::text from experiment_test_ids), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.suggestion_exposure_log (
  user_id, tmdb_id,
  engine_version, experiment_bucket, experiment_config_version, assignment_hash,
  input_revision, pre_rank, post_rank,
  drop_reason_counts, source_shares
)
values (
  (select user_a from experiment_test_ids),
  2147483201,
  'v1-canonical-1', 'default', '0000000000000000', '0000000000000000',
  'abcdef0123456789',
  1, 1,
  '{"seed":1}'::jsonb,
  '{"tmdb":1}'::jsonb
);

-- Inspect through service_role so RLS cannot make the assertions vacuous.
reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  (select count(*) from public.suggestion_exposure_log
    where user_id = (select user_a from experiment_test_ids)
      and tmdb_id = 2147483201),
  1::bigint,
  'browser default exposure insert with zero config and zero assignment hash persists'
);

select is(
  (select jsonb_build_object(
      'engine_version', engine_version,
      'experiment_bucket', experiment_bucket,
      'experiment_config_version', experiment_config_version,
      'assignment_hash', assignment_hash)
    from public.suggestion_exposure_log
    where user_id = (select user_a from experiment_test_ids)
      and tmdb_id = 2147483201),
  '{"engine_version":"v1-canonical-1","experiment_bucket":"default","experiment_config_version":"0000000000000000","assignment_hash":"0000000000000000"}'::jsonb,
  'browser default exposure persists the zero experiment markers verbatim'
);

-- ---------------------------------------------------------------------------
-- Guard rejection: authenticated writers cannot forge active exposures or
-- break the zero-hash default pairing. The SECURITY DEFINER guard checks the
-- service-owned registry directly, so only hashes the service actually
-- registered can pass; this probe keeps the registered config and bucket but
-- supplies an unregistered assignment hash, so the forged evidence fails.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_a::text from experiment_test_ids), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, experiment_config_version, assignment_hash, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483202, %L, %L, %L, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_a from experiment_test_ids),
    'v1-canonical-1',
    'control',
    '0123456789abcdef',
    'bbbbbbbbbbbbbbbb',
    'abcdef0123456789',
    '{"seed":1}',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'authenticated direct active exposure insert is rejected for an unregistered assignment hash'
);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, experiment_config_version, assignment_hash, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483203, %L, %L, %L, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_a from experiment_test_ids),
    'v1-canonical-1',
    'default',
    '0000000000000000',
    'abcdef0123456789',
    'abcdef0123456789',
    '{"seed":1}',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'default bucket with a nonzero assignment hash is rejected'
);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, experiment_config_version, assignment_hash, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483204, %L, %L, %L, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_a from experiment_test_ids),
    'v1-canonical-1',
    'control',
    '0000000000000000',
    'abcdef0123456789',
    'abcdef0123456789',
    '{"seed":1}',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'active bucket with the zero config version is rejected'
);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, experiment_config_version, assignment_hash, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483205, %L, %L, %L, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_a from experiment_test_ids),
    'v1-canonical-1',
    'treatment',
    'NOT-HEX',
    'abcdef0123456789',
    'abcdef0123456789',
    '{"seed":1}',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'active bucket with a malformed config version is rejected'
);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, experiment_config_version, assignment_hash, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483206, %L, %L, %L, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_a from experiment_test_ids),
    'v1-canonical-1',
    'variant_a',
    '0123456789abcdef',
    'abcdef0123456789',
    'abcdef0123456789',
    '{"seed":1}',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'unknown experiment buckets outside the controlled allowlist are rejected'
);

-- ---------------------------------------------------------------------------
-- Service role: registration is not lifecycle-gated, but a controlled
-- exposure is rejected while no enrollment is active even when the exact
-- registry evidence already exists. The frozen-config evidence registered
-- here is reused by the active-window and post-deactivation probes below.
-- ---------------------------------------------------------------------------

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', (select user_a::text from experiment_test_ids), true);
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  public.register_recommendation_experiment_assignment(
    'aabbccdd00000001',
    (select user_a from experiment_test_ids),
    'user',
    'fedcba9876543210',
    'v1-canonical-1',
    '37ed98ccebd44c08',
    'control'
  ),
  true,
  'service-role registration persists frozen-config evidence before any activation'
);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, experiment_config_version, assignment_hash, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483207, %L, %L, %L, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_a from experiment_test_ids),
    'v1-canonical-1',
    'control',
    '37ed98ccebd44c08',
    'aabbccdd00000001',
    'abcdef0123456789',
    '{"seed":1}',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'controlled exposure is rejected while no enrollment is active despite exact registry evidence'
);

-- ---------------------------------------------------------------------------
-- Registration RPC stays out of authenticated reach.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_a::text from experiment_test_ids), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  format(
    'select public.register_recommendation_experiment_assignment(%L, %L::uuid, %L, %L, %L, %L, %L)',
    'aaaaaaaaaaaaaaaa',
    (select user_a from experiment_test_ids),
    'user',
    'fedcba9876543210',
    'v1-canonical-1',
    '0123456789abcdef',
    'control'
  ),
  '42501',
  'permission denied for function register_recommendation_experiment_assignment',
  'authenticated cannot call the service-role registration RPC'
);

-- ---------------------------------------------------------------------------
-- Server-controlled feedback event time behavior: client-supplied event
-- times never persist on insert, and every update forces the server time
-- again while non-timestamp changes still apply. (created_at alone cannot
-- serve the join because suggestion_feedback is unique per user/movie and
-- created_at does not advance on upsert.)
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_b::text from experiment_test_ids), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.suggestion_feedback (
  user_id, tmdb_id, feedback_type, feedback_event_at
)
values (
  (select user_b from experiment_test_ids),
  2147483301,
  'positive',
  '2020-01-01T00:00:00Z'::timestamptz
);

select is(
  (select feedback_event_at
     from public.suggestion_feedback
    where user_id = (select user_b from experiment_test_ids)
      and tmdb_id = 2147483301),
  now(),
  'feedback insert forces feedback_event_at to the server time, never the client value'
);

-- This service-role update path bypasses RLS; the owner-scoped
-- authenticated upsert path is covered separately below.
reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);

update public.suggestion_feedback
   set feedback_type = 'negative',
       feedback_event_at = '2021-01-01T00:00:00Z'::timestamptz
 where user_id = (select user_b from experiment_test_ids)
   and tmdb_id = 2147483301;

select is(
  (select feedback_event_at
     from public.suggestion_feedback
    where user_id = (select user_b from experiment_test_ids)
      and tmdb_id = 2147483301),
  now(),
  'feedback update forces feedback_event_at to the server time again'
);

select is(
  (select feedback_type
     from public.suggestion_feedback
    where user_id = (select user_b from experiment_test_ids)
      and tmdb_id = 2147483301),
  'negative',
  'feedback update still applies non-timestamp changes'
);

-- ---------------------------------------------------------------------------
-- Owner-scoped authenticated upsert behavior: production feedback writes
-- upsert on (user_id, tmdb_id), so the DO UPDATE arm runs through the new
-- owner update policy. An owner conflicting upsert changes feedback_type
-- while the trigger forces the server-controlled event time again; a
-- cross-owner update is denied.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_a::text from experiment_test_ids), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.suggestion_feedback (
  user_id, tmdb_id, feedback_type, feedback_event_at
)
values (
  (select user_a from experiment_test_ids),
  2147483302,
  'positive',
  '2020-01-01T00:00:00Z'::timestamptz
);

insert into public.suggestion_feedback (
  user_id, tmdb_id, feedback_type, feedback_event_at
)
values (
  (select user_a from experiment_test_ids),
  2147483302,
  'negative',
  '2021-01-01T00:00:00Z'::timestamptz
)
on conflict (user_id, tmdb_id) do update
set feedback_type = excluded.feedback_type,
    feedback_event_at = excluded.feedback_event_at;

select is(
  (select feedback_type
     from public.suggestion_feedback
    where user_id = (select user_a from experiment_test_ids)
      and tmdb_id = 2147483302),
  'negative',
  'owner conflicting upsert changes feedback_type through the update policy'
);

select is(
  (select feedback_event_at
     from public.suggestion_feedback
    where user_id = (select user_a from experiment_test_ids)
      and tmdb_id = 2147483302),
  now(),
  'owner conflicting upsert forces the server-controlled feedback_event_at'
);

-- Cross-owner denial: user_b cannot see or rewrite user_a's row through the
-- owner-scoped update policy; the update matches no rows and never raises
-- the owner's row into user_b's reach.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_b::text from experiment_test_ids), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

with denied as (
  update public.suggestion_feedback
     set feedback_type = 'positive'
   where user_id = (select user_a from experiment_test_ids)
     and tmdb_id = 2147483302
   returning 1
)
select is(
  (select count(*) from denied),
  0::bigint,
  'cross-owner feedback update is denied by the owner-scoped update policy'
);

-- Inspect through service_role so RLS cannot make the assertion vacuous.
reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  (select feedback_type
     from public.suggestion_feedback
    where user_id = (select user_a from experiment_test_ids)
      and tmdb_id = 2147483302),
  'negative',
  'cross-owner feedback update never rewrites the owner row'
);

-- ---------------------------------------------------------------------------
-- Checkpoint 3.1A enrollment control plane (INACTIVE infrastructure). The
-- overlap fixture runs BEFORE the frozen activation: the owner inserts a
-- generic bounded overlapping enrollment row, the service frozen activation
-- fails with the overlap message, the owner deactivates the generic row, and
-- only then does the service activate the frozen key; duplicates are tested
-- after the successful frozen activation.
-- ---------------------------------------------------------------------------

select has_table(
  'public',
  'recommendation_experiment_enrollments',
  'enrollment control plane table exists'
);

select has_column(
  'public',
  'recommendation_experiment_enrollments',
  'experiment_key',
  'enrollment table has the experiment key column'
);

select has_column(
  'public',
  'recommendation_experiment_enrollments',
  'config_version',
  'enrollment table has the config version column'
);

select has_column(
  'public',
  'recommendation_experiment_enrollments',
  'engine_version',
  'enrollment table has the engine version column'
);

select has_column(
  'public',
  'recommendation_experiment_enrollments',
  'assignment_unit',
  'enrollment table has the assignment unit column'
);

select has_column(
  'public',
  'recommendation_experiment_enrollments',
  'control_traffic',
  'enrollment table has the control traffic column'
);

select has_column(
  'public',
  'recommendation_experiment_enrollments',
  'treatment_traffic',
  'enrollment table has the treatment traffic column'
);

select has_column(
  'public',
  'recommendation_experiment_enrollments',
  'starts_at',
  'enrollment table has the window start column'
);

select has_column(
  'public',
  'recommendation_experiment_enrollments',
  'ends_at',
  'enrollment table has the window end column'
);

select has_column(
  'public',
  'recommendation_experiment_enrollments',
  'deactivated_at',
  'enrollment table has the deactivation timestamp column'
);

select has_column(
  'public',
  'recommendation_experiment_enrollments',
  'created_at',
  'enrollment table has the creation timestamp column'
);

select has_index(
  'public',
  'recommendation_experiment_enrollments',
  'recommendation_experiment_enrollments_pkey',
  'enrollment table primary key index exists'
);

select ok(
  (select relrowsecurity
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'recommendation_experiment_enrollments'),
  'enrollment table row level security is enabled'
);

select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'recommendation_experiment_enrollments'
  ),
  'no policy exists on the enrollment table; access is RPC-only'
);

select ok(
  not has_table_privilege('public', 'public.recommendation_experiment_enrollments', 'SELECT')
  and not has_table_privilege('anon', 'public.recommendation_experiment_enrollments', 'SELECT')
  and not has_table_privilege('authenticated', 'public.recommendation_experiment_enrollments', 'SELECT')
  and not has_table_privilege('service_role', 'public.recommendation_experiment_enrollments', 'SELECT'),
  'no PUBLIC, anon, authenticated, or service_role SELECT exists on the enrollment table'
);

select ok(
  not has_table_privilege('public', 'public.recommendation_experiment_enrollments', 'INSERT')
  and not has_table_privilege('anon', 'public.recommendation_experiment_enrollments', 'INSERT')
  and not has_table_privilege('authenticated', 'public.recommendation_experiment_enrollments', 'INSERT')
  and not has_table_privilege('service_role', 'public.recommendation_experiment_enrollments', 'INSERT')
  and not has_table_privilege('public', 'public.recommendation_experiment_enrollments', 'UPDATE')
  and not has_table_privilege('anon', 'public.recommendation_experiment_enrollments', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.recommendation_experiment_enrollments', 'UPDATE')
  and not has_table_privilege('service_role', 'public.recommendation_experiment_enrollments', 'UPDATE')
  and not has_table_privilege('public', 'public.recommendation_experiment_enrollments', 'DELETE')
  and not has_table_privilege('anon', 'public.recommendation_experiment_enrollments', 'DELETE')
  and not has_table_privilege('authenticated', 'public.recommendation_experiment_enrollments', 'DELETE')
  and not has_table_privilege('service_role', 'public.recommendation_experiment_enrollments', 'DELETE'),
  'no PUBLIC, anon, authenticated, or service_role INSERT, UPDATE, or DELETE exists on the enrollment table'
);

select has_trigger(
  'public',
  'recommendation_experiment_enrollments',
  'recommendation_experiment_enrollments_guard',
  'enrollment guard trigger exists on recommendation_experiment_enrollments'
);

select ok(
  (select p.prosecdef
          and coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']
     from pg_proc p
     join pg_trigger t on t.tgfoid = p.oid
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'recommendation_experiment_enrollments'
      and t.tgname = 'recommendation_experiment_enrollments_guard'
      and not t.tgisinternal
    limit 1),
  'enrollment guard trigger function is SECURITY DEFINER with an empty search_path'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'activate_recommendation_experiment_enrollment'
      and oidvectortypes(p.proargtypes) =
        'text, text, text, text, numeric, numeric, interval'
  )
  and (select p.prosecdef
              and coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'activate_recommendation_experiment_enrollment'
        limit 1),
  'activation RPC exists with the exact signature, SECURITY DEFINER, and an empty search_path'
);

select ok(
  (select has_function_privilege('service_role', p.oid, 'EXECUTE')
          and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
          and not has_function_privilege('anon', p.oid, 'EXECUTE')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'activate_recommendation_experiment_enrollment'
    limit 1),
  'only service_role can execute the activation RPC'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'deactivate_recommendation_experiment_enrollment'
      and oidvectortypes(p.proargtypes) = 'text, text'
  )
  and (select p.prosecdef
              and coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'deactivate_recommendation_experiment_enrollment'
        limit 1),
  'deactivation RPC exists with the exact signature, SECURITY DEFINER, and an empty search_path'
);

select ok(
  (select has_function_privilege('service_role', p.oid, 'EXECUTE')
          and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
          and not has_function_privilege('anon', p.oid, 'EXECUTE')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'deactivate_recommendation_experiment_enrollment'
    limit 1),
  'only service_role can execute the deactivation RPC'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_active_recommendation_experiment_enrollment'
      and oidvectortypes(p.proargtypes) = ''
  )
  and (select p.prosecdef
              and coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'get_active_recommendation_experiment_enrollment'
        limit 1),
  'active enrollment read RPC exists with the exact no-argument signature, SECURITY DEFINER, and an empty search_path'
);

select ok(
  (select has_function_privilege('service_role', p.oid, 'EXECUTE')
          and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
          and not has_function_privilege('anon', p.oid, 'EXECUTE')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_active_recommendation_experiment_enrollment'
    limit 1),
  'only service_role can execute the active enrollment read RPC'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'resolve_recommendation_experiment_assignment'
      and oidvectortypes(p.proargtypes) =
        'text, uuid, text, text, text, text, text'
  )
  and (select p.prosecdef
              and coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'resolve_recommendation_experiment_assignment'
        limit 1),
  'assignment resolver RPC exists with the exact signature, SECURITY DEFINER, and an empty search_path'
);

select ok(
  (select has_function_privilege('service_role', p.oid, 'EXECUTE')
          and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
          and not has_function_privilege('anon', p.oid, 'EXECUTE')
      from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'resolve_recommendation_experiment_assignment'
    limit 1),
  'only service_role can execute the assignment resolver RPC'
);

-- ---------------------------------------------------------------------------
-- Review-fix static contract: the one-stored-assignment index is PARTIAL for
-- the frozen user-level run; the resolver rejects every non-user unit; the
-- redefined registration RPC shares the resolver advisory lock and recovers
-- unique violations deterministically instead of surfacing raw 23505.
-- ---------------------------------------------------------------------------

select ok(
  (select position('CREATE UNIQUE INDEX' in indexdef) = 1
          and position($pred$WHERE (assignment_unit = 'user'$pred$ in indexdef) > 0
     from pg_indexes
     where schemaname = 'public'
       and tablename = 'recommendation_experiment_assignments'
       and indexname = 'recommendation_experiment_assignments_one_assignment_idx'),
  'one-stored-assignment index is a partial unique index for user-level assignments only'
);

select ok(
  (select position(
      $frag$p_assignment_unit is distinct from 'user'$frag$
      in prosrc) > 0
     from pg_proc
     where oid = 'public.resolve_recommendation_experiment_assignment(text, uuid, text, text, text, text, text)'::regprocedure),
  'assignment resolver RPC rejects every assignment unit other than user'
);

select ok(
  (select position(
      $lock$pg_advisory_xact_lock(hashtextextended(p_user_id::text || '/' || p_assignment_unit || '/' || p_engine_version || '/' || p_config_version, 0))$lock$
      in register_src.prosrc) > 0
          and position(
      $lock$pg_advisory_xact_lock(hashtextextended(p_user_id::text || '/' || p_assignment_unit || '/' || p_engine_version || '/' || p_config_version, 0))$lock$
      in resolve_src.prosrc) > 0
     from (select prosrc
             from pg_proc
            where oid = 'public.register_recommendation_experiment_assignment(text, uuid, text, text, text, text, text)'::regprocedure) as register_src
     cross join (select prosrc
                   from pg_proc
                  where oid = 'public.resolve_recommendation_experiment_assignment(text, uuid, text, text, text, text, text)'::regprocedure) as resolve_src),
  'register and resolve serialize user tuples on the identical deterministic advisory lock'
);

select ok(
  (select position(
      $frag$when unique_violation then$frag$
      in prosrc) > 0
     from pg_proc
    where oid = 'public.register_recommendation_experiment_assignment(text, uuid, text, text, text, text, text)'::regprocedure),
  'redefined registration RPC recovers unique violations deterministically instead of raw 23505'
);

-- ---------------------------------------------------------------------------
-- Lifecycle review-fix static contract: the assignment resolver and the
-- exposure write guard serialize on the exact advisory lock the activation
-- and deactivation RPCs use, and revalidate the exact frozen enrollment at
-- one captured clock timestamp with the half-open window. Resolver lock
-- order is lifecycle first, then per-user. Controlled buckets alone take
-- the lifecycle lock in the guard; default exposures take neither.
-- ---------------------------------------------------------------------------

select ok(
  (select position(
      $lock$pg_advisory_xact_lock(hashtextextended('recommendation_experiment_enrollment_activation', 0))$lock$
      in prosrc) > 0
     from pg_proc
    where oid = 'public.resolve_recommendation_experiment_assignment(text, uuid, text, text, text, text, text)'::regprocedure),
  'assignment resolver serializes on the exact enrollment lifecycle advisory lock'
);

select ok(
  (select position(
      $lock$pg_advisory_xact_lock(hashtextextended('recommendation_experiment_enrollment_activation', 0))$lock$
      in prosrc) < position(
      $lock$pg_advisory_xact_lock(hashtextextended(p_user_id::text || '/' || p_assignment_unit || '/' || p_engine_version || '/' || p_config_version, 0))$lock$
      in prosrc)
     from pg_proc
    where oid = 'public.resolve_recommendation_experiment_assignment(text, uuid, text, text, text, text, text)'::regprocedure),
  'assignment resolver acquires the lifecycle lock before the per-user lock'
);

select ok(
  (select position(
      $frag$enrollment_evidence.experiment_key = 'phase-3-1-canonical-aa-baseline-r1'$frag$
      in prosrc) > 0
      and position(
      $frag$enrollment_evidence.config_version = '37ed98ccebd44c08'$frag$
      in prosrc) > 0
      and position(
      $frag$enrollment_evidence.engine_version = 'v1-canonical-1'$frag$
      in prosrc) > 0
      and position(
      $frag$enrollment_evidence.assignment_unit = 'user'$frag$
      in prosrc) > 0
      and position(
      $frag$enrollment_evidence.control_traffic = 0.5$frag$
      in prosrc) > 0
      and position(
      $frag$enrollment_evidence.treatment_traffic = 0.5$frag$
      in prosrc) > 0
      and position(
      $frag$enrollment_evidence.deactivated_at is null$frag$
      in prosrc) > 0
      and position(
      $frag$enrollment_evidence.starts_at <= v_now$frag$
      in prosrc) > 0
      and position(
      $frag$v_now < enrollment_evidence.ends_at$frag$
      in prosrc) > 0
     from pg_proc
    where oid = 'public.resolve_recommendation_experiment_assignment(text, uuid, text, text, text, text, text)'::regprocedure),
  'assignment resolver revalidates the exact frozen enrollment half-open window before returning or inserting'
);

select ok(
  (select position(
      $lock$pg_advisory_xact_lock(hashtextextended('recommendation_experiment_enrollment_activation', 0))$lock$
      in prosrc) > 0
      and position(
      $frag$from public.recommendation_experiment_enrollments as enrollment_evidence$frag$
      in prosrc) > 0
      and position(
      $frag$enrollment_evidence.experiment_key = 'phase-3-1-canonical-aa-baseline-r1'$frag$
      in prosrc) > 0
      and position(
      $frag$enrollment_evidence.deactivated_at is null$frag$
      in prosrc) > 0
      and position(
      $frag$enrollment_evidence.starts_at <= v_enrollment_now$frag$
      in prosrc) > 0
      and position(
      $frag$v_enrollment_now < enrollment_evidence.ends_at$frag$
      in prosrc) > 0
     from pg_proc
    where oid = 'public.enforce_versioned_exposure_insert()'::regprocedure),
  'exposure guard serializes controlled buckets on the lifecycle lock and one captured half-open clock timestamp'
);

select ok(
  (select position(
      $frag$if new.experiment_bucket in ('control', 'treatment') then$frag$
      in prosrc) > 0
      and position(
      $frag$if new.experiment_bucket in ('control', 'treatment') then$frag$
      in prosrc) < position(
      $lock$pg_advisory_xact_lock(hashtextextended('recommendation_experiment_enrollment_activation', 0))$lock$
      in prosrc)
     from pg_proc
    where oid = 'public.enforce_versioned_exposure_insert()'::regprocedure),
  'exposure guard acquires the lifecycle lock only for controlled buckets'
);

-- Overlap fixture BEFORE the frozen activation: the owner inserts a generic
-- bounded overlapping enrollment row directly (owner-only access).
reset role;

insert into public.recommendation_experiment_enrollments (
  experiment_key, config_version, engine_version, assignment_unit,
  control_traffic, treatment_traffic, starts_at, ends_at
)
select 'overlap-generic-r1', 'aaaaaaaaaaaaaaaa', 'v1-canonical-1', 'user',
       0.5, 0.5, window_starts.starts_at,
       window_starts.starts_at + interval '14 days'
  from (select clock_timestamp() as starts_at) as window_starts;

select is(
  (select count(*)
     from public.recommendation_experiment_enrollments
    where experiment_key = 'overlap-generic-r1'),
  1::bigint,
  'owner inserts a generic bounded overlapping enrollment row'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);

select throws_ok(
  'select * from public.activate_recommendation_experiment_enrollment(''phase-3-1-canonical-aa-baseline-r1'', ''37ed98ccebd44c08'', ''v1-canonical-1'', ''user'', 0.5, 0.5, interval ''14 days'')',
  '22023',
  'overlapping experiment enrollment',
  'frozen activation is rejected while an undeactivated overlapping enrollment exists'
);

reset role;

update public.recommendation_experiment_enrollments
   set deactivated_at = clock_timestamp()
 where experiment_key = 'overlap-generic-r1';

select ok(
  (select deactivated_at is not null
          and experiment_key = 'overlap-generic-r1'
          and config_version = 'aaaaaaaaaaaaaaaa'
          and ends_at = starts_at + interval '14 days'
     from public.recommendation_experiment_enrollments
    where experiment_key = 'overlap-generic-r1'),
  'owner deactivation stamps the generic overlapping row without touching metadata'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);

create temporary table enrollment_activation_result as
select * from public.activate_recommendation_experiment_enrollment(
  'phase-3-1-canonical-aa-baseline-r1',
  '37ed98ccebd44c08',
  'v1-canonical-1',
  'user',
  0.5,
  0.5,
  interval '14 days'
);

select is(
  (select jsonb_build_object(
      'experiment_key', experiment_key,
      'config_version', config_version,
      'engine_version', engine_version,
      'assignment_unit', assignment_unit,
      'control_traffic', control_traffic,
      'treatment_traffic', treatment_traffic,
      'deactivated_at', deactivated_at)
     from enrollment_activation_result),
  '{"experiment_key":"phase-3-1-canonical-aa-baseline-r1","config_version":"37ed98ccebd44c08","engine_version":"v1-canonical-1","assignment_unit":"user","control_traffic":0.5,"treatment_traffic":0.5,"deactivated_at":null}'::jsonb,
  'frozen activation returns the exact contracted enrollment row'
);

select ok(
  (select count(*) = 1 from enrollment_activation_result)
  and (select starts_at <= clock_timestamp()
              and starts_at > clock_timestamp() - interval '10 seconds'
              and ends_at = starts_at + interval '14 days'
         from enrollment_activation_result),
  'activation assigns one clock_timestamp start and the exact 14-day window'
);

select is(
  (select jsonb_build_object(
      'experiment_key', experiment_key,
      'config_version', config_version)
     from public.get_active_recommendation_experiment_enrollment()),
  '{"experiment_key":"phase-3-1-canonical-aa-baseline-r1","config_version":"37ed98ccebd44c08"}'::jsonb,
  'active enrollment read returns exactly the frozen row inside the window'
);

select throws_ok(
  'select * from public.activate_recommendation_experiment_enrollment(''phase-3-1-canonical-aa-baseline-r1'', ''37ed98ccebd44c08'', ''v1-canonical-1'', ''user'', 0.5, 0.5, interval ''14 days'')',
  '22023',
  'duplicate experiment enrollment',
  'second frozen activation is rejected as a duplicate'
);

select throws_ok(
  'select * from public.activate_recommendation_experiment_enrollment(''phase-3-1-canonical-aa-baseline-r1'', ''ffffffffffffffff'', ''v1-canonical-1'', ''user'', 0.5, 0.5, interval ''14 days'')',
  '22023',
  'invalid experiment enrollment contract',
  'activation with a non-frozen config version is rejected'
);

select throws_ok(
  'select * from public.activate_recommendation_experiment_enrollment(''phase-3-1-canonical-aa-baseline-r1'', ''37ed98ccebd44c08'', ''v1-canonical-1'', ''user'', 0.5, 0.5, interval ''13 days'')',
  '22023',
  'invalid experiment enrollment contract',
  'activation with a non-14-day duration is rejected'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_a::text from experiment_test_ids), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  'select * from public.activate_recommendation_experiment_enrollment(''phase-3-1-canonical-aa-baseline-r1'', ''37ed98ccebd44c08'', ''v1-canonical-1'', ''user'', 0.5, 0.5, interval ''14 days'')',
  '42501',
  'permission denied for function activate_recommendation_experiment_enrollment',
  'authenticated cannot activate the enrollment'
);

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);

select throws_ok(
  'select * from public.activate_recommendation_experiment_enrollment(''phase-3-1-canonical-aa-baseline-r1'', ''37ed98ccebd44c08'', ''v1-canonical-1'', ''user'', 0.5, 0.5, interval ''14 days'')',
  '42501',
  'permission denied for function activate_recommendation_experiment_enrollment',
  'anon cannot activate the enrollment'
);

-- ---------------------------------------------------------------------------
-- Active frozen enrollment window: controlled exposures persist for both
-- writer roles with exact service registry evidence, unregistered and
-- cross-owner evidence is rejected, and the resolver returns stored and
-- fresh assignments. The exact same evidence is replayed after
-- deactivation below and must fail closed.
-- ---------------------------------------------------------------------------

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', (select user_a::text from experiment_test_ids), true);
select set_config('request.jwt.claim.role', 'service_role', true);

select throws_ok(
  format(
    'select * from public.resolve_recommendation_experiment_assignment(%L, %L::uuid, %L, %L, %L, %L, %L)',
    'eeeeeeeeeeeeeeee',
    (select user_b from experiment_test_ids),
    'user',
    'abcdef1234567890',
    'v1-canonical-1',
    'fedcba9876543210',
    'treatment'
  ),
  '22023',
  'invalid experiment assignment',
  'resolver rejects a non-frozen config while the frozen enrollment is active'
);

insert into public.suggestion_exposure_log (
  user_id, tmdb_id,
  engine_version, experiment_bucket, experiment_config_version, assignment_hash,
  input_revision, pre_rank, post_rank,
  drop_reason_counts, source_shares
)
values (
  (select user_a from experiment_test_ids),
  2147483207,
  'v1-canonical-1', 'control', '37ed98ccebd44c08', 'aabbccdd00000001',
  'abcdef0123456789',
  1, 1,
  '{"seed":1}'::jsonb,
  '{"tmdb":1}'::jsonb
);

select is(
  (select count(*) from public.suggestion_exposure_log
    where user_id = (select user_a from experiment_test_ids)
      and tmdb_id = 2147483207),
  1::bigint,
  'service-role controlled exposure persists while the frozen enrollment is active'
);

select is(
  (select jsonb_build_object(
      'engine_version', engine_version,
      'experiment_bucket', experiment_bucket,
      'experiment_config_version', experiment_config_version,
      'assignment_hash', assignment_hash)
    from public.suggestion_exposure_log
    where user_id = (select user_a from experiment_test_ids)
      and tmdb_id = 2147483207),
  '{"engine_version":"v1-canonical-1","experiment_bucket":"control","experiment_config_version":"37ed98ccebd44c08","assignment_hash":"aabbccdd00000001"}'::jsonb,
  'active controlled exposure persists the frozen config version and assignment hash verbatim'
);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, experiment_config_version, assignment_hash, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483208, %L, %L, %L, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_a from experiment_test_ids),
    'v1-canonical-1',
    'control',
    '37ed98ccebd44c08',
    'ffffffffffffffff',
    'abcdef0123456789',
    '{"seed":1}',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'active controlled exposure with an unregistered assignment hash is rejected'
);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, experiment_config_version, assignment_hash, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483209, %L, %L, %L, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_b from experiment_test_ids),
    'v1-canonical-1',
    'control',
    '37ed98ccebd44c08',
    'aabbccdd00000001',
    'abcdef0123456789',
    '{"seed":1}',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'active controlled exposure whose registry evidence belongs to another owner is rejected'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_a::text from experiment_test_ids), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.suggestion_exposure_log (
  user_id, tmdb_id,
  engine_version, experiment_bucket, experiment_config_version, assignment_hash,
  input_revision, pre_rank, post_rank,
  drop_reason_counts, source_shares
)
values (
  (select user_a from experiment_test_ids),
  2147483210,
  'v1-canonical-1', 'control', '37ed98ccebd44c08', 'aabbccdd00000001',
  'abcdef0123456789',
  1, 1,
  '{"seed":1}'::jsonb,
  '{"tmdb":1}'::jsonb
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  (select count(*) from public.suggestion_exposure_log
    where user_id = (select user_a from experiment_test_ids)
      and tmdb_id = 2147483210),
  1::bigint,
  'authenticated owner controlled exposure persists with the exact service registry evidence while active'
);

select is(
  (select jsonb_build_object(
      'assignment_hash', assignment_hash,
      'config_version', config_version,
      'bucket', bucket)
     from public.resolve_recommendation_experiment_assignment(
       'ffffffffffffffff',
       (select user_a from experiment_test_ids),
       'user',
       'fedcba9876543210',
       'v1-canonical-1',
       '37ed98ccebd44c08',
       'treatment')),
  '{"assignment_hash":"aabbccdd00000001","config_version":"37ed98ccebd44c08","bucket":"control"}'::jsonb,
  'stored user assignment wins when the resolver is called with a conflicting hash while active'
);

select is(
  (select jsonb_build_object(
      'assignment_hash', assignment_hash,
      'config_version', config_version,
      'bucket', bucket)
     from public.resolve_recommendation_experiment_assignment(
       '1234567890abcdef',
       (select user_b from experiment_test_ids),
       'user',
       'abcdef1234567890',
       'v1-canonical-1',
       '37ed98ccebd44c08',
       'treatment')),
  '{"assignment_hash":"1234567890abcdef","config_version":"37ed98ccebd44c08","bucket":"treatment"}'::jsonb,
  'resolver registers and returns a new assignment while the enrollment is active'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  (select count(*)
     from public.deactivate_recommendation_experiment_enrollment(
       'no-such-experiment',
       'ffffffffffffffff')),
  0::bigint,
  'deactivation of an unknown enrollment returns zero rows'
);

create temporary table enrollment_deactivation_result as
select * from public.deactivate_recommendation_experiment_enrollment(
  'phase-3-1-canonical-aa-baseline-r1',
  '37ed98ccebd44c08'
);

select ok(
  (select count(*) = 1 from enrollment_deactivation_result)
  and (select deactivated_at is not null
              and deactivated_at <= clock_timestamp()
              and deactivated_at > clock_timestamp() - interval '10 seconds'
         from enrollment_deactivation_result)
  and (select jsonb_build_object(
          'experiment_key', experiment_key,
          'config_version', config_version,
          'engine_version', engine_version,
          'assignment_unit', assignment_unit,
          'control_traffic', control_traffic,
          'treatment_traffic', treatment_traffic)
        from enrollment_deactivation_result) =
      '{"experiment_key":"phase-3-1-canonical-aa-baseline-r1","config_version":"37ed98ccebd44c08","engine_version":"v1-canonical-1","assignment_unit":"user","control_traffic":0.5,"treatment_traffic":0.5}'::jsonb,
  'deactivation stamps deactivated_at and returns the unchanged enrollment metadata'
);

create temporary table enrollment_deactivation_replay as
select * from public.deactivate_recommendation_experiment_enrollment(
  'phase-3-1-canonical-aa-baseline-r1',
  '37ed98ccebd44c08'
);

select is(
  (select jsonb_build_object(
      'experiment_key', experiment_key,
      'config_version', config_version,
      'starts_at', starts_at,
      'ends_at', ends_at,
      'deactivated_at', deactivated_at)
     from enrollment_deactivation_replay),
  (select jsonb_build_object(
      'experiment_key', experiment_key,
      'config_version', config_version,
      'starts_at', starts_at,
      'ends_at', ends_at,
      'deactivated_at', deactivated_at)
     from enrollment_deactivation_result),
  'repeated deactivation returns the deactivated row unchanged'
);

select is(
  (select count(*)
     from public.get_active_recommendation_experiment_enrollment()),
  0::bigint,
  'no active enrollment remains after deactivation'
);

reset role;

select throws_ok(
  'delete from public.recommendation_experiment_enrollments where experiment_key = ''phase-3-1-canonical-aa-baseline-r1''',
  '22023',
  'experiment enrollment delete denied',
  'direct deletion of an enrollment row is rejected by the guard trigger'
);

select throws_ok(
  'update public.recommendation_experiment_enrollments set starts_at = starts_at + interval ''1 day'' where experiment_key = ''phase-3-1-canonical-aa-baseline-r1''',
  '22023',
  'experiment enrollment metadata immutable',
  'direct metadata rewrite of an enrollment row is rejected by the guard trigger'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);

select ok(
  exists (
    select 1
    from public.recommendation_experiment_assignments
    where assignment_hash = 'abcdef0123456789'
      and user_id = (select user_a from experiment_test_ids)
      and config_version = '0123456789abcdef'
      and bucket = 'control'
  ),
  'deactivation preserves stored assignment evidence for auditability'
);

select is(
  (select prosecdef from pg_proc
    where oid = 'public.enforce_versioned_exposure_insert()'::regprocedure),
  true,
  'exposure guard is SECURITY DEFINER so owner exposure writes can see service registry evidence'
);

-- ---------------------------------------------------------------------------
-- Post-deactivation lifecycle gate: the exact same registry evidence that
-- persisted controlled exposures while active is now rejected for every
-- writer, the resolver returns zero rows instead of raising (so the server
-- resolver fails closed as registry-response-invalid) and registers
-- nothing, while browser default exposures stay unaffected.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_a::text from experiment_test_ids), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, experiment_config_version, assignment_hash, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483211, %L, %L, %L, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_a from experiment_test_ids),
    'v1-canonical-1',
    'control',
    '37ed98ccebd44c08',
    'aabbccdd00000001',
    'abcdef0123456789',
    '{"seed":1}',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'authenticated owner controlled exposure with the same service evidence is rejected after deactivation'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', (select user_a::text from experiment_test_ids), true);
select set_config('request.jwt.claim.role', 'service_role', true);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, experiment_config_version, assignment_hash, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483212, %L, %L, %L, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_a from experiment_test_ids),
    'v1-canonical-1',
    'control',
    '37ed98ccebd44c08',
    'aabbccdd00000001',
    'abcdef0123456789',
    '{"seed":1}',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'service-role controlled exposure with the same evidence is rejected after deactivation'
);

select is(
  (select count(*)
     from public.resolve_recommendation_experiment_assignment(
       'ffffffffffffffff',
       (select user_a from experiment_test_ids),
       'user',
       'fedcba9876543210',
       'v1-canonical-1',
       '37ed98ccebd44c08',
       'treatment')),
  0::bigint,
  'resolver returns zero rows for a stored user assignment after deactivation'
);

select is(
  (select count(*)
     from public.resolve_recommendation_experiment_assignment(
       'bbbb000000000002',
       (select user_b from experiment_test_ids),
       'user',
       'abcdef1234567890',
       'v1-canonical-1',
       '37ed98ccebd44c08',
       'control')),
  0::bigint,
  'resolver returns zero rows for a fresh assignment after deactivation'
);

select ok(
  not exists (
    select 1
    from public.recommendation_experiment_assignments
    where assignment_hash = 'bbbb000000000002'
      and user_id = (select user_b from experiment_test_ids)
  ),
  'the deactivated resolver never inserts assignment evidence'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_a::text from experiment_test_ids), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.suggestion_exposure_log (
  user_id, tmdb_id,
  engine_version, experiment_bucket, experiment_config_version, assignment_hash,
  input_revision, pre_rank, post_rank,
  drop_reason_counts, source_shares
)
values (
  (select user_a from experiment_test_ids),
  2147483213,
  'v1-canonical-1', 'default', '0000000000000000', '0000000000000000',
  'abcdef0123456789',
  1, 1,
  '{"seed":1}'::jsonb,
  '{"tmdb":1}'::jsonb
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  (select count(*) from public.suggestion_exposure_log
    where user_id = (select user_a from experiment_test_ids)
      and tmdb_id = 2147483213),
  1::bigint,
  'browser default exposure keeps persisting after deactivation without the lifecycle gate'
);

-- ---------------------------------------------------------------------------
-- Review-fix behavior: a different-hash registration on the same user tuple
-- raises the stable 22023 conflict (never raw 23505); exact replays still
-- return true; the stored assignment wins in the resolver; the resolver
-- rejects non-user units; request-level subjects remain independently
-- registrable for one user/config. Sequential single-session probes only:
-- pgTAP cannot express a deterministic true-concurrent race here.
-- ---------------------------------------------------------------------------

select throws_ok(
  format(
    'select public.register_recommendation_experiment_assignment(%L, %L::uuid, %L, %L, %L, %L, %L)',
    'eeeeeeeeeeeeeeee',
    (select user_a from experiment_test_ids),
    'user',
    'fedcba9876543210',
    'v1-canonical-1',
    '0123456789abcdef',
    'control'
  ),
  '22023',
  'conflicting experiment assignment',
  'sequential direct registration with a different hash on the same user tuple raises the stable conflict'
);

select is(
  public.register_recommendation_experiment_assignment(
    'abcdef0123456789',
    (select user_a from experiment_test_ids),
    'user',
    'fedcba9876543210',
    'v1-canonical-1',
    '0123456789abcdef',
    'control'
  ),
  true,
  'exact registration replay still returns true after a rejected conflict'
);

select throws_ok(
  format(
    'select * from public.resolve_recommendation_experiment_assignment(%L, %L::uuid, %L, %L, %L, %L, %L)',
    'eeeeeeeeeeeeeeee',
    (select user_a from experiment_test_ids),
    'user',
    'fedcba9876543210',
    'v1-canonical-1',
    '0123456789abcdef',
    'control'
  ),
  '22023',
  'invalid experiment assignment',
  'resolver rejects a stored generic-config assignment after deactivation too'
);

select throws_ok(
  format(
    'select * from public.resolve_recommendation_experiment_assignment(%L, %L::uuid, %L, %L, %L, %L, %L)',
    'dddddddddddddddd',
    (select user_a from experiment_test_ids),
    'request',
    'fedcba9876543210',
    'v1-canonical-1',
    '0123456789abcdef',
    'control'
  ),
  '22023',
  'invalid experiment assignment',
  'assignment resolver rejects every assignment unit other than user'
);

select is(
  public.register_recommendation_experiment_assignment(
    'aaaa000000000001',
    (select user_a from experiment_test_ids),
    'request',
    '1111222233334444',
    'v1-canonical-1',
    '0123456789abcdef',
    'control'
  ),
  true,
  'first request-level subject for the user/config registers independently'
);

select is(
  public.register_recommendation_experiment_assignment(
    'aaaa000000000002',
    (select user_a from experiment_test_ids),
    'request',
    '5555666677778888',
    'v1-canonical-1',
    '0123456789abcdef',
    'treatment'
  ),
  true,
  'second request-level subject for the same user/config stays independently registrable'
);

select is(
  (select count(*)
     from public.recommendation_experiment_assignments
    where user_id = (select user_a from experiment_test_ids)
      and assignment_unit = 'request'
      and engine_version = 'v1-canonical-1'
      and config_version = '0123456789abcdef'),
  2::bigint,
  'both request-level subject rows persist independently for one user/config'
);

-- ---------------------------------------------------------------------------
-- Global pairing/backfill invariants and registry-evidence integrity.
-- ---------------------------------------------------------------------------

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);

select ok(
  not exists (
    select 1
    from public.suggestion_exposure_log
    where experiment_bucket = 'default'
      and assignment_hash <> '0000000000000000'
  ),
  'no default-bucket row carries a nonzero assignment hash'
);

select ok(
  not exists (
    select 1
    from public.suggestion_exposure_log
    where experiment_bucket = 'default'
      and experiment_config_version <> '0000000000000000'
  ),
  'no default-bucket row carries a nonzero experiment config version'
);

select ok(
  not exists (
    select 1
    from public.suggestion_exposure_log
    where experiment_bucket is null
      and experiment_config_version <> '0000000000000000'
  ),
  'no legacy unassigned row carries a nonzero experiment config version'
);

select ok(
  not exists (
    select 1
    from public.suggestion_exposure_log e
    where e.experiment_bucket in ('control', 'treatment')
      and not exists (
        select 1
        from public.recommendation_experiment_assignments a
        where a.assignment_hash = e.assignment_hash
          and a.user_id = e.user_id
          and a.engine_version = e.engine_version
          and a.config_version = e.experiment_config_version
          and a.bucket = e.experiment_bucket
      )
  ),
  'every active exposure row has matching server-owned registry evidence'
);

select ok(
  not exists (
    select 1
    from public.suggestion_feedback
    where feedback_event_at is null
  ),
  'no suggestion_feedback row carries a null feedback_event_at'
);

reset role;
select * from finish();
rollback;
