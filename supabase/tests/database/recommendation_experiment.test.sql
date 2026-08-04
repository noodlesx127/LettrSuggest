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
--   * global pairing/backfill invariants and registry-evidence integrity
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(74);

-- ---------------------------------------------------------------------------
-- Static contract: experiment config version column.
-- ---------------------------------------------------------------------------

select has_column(
  'public',
  'suggestion_exposure_log',
  'experiment_config_version'
);

select col_not_null(
  'public',
  'suggestion_exposure_log',
  'experiment_config_version'
);

select col_default_is(
  'public',
  'suggestion_exposure_log',
  'experiment_config_version',
  '0000000000000000'
);

-- ---------------------------------------------------------------------------
-- Static contract: assignment hash column.
-- ---------------------------------------------------------------------------

select has_column(
  'public',
  'suggestion_exposure_log',
  'assignment_hash'
);

select col_not_null(
  'public',
  'suggestion_exposure_log',
  'assignment_hash'
);

select col_default_is(
  'public',
  'suggestion_exposure_log',
  'assignment_hash',
  '0000000000000000'
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
  'suggestion_exposure_log_experiment_join_idx'
);

select has_index(
  'public',
  'suggestion_exposure_log',
  'suggestion_exposure_log_experiment_bucket_idx'
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
  'recommendation_experiment_assignments'
);

select has_column(
  'public',
  'recommendation_experiment_assignments',
  'assignment_hash'
);

select has_column(
  'public',
  'recommendation_experiment_assignments',
  'subject_hash'
);

select has_index(
  'public',
  'recommendation_experiment_assignments',
  'recommendation_experiment_assignments_pkey'
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
      and pg_get_function_identity_arguments(p.oid) =
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
  'feedback_event_at'
);

select col_not_null(
  'public',
  'suggestion_feedback',
  'feedback_event_at'
);

select col_default_is(
  'public',
  'suggestion_feedback',
  'feedback_event_at',
  'now()'
);

select has_trigger(
  'public',
  'suggestion_feedback',
  'suggestion_feedback_event_at_guard'
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
-- break the zero-hash default pairing, even when a registry row exists for
-- the same owner (RLS keeps registry evidence unreachable).
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
    'abcdef0123456789',
    'abcdef0123456789',
    '{"seed":1}',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'authenticated direct active exposure insert is rejected without reachable registry evidence'
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
-- Service role: an active exposure persists only with a matching registry
-- row; unregistered and cross-owner evidence is rejected.
-- ---------------------------------------------------------------------------

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', (select user_a::text from experiment_test_ids), true);
select set_config('request.jwt.claim.role', 'service_role', true);

insert into public.suggestion_exposure_log (
  user_id, tmdb_id,
  engine_version, experiment_bucket, experiment_config_version, assignment_hash,
  input_revision, pre_rank, post_rank,
  drop_reason_counts, source_shares
)
values (
  (select user_a from experiment_test_ids),
  2147483207,
  'v1-canonical-1', 'control', '0123456789abcdef', 'abcdef0123456789',
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
  'service-role active exposure with a matching registry row persists'
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
  '{"engine_version":"v1-canonical-1","experiment_bucket":"control","experiment_config_version":"0123456789abcdef","assignment_hash":"abcdef0123456789"}'::jsonb,
  'controlled bucket, nonzero config version, and assignment hash persist verbatim'
);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, experiment_config_version, assignment_hash, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483208, %L, %L, %L, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_a from experiment_test_ids),
    'v1-canonical-1',
    'control',
    '0123456789abcdef',
    'ffffffffffffffff',
    'abcdef0123456789',
    '{"seed":1}',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'active exposure with an unregistered assignment hash is rejected'
);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, experiment_config_version, assignment_hash, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483209, %L, %L, %L, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_b from experiment_test_ids),
    'v1-canonical-1',
    'control',
    '0123456789abcdef',
    'abcdef0123456789',
    'abcdef0123456789',
    '{"seed":1}',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'active exposure whose registry evidence belongs to another owner is rejected'
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

select is(
  (with denied as (
     update public.suggestion_feedback
        set feedback_type = 'positive'
      where user_id = (select user_a from experiment_test_ids)
        and tmdb_id = 2147483302
      returning 1
   )
   select count(*) from denied),
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
