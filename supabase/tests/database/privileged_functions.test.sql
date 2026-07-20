begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(55);

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

-- PUBLIC must not retain inherited EXECUTE through a missing explicit ACL.
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

select function_privs_are(
  'public',
  'add_liked_suggestion',
  array['uuid', 'integer', 'text', 'integer', 'text'],
  'authenticated',
  array['EXECUTE']::text[]
);
select function_privs_are(
  'public',
  'get_film_stats',
  array['uuid'],
  'authenticated',
  array['EXECUTE']::text[]
);
select function_privs_are(
  'public',
  'increment_rate_limit',
  array['uuid', 'timestamp with time zone'],
  'authenticated',
  array[]::text[]
);
select function_privs_are(
  'public',
  'delete_user_data',
  array['uuid'],
  'authenticated',
  array['EXECUTE']::text[]
);
select function_privs_are(
  'public',
  'admin_delete_user_data',
  array['uuid', 'text'],
  'authenticated',
  array['EXECUTE']::text[]
);

select function_privs_are(
  'public',
  'add_liked_suggestion',
  array['uuid', 'integer', 'text', 'integer', 'text'],
  'service_role',
  array['EXECUTE']::text[]
);
select function_privs_are(
  'public',
  'get_film_stats',
  array['uuid'],
  'service_role',
  array['EXECUTE']::text[]
);
select function_privs_are(
  'public',
  'increment_rate_limit',
  array['uuid', 'timestamp with time zone'],
  'service_role',
  array['EXECUTE']::text[]
);
select function_privs_are(
  'public',
  'delete_user_data',
  array['uuid'],
  'service_role',
  array[]::text[]
);
select function_privs_are(
  'public',
  'admin_delete_user_data',
  array['uuid', 'text'],
  'service_role',
  array[]::text[]
);

create temporary table privileged_function_test_ids (
  user_id uuid not null,
  other_user_id uuid not null,
  admin_user_id uuid not null,
  all_user_id uuid not null,
  other_key_id uuid not null,
  rate_window_start timestamptz not null,
  self_tmdb_id integer not null,
  other_tmdb_id integer not null,
  all_tmdb_id integer not null,
  admin_tmdb_id integer not null
);

create temporary table privileged_function_test_results (
  name text primary key,
  result jsonb not null
);

do $setup$
declare
  test_user_id uuid := gen_random_uuid();
  other_test_user_id uuid := gen_random_uuid();
  admin_test_user_id uuid := gen_random_uuid();
  all_test_user_id uuid := gen_random_uuid();
  test_key_id uuid;
  test_window_start timestamptz := date_trunc('minute', now());
  self_tmdb_id integer := 2147483004;
  other_tmdb_id integer := 2147483005;
  all_tmdb_id integer := 2147483006;
  admin_tmdb_id integer := 2147483007;
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
    ),
    (
      admin_test_user_id,
      'authenticated',
      'authenticated',
      admin_test_user_id::text || '@privileged-functions.test',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    ),
    (
      all_test_user_id,
      'authenticated',
      'authenticated',
      all_test_user_id::text || '@privileged-functions.test',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    );

  -- Keep the profile FKs valid even when the auth trigger is absent on reset.
  insert into public.profiles (id, email)
  values
    (test_user_id, test_user_id::text || '@privileged-functions.test'),
    (other_test_user_id, other_test_user_id::text || '@privileged-functions.test'),
    (admin_test_user_id, admin_test_user_id::text || '@privileged-functions.test'),
    (all_test_user_id, all_test_user_id::text || '@privileged-functions.test')
  on conflict (id) do update
    set email = excluded.email;

  insert into public.user_roles (user_id, role)
  values
    (test_user_id, 'user'),
    (other_test_user_id, 'user'),
    (admin_test_user_id, 'admin'),
    (all_test_user_id, 'user')
  on conflict (user_id) do update
    set role = excluded.role;

  insert into public.api_keys (user_id, key_hash, key_prefix)
  values (
    other_test_user_id,
    'privileged-function-test-' || other_test_user_id::text,
    'pgtap-' || left(other_test_user_id::text, 8)
  )
  returning id into test_key_id;

  insert into public.tmdb_movies (tmdb_id, data)
  values
    (self_tmdb_id, jsonb_build_object('title', 'pgTAP self fixture')),
    (other_tmdb_id, jsonb_build_object('title', 'pgTAP import fixture')),
    (all_tmdb_id, jsonb_build_object('title', 'pgTAP all fixture')),
    (admin_tmdb_id, jsonb_build_object('title', 'pgTAP non-target fixture'))
  on conflict (tmdb_id) do nothing;

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
  values
    (
      test_user_id,
      'letterboxd://privileged/self',
      'pgTAP self film',
      2026,
      4.5,
      false,
      '2026-07-01',
      1,
      true,
      false
    ),
    (
      other_test_user_id,
      'letterboxd://privileged/import',
      'pgTAP import film',
      2026,
      3.5,
      false,
      '2026-07-02',
      1,
      false,
      false
    ),
    (
      all_test_user_id,
      'letterboxd://privileged/all',
      'pgTAP all film',
      2026,
      5,
      true,
      '2026-07-03',
      2,
      true,
      true
    ),
    (
      admin_test_user_id,
      'letterboxd://privileged/non-target',
      'pgTAP non-target film',
      2026,
      2.5,
      false,
      '2026-07-04',
      1,
      false,
      false
    );

  insert into public.film_diary_events_raw (
    user_id,
    uri,
    watched_date,
    rating,
    rewatch
  )
  values
    (test_user_id, 'letterboxd://privileged/self', '2026-07-01', 4.5, false),
    (other_test_user_id, 'letterboxd://privileged/import', '2026-07-02', 3.5, false),
    (other_test_user_id, 'letterboxd://privileged/import', '2026-07-05', 4, true),
    (all_test_user_id, 'letterboxd://privileged/all', '2026-07-03', 5, false),
    (all_test_user_id, 'letterboxd://privileged/all', '2026-07-06', 4.5, true),
    (admin_test_user_id, 'letterboxd://privileged/non-target', '2026-07-04', 2.5, false);

  insert into public.film_tmdb_map (user_id, uri, tmdb_id)
  values
    (test_user_id, 'letterboxd://privileged/self', self_tmdb_id),
    (other_test_user_id, 'letterboxd://privileged/import', other_tmdb_id),
    (all_test_user_id, 'letterboxd://privileged/all', all_tmdb_id),
    (admin_test_user_id, 'letterboxd://privileged/non-target', admin_tmdb_id);

  insert into public.blocked_suggestions (user_id, tmdb_id)
  values
    (test_user_id, self_tmdb_id + 10),
    (other_test_user_id, other_tmdb_id + 10),
    (all_test_user_id, all_tmdb_id + 10),
    (admin_test_user_id, admin_tmdb_id + 10);

  insert into public.suggestion_feedback (user_id, tmdb_id, feedback_type)
  values
    (test_user_id, self_tmdb_id, 'negative'),
    (other_test_user_id, other_tmdb_id, 'positive'),
    (other_test_user_id, other_tmdb_id + 1, 'negative'),
    (all_test_user_id, all_tmdb_id, 'positive'),
    (admin_test_user_id, admin_tmdb_id, 'positive');

  insert into public.user_exploration_stats (user_id)
  values
    (test_user_id),
    (other_test_user_id),
    (all_test_user_id),
    (admin_test_user_id);

  insert into public.user_adjacent_preferences (
    user_id,
    from_genre_id,
    from_genre_name,
    to_genre_id,
    to_genre_name
  )
  values
    (test_user_id, 18, 'Drama', 878, 'Science Fiction'),
    (other_test_user_id, 18, 'Drama', 878, 'Science Fiction'),
    (all_test_user_id, 18, 'Drama', 878, 'Science Fiction'),
    (admin_test_user_id, 18, 'Drama', 878, 'Science Fiction');

  insert into public.user_reason_preferences (user_id, reason_type)
  values
    (test_user_id, 'genre'),
    (other_test_user_id, 'genre'),
    (all_test_user_id, 'genre'),
    (admin_test_user_id, 'genre');

  insert into privileged_function_test_ids (
    user_id,
    other_user_id,
    admin_user_id,
    all_user_id,
    other_key_id,
    rate_window_start,
    self_tmdb_id,
    other_tmdb_id,
    all_tmdb_id,
    admin_tmdb_id
  )
  values (
    test_user_id,
    other_test_user_id,
    admin_test_user_id,
    all_test_user_id,
    test_key_id,
    test_window_start,
    self_tmdb_id,
    other_tmdb_id,
    all_tmdb_id,
    admin_tmdb_id
  );
end;
$setup$;

grant select on privileged_function_test_ids to anon, authenticated, service_role;
grant select, insert on privileged_function_test_results to authenticated, service_role;

-- Seed saved_suggestions through its actual privileged function schema.
reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
do $saved_setup$
declare
  fixture record;
begin
  select * into fixture from privileged_function_test_ids;
  perform public.add_liked_suggestion(
    fixture.other_user_id,
    fixture.other_tmdb_id,
    'pgTAP import saved fixture',
    2026,
    null
  );
  perform public.add_liked_suggestion(
    fixture.all_user_id,
    fixture.all_tmdb_id,
    'pgTAP all saved fixture',
    2026,
    null
  );
  perform public.add_liked_suggestion(
    fixture.admin_user_id,
    fixture.admin_tmdb_id,
    'pgTAP non-target saved fixture',
    2026,
    null
  );
end;
$saved_setup$;

-- Anonymous callers are denied by the effective ACL before any body logic runs.
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);

select throws_ok($test$
  select public.add_liked_suggestion(
    (select other_user_id from privileged_function_test_ids),
    2147483001,
    'pgTAP anonymous probe',
    2026,
    null
  )
$test$, '42501', 'permission denied for function add_liked_suggestion',
  'anon cannot execute add_liked_suggestion');
select throws_ok($test$
  select public.get_film_stats(
    (select other_user_id from privileged_function_test_ids)
  )
$test$, '42501', 'permission denied for function get_film_stats',
  'anon cannot execute get_film_stats');
select throws_ok($test$
  select public.increment_rate_limit(
    (select other_key_id from privileged_function_test_ids),
    (select rate_window_start from privileged_function_test_ids)
  )
$test$, '42501', 'permission denied for function increment_rate_limit',
  'anon cannot execute increment_rate_limit');
select throws_ok($test$
  select public.delete_user_data(
    (select other_user_id from privileged_function_test_ids)
  )
$test$, '42501', 'permission denied for function delete_user_data',
  'anon cannot execute delete_user_data');
select throws_ok($test$
  select public.admin_delete_user_data(
    (select other_user_id from privileged_function_test_ids),
    'liked'
  )
$test$, '42501', 'permission denied for function admin_delete_user_data',
  'anon cannot execute admin_delete_user_data');

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  (select user_id::text from privileged_function_test_ids),
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- A regular authenticated user can perform each documented self-service call.
select is(
  (
    public.add_liked_suggestion(
      (select user_id from privileged_function_test_ids),
      2147483002,
      'pgTAP self-service probe',
      2026,
      null
    )->>'already_exists'
  ),
  'false',
  'authenticated user can add a liked suggestion for self'
);
select is(
  (
    public.get_film_stats(
      (select user_id from privileged_function_test_ids)
    )->>'total_films'
  ),
  '1',
  'authenticated user can read film stats for self'
);

insert into privileged_function_test_results (name, result)
select
  'self_delete',
  public.delete_user_data((select user_id from privileged_function_test_ids));

select is(
  (select result from privileged_function_test_results where name = 'self_delete'),
  '{
    "success": true,
    "deleted": {
      "blocked_suggestions": 1,
      "suggestion_feedback": 1,
      "user_exploration_stats": 1,
      "user_adjacent_preferences": 1,
      "saved_suggestions": 1,
      "user_reason_preferences": 1,
      "film_tmdb_map": 1,
      "film_diary_events": 1,
      "film_events": 1
    }
  }'::jsonb,
  'self delete reports every generated deletion count'
);

-- Inspect through service_role so RLS cannot make absence/preservation assertions vacuous.
reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  jsonb_build_object(
    'blocked_suggestions', (select count(*) from public.blocked_suggestions where user_id = (select user_id from privileged_function_test_ids)),
    'suggestion_feedback', (select count(*) from public.suggestion_feedback where user_id = (select user_id from privileged_function_test_ids)),
    'user_exploration_stats', (select count(*) from public.user_exploration_stats where user_id = (select user_id from privileged_function_test_ids)),
    'user_adjacent_preferences', (select count(*) from public.user_adjacent_preferences where user_id = (select user_id from privileged_function_test_ids)),
    'saved_suggestions', (select count(*) from public.saved_suggestions where user_id = (select user_id from privileged_function_test_ids)),
    'user_reason_preferences', (select count(*) from public.user_reason_preferences where user_id = (select user_id from privileged_function_test_ids)),
    'film_tmdb_map', (select count(*) from public.film_tmdb_map where user_id = (select user_id from privileged_function_test_ids)),
    'film_diary_events_raw', (select count(*) from public.film_diary_events_raw where user_id = (select user_id from privileged_function_test_ids)),
    'film_events', (select count(*) from public.film_events where user_id = (select user_id from privileged_function_test_ids))
  ),
  '{
    "blocked_suggestions": 0,
    "suggestion_feedback": 0,
    "user_exploration_stats": 0,
    "user_adjacent_preferences": 0,
    "saved_suggestions": 0,
    "user_reason_preferences": 0,
    "film_tmdb_map": 0,
    "film_diary_events_raw": 0,
    "film_events": 0
  }'::jsonb,
  'self delete removes every generated target row'
);
select is(
  jsonb_build_object(
    'blocked_suggestions', (select count(*) from public.blocked_suggestions where user_id = (select other_user_id from privileged_function_test_ids)),
    'suggestion_feedback', (select count(*) from public.suggestion_feedback where user_id = (select other_user_id from privileged_function_test_ids)),
    'user_exploration_stats', (select count(*) from public.user_exploration_stats where user_id = (select other_user_id from privileged_function_test_ids)),
    'user_adjacent_preferences', (select count(*) from public.user_adjacent_preferences where user_id = (select other_user_id from privileged_function_test_ids)),
    'saved_suggestions', (select count(*) from public.saved_suggestions where user_id = (select other_user_id from privileged_function_test_ids)),
    'user_reason_preferences', (select count(*) from public.user_reason_preferences where user_id = (select other_user_id from privileged_function_test_ids)),
    'film_tmdb_map', (select count(*) from public.film_tmdb_map where user_id = (select other_user_id from privileged_function_test_ids)),
    'film_diary_events_raw', (select count(*) from public.film_diary_events_raw where user_id = (select other_user_id from privileged_function_test_ids)),
    'film_events', (select count(*) from public.film_events where user_id = (select other_user_id from privileged_function_test_ids))
  ),
  '{
    "blocked_suggestions": 1,
    "suggestion_feedback": 2,
    "user_exploration_stats": 1,
    "user_adjacent_preferences": 1,
    "saved_suggestions": 1,
    "user_reason_preferences": 1,
    "film_tmdb_map": 1,
    "film_diary_events_raw": 2,
    "film_events": 1
  }'::jsonb,
  'self delete preserves every generated non-target row'
);

reset role;
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
$test$, '42501', 'Unauthorized: can only access your own data',
  'authenticated user cannot add a liked suggestion for another user');
select throws_ok($test$
  select public.get_film_stats(
    (select other_user_id from privileged_function_test_ids)
  )
$test$, '42501', 'Unauthorized: can only access your own data',
  'authenticated user cannot read another user film stats');
select throws_ok($test$
  select public.increment_rate_limit(
    (select other_key_id from privileged_function_test_ids),
    (select rate_window_start from privileged_function_test_ids)
  )
$test$, '42501', 'permission denied for function increment_rate_limit',
  'authenticated user cannot increment a rate limit');
select throws_ok($test$
  select public.delete_user_data(
    (select other_user_id from privileged_function_test_ids)
  )
$test$, '42501', 'Unauthorized: can only delete your own data',
  'authenticated user cannot delete another user data');
select throws_ok($test$
  select public.admin_delete_user_data(
    (select other_user_id from privileged_function_test_ids),
    'liked'
  )
$test$, '42501', 'Unauthorized: admin role required',
  'regular authenticated user cannot perform admin deletion');

select set_config('request.jwt.claim.sub', '', true);
select throws_ok($test$
  select public.delete_user_data(
    (select other_user_id from privileged_function_test_ids)
  )
$test$, '42501', 'Unauthorized: can only delete your own data',
  'authenticated caller with null identity cannot delete data');

-- The JWT role remains authenticated; the database user_roles row grants admin.
select set_config(
  'request.jwt.claim.sub',
  (select admin_user_id::text from privileged_function_test_ids),
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(
  current_setting('request.jwt.claim.role', true),
  'authenticated',
  'admin fixture uses an authenticated JWT role'
);

insert into privileged_function_test_results (name, result)
select
  'admin_liked',
  public.admin_delete_user_data(
    (select other_user_id from privileged_function_test_ids),
    'liked'
  );
select is(
  (select result from privileged_function_test_results where name = 'admin_liked'),
  '{
    "success": true,
    "scope": "liked",
    "deleted": {"liked_suggestions": 1}
  }'::jsonb,
  'admin liked deletion reports its generated deletion count'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  jsonb_build_object(
    'other_positive', (
      select count(*)
      from public.suggestion_feedback
      where user_id = (select other_user_id from privileged_function_test_ids)
        and feedback_type = 'positive'
    ),
    'other_negative', (
      select count(*)
      from public.suggestion_feedback
      where user_id = (select other_user_id from privileged_function_test_ids)
        and feedback_type = 'negative'
    ),
    'all_positive', (
      select count(*)
      from public.suggestion_feedback
      where user_id = (select all_user_id from privileged_function_test_ids)
        and feedback_type = 'positive'
    ),
    'admin_positive', (
      select count(*)
      from public.suggestion_feedback
      where user_id = (select admin_user_id from privileged_function_test_ids)
        and feedback_type = 'positive'
    )
  ),
  '{
    "other_positive": 0,
    "other_negative": 1,
    "all_positive": 1,
    "admin_positive": 1
  }'::jsonb,
  'admin liked deletion removes only the generated positive target row'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  (select admin_user_id::text from privileged_function_test_ids),
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into privileged_function_test_results (name, result)
select
  'admin_import',
  public.admin_delete_user_data(
    (select other_user_id from privileged_function_test_ids),
    'import'
  );
select is(
  (select result from privileged_function_test_results where name = 'admin_import'),
  '{
    "success": true,
    "scope": "import",
    "deleted": {
      "film_tmdb_map": 1,
      "film_diary_events": 2,
      "film_events": 1
    }
  }'::jsonb,
  'admin import deletion reports map, raw diary, and film event counts'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  jsonb_build_object(
    'target_map', (select count(*) from public.film_tmdb_map where user_id = (select other_user_id from privileged_function_test_ids)),
    'target_diary_raw', (select count(*) from public.film_diary_events_raw where user_id = (select other_user_id from privileged_function_test_ids)),
    'target_events', (select count(*) from public.film_events where user_id = (select other_user_id from privileged_function_test_ids)),
    'non_target_map', (select count(*) from public.film_tmdb_map where user_id = (select all_user_id from privileged_function_test_ids)),
    'non_target_diary_raw', (select count(*) from public.film_diary_events_raw where user_id = (select all_user_id from privileged_function_test_ids)),
    'non_target_events', (select count(*) from public.film_events where user_id = (select all_user_id from privileged_function_test_ids))
  ),
  '{
    "target_map": 0,
    "target_diary_raw": 0,
    "target_events": 0,
    "non_target_map": 1,
    "non_target_diary_raw": 2,
    "non_target_events": 1
  }'::jsonb,
  'admin import deletes only the generated target import rows'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  (select admin_user_id::text from privileged_function_test_ids),
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into privileged_function_test_results (name, result)
select
  'admin_all',
  public.admin_delete_user_data(
    (select all_user_id from privileged_function_test_ids),
    'all'
  );
select is(
  (select result from privileged_function_test_results where name = 'admin_all'),
  '{
    "success": true,
    "scope": "all",
    "deleted": {
      "blocked_suggestions": 1,
      "suggestion_feedback": 1,
      "user_exploration_stats": 1,
      "user_adjacent_preferences": 1,
      "saved_suggestions": 1,
      "user_reason_preferences": 1,
      "film_tmdb_map": 1,
      "film_diary_events": 2,
      "film_events": 1
    }
  }'::jsonb,
  'admin all deletion reports every generated deletion count'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  jsonb_build_object(
    'target_blocked', (select count(*) from public.blocked_suggestions where user_id = (select all_user_id from privileged_function_test_ids)),
    'target_feedback', (select count(*) from public.suggestion_feedback where user_id = (select all_user_id from privileged_function_test_ids)),
    'target_exploration', (select count(*) from public.user_exploration_stats where user_id = (select all_user_id from privileged_function_test_ids)),
    'target_adjacent', (select count(*) from public.user_adjacent_preferences where user_id = (select all_user_id from privileged_function_test_ids)),
    'target_saved', (select count(*) from public.saved_suggestions where user_id = (select all_user_id from privileged_function_test_ids)),
    'target_reason', (select count(*) from public.user_reason_preferences where user_id = (select all_user_id from privileged_function_test_ids)),
    'target_map', (select count(*) from public.film_tmdb_map where user_id = (select all_user_id from privileged_function_test_ids)),
    'target_diary_raw', (select count(*) from public.film_diary_events_raw where user_id = (select all_user_id from privileged_function_test_ids)),
    'target_events', (select count(*) from public.film_events where user_id = (select all_user_id from privileged_function_test_ids)),
    'non_target_diary_raw', (select count(*) from public.film_diary_events_raw where user_id = (select admin_user_id from privileged_function_test_ids)),
    'non_target_events', (select count(*) from public.film_events where user_id = (select admin_user_id from privileged_function_test_ids))
  ),
  '{
    "target_blocked": 0,
    "target_feedback": 0,
    "target_exploration": 0,
    "target_adjacent": 0,
    "target_saved": 0,
    "target_reason": 0,
    "target_map": 0,
    "target_diary_raw": 0,
    "target_events": 0,
    "non_target_diary_raw": 1,
    "non_target_events": 1
  }'::jsonb,
  'admin all removes raw diary rows and preserves generated non-target data'
);

-- Service-role callers support verified server-side liked/stats/rate operations.
select is(
  (
    public.add_liked_suggestion(
      (select other_user_id from privileged_function_test_ids),
      2147483003,
      'pgTAP service probe',
      2026,
      null
    )->>'already_exists'
  ),
  'false',
  'service role can add a liked suggestion for a verified server call'
);
select is(
  (
    public.get_film_stats(
      (select other_user_id from privileged_function_test_ids)
    )->>'total_films'
  ),
  '0',
  'service role can read film stats for a verified server call'
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok($test$
  select public.increment_rate_limit(
    (select other_key_id from privileged_function_test_ids),
    (select rate_window_start from privileged_function_test_ids)
  )
$test$, '42501', 'Unauthorized: service role required',
  'rate limit body rejects a service database role with a non-service JWT claim');
select set_config('request.jwt.claim.role', 'service_role', true);
select lives_ok($test$
  select public.increment_rate_limit(
    (select other_key_id from privileged_function_test_ids),
    (select rate_window_start from privileged_function_test_ids)
  )
$test$, 'service role can increment a rate limit');
select is(
  (
    select request_count
    from public.api_rate_limits
    where key_id = (select other_key_id from privileged_function_test_ids)
      and window_start = (select rate_window_start from privileged_function_test_ids)
  ),
  1,
  'service rate-limit call increments the generated fixture bucket'
);

select throws_ok($test$
  select public.delete_user_data(
    (select other_user_id from privileged_function_test_ids)
  )
$test$, '42501', 'permission denied for function delete_user_data',
  'service role cannot execute self-service deletion');
select throws_ok($test$
  select public.admin_delete_user_data(
    (select other_user_id from privileged_function_test_ids),
    'liked'
  )
$test$, '42501', 'permission denied for function admin_delete_user_data',
  'service role cannot execute admin deletion');

reset role;
select * from finish();
rollback;
