begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

-- This contract is intentionally written before the containment migration.  It
-- describes the post-migration boundary for the five helper functions that
-- remained publicly executable after checkpoint 0A.2.
select plan(67);

-- Exact helper signatures.
select has_function('public', 'handle_new_user', array[]::text[]);
select has_function('public', 'handle_new_user_role', array[]::text[]);
select has_function('public', 'is_admin', array['uuid']);
select has_function('public', 'prune_api_caches', array['integer']);
select has_function('public', 'sync_film_events_last_date', array[]::text[]);

-- Every helper remains SECURITY DEFINER, but its body must not inherit a
-- caller-controlled search path.
select ok(
  (select prosecdef from pg_proc where oid = 'public.handle_new_user()'::regprocedure),
  'handle_new_user is SECURITY DEFINER'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.handle_new_user_role()'::regprocedure),
  'handle_new_user_role is SECURITY DEFINER'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.is_admin(uuid)'::regprocedure),
  'is_admin(uuid) is SECURITY DEFINER'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.prune_api_caches(integer)'::regprocedure),
  'prune_api_caches(integer) is SECURITY DEFINER'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.sync_film_events_last_date()'::regprocedure),
  'sync_film_events_last_date is SECURITY DEFINER'
);

select ok(
  exists (
    select 1
    from pg_proc p
    where p.oid = 'public.handle_new_user()'::regprocedure
      and (
        select count(*) = 1
        from unnest(coalesce(p.proconfig, array[]::text[])) as config(setting)
        where split_part(config.setting, '=', 1) = 'search_path'
      )
      and exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) as config(setting)
        where split_part(config.setting, '=', 1) = 'search_path'
          and replace(split_part(config.setting, '=', 2), '"', '') = ''
      )
  ),
  'handle_new_user has exactly an empty search_path'
);
select ok(
  exists (
    select 1
    from pg_proc p
    where p.oid = 'public.handle_new_user_role()'::regprocedure
      and (
        select count(*) = 1
        from unnest(coalesce(p.proconfig, array[]::text[])) as config(setting)
        where split_part(config.setting, '=', 1) = 'search_path'
      )
      and exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) as config(setting)
        where split_part(config.setting, '=', 1) = 'search_path'
          and replace(split_part(config.setting, '=', 2), '"', '') = ''
      )
  ),
  'handle_new_user_role has exactly an empty search_path'
);
select ok(
  exists (
    select 1
    from pg_proc p
    where p.oid = 'public.is_admin(uuid)'::regprocedure
      and (
        select count(*) = 1
        from unnest(coalesce(p.proconfig, array[]::text[])) as config(setting)
        where split_part(config.setting, '=', 1) = 'search_path'
      )
      and exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) as config(setting)
        where split_part(config.setting, '=', 1) = 'search_path'
          and replace(split_part(config.setting, '=', 2), '"', '') = ''
      )
  ),
  'is_admin(uuid) has exactly an empty search_path'
);
select ok(
  exists (
    select 1
    from pg_proc p
    where p.oid = 'public.prune_api_caches(integer)'::regprocedure
      and (
        select count(*) = 1
        from unnest(coalesce(p.proconfig, array[]::text[])) as config(setting)
        where split_part(config.setting, '=', 1) = 'search_path'
      )
      and exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) as config(setting)
        where split_part(config.setting, '=', 1) = 'search_path'
          and replace(split_part(config.setting, '=', 2), '"', '') = ''
      )
  ),
  'prune_api_caches(integer) has exactly an empty search_path'
);
select ok(
  exists (
    select 1
    from pg_proc p
    where p.oid = 'public.sync_film_events_last_date()'::regprocedure
      and (
        select count(*) = 1
        from unnest(coalesce(p.proconfig, array[]::text[])) as config(setting)
        where split_part(config.setting, '=', 1) = 'search_path'
      )
      and exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) as config(setting)
        where split_part(config.setting, '=', 1) = 'search_path'
          and replace(split_part(config.setting, '=', 2), '"', '') = ''
      )
  ),
  'sync_film_events_last_date has exactly an empty search_path'
);

-- All objects referenced by the definer bodies are schema-qualified.
select ok(
  position('public.profiles' in lower(pg_get_functiondef('public.handle_new_user()'::regprocedure))) > 0,
  'handle_new_user schema-qualifies profiles'
);
select ok(
  position('public.user_roles' in lower(pg_get_functiondef('public.handle_new_user_role()'::regprocedure))) > 0,
  'handle_new_user_role schema-qualifies user_roles'
);
select ok(
  position('public.user_roles' in lower(pg_get_functiondef('public.is_admin(uuid)'::regprocedure))) > 0,
  'is_admin schema-qualifies user_roles'
);
select ok(
  position('public.trakt_related_cache' in lower(pg_get_functiondef('public.prune_api_caches(integer)'::regprocedure))) > 0
    and position('public.tmdb_similar_cache' in lower(pg_get_functiondef('public.prune_api_caches(integer)'::regprocedure))) > 0
    and position('public.tuimdb_uid_cache' in lower(pg_get_functiondef('public.prune_api_caches(integer)'::regprocedure))) > 0
    and position('public.tastedive_cache' in lower(pg_get_functiondef('public.prune_api_caches(integer)'::regprocedure))) > 0
    and position('public.watchmode_cache' in lower(pg_get_functiondef('public.prune_api_caches(integer)'::regprocedure))) > 0
    and position('public.vector_similarity_cache' in lower(pg_get_functiondef('public.prune_api_caches(integer)'::regprocedure))) > 0
    and position('public.tmdb_trending' in lower(pg_get_functiondef('public.prune_api_caches(integer)'::regprocedure))) > 0
    and position('public.user_taste_profile_cache' in lower(pg_get_functiondef('public.prune_api_caches(integer)'::regprocedure))) > 0,
  'prune_api_caches schema-qualifies all eight cache tables'
);
select ok(
  position('public.film_diary_events_raw' in lower(pg_get_functiondef('public.sync_film_events_last_date()'::regprocedure))) > 0
    and position('public.film_events' in lower(pg_get_functiondef('public.sync_film_events_last_date()'::regprocedure))) > 0,
  'sync_film_events_last_date schema-qualifies both event tables'
);

-- The effective ACL must remove inherited PUBLIC execution as well as the
-- explicit PostgREST roles.
select ok(
  not exists (
    select 1
    from aclexplode(
      coalesce(
        (select proacl from pg_proc where oid = 'public.handle_new_user()'::regprocedure),
        acldefault('f', (select proowner from pg_proc where oid = 'public.handle_new_user()'::regprocedure))
      )
    )
    where grantee = 0 and privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute handle_new_user()'
);
select ok(
  not exists (
    select 1
    from aclexplode(
      coalesce(
        (select proacl from pg_proc where oid = 'public.handle_new_user_role()'::regprocedure),
        acldefault('f', (select proowner from pg_proc where oid = 'public.handle_new_user_role()'::regprocedure))
      )
    )
    where grantee = 0 and privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute handle_new_user_role()'
);
select ok(
  not exists (
    select 1
    from aclexplode(
      coalesce(
        (select proacl from pg_proc where oid = 'public.is_admin(uuid)'::regprocedure),
        acldefault('f', (select proowner from pg_proc where oid = 'public.is_admin(uuid)'::regprocedure))
      )
    )
    where grantee = 0 and privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute is_admin(uuid)'
);
select ok(
  not exists (
    select 1
    from aclexplode(
      coalesce(
        (select proacl from pg_proc where oid = 'public.prune_api_caches(integer)'::regprocedure),
        acldefault('f', (select proowner from pg_proc where oid = 'public.prune_api_caches(integer)'::regprocedure))
      )
    )
    where grantee = 0 and privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute prune_api_caches(integer)'
);
select ok(
  not exists (
    select 1
    from aclexplode(
      coalesce(
        (select proacl from pg_proc where oid = 'public.sync_film_events_last_date()'::regprocedure),
        acldefault('f', (select proowner from pg_proc where oid = 'public.sync_film_events_last_date()'::regprocedure))
      )
    )
    where grantee = 0 and privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute sync_film_events_last_date()'
);

select function_privs_are('public', 'handle_new_user', array[]::text[], 'anon', array[]::text[]);
select function_privs_are('public', 'handle_new_user_role', array[]::text[], 'anon', array[]::text[]);
select function_privs_are('public', 'is_admin', array['uuid'], 'anon', array[]::text[]);
select function_privs_are('public', 'prune_api_caches', array['integer'], 'anon', array[]::text[]);
select function_privs_are('public', 'sync_film_events_last_date', array[]::text[], 'anon', array[]::text[]);

select function_privs_are('public', 'handle_new_user', array[]::text[], 'authenticated', array[]::text[]);
select function_privs_are('public', 'handle_new_user_role', array[]::text[], 'authenticated', array[]::text[]);
select function_privs_are('public', 'is_admin', array['uuid'], 'authenticated', array['EXECUTE']::text[]);
select function_privs_are('public', 'prune_api_caches', array['integer'], 'authenticated', array[]::text[]);
select function_privs_are('public', 'sync_film_events_last_date', array[]::text[], 'authenticated', array[]::text[]);

select function_privs_are('public', 'handle_new_user', array[]::text[], 'service_role', array[]::text[]);
select function_privs_are('public', 'handle_new_user_role', array[]::text[], 'service_role', array[]::text[]);
select function_privs_are('public', 'is_admin', array['uuid'], 'service_role', array[]::text[]);
select function_privs_are('public', 'prune_api_caches', array['integer'], 'service_role', array[]::text[]);
select function_privs_are('public', 'sync_film_events_last_date', array[]::text[], 'service_role', array[]::text[]);

select is(
  (
    select pg_get_userbyid(proowner)
    from pg_proc
    where oid = 'public.handle_new_user()'::regprocedure
  ),
  'postgres',
  'handle_new_user is owned by postgres'
);
select is(
  (
    select pg_get_userbyid(proowner)
    from pg_proc
    where oid = 'public.handle_new_user_role()'::regprocedure
  ),
  'postgres',
  'handle_new_user_role is owned by postgres'
);
select is(
  (
    select pg_get_userbyid(proowner)
    from pg_proc
    where oid = 'public.is_admin(uuid)'::regprocedure
  ),
  'postgres',
  'is_admin(uuid) is owned by postgres'
);
select is(
  (
    select pg_get_userbyid(proowner)
    from pg_proc
    where oid = 'public.prune_api_caches(integer)'::regprocedure
  ),
  'postgres',
  'prune_api_caches(integer) is owned by postgres'
);
select is(
  (
    select pg_get_userbyid(proowner)
    from pg_proc
    where oid = 'public.sync_film_events_last_date()'::regprocedure
  ),
  'postgres',
  'sync_film_events_last_date is owned by postgres'
);

select ok(
  not exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) as privilege
    where p.oid = 'public.handle_new_user()'::regprocedure
      and privilege.privilege_type = 'EXECUTE'
      and privilege.grantee <> p.proowner
  ),
  'handle_new_user has no EXECUTE grantee beyond postgres'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) as privilege
    where p.oid = 'public.handle_new_user_role()'::regprocedure
      and privilege.privilege_type = 'EXECUTE'
      and privilege.grantee <> p.proowner
  ),
  'handle_new_user_role has no EXECUTE grantee beyond postgres'
);
select ok(
  exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) as privilege
    where p.oid = 'public.is_admin(uuid)'::regprocedure
      and privilege.grantee = 'authenticated'::regrole
      and privilege.privilege_type = 'EXECUTE'
  )
  and not exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) as privilege
    where p.oid = 'public.is_admin(uuid)'::regprocedure
      and privilege.privilege_type = 'EXECUTE'
      and privilege.grantee not in (p.proowner, 'authenticated'::regrole)
  ),
  'is_admin has EXECUTE only for postgres and authenticated'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) as privilege
    where p.oid = 'public.prune_api_caches(integer)'::regprocedure
      and privilege.privilege_type = 'EXECUTE'
      and privilege.grantee <> p.proowner
  ),
  'prune_api_caches has no EXECUTE grantee beyond postgres'
);
select ok(
  not exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) as privilege
    where p.oid = 'public.sync_film_events_last_date()'::regprocedure
      and privilege.privilege_type = 'EXECUTE'
      and privilege.grantee <> p.proowner
  ),
  'sync_film_events_last_date has no EXECUTE grantee beyond postgres'
);

-- Trigger-only helpers remain callable by their triggers even though no client
-- role has EXECUTE.  The role trigger is reconciled by the new migration.
select ok(
  exists (
    select 1
    from pg_trigger
    where tgname = 'on_auth_user_created'
      and tgrelid = 'auth.users'::regclass
      and not tgisinternal
      and tgenabled = 'O'
      and tgtype = 5
      and tgfoid = 'public.handle_new_user()'::regprocedure
  ),
  'on_auth_user_created exists on auth.users and calls handle_new_user()'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgname = 'on_auth_user_created_role'
      and tgrelid = 'auth.users'::regclass
      and not tgisinternal
      and tgenabled = 'O'
      and tgtype = 5
      and tgfoid = 'public.handle_new_user_role()'::regprocedure
  ),
  'on_auth_user_created_role exists on auth.users and calls handle_new_user_role()'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgname = 'trg_sync_film_events_last_date'
      and tgrelid = 'public.film_diary_events_raw'::regclass
      and not tgisinternal
      and tgenabled = 'O'
      and tgtype = 21
      and tgfoid = 'public.sync_film_events_last_date()'::regprocedure
  ),
  'trg_sync_film_events_last_date exists on film_diary_events_raw'
);

create temporary table privileged_helper_test_ids (
  admin_user_id uuid not null,
  other_user_id uuid not null,
  target_uri text not null,
  non_target_uri text not null
);

do $setup$
declare
  admin_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  target_film_uri text := 'letterboxd://privileged-helper-target/' || admin_id::text;
  non_target_film_uri text := 'letterboxd://privileged-helper-other/' || other_id::text;
begin
  insert into auth.users (
    id,
    aud,
    role,
    email,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values
    (
      admin_id,
      'authenticated',
      'authenticated',
      admin_id::text || '@privileged-helpers.test',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    ),
    (
      other_id,
      'authenticated',
      'authenticated',
      other_id::text || '@privileged-helpers.test',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    );

  insert into privileged_helper_test_ids (
    admin_user_id,
    other_user_id,
    target_uri,
    non_target_uri
  )
  values (
    admin_id,
    other_id,
    target_film_uri,
    non_target_film_uri
  );
end;
$setup$;

select is(
  (
    select count(*)::integer
    from public.profiles
    where id in (
      select admin_user_id from privileged_helper_test_ids
      union all
      select other_user_id from privileged_helper_test_ids
    )
  ),
  2,
  'auth insert created profiles for both generated users'
);
select is(
  (
    select count(*)::integer
    from public.user_roles
    where user_id in (
      select admin_user_id from privileged_helper_test_ids
      union all
      select other_user_id from privileged_helper_test_ids
    )
      and role = 'user'
  ),
  2,
  'auth insert created default user roles for both generated users'
);

update public.user_roles
   set role = 'admin'
 where user_id = (select admin_user_id from privileged_helper_test_ids);

-- Exercise the existing trigger body before and after helper containment.  The
-- fixture uses only generated users and URIs and is rolled back with the test.
insert into public.film_events (
  user_id,
  uri,
  title,
  year,
  rating,
  rewatch,
  last_date,
  watch_count,
  liked,
  on_watchlist
)
select
  admin_user_id,
  target_uri,
  'pgTAP trigger target film',
  2026,
  4,
  false,
  null,
  0,
  false,
  false
from privileged_helper_test_ids;

insert into public.film_events (
  user_id,
  uri,
  title,
  year,
  rating,
  rewatch,
  last_date,
  watch_count,
  liked,
  on_watchlist
)
select
  other_user_id,
  non_target_uri,
  'pgTAP trigger non-target film',
  2026,
  3,
  false,
  '2026-06-01',
  1,
  false,
  false
from privileged_helper_test_ids;

insert into public.film_diary_events_raw (
  user_id,
  uri,
  watched_date,
  rating,
  rewatch
)
select
  admin_user_id,
  target_uri,
  '2026-07-01',
  4,
  false
from privileged_helper_test_ids;

select is(
  (
    select last_date
    from public.film_events
    where user_id = (select admin_user_id from privileged_helper_test_ids)
      and uri = (select target_uri from privileged_helper_test_ids)
  ),
  '2026-07-01',
  'raw diary INSERT updates the matching film_events last_date'
);

update public.film_diary_events_raw
   set watched_date = '2026-07-03'
 where user_id = (select admin_user_id from privileged_helper_test_ids)
   and uri = (select target_uri from privileged_helper_test_ids)
   and rewatch = false;

select is(
  (
    select last_date
    from public.film_events
    where user_id = (select admin_user_id from privileged_helper_test_ids)
      and uri = (select target_uri from privileged_helper_test_ids)
  ),
  '2026-07-03',
  'raw diary UPDATE advances the matching film_events last_date'
);
select is(
  (
    select last_date
    from public.film_events
    where user_id = (select other_user_id from privileged_helper_test_ids)
      and uri = (select non_target_uri from privileged_helper_test_ids)
  ),
  '2026-06-01',
  'raw diary trigger leaves the generated non-target film unchanged'
);

grant select on privileged_helper_test_ids to anon, authenticated, service_role;

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  (select admin_user_id::text from privileged_helper_test_ids),
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  public.is_admin((select admin_user_id from privileged_helper_test_ids)),
  true,
  'authenticated admin can check own admin status'
);
select throws_ok($test$
  select public.is_admin((select other_user_id from privileged_helper_test_ids));
$test$, '42501', 'Unauthorized: can only check your own admin status',
  'authenticated user cannot check another user admin status'
);

select set_config(
  'request.jwt.claim.sub',
  (select other_user_id::text from privileged_helper_test_ids),
  true
);
select is(
  public.is_admin((select other_user_id from privileged_helper_test_ids)),
  false,
  'authenticated non-admin can check own admin status'
);

reset role;
select throws_ok($test$
  select public.prune_api_caches(null::integer);
$test$, '22023', 'retention_days must be between 1 and 3650',
  'owner rejects null retention_days before pruning'
);
select throws_ok($test$
  select public.prune_api_caches(0);
$test$, '22023', 'retention_days must be between 1 and 3650',
  'owner rejects zero retention_days before pruning'
);
select throws_ok($test$
  select public.prune_api_caches(3651);
$test$, '22023', 'retention_days must be between 1 and 3650',
  'owner rejects excessive retention_days before pruning'
);

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
select throws_ok($test$
  select public.prune_api_caches(null::integer);
$test$, '42501', 'permission denied for function prune_api_caches',
  'anon cannot execute prune_api_caches'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok($test$
  select public.prune_api_caches(null::integer);
$test$, '42501', 'permission denied for function prune_api_caches',
  'authenticated cannot execute prune_api_caches'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok($test$
  select public.prune_api_caches(null::integer);
$test$, '42501', 'permission denied for function prune_api_caches',
  'service_role cannot execute prune_api_caches directly'
);

select * from finish();
rollback;
