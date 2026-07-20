begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

select has_function(
  'public',
  'add_liked_suggestion',
  array['uuid', 'integer', 'text', 'integer', 'text']
);
select has_function('public', 'get_film_stats', array['uuid']);
select has_function(
  'public',
  'increment_rate_limit',
  array['uuid', 'timestamp with time zone']
);
select has_function('public', 'delete_user_data', array['uuid']);
select has_function('public', 'admin_delete_user_data', array['uuid', 'text']);

select function_privs_are(
  'public',
  'add_liked_suggestion',
  array['uuid', 'integer', 'text', 'integer', 'text'],
  'anon',
  array[]::text[]
);
select function_privs_are(
  'public',
  'get_film_stats',
  array['uuid'],
  'anon',
  array[]::text[]
);
select function_privs_are(
  'public',
  'increment_rate_limit',
  array['uuid', 'timestamp with time zone'],
  'anon',
  array[]::text[]
);
select function_privs_are(
  'public',
  'delete_user_data',
  array['uuid'],
  'anon',
  array[]::text[]
);
select function_privs_are(
  'public',
  'admin_delete_user_data',
  array['uuid', 'text'],
  'anon',
  array[]::text[]
);

select ok(
  not exists (
    select 1
    from aclexplode(
      coalesce(
        (select proacl from pg_proc where oid = 'public.add_liked_suggestion(uuid,integer,text,integer,text)'::regprocedure),
        acldefault('f', (select proowner from pg_proc where oid = 'public.add_liked_suggestion(uuid,integer,text,integer,text)'::regprocedure))
      )
    )
    where grantee = 0 and privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute add_liked_suggestion(uuid, integer, text, integer, text)'
);
select ok(
  not exists (
    select 1
    from aclexplode(
      coalesce(
        (select proacl from pg_proc where oid = 'public.get_film_stats(uuid)'::regprocedure),
        acldefault('f', (select proowner from pg_proc where oid = 'public.get_film_stats(uuid)'::regprocedure))
      )
    )
    where grantee = 0 and privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute get_film_stats(uuid)'
);
select ok(
  not exists (
    select 1
    from aclexplode(
      coalesce(
        (select proacl from pg_proc where oid = 'public.increment_rate_limit(uuid,timestamp with time zone)'::regprocedure),
        acldefault('f', (select proowner from pg_proc where oid = 'public.increment_rate_limit(uuid,timestamp with time zone)'::regprocedure))
      )
    )
    where grantee = 0 and privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute increment_rate_limit(uuid, timestamptz)'
);
select ok(
  not exists (
    select 1
    from aclexplode(
      coalesce(
        (select proacl from pg_proc where oid = 'public.delete_user_data(uuid)'::regprocedure),
        acldefault('f', (select proowner from pg_proc where oid = 'public.delete_user_data(uuid)'::regprocedure))
      )
    )
    where grantee = 0 and privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute delete_user_data(uuid)'
);
select ok(
  not exists (
    select 1
    from aclexplode(
      coalesce(
        (select proacl from pg_proc where oid = 'public.admin_delete_user_data(uuid,text)'::regprocedure),
        acldefault('f', (select proowner from pg_proc where oid = 'public.admin_delete_user_data(uuid,text)'::regprocedure))
      )
    )
    where grantee = 0 and privilege_type = 'EXECUTE'
  ),
  'PUBLIC cannot execute admin_delete_user_data(uuid, text)'
);

create temporary table privileged_function_test_ids (
  user_id uuid not null,
  other_user_id uuid not null,
  other_key_id uuid not null
);

do $setup$
declare
  test_user_id uuid := gen_random_uuid();
  other_test_user_id uuid := gen_random_uuid();
  test_key_id uuid;
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
      test_user_id,
      'authenticated',
      'authenticated',
      test_user_id::text || '@privileged-functions.test',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    ),
    (
      other_test_user_id,
      'authenticated',
      'authenticated',
      other_test_user_id::text || '@privileged-functions.test',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    );

  insert into public.api_keys (user_id, key_hash, key_prefix)
  values (
    other_test_user_id,
    'privileged-function-test-' || other_test_user_id::text,
    'pgtap-' || left(other_test_user_id::text, 8)
  )
  returning id into test_key_id;

  insert into privileged_function_test_ids (user_id, other_user_id, other_key_id)
  values (test_user_id, other_test_user_id, test_key_id);
end;
$setup$;

grant select on privileged_function_test_ids to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  (select user_id::text from privileged_function_test_ids),
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- Each statement must reject an authenticated caller targeting another user.
select throws_ok($test$
  select public.add_liked_suggestion(
    (select other_user_id from privileged_function_test_ids),
    2147483001,
    'pgTAP cross-user probe',
    2026,
    null
  )
$test$, '42501');
select throws_ok($test$
  select public.get_film_stats(
    (select other_user_id from privileged_function_test_ids)
  )
$test$, '42501');
select throws_ok($test$
  select public.increment_rate_limit(
    (select other_key_id from privileged_function_test_ids),
    date_trunc('minute', now())
  )
$test$, '42501');
select throws_ok($test$
  select public.delete_user_data(
    (select other_user_id from privileged_function_test_ids)
  )
$test$, 'P0001', 'Unauthorized: can only delete your own data');
select throws_ok($test$
  select public.admin_delete_user_data(
    (select other_user_id from privileged_function_test_ids),
    'blocked'
  )
$test$, '42501');

reset role;
select * from finish();
rollback;
