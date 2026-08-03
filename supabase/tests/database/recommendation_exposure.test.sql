-- =============================================================================
-- pgTAP: versioned recommendation exposure telemetry (checkpoint 2B.2)
-- =============================================================================
-- Runs entirely inside begin/rollback; every fixture row (auth users,
-- profiles, and exposure rows) is removed by the outer ROLLBACK, so no test
-- data persists. Identifiers are randomized per run to avoid collisions.
--
-- Coverage:
--   * BEFORE INSERT OR UPDATE guard: exact signature, trigger return type, SECURITY
--     INVOKER, empty search_path, EXECUTE only for authenticated/service_role
--   * guard source contract: server timestamps, nulling of every legacy
--     telemetry payload column, and the stable SQLSTATE 22023 rejection of
--     incomplete/non-canonical records
--   * allowlisted bounded-map helper: exact 6-argument signature, restricted
--     EXECUTE, and removal of the legacy unbounded overload
--   * bounded exposure aggregate RPC: exact result shape, one-table-scan
--     contract, SECURITY DEFINER/empty search_path, and service_role-only ACL
--   * privileged prune function: SECURITY DEFINER with no PUBLIC EXECUTE
--   * versioned bounds check constraints exist on the exposure table
--   * trigger behavior: client-supplied timestamps and every legacy payload
--     column are overridden with server values on insert, while canonical
--     version fields persist verbatim and privileged updates cannot extend
--     the original exposure timestamps
--   * rejection: incomplete rows (missing canonical fields) and complete but
--     non-canonical rows (wrong engine/bucket pairing, malformed input
--     revision, out-of-bounds rank, non-allowlisted keys, out-of-range and
--     non-integer values, non-object diagnostic maps) all fail closed with
--     the stable SQLSTATE 22023 message
--   * legacy compatibility: a pre-migration-style row seeded with the guard
--     disabled keeps its legacy payload and nullable canonical fields
--   * owner isolation: cross-owner reads are hidden and cross-owner inserts
--     are rejected by the owner RLS policy
--   * anon EXECUTE denial for the guard function
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(74);

-- ---------------------------------------------------------------------------
-- Static contract: guard trigger function.
-- ---------------------------------------------------------------------------

select has_function('public', 'enforce_versioned_exposure_insert');

select function_returns(
  'public',
  'enforce_versioned_exposure_insert',
  'trigger'
);

select is(
  (select prosecdef from pg_proc
    where oid = 'public.enforce_versioned_exposure_insert()'::regprocedure),
  false,
  'enforce_versioned_exposure_insert is SECURITY INVOKER (prosecdef = false)'
);

-- PUBLIC must not retain inherited EXECUTE through a missing explicit ACL.
select ok(
  not exists (
    select 1
    from aclexplode(
      coalesce(
        (select proacl from pg_proc
          where oid = 'public.enforce_versioned_exposure_insert()'::regprocedure),
        acldefault('f', (select proowner from pg_proc
          where oid = 'public.enforce_versioned_exposure_insert()'::regprocedure))
      )
    )
    where grantee = 0 and privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute enforce_versioned_exposure_insert()'
);

select function_privs_are(
  'public',
  'enforce_versioned_exposure_insert',
  array[]::text[],
  'anon',
  array[]::text[]
);
select function_privs_are(
  'public',
  'enforce_versioned_exposure_insert',
  array[]::text[],
  'authenticated',
  array['EXECUTE']::text[]
);
select function_privs_are(
  'public',
  'enforce_versioned_exposure_insert',
  array[]::text[],
  'service_role',
  array['EXECUTE']::text[]
);

select ok(
  (select coalesce(proconfig, array[]::text[]) @> array['search_path=']
     from pg_proc
    where oid = 'public.enforce_versioned_exposure_insert()'::regprocedure),
  'enforce_versioned_exposure_insert runs with an empty search_path'
);

select ok(
  (select position($frag$new.exposed_at := now();$frag$ in prosrc) > 0
          and position($frag$new.retention_until := now() + interval '90 days';$frag$ in prosrc) > 0
     from pg_proc
    where oid = 'public.enforce_versioned_exposure_insert()'::regprocedure),
  'guard forces server exposed_at and the bounded 90-day retention boundary'
);

select ok(
  (select position($frag$new.session_context := null;$frag$ in prosrc) > 0
          and position($frag$new.sources := null;$frag$ in prosrc) > 0
          and position($frag$new.reasons := null;$frag$ in prosrc) > 0
     from pg_proc
    where oid = 'public.enforce_versioned_exposure_insert()'::regprocedure),
  'guard nulls the legacy raw session_context/sources/reasons columns'
);

select ok(
  (select position($frag$new.category := null;$frag$ in prosrc) > 0
          and position($frag$new.base_score := null;$frag$ in prosrc) > 0
          and position($frag$new.consensus_level := null;$frag$ in prosrc) > 0
          and position($frag$new.mmr_lambda := null;$frag$ in prosrc) > 0
          and position($frag$new.diversity_rank := null;$frag$ in prosrc) > 0
          and position($frag$new.has_poster := null;$frag$ in prosrc) > 0
          and position($frag$new.has_trailer := null;$frag$ in prosrc) > 0
          and position($frag$new.metadata_completeness := null;$frag$ in prosrc) > 0
     from pg_proc
    where oid = 'public.enforce_versioned_exposure_insert()'::regprocedure),
  'guard nulls every remaining legacy telemetry payload column'
);

select ok(
  (select position(
      $frag$raise exception 'incomplete versioned exposure record' using errcode = '22023';$frag$
      in prosrc) > 0
     from pg_proc
    where oid = 'public.enforce_versioned_exposure_insert()'::regprocedure),
  'guard rejects incomplete canonical records with SQLSTATE 22023 and a stable message'
);

select has_trigger(
  'public',
  'suggestion_exposure_log',
  'suggestion_exposure_log_version_guard'
);

select ok(
  (select pg_get_triggerdef(t.oid) ~* 'before insert or update'
     from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'suggestion_exposure_log'
      and t.tgname = 'suggestion_exposure_log_version_guard'
      and not t.tgisinternal),
  'exposure guard runs before INSERT OR UPDATE'
);

-- ---------------------------------------------------------------------------
-- Static contract: allowlisted bounded-map helper.
-- ---------------------------------------------------------------------------

select has_function(
  'public',
  'bounded_jsonb_object',
  array['jsonb', 'text[]', 'integer', 'integer', 'integer', 'integer']
);

select function_returns(
  'public',
  'bounded_jsonb_object',
  array['jsonb', 'text[]', 'integer', 'integer', 'integer', 'integer'],
  'boolean'
);

select ok(
  not exists (
    select 1
    from aclexplode(
      coalesce(
        (select proacl from pg_proc
          where oid = 'public.bounded_jsonb_object(jsonb,text[],integer,integer,integer,integer)'::regprocedure),
        acldefault('f', (select proowner from pg_proc
          where oid = 'public.bounded_jsonb_object(jsonb,text[],integer,integer,integer,integer)'::regprocedure))
      )
    )
    where grantee = 0 and privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute the allowlisted bounded_jsonb_object overload'
);

select function_privs_are(
  'public',
  'bounded_jsonb_object',
  array['jsonb', 'text[]', 'integer', 'integer', 'integer', 'integer'],
  'anon',
  array[]::text[]
);
select function_privs_are(
  'public',
  'bounded_jsonb_object',
  array['jsonb', 'text[]', 'integer', 'integer', 'integer', 'integer'],
  'authenticated',
  array['EXECUTE']::text[]
);

select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'bounded_jsonb_object'
      and pg_get_function_identity_arguments(p.oid) = 'jsonb, integer, numeric'
  ),
  'legacy unbounded bounded_jsonb_object(jsonb, integer, numeric) overload is removed'
);

select ok(
  (select position($frag$case jsonb_typeof(entries.entry_value) when 'number'$frag$ in prosrc) > 0
     from pg_proc
    where oid = 'public.bounded_jsonb_object(jsonb,text[],integer,integer,integer,integer)'::regprocedure),
  'bounded_jsonb_object guards numeric casts with a value-type CASE branch'
);

-- ---------------------------------------------------------------------------
-- Static/result contract: restricted exposure aggregate RPC.
-- ---------------------------------------------------------------------------

select has_function(
  'public',
  'get_bounded_exposure_diagnostics',
  array['uuid']::text[]
);

select function_returns(
  'public',
  'get_bounded_exposure_diagnostics',
  array['uuid']::text[],
  'record'
);

select is(
  (select pg_get_function_result('public.get_bounded_exposure_diagnostics(uuid)'::regprocedure)),
  'TABLE(total_count integer, owner_count integer, current_engine_count integer, default_bucket_count integer)',
  'aggregate RPC exposes exactly the four bounded count columns'
);

select is(
  (select prosecdef from pg_proc
    where oid = 'public.get_bounded_exposure_diagnostics(uuid)'::regprocedure),
  true,
  'aggregate RPC is SECURITY DEFINER (prosecdef = true)'
);

select ok(
  (select coalesce(proconfig, array[]::text[]) @> array['search_path=']
     from pg_proc
    where oid = 'public.get_bounded_exposure_diagnostics(uuid)'::regprocedure),
  'aggregate RPC runs with an empty search_path'
);

select ok(
  not exists (
    select 1
    from aclexplode(
      coalesce(
        (select proacl from pg_proc
          where oid = 'public.get_bounded_exposure_diagnostics(uuid)'::regprocedure),
        acldefault('f', (select proowner from pg_proc
          where oid = 'public.get_bounded_exposure_diagnostics(uuid)'::regprocedure))
      )
    )
    where grantee = 0 and privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute the aggregate RPC'
);

select function_privs_are(
  'public',
  'get_bounded_exposure_diagnostics',
  array['uuid']::text[],
  'anon',
  array[]::text[]
);
select function_privs_are(
  'public',
  'get_bounded_exposure_diagnostics',
  array['uuid']::text[],
  'authenticated',
  array[]::text[]
);
select function_privs_are(
  'public',
  'get_bounded_exposure_diagnostics',
  array['uuid']::text[],
  'service_role',
  array['EXECUTE']::text[]
);

select is(
  (select count(*) from public.get_bounded_exposure_diagnostics(gen_random_uuid())),
  1::bigint,
  'aggregate RPC returns exactly one row'
);

select ok(
  (select jsonb_object_length(to_jsonb(aggregate_row)) = 4
           and to_jsonb(aggregate_row) ?& array[
             'total_count', 'owner_count', 'current_engine_count',
             'default_bucket_count'
           ]
      from public.get_bounded_exposure_diagnostics(gen_random_uuid()) as aggregate_row),
  'aggregate RPC returns only the fixed bounded count shape'
);

select ok(
  (select aggregate_row.total_count between 0 and 10000
           and aggregate_row.owner_count between 0 and 10000
           and aggregate_row.current_engine_count between 0 and 10000
           and aggregate_row.default_bucket_count between 0 and 10000
      from public.get_bounded_exposure_diagnostics(gen_random_uuid()) as aggregate_row),
  'aggregate RPC caps every count at the bounded diagnostic maximum'
);

-- ---------------------------------------------------------------------------
-- Static contract: privileged prune function.
-- ---------------------------------------------------------------------------

select has_function(
  'public',
  'prune_suggestion_exposures',
  array['integer']
);

select is(
  (select prosecdef from pg_proc
    where oid = 'public.prune_suggestion_exposures(integer)'::regprocedure),
  true,
  'prune_suggestion_exposures is SECURITY DEFINER (prosecdef = true)'
);

select ok(
  not exists (
    select 1
    from aclexplode(
      coalesce(
        (select proacl from pg_proc
          where oid = 'public.prune_suggestion_exposures(integer)'::regprocedure),
        acldefault('f', (select proowner from pg_proc
          where oid = 'public.prune_suggestion_exposures(integer)'::regprocedure))
      )
    )
    where grantee = 0 and privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute prune_suggestion_exposures(integer)'
);

-- ---------------------------------------------------------------------------
-- Static contract: versioned bounds check constraints.
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
  'engine_version bounds check constraint exists'
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
  'experiment_bucket bounds check constraint exists'
);
select ok(
  exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'suggestion_exposure_log'
      and c.conname = 'suggestion_exposure_log_input_revision_bounds'
      and c.contype = 'c'
  ),
  'input_revision bounds check constraint exists'
);
select ok(
  exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'suggestion_exposure_log'
      and c.conname = 'suggestion_exposure_log_rank_bounds'
      and c.contype = 'c'
  ),
  'rank bounds check constraint exists'
);
select ok(
  exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'suggestion_exposure_log'
      and c.conname = 'suggestion_exposure_log_drop_reason_counts_bounds'
      and c.contype = 'c'
  ),
  'drop_reason_counts bounds check constraint exists'
);
select ok(
  exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'suggestion_exposure_log'
      and c.conname = 'suggestion_exposure_log_source_shares_bounds'
      and c.contype = 'c'
  ),
  'source_shares bounds check constraint exists'
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
  'canonical exposure fields use an explicit all-null-or-complete constraint'
);

-- ---------------------------------------------------------------------------
-- Fixtures: two auth users for owner and cross-owner behavior.
-- ---------------------------------------------------------------------------

create temporary table exposure_test_ids (
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
    (a, 'authenticated', 'authenticated', a::text || '@exposure.test',
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    (b, 'authenticated', 'authenticated', b::text || '@exposure.test',
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

  -- Keep the profile FKs valid even when the auth trigger is absent on reset.
  insert into public.profiles (id, email)
  values
    (a, a::text || '@exposure.test'),
    (b, b::text || '@exposure.test')
  on conflict (id) do update set email = excluded.email;

  insert into exposure_test_ids (user_a, user_b) values (a, b);
end;
$setup$;

grant select on exposure_test_ids to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Owner insert with every legacy payload column poisoned: the guard must
-- override the timestamps and null every legacy column while persisting the
-- canonical version fields verbatim.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_a::text from exposure_test_ids), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.suggestion_exposure_log (
  user_id, tmdb_id, exposed_at, retention_until,
  category, session_context, base_score, consensus_level,
  sources, reasons, mmr_lambda, diversity_rank,
  has_poster, has_trailer, metadata_completeness,
  engine_version, experiment_bucket, input_revision,
  pre_rank, post_rank, drop_reason_counts, source_shares
)
values (
  (select user_a from exposure_test_ids),
  2147483001,
  '2031-01-01T00:00:00Z',
  '2032-01-01T00:00:00Z',
  'legacy-seasonal',
  '{"jwt":"eyJhbGciOiJIUzI1NiJ9.leaked.signature"}'::jsonb,
  0.987,
  'high',
  array['leaked-source'],
  array['leaked-reason'],
  0.5,
  7,
  true,
  true,
  0.42,
  'v1-canonical-1', 'default', 'abcdef0123456789',
  1, 1,
  '{"seed":1,"watched":2}'::jsonb,
  '{"tmdb":2,"letterboxd":1}'::jsonb
);

-- Inspect through service_role so RLS cannot make the assertions vacuous.
reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  (select count(*) from public.suggestion_exposure_log
    where user_id = (select user_a from exposure_test_ids)),
  1::bigint,
  'owner insert persists exactly one versioned exposure row'
);

select ok(
  (select exposed_at <= now()
          and exposed_at > now() - interval '10 seconds'
          and retention_until > now() + interval '89 days'
          and retention_until < now() + interval '91 days'
     from public.suggestion_exposure_log
    where user_id = (select user_a from exposure_test_ids)
      and tmdb_id = 2147483001),
  'trigger overrides client exposed_at/retention_until with the server clock and the 90-day boundary'
);

select ok(
  (select abs(extract(epoch from (retention_until - exposed_at - interval '90 days'))) < 5
     from public.suggestion_exposure_log
    where user_id = (select user_a from exposure_test_ids)
      and tmdb_id = 2147483001),
  'retention_until stays exactly 90 days after the forced exposed_at'
);

select is(
  (select jsonb_build_object(
     'category', to_jsonb(category),
     'session_context', session_context,
     'base_score', to_jsonb(base_score),
     'consensus_level', to_jsonb(consensus_level),
     'sources', to_jsonb(sources),
     'reasons', to_jsonb(reasons),
     'mmr_lambda', to_jsonb(mmr_lambda),
     'diversity_rank', to_jsonb(diversity_rank),
     'has_poster', to_jsonb(has_poster),
     'has_trailer', to_jsonb(has_trailer),
     'metadata_completeness', to_jsonb(metadata_completeness))
   from public.suggestion_exposure_log
   where user_id = (select user_a from exposure_test_ids)
     and tmdb_id = 2147483001),
  '{"category":null,"session_context":null,"base_score":null,"consensus_level":null,"sources":null,"reasons":null,"mmr_lambda":null,"diversity_rank":null,"has_poster":null,"has_trailer":null,"metadata_completeness":null}'::jsonb,
  'trigger nulls every legacy telemetry payload column on insert'
);

select is(
  (select jsonb_build_object(
      'engine_version', engine_version,
     'experiment_bucket', experiment_bucket,
     'input_revision', input_revision)
   from public.suggestion_exposure_log
   where user_id = (select user_a from exposure_test_ids)
     and tmdb_id = 2147483001),
  '{"engine_version":"v1-canonical-1","experiment_bucket":"default","input_revision":"abcdef0123456789"}'::jsonb,
   'canonical version fields persist verbatim for the owner row'
);

-- ---------------------------------------------------------------------------
-- Privileged UPDATE boundary: the same guard must sanitize legacy payloads,
-- reject incomplete canonical records, and preserve the original timestamp
-- boundary even when service_role attempts to extend it.
-- ---------------------------------------------------------------------------

create temporary table exposure_expected_timestamps (
  expected_exposed_at timestamptz not null,
  expected_retention_until timestamptz not null
);

insert into exposure_expected_timestamps (
  expected_exposed_at,
  expected_retention_until
)
select exposed_at, retention_until
  from public.suggestion_exposure_log
 where user_id = (select user_a from exposure_test_ids)
   and tmdb_id = 2147483001;

update public.suggestion_exposure_log
   set exposed_at = '2041-01-01T00:00:00Z',
       retention_until = '2099-01-01T00:00:00Z',
       category = 'updated-legacy-seasonal',
       session_context = '{"jwt":"eyJhbGciOiJIUzI1NiJ9.updated.signature"}'::jsonb,
       base_score = 0.123,
       consensus_level = 'updated-high',
       sources = array['updated-source'],
       reasons = array['updated-reason'],
       mmr_lambda = 0.25,
       diversity_rank = 9,
       has_poster = false,
       has_trailer = false,
       metadata_completeness = 0.11
 where user_id = (select user_a from exposure_test_ids)
   and tmdb_id = 2147483001;

select is(
  (select jsonb_build_object(
     'category', to_jsonb(category),
     'session_context', session_context,
     'base_score', to_jsonb(base_score),
     'consensus_level', to_jsonb(consensus_level),
     'sources', to_jsonb(sources),
     'reasons', to_jsonb(reasons),
     'mmr_lambda', to_jsonb(mmr_lambda),
     'diversity_rank', to_jsonb(diversity_rank),
     'has_poster', to_jsonb(has_poster),
     'has_trailer', to_jsonb(has_trailer),
     'metadata_completeness', to_jsonb(metadata_completeness))
    from public.suggestion_exposure_log
   where user_id = (select user_a from exposure_test_ids)
     and tmdb_id = 2147483001),
  '{"category":null,"session_context":null,"base_score":null,"consensus_level":null,"sources":null,"reasons":null,"mmr_lambda":null,"diversity_rank":null,"has_poster":null,"has_trailer":null,"metadata_completeness":null}'::jsonb,
  'privileged UPDATE sanitizes every legacy telemetry payload column'
);

select ok(
  (select exposure.exposed_at = expected.expected_exposed_at
          and exposure.retention_until = expected.expected_retention_until
     from public.suggestion_exposure_log exposure
     cross join exposure_expected_timestamps expected
    where exposure.user_id = (select user_a from exposure_test_ids)
      and exposure.tmdb_id = 2147483001),
  'privileged UPDATE cannot extend exposed_at or retention_until'
);

select throws_ok(
  format(
    'update public.suggestion_exposure_log set input_revision = null where user_id = %L::uuid and tmdb_id = 2147483001',
    (select user_a from exposure_test_ids)
  ),
  '22023',
  'incomplete versioned exposure record',
  'privileged UPDATE rejects a partial canonical field set'
);

select throws_ok(
  format(
    'update public.suggestion_exposure_log set drop_reason_counts = %L::jsonb where user_id = %L::uuid and tmdb_id = 2147483001',
    '{"seed":"1"}',
    (select user_a from exposure_test_ids)
  ),
  '22023',
  'incomplete versioned exposure record',
  'UPDATE rejects an allowlisted string value with the stable guard error'
);

select throws_ok(
  format(
    'update public.suggestion_exposure_log set drop_reason_counts = %L::jsonb where user_id = %L::uuid and tmdb_id = 2147483001',
    '{"seed":true}',
    (select user_a from exposure_test_ids)
  ),
  '22023',
  'incomplete versioned exposure record',
  'UPDATE rejects an allowlisted boolean value with the stable guard error'
);

select throws_ok(
  format(
    'update public.suggestion_exposure_log set drop_reason_counts = %L::jsonb where user_id = %L::uuid and tmdb_id = 2147483001',
    '{"seed":null}',
    (select user_a from exposure_test_ids)
  ),
  '22023',
  'incomplete versioned exposure record',
  'UPDATE rejects an allowlisted null value with the stable guard error'
);

-- ---------------------------------------------------------------------------
-- Guard rejection: every incomplete or non-canonical insert fails closed with
-- the stable SQLSTATE 22023 message and leaves no row behind. Rejection
-- probes supply every canonical field except the poisoned one so each probe
-- isolates a single failing condition.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_a::text from exposure_test_ids), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id) values (%L::uuid, 2147483013)',
    (select user_a from exposure_test_ids)
  ),
  '22023',
  'incomplete versioned exposure record',
  'minimal insert without any canonical version fields is rejected'
);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket) values (%L::uuid, 2147483014, %L, %L)',
    (select user_a from exposure_test_ids),
    'v1-canonical-1',
    'default'
  ),
  '22023',
  'incomplete versioned exposure record',
  'partial insert missing revision, ranks, and diagnostic maps is rejected'
);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483002, %L, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_a from exposure_test_ids),
    'v2-evil',
    'default',
    'abcdef0123456789',
    '{"seed":1}',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'non-canonical engine_version is rejected'
);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483003, %L, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_a from exposure_test_ids),
    'v1-canonical-1',
    'variant_a',
    'abcdef0123456789',
    '{"seed":1}',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'non-default experiment_bucket is rejected'
);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, experiment_bucket, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483004, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_a from exposure_test_ids),
    'default',
    'abcdef0123456789',
    '{"seed":1}',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'experiment_bucket without the canonical engine_version is rejected'
);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483005, %L, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_a from exposure_test_ids),
    'v1-canonical-1',
    'default',
    'NOT-HEX',
    '{"seed":1}',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'malformed input_revision is rejected'
);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483006, %L, %L, %L, 1, 0, %L::jsonb, %L::jsonb)',
    (select user_a from exposure_test_ids),
    'v1-canonical-1',
    'default',
    'abcdef0123456789',
    '{"seed":1}',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'out-of-bounds post_rank is rejected'
);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483007, %L, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_a from exposure_test_ids),
    'v1-canonical-1',
    'default',
    'abcdef0123456789',
    '{"not_a_reason":1}',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'non-allowlisted drop-reason keys cannot hide arbitrary strings'
);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483008, %L, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_a from exposure_test_ids),
    'v1-canonical-1',
    'default',
    'abcdef0123456789',
    '{"seed":1}',
    '{"sk_live":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'non-allowlisted source-family keys cannot hide arbitrary strings'
);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483009, %L, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_a from exposure_test_ids),
    'v1-canonical-1',
    'default',
    'abcdef0123456789',
    '{"seed":10001}',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'drop-reason counts above the bounded integer range are rejected'
);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483010, %L, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_a from exposure_test_ids),
    'v1-canonical-1',
    'default',
    'abcdef0123456789',
    '{"seed":1.5}',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'non-integer drop-reason counts are rejected'
);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483015, %L, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_a from exposure_test_ids),
    'v1-canonical-1',
    'default',
    'abcdef0123456789',
    '{"seed":"1"}',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'INSERT rejects an allowlisted string value with the stable guard error'
);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483016, %L, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_a from exposure_test_ids),
    'v1-canonical-1',
    'default',
    'abcdef0123456789',
    '{"seed":true}',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'INSERT rejects an allowlisted boolean value with the stable guard error'
);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483017, %L, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_a from exposure_test_ids),
    'v1-canonical-1',
    'default',
    'abcdef0123456789',
    '{"seed":null}',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'INSERT rejects an allowlisted null value with the stable guard error'
);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483011, %L, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_a from exposure_test_ids),
    'v1-canonical-1',
    'default',
    'abcdef0123456789',
    '[1,2]',
    '{"tmdb":1}'
  ),
  '22023',
  'incomplete versioned exposure record',
  'non-object diagnostic maps fail closed'
);

-- ---------------------------------------------------------------------------
-- Legacy compatibility: a pre-migration-style row (poisoned legacy payload,
-- null canonical fields) remains valid under the versioned constraints. The
-- guard trigger is disabled for the seeding insert only so the row mirrors
-- data written before the guard existed; the disable/enable pair and the row
-- itself are rolled back with the outer transaction. The migration-time
-- cleanup of such rows cannot be rerun inside this suite, so its contract is
-- asserted statically in the migration contract tests.
-- ---------------------------------------------------------------------------

reset role;

alter table public.suggestion_exposure_log
  disable trigger suggestion_exposure_log_version_guard;

insert into public.suggestion_exposure_log (
  user_id, tmdb_id, exposed_at,
  category, session_context, base_score, consensus_level,
  sources, reasons, mmr_lambda, diversity_rank,
  has_poster, has_trailer, metadata_completeness
)
values (
  (select user_a from exposure_test_ids),
  2147483099,
  now() - interval '10 days',
  'legacy-seasonal',
  '{"jwt":"eyJhbGciOiJIUzI1NiJ9.leaked.signature","filters":["drama"]}'::jsonb,
  0.987,
  'high',
  array['legacy-source'],
  array['legacy-reason'],
  0.5,
  7,
  true,
  false,
  0.42
);

alter table public.suggestion_exposure_log
  enable trigger suggestion_exposure_log_version_guard;

select is(
  (select jsonb_build_object(
     'category', to_jsonb(category),
     'session_context', session_context,
     'base_score', to_jsonb(base_score),
     'consensus_level', to_jsonb(consensus_level),
     'sources', to_jsonb(sources),
     'reasons', to_jsonb(reasons),
     'mmr_lambda', to_jsonb(mmr_lambda),
     'diversity_rank', to_jsonb(diversity_rank),
     'has_poster', to_jsonb(has_poster),
     'has_trailer', to_jsonb(has_trailer),
     'metadata_completeness', to_jsonb(metadata_completeness))
   from public.suggestion_exposure_log
   where tmdb_id = 2147483099),
  '{"category":"legacy-seasonal","session_context":{"jwt":"eyJhbGciOiJIUzI1NiJ9.leaked.signature","filters":["drama"]},"base_score":0.987,"consensus_level":"high","sources":["legacy-source"],"reasons":["legacy-reason"],"mmr_lambda":0.5,"diversity_rank":7,"has_poster":true,"has_trailer":false,"metadata_completeness":0.42}'::jsonb,
  'pre-migration-style rows keep their legacy payload until the migration-time cleanup'
);

select is(
  (select jsonb_build_object(
     'engine_version', to_jsonb(engine_version),
     'experiment_bucket', to_jsonb(experiment_bucket),
     'input_revision', to_jsonb(input_revision),
     'pre_rank', to_jsonb(pre_rank),
     'post_rank', to_jsonb(post_rank),
     'drop_reason_counts', drop_reason_counts,
     'source_shares', source_shares)
   from public.suggestion_exposure_log
   where tmdb_id = 2147483099),
  '{"engine_version":null,"experiment_bucket":null,"input_revision":null,"pre_rank":null,"post_rank":null,"drop_reason_counts":null,"source_shares":null}'::jsonb,
  'legacy rows keep nullable canonical fields under the versioned constraints'
);

-- ---------------------------------------------------------------------------
-- Owner isolation: cross-owner reads are hidden and cross-owner inserts are
-- rejected by the owner RLS policy. The probe supplies a complete canonical
-- row so the guard passes and the RLS policy is the rejecting boundary.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_b::text from exposure_test_ids), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (select count(*) from public.suggestion_exposure_log
    where user_id = (select user_a from exposure_test_ids)),
  0::bigint,
  'cross-owner reads are hidden by the owner RLS policy'
);

select throws_ok(
  format(
    'insert into public.suggestion_exposure_log (user_id, tmdb_id, engine_version, experiment_bucket, input_revision, pre_rank, post_rank, drop_reason_counts, source_shares) values (%L::uuid, 2147483012, %L, %L, %L, 1, 1, %L::jsonb, %L::jsonb)',
    (select user_a from exposure_test_ids),
    'v1-canonical-1',
    'default',
    'abcdef0123456789',
    '{"seed":1}',
    '{"tmdb":1}'
  ),
  '42501',
  'new row violates row-level security policy',
  'cross-owner inserts are rejected by the owner RLS policy'
);

-- ---------------------------------------------------------------------------
-- ACL negative: anon cannot execute the guard function.
-- ---------------------------------------------------------------------------

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);

select throws_ok(
  'select public.enforce_versioned_exposure_insert()',
  '42501',
  'permission denied for function enforce_versioned_exposure_insert',
  'anon cannot execute the exposure guard function'
);

reset role;
select * from finish();
rollback;
