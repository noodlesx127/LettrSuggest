-- =============================================================================
-- pgTAP: reconcile_import_snapshot atomic snapshot reconciliation (checkpoint 2A.3)
-- =============================================================================
-- Runs entirely inside begin/rollback; every fixture row (auth users, profiles,
-- tmdb_movies metadata, and the other user's import rows) is removed by the
-- outer ROLLBACK, so no test data persists. Identifiers and URIs are randomized
-- per run to avoid collisions with existing rows.
--
-- Coverage:
--   * exact signature (jsonb, jsonb, jsonb) and jsonb return type
--   * SECURITY INVOKER (prosecdef = false)
--   * ACL: PUBLIC / anon / service_role denied, authenticated EXECUTE only
--   * definition references auth.uid() and takes the stable per-user
--     pg_advisory_xact_lock(hashtextextended(v_uid::text, 0))
--   * anon and null-identity callers are rejected
--   * first snapshot inserts; second snapshot preserves one / removes absent /
--     adds one across film_events, film_tmdb_map, and film_diary_events_raw with
--     structured counts, deleting absent diary rows BEFORE inserting retained ones
--     so the last_date trigger recomputes to the retained (earlier) date; the
--     other user's rows remain untouched throughout
--   * a third snapshot replaces everything with a single epsilon film (mapped to
--     already-seeded metadata, empty diary), proving a full swap: epsilon's
--     last_date stays NULL, alpha/gamma are removed, and the diary is cleared
--   * an orphan mapping and an orphan diary event each throw before any write; a
--     mapping to missing TMDB metadata fails the FK constraint mid-write and rolls
--     the whole function statement back, leaving prior permanent state unchanged
--
-- Concurrency note: this suite asserts the advisory-lock DEFINITION offline.
-- Actual concurrent-execution serialization (two overlapping imports for one
-- user blocking on the same lock) cannot be exercised by single-connection
-- pgTAP and remains for live validation against a running database.
--
-- Test-harness note: reconcile_import_snapshot stages into ON COMMIT DROP temp
-- tables and pre-drops them (DROP TABLE IF EXISTS pg_temp.*) at the start of each
-- call. Production invokes it as one RPC per transaction, but this suite calls it
-- several times inside one transaction; the function's own pre-create drops make
-- those repeated calls reentrant, so the suite performs no manual staging drops.
-- A failed call is rolled back by pgTAP's internal savepoint and leaves no temp
-- tables.
-- =============================================================================

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(38);

-- ---------------------------------------------------------------------------
-- Static contract: signature, return type, security, ACL, and definition.
-- ---------------------------------------------------------------------------

select has_function(
  'public',
  'reconcile_import_snapshot',
  array['jsonb', 'jsonb', 'jsonb']
);

select function_returns(
  'public',
  'reconcile_import_snapshot',
  array['jsonb', 'jsonb', 'jsonb'],
  'jsonb'
);

select is(
  (select prosecdef from pg_proc
    where oid = 'public.reconcile_import_snapshot(jsonb,jsonb,jsonb)'::regprocedure),
  false,
  'reconcile_import_snapshot is SECURITY INVOKER (prosecdef = false)'
);

-- PUBLIC must not retain inherited EXECUTE through a missing explicit ACL.
select ok(
  not exists (
    select 1
    from aclexplode(
      coalesce(
        (select proacl from pg_proc where oid = 'public.reconcile_import_snapshot(jsonb,jsonb,jsonb)'::regprocedure),
        acldefault('f', (select proowner from pg_proc where oid = 'public.reconcile_import_snapshot(jsonb,jsonb,jsonb)'::regprocedure))
      )
    )
    where grantee = 0 and privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute reconcile_import_snapshot(jsonb, jsonb, jsonb)'
);

select function_privs_are(
  'public',
  'reconcile_import_snapshot',
  array['jsonb', 'jsonb', 'jsonb'],
  'anon',
  array[]::text[]
);
select function_privs_are(
  'public',
  'reconcile_import_snapshot',
  array['jsonb', 'jsonb', 'jsonb'],
  'service_role',
  array[]::text[]
);
select function_privs_are(
  'public',
  'reconcile_import_snapshot',
  array['jsonb', 'jsonb', 'jsonb'],
  'authenticated',
  array['EXECUTE']::text[]
);

select ok(
  position('auth.uid()' in (
    select prosrc from pg_proc
     where oid = 'public.reconcile_import_snapshot(jsonb,jsonb,jsonb)'::regprocedure
  )) > 0,
  'function definition derives ownership from auth.uid()'
);
select ok(
  position('pg_advisory_xact_lock(hashtextextended(v_uid::text, 0))' in (
    select prosrc from pg_proc
     where oid = 'public.reconcile_import_snapshot(jsonb,jsonb,jsonb)'::regprocedure
  )) > 0,
  'function definition takes a stable per-user advisory xact lock before writes'
);
select ok(
  (select position('pg_temp.tmp_snapshot_film_events' in prosrc) > 0
          and position('pg_temp.tmp_snapshot_mappings' in prosrc) > 0
          and position('pg_temp.tmp_snapshot_diary_events' in prosrc) > 0
     from pg_proc
    where oid = 'public.reconcile_import_snapshot(jsonb,jsonb,jsonb)'::regprocedure),
   'function definition pre-drops its pg_temp staging tables so repeated calls are reentrant'
);

-- ---------------------------------------------------------------------------
-- Static RLS contract: the reconciled film/mapping tables carry an owner-scoped
-- DELETE policy granted to authenticated only. The function is SECURITY INVOKER,
-- so without these policies its DELETE FROM public.film_events / film_tmdb_map
-- statements would be blocked (zero rows) and stale rows would never be removed.
-- ---------------------------------------------------------------------------

select policy_exists('public', 'film_events', 'film_events user delete');
select policy_exists('public', 'film_tmdb_map', 'film_tmdb_map user delete');

select policy_cmd_is(
  'public', 'film_events', 'film_events user delete', 'DELETE'
);
select policy_cmd_is(
  'public', 'film_tmdb_map', 'film_tmdb_map user delete', 'DELETE'
);

select policy_roles_are(
  'public', 'film_events', 'film_events user delete', array['authenticated']
);
select policy_roles_are(
  'public', 'film_tmdb_map', 'film_tmdb_map user delete', array['authenticated']
);

-- ---------------------------------------------------------------------------
-- Fixtures: two auth users, required TMDB metadata, and the other user's rows.
-- ---------------------------------------------------------------------------

create temporary table import_snapshot_test_ids (
  user_a uuid not null,
  user_b uuid not null,
  uri_alpha text not null,
  uri_beta text not null,
  uri_gamma text not null,
  uri_delta text not null,
  uri_orphan text not null,
  uri_epsilon text not null,
  uri_b text not null
);

create temporary table import_snapshot_test_results (
  name text primary key,
  result jsonb not null
);

create temporary table import_snapshot_payloads (
  name text primary key,
  films jsonb not null,
  mappings jsonb not null,
  diary jsonb not null
);

do $setup$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  -- High range far above real TMDB ids; t1/t2/t3/t_b are seeded, t_missing is not.
  base bigint := 2000000000 + (random() * 100000000)::bigint;
  ua text := 'letterboxd://import-snapshot/' || gen_random_uuid()::text || '/alpha';
  ub text := 'letterboxd://import-snapshot/' || gen_random_uuid()::text || '/beta';
  ug text := 'letterboxd://import-snapshot/' || gen_random_uuid()::text || '/gamma';
  ud text := 'letterboxd://import-snapshot/' || gen_random_uuid()::text || '/delta';
  uo text := 'letterboxd://import-snapshot/' || gen_random_uuid()::text || '/orphan';
  ue text := 'letterboxd://import-snapshot/' || gen_random_uuid()::text || '/epsilon';
  ubu text := 'letterboxd://import-snapshot/' || gen_random_uuid()::text || '/other';
begin
  insert into auth.users (
    id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values
    (a, 'authenticated', 'authenticated', a::text || '@import-snapshot.test',
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()),
    (b, 'authenticated', 'authenticated', b::text || '@import-snapshot.test',
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now());

  -- Keep the profile FKs valid even when the auth trigger is absent on reset.
  insert into public.profiles (id, email)
  values
    (a, a::text || '@import-snapshot.test'),
    (b, b::text || '@import-snapshot.test')
  on conflict (id) do update set email = excluded.email;

  -- TMDB metadata required by the film_tmdb_map FK. base+4 (t_missing) is
  -- intentionally NOT inserted so the fkbad scenario violates the FK mid-write.
  insert into public.tmdb_movies (tmdb_id, data)
  values
    (base,     jsonb_build_object('title', 'pgTAP import alpha')),
    (base + 1, jsonb_build_object('title', 'pgTAP import beta')),
    (base + 2, jsonb_build_object('title', 'pgTAP import gamma')),
    (base + 3, jsonb_build_object('title', 'pgTAP import other-user'))
  on conflict (tmdb_id) do nothing;

  -- The other user's pre-existing import rows; these must survive every
  -- reconciliation and failure performed by user_a.
  insert into public.film_events (
    user_id, uri, title, year, rating, rewatch, last_date, watch_count, liked, on_watchlist
  )
  values (b, ubu, 'pgTAP other-user film', 2021, 3.5, false, '2026-05-01', 1, false, false);

  insert into public.film_tmdb_map (user_id, uri, tmdb_id) values (b, ubu, base + 3);

  insert into public.film_diary_events_raw (user_id, uri, watched_date, rating, rewatch)
  values (b, ubu, '2026-05-01', 3.5, false);

  insert into import_snapshot_test_ids (
    user_a, user_b, uri_alpha, uri_beta, uri_gamma, uri_delta, uri_orphan, uri_epsilon, uri_b
  )
  values (a, b, ua, ub, ug, ud, uo, ue, ubu);

  -- Precompute snapshot payloads per scenario.
  insert into import_snapshot_payloads (name, films, mappings, diary) values
    -- First snapshot: alpha + beta across all three stores. Alpha carries an
    -- early (2026-01-01) AND a late (2026-09-01) diary event so the second
    -- snapshot can prove the late one is deleted before the retained early one
    -- is re-inserted (last_date trigger recompute).
    ('snap1',
      jsonb_build_array(
        jsonb_build_object('uri', ua, 'title', 'Alpha Fixture', 'year', 2020),
        jsonb_build_object('uri', ub, 'title', 'Beta Fixture', 'year', 2021)),
      jsonb_build_array(
        jsonb_build_object('uri', ua, 'tmdb_id', base),
        jsonb_build_object('uri', ub, 'tmdb_id', base + 1)),
      jsonb_build_array(
        jsonb_build_object('uri', ua, 'watched_date', '2026-01-01', 'rating', 4, 'rewatch', false),
        jsonb_build_object('uri', ua, 'watched_date', '2026-09-01', 'rating', 3, 'rewatch', false),
        jsonb_build_object('uri', ub, 'watched_date', '2026-02-01', 'rating', 3, 'rewatch', false))),
    -- Second snapshot: preserve alpha (early diary only), remove beta, add gamma.
    -- Alpha's film last_date is supplied as a DELIBERATELY STALE LATER date
    -- (2026-12-31) so the assertion proves the exact post-diary recompute
    -- overrides both the snapshot value and the increase-only trigger, landing
    -- on the true retained MAX(watched_date) of 2026-01-01.
    ('snap2',
      jsonb_build_array(
        jsonb_build_object('uri', ua, 'title', 'Alpha Fixture', 'year', 2020, 'last_date', '2026-12-31'),
        jsonb_build_object('uri', ug, 'title', 'Gamma Fixture', 'year', 2022)),
      jsonb_build_array(
        jsonb_build_object('uri', ua, 'tmdb_id', base),
        jsonb_build_object('uri', ug, 'tmdb_id', base + 2)),
      jsonb_build_array(
        jsonb_build_object('uri', ua, 'watched_date', '2026-01-01', 'rating', 4, 'rewatch', false),
        jsonb_build_object('uri', ug, 'watched_date', '2026-03-01', 'rating', 5, 'rewatch', false))),
    -- Orphan mapping: mapping uri (uo) is absent from the film snapshot.
    ('orphan',
      jsonb_build_array(
        jsonb_build_object('uri', ua, 'title', 'Alpha Fixture', 'year', 2020),
        jsonb_build_object('uri', ug, 'title', 'Gamma Fixture', 'year', 2022)),
      jsonb_build_array(
        jsonb_build_object('uri', ua, 'tmdb_id', base),
        jsonb_build_object('uri', uo, 'tmdb_id', base)),
      jsonb_build_array(
        jsonb_build_object('uri', ua, 'watched_date', '2026-01-01', 'rating', 4, 'rewatch', false))),
    -- FK failure: delta is a valid snapshot film but maps to a missing TMDB id,
    -- so validation passes and the FK constraint fails during the write phase.
    ('fkbad',
      jsonb_build_array(
        jsonb_build_object('uri', ua, 'title', 'Alpha Fixture', 'year', 2020),
        jsonb_build_object('uri', ug, 'title', 'Gamma Fixture', 'year', 2022),
        jsonb_build_object('uri', ud, 'title', 'Delta Fixture', 'year', 2023)),
      jsonb_build_array(
        jsonb_build_object('uri', ua, 'tmdb_id', base),
        jsonb_build_object('uri', ug, 'tmdb_id', base + 2),
        jsonb_build_object('uri', ud, 'tmdb_id', base + 4)),
      jsonb_build_array(
        jsonb_build_object('uri', ua, 'watched_date', '2026-01-01', 'rating', 4, 'rewatch', false),
        jsonb_build_object('uri', ug, 'watched_date', '2026-03-01', 'rating', 5, 'rewatch', false))),
    -- Orphan diary event: delta appears in the diary payload but NOT in the film
    -- snapshot, so it would dangle once the film row is absent. Films/mappings
    -- are otherwise valid, so this isolates the diary-orphan validation branch
    -- (23503) before any permanent write, exactly like an orphan mapping.
    ('orphan_diary',
      jsonb_build_array(
        jsonb_build_object('uri', ua, 'title', 'Alpha Fixture', 'year', 2020),
        jsonb_build_object('uri', ug, 'title', 'Gamma Fixture', 'year', 2022)),
      jsonb_build_array(
        jsonb_build_object('uri', ua, 'tmdb_id', base),
        jsonb_build_object('uri', ug, 'tmdb_id', base + 2)),
      jsonb_build_array(
        jsonb_build_object('uri', ua, 'watched_date', '2026-01-01', 'rating', 4, 'rewatch', false),
        jsonb_build_object('uri', ud, 'watched_date', '2026-04-01', 'rating', 2, 'rewatch', false))),
    -- Third snapshot: only epsilon, mapped to the already-seeded base+2 metadata,
    -- with an empty diary. Replaces alpha/gamma entirely; because epsilon carries
    -- no diary events its film last_date stays NULL and the diary is fully cleared.
    ('snap3',
      jsonb_build_array(
        jsonb_build_object('uri', ue, 'title', 'Epsilon Fixture', 'year', 2024)),
      jsonb_build_array(
        jsonb_build_object('uri', ue, 'tmdb_id', base + 2)),
      jsonb_build_array());
end;
$setup$;

grant select on import_snapshot_test_ids to anon, authenticated, service_role;
grant select, insert on import_snapshot_test_results to authenticated, service_role;
grant select on import_snapshot_payloads to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Anonymous callers are denied by the effective ACL before any body logic runs.
-- ---------------------------------------------------------------------------

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);

select throws_ok($test$
  select public.reconcile_import_snapshot('[]'::jsonb, '[]'::jsonb, '[]'::jsonb)
$test$, '42501', 'permission denied for function reconcile_import_snapshot',
  'anon cannot execute reconcile_import_snapshot');

-- An authenticated database role with no identity is rejected by the body guard.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok($test$
  select public.reconcile_import_snapshot('[]'::jsonb, '[]'::jsonb, '[]'::jsonb)
$test$, '28000', 'authentication required',
  'authenticated caller with null identity is rejected before any write');

-- ---------------------------------------------------------------------------
-- First snapshot (authenticated user_a): inserts every row.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_a::text from import_snapshot_test_ids), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into import_snapshot_test_results (name, result)
select 'snap1', public.reconcile_import_snapshot(p.films, p.mappings, p.diary)
from import_snapshot_payloads p
where p.name = 'snap1';

select is(
  (select result from import_snapshot_test_results where name = 'snap1'),
  '{"ok":true,"films_upserted":2,"films_deleted":0,"mappings_upserted":2,"mappings_deleted":0,"events_upserted":3,"events_deleted":0}'::jsonb,
  'first snapshot inserts every film, mapping, and diary event'
);

-- Inspect through service_role so RLS cannot make absence/preservation vacuous.
reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  jsonb_build_object(
    'film_events', (select count(*) from public.film_events where user_id = (select user_a from import_snapshot_test_ids)),
    'film_tmdb_map', (select count(*) from public.film_tmdb_map where user_id = (select user_a from import_snapshot_test_ids)),
    'film_diary_events_raw', (select count(*) from public.film_diary_events_raw where user_id = (select user_a from import_snapshot_test_ids))
  ),
  '{"film_events":2,"film_tmdb_map":2,"film_diary_events_raw":3}'::jsonb,
  'first snapshot persists all three tables for the caller'
);
select is(
  jsonb_build_object(
    'film_events', (select count(*) from public.film_events where user_id = (select user_b from import_snapshot_test_ids)),
    'film_tmdb_map', (select count(*) from public.film_tmdb_map where user_id = (select user_b from import_snapshot_test_ids)),
    'film_diary_events_raw', (select count(*) from public.film_diary_events_raw where user_id = (select user_b from import_snapshot_test_ids))
  ),
  '{"film_events":1,"film_tmdb_map":1,"film_diary_events_raw":1}'::jsonb,
  'first snapshot leaves the other user rows untouched'
);

-- ---------------------------------------------------------------------------
-- Second snapshot (authenticated user_a): preserve alpha, remove beta, add gamma.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_a::text from import_snapshot_test_ids), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into import_snapshot_test_results (name, result)
select 'snap2', public.reconcile_import_snapshot(p.films, p.mappings, p.diary)
from import_snapshot_payloads p
where p.name = 'snap2';

select is(
  (select result from import_snapshot_test_results where name = 'snap2'),
  '{"ok":true,"films_upserted":2,"films_deleted":1,"mappings_upserted":2,"mappings_deleted":1,"events_upserted":2,"events_deleted":2}'::jsonb,
  'second snapshot reports preserve-one/remove-absent/add-one through structured counts'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  jsonb_build_object(
    'film_events', (select count(*) from public.film_events where user_id = (select user_a from import_snapshot_test_ids)),
    'film_tmdb_map', (select count(*) from public.film_tmdb_map where user_id = (select user_a from import_snapshot_test_ids)),
    'film_diary_events_raw', (select count(*) from public.film_diary_events_raw where user_id = (select user_a from import_snapshot_test_ids))
  ),
  '{"film_events":2,"film_tmdb_map":2,"film_diary_events_raw":2}'::jsonb,
  'second snapshot keeps exactly two rows per table for the caller'
);
select is(
  (select jsonb_build_object(
     'fe_alpha',  exists(select 1 from public.film_events where user_id = t.user_a and uri = t.uri_alpha),
     'fe_beta',   exists(select 1 from public.film_events where user_id = t.user_a and uri = t.uri_beta),
     'fe_gamma',  exists(select 1 from public.film_events where user_id = t.user_a and uri = t.uri_gamma),
     'map_alpha', exists(select 1 from public.film_tmdb_map where user_id = t.user_a and uri = t.uri_alpha),
     'map_beta',  exists(select 1 from public.film_tmdb_map where user_id = t.user_a and uri = t.uri_beta),
     'map_gamma', exists(select 1 from public.film_tmdb_map where user_id = t.user_a and uri = t.uri_gamma),
     'diary_alpha', exists(select 1 from public.film_diary_events_raw where user_id = t.user_a and uri = t.uri_alpha and watched_date = '2026-01-01'),
     'diary_beta',  exists(select 1 from public.film_diary_events_raw where user_id = t.user_a and uri = t.uri_beta and watched_date = '2026-02-01'),
     'diary_gamma', exists(select 1 from public.film_diary_events_raw where user_id = t.user_a and uri = t.uri_gamma and watched_date = '2026-03-01')
   )
   from import_snapshot_test_ids t),
   '{"fe_alpha":true,"fe_beta":false,"fe_gamma":true,"map_alpha":true,"map_beta":false,"map_gamma":true,"diary_alpha":true,"diary_beta":false,"diary_gamma":true}'::jsonb,
   'second snapshot preserves alpha, removes beta, and adds gamma across all three tables'
);
select is(
  (select jsonb_build_object(
     'alpha_last_date', (
       select fe.last_date from public.film_events fe
        where fe.user_id = t.user_a and fe.uri = t.uri_alpha),
     'late_event_absent', not exists (
       select 1 from public.film_diary_events_raw d
        where d.user_id = t.user_a and d.uri = t.uri_alpha
          and d.watched_date = '2026-09-01')
   )
   from import_snapshot_test_ids t),
  '{"alpha_last_date":"2026-01-01","late_event_absent":true}'::jsonb,
  'second snapshot deletes the late diary event first so the trigger recomputes alpha last_date to the retained early date'
);
select is(
  jsonb_build_object(
    'film_events', (select count(*) from public.film_events where user_id = (select user_b from import_snapshot_test_ids)),
    'film_tmdb_map', (select count(*) from public.film_tmdb_map where user_id = (select user_b from import_snapshot_test_ids)),
    'film_diary_events_raw', (select count(*) from public.film_diary_events_raw where user_id = (select user_b from import_snapshot_test_ids))
  ),
  '{"film_events":1,"film_tmdb_map":1,"film_diary_events_raw":1}'::jsonb,
  'second snapshot leaves the other user rows untouched'
);

-- ---------------------------------------------------------------------------
-- Orphan mapping: rejected during validation, before any permanent write.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_a::text from import_snapshot_test_ids), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  (select format(
     'select public.reconcile_import_snapshot(%L::jsonb, %L::jsonb, %L::jsonb)',
     films, mappings, diary)
   from import_snapshot_payloads where name = 'orphan'),
  '23503',
  'mapping references a film not in the snapshot',
  'orphan mapping is rejected before any write'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  jsonb_build_object(
    'film_events', (select count(*) from public.film_events where user_id = (select user_a from import_snapshot_test_ids)),
    'film_tmdb_map', (select count(*) from public.film_tmdb_map where user_id = (select user_a from import_snapshot_test_ids)),
    'film_diary_events_raw', (select count(*) from public.film_diary_events_raw where user_id = (select user_a from import_snapshot_test_ids))
  ),
  '{"film_events":2,"film_tmdb_map":2,"film_diary_events_raw":2}'::jsonb,
  'rejected orphan mapping leaves prior permanent state unchanged'
);

-- ---------------------------------------------------------------------------
-- Orphan diary event: rejected during validation, before any permanent write.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_a::text from import_snapshot_test_ids), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  (select format(
     'select public.reconcile_import_snapshot(%L::jsonb, %L::jsonb, %L::jsonb)',
     films, mappings, diary)
   from import_snapshot_payloads where name = 'orphan_diary'),
  '23503',
  'diary event references a film not in the snapshot',
  'orphan diary event is rejected before any write'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  jsonb_build_object(
    'film_events', (select count(*) from public.film_events where user_id = (select user_a from import_snapshot_test_ids)),
    'film_tmdb_map', (select count(*) from public.film_tmdb_map where user_id = (select user_a from import_snapshot_test_ids)),
    'film_diary_events_raw', (select count(*) from public.film_diary_events_raw where user_id = (select user_a from import_snapshot_test_ids))
  ),
  '{"film_events":2,"film_tmdb_map":2,"film_diary_events_raw":2}'::jsonb,
  'rejected orphan diary event leaves prior permanent state unchanged'
);

-- ---------------------------------------------------------------------------
-- FK failure mid-write: validation passes, the FK constraint fails during the
-- write phase, and the entire function statement rolls back.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_a::text from import_snapshot_test_ids), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_matching(
  (select format(
     'select public.reconcile_import_snapshot(%L::jsonb, %L::jsonb, %L::jsonb)',
     films, mappings, diary)
   from import_snapshot_payloads where name = 'fkbad'),
  'violates foreign key constraint',
  'mapping to missing TMDB metadata fails the FK constraint mid-write'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  jsonb_build_object(
    'film_events', (select count(*) from public.film_events where user_id = (select user_a from import_snapshot_test_ids)),
    'film_tmdb_map', (select count(*) from public.film_tmdb_map where user_id = (select user_a from import_snapshot_test_ids)),
    'film_diary_events_raw', (select count(*) from public.film_diary_events_raw where user_id = (select user_a from import_snapshot_test_ids))
  ),
  '{"film_events":2,"film_tmdb_map":2,"film_diary_events_raw":2}'::jsonb,
  'FK failure rolls back the whole function statement'
);
select ok(
  not exists(
    select 1 from public.film_events
     where user_id = (select user_a from import_snapshot_test_ids)
       and uri = (select uri_delta from import_snapshot_test_ids)
  ),
  'film row written before the FK failure is rolled back'
);

-- ---------------------------------------------------------------------------
-- Third snapshot (authenticated user_a): replace alpha/gamma with epsilon only.
-- Epsilon maps to the already-seeded base+2 metadata and carries no diary
-- events, so its film last_date stays NULL and the diary is fully cleared.
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_a::text from import_snapshot_test_ids), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into import_snapshot_test_results (name, result)
select 'snap3', public.reconcile_import_snapshot(p.films, p.mappings, p.diary)
from import_snapshot_payloads p
where p.name = 'snap3';

select is(
  (select result from import_snapshot_test_results where name = 'snap3'),
  '{"ok":true,"films_upserted":1,"films_deleted":2,"mappings_upserted":1,"mappings_deleted":2,"events_upserted":0,"events_deleted":2}'::jsonb,
  'third snapshot replaces alpha/gamma with epsilon through structured counts'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);

select is(
  (select jsonb_build_object(
     'epsilon_last_date', (
       select fe.last_date from public.film_events fe
        where fe.user_id = t.user_a and fe.uri = t.uri_epsilon),
     'alpha_absent', not exists (
       select 1 from public.film_events
        where user_id = t.user_a and uri = t.uri_alpha),
     'gamma_absent', not exists (
       select 1 from public.film_events
        where user_id = t.user_a and uri = t.uri_gamma),
     'diary_count', (
       select count(*) from public.film_diary_events_raw
        where user_id = t.user_a)
   )
   from import_snapshot_test_ids t),
  '{"epsilon_last_date":null,"alpha_absent":true,"gamma_absent":true,"diary_count":0}'::jsonb,
  'third snapshot leaves epsilon last_date NULL, removes alpha/gamma, and clears the diary'
);

select is(
  jsonb_build_object(
    'film_events', (select count(*) from public.film_events where user_id = (select user_b from import_snapshot_test_ids)),
    'film_tmdb_map', (select count(*) from public.film_tmdb_map where user_id = (select user_b from import_snapshot_test_ids)),
    'film_diary_events_raw', (select count(*) from public.film_diary_events_raw where user_id = (select user_b from import_snapshot_test_ids))
  ),
  '{"film_events":1,"film_tmdb_map":1,"film_diary_events_raw":1}'::jsonb,
  'other user rows remain untouched after every reconciliation and failure'
);

-- ---------------------------------------------------------------------------
-- Effective DELETE policy: the authenticated owner can directly remove its own
-- mapping rows (zero rows before the owner DELETE policy existed), while a
-- cross-user delete still removes nothing because the owner qual hides other
-- users' rows. After snap3 user_a holds exactly one mapping (epsilon).
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_a::text from import_snapshot_test_ids), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (with d as (
     delete from public.film_tmdb_map
      where user_id = (select user_a from import_snapshot_test_ids)
      returning 1
   )
   select count(*) from d),
  1::bigint,
  'authenticated owner can directly delete its own film_tmdb_map rows (effective DELETE policy)'
);

select is(
  (with d as (
     delete from public.film_tmdb_map
      where user_id = (select user_b from import_snapshot_test_ids)
      returning 1
   )
   select count(*) from d),
  0::bigint,
  'authenticated caller cannot delete another user film_tmdb_map rows (cross-user blocked)'
);

reset role;
select * from finish();
rollback;
