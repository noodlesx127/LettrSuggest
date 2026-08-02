-- =============================================================================
-- Migration: Atomic import snapshot reconciliation
-- =============================================================================
-- Replaces the prior per-row, failure-swallowing import persistence with one
-- authenticated, transactional RPC. The caller supplies the complete current
-- snapshot (film events, TMDB mappings, diary watch events); the function makes
-- the user's cloud tables match that snapshot exactly:
--   * upserts every snapshot row,
--   * deletes rows that are no longer present in the snapshot,
--   * raises (rolling back ALL changes) on malformed input or persistence error.
--
-- Ownership is derived from auth.uid(); the function never accepts a target user
-- id, so a caller can only reconcile its own rows. It runs as SECURITY INVOKER
-- and relies on the existing per-table RLS policies plus the auth.uid() guard.
--
-- Validation runs entirely BEFORE any permanent write: every payload is staged
-- into a transaction-local temp table and checked (required fields, duplicate
-- identities, orphan mappings) so a rejected snapshot can never partially apply.
-- An explicit empty array ('[]') is valid at the database level and simply
-- removes the corresponding rows; an explicit NULL parameter is rejected.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Owner-scoped DELETE policies for the reconciled film/mapping tables.
-- ---------------------------------------------------------------------------
-- The reconciliation function below runs as SECURITY INVOKER, so its
-- DELETE FROM public.film_events / public.film_tmdb_map statements are subject
-- to row level security. The linked database currently grants SELECT/INSERT/
-- UPDATE on these two tables but NO DELETE, which would block (zero rows) the
-- stale-row removal the reconciliation depends on. (film_diary_events_raw
-- already carries an owner DELETE policy.) Recreate the two missing owner
-- DELETE policies here, before the function is created, so the invoker can
-- remove only its own rows. DROP-then-CREATE keeps the migration rerun-safe
-- (CREATE POLICY has no IF NOT EXISTS); each policy is scoped TO authenticated
-- with an auth.uid() owner qual and is never granted to PUBLIC or anon.
DROP POLICY IF EXISTS "film_events user delete" ON public.film_events;
CREATE POLICY "film_events user delete" ON public.film_events
  FOR DELETE TO authenticated USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "film_tmdb_map user delete" ON public.film_tmdb_map;
CREATE POLICY "film_tmdb_map user delete" ON public.film_tmdb_map
  FOR DELETE TO authenticated USING ((select auth.uid()) = user_id);

CREATE OR REPLACE FUNCTION public.reconcile_import_snapshot(
  p_film_events jsonb,
  p_mappings jsonb,
  p_diary_events jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid;
  v_films_upserted integer := 0;
  v_films_deleted integer := 0;
  v_mappings_upserted integer := 0;
  v_mappings_deleted integer := 0;
  v_events_upserted integer := 0;
  v_events_deleted integer := 0;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  -- Serialize concurrent reconciliations for the SAME user before any staging or
  -- permanent write. Two overlapping imports for one user must not interleave
  -- their delete/upsert passes and observe a partially-replaced snapshot. The
  -- transaction-scoped lock is keyed on a stable per-user value, so distinct
  -- users never block each other and the lock auto-releases at commit/rollback.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  -- Explicit NULL parameters are rejected; there are no silent defaults. An
  -- explicit empty array remains a valid (clearing) snapshot at the DB level.
  IF p_film_events IS NULL
     OR p_mappings IS NULL
     OR p_diary_events IS NULL THEN
    RAISE EXCEPTION 'snapshot parameters must not be null' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_film_events) <> 'array'
     OR jsonb_typeof(p_mappings) <> 'array'
     OR jsonb_typeof(p_diary_events) <> 'array' THEN
    RAISE EXCEPTION 'snapshot payload must be json arrays' USING ERRCODE = '22023';
  END IF;

  -- ---------------------------------------------------------------------------
  -- Stage all three payloads into transaction-local temp tables first. Nothing
  -- permanent is written until every validation below has passed.
  --
  -- The staging relations use fixed names with ON COMMIT DROP. Production runs
  -- one RPC per transaction, but a caller may invoke the function more than once
  -- in a single transaction (and a prior failed call is rolled back to a
  -- savepoint, not the whole transaction). Drop any pre-existing staging tables
  -- first so repeated calls are reentrant and a prior failure can never leave a
  -- relation that blocks the next call. These drops run after the advisory lock
  -- and parameter validation, so they are safe and transaction-local.
  -- ---------------------------------------------------------------------------
  DROP TABLE IF EXISTS pg_temp.tmp_snapshot_film_events;
  DROP TABLE IF EXISTS pg_temp.tmp_snapshot_mappings;
  DROP TABLE IF EXISTS pg_temp.tmp_snapshot_diary_events;

  CREATE TEMP TABLE tmp_snapshot_film_events ON COMMIT DROP AS
    SELECT
      v_uid AS user_id,
      trim(x.uri) AS uri,
      x.title AS title,
      x.year AS year,
      x.rating AS rating,
      x.rewatch AS rewatch,
      x.last_date AS last_date,
      x.watch_count AS watch_count,
      COALESCE(x.liked, false) AS liked,
      COALESCE(x.on_watchlist, false) AS on_watchlist,
      x.watchlist_added_at AS watchlist_added_at
    FROM jsonb_to_recordset(p_film_events) AS x(
      uri text,
      title text,
      year int,
      rating numeric,
      rewatch boolean,
      last_date text,
      watch_count int,
      liked boolean,
      on_watchlist boolean,
      watchlist_added_at timestamptz
    );

  CREATE TEMP TABLE tmp_snapshot_mappings ON COMMIT DROP AS
    SELECT
      v_uid AS user_id,
      trim(x.uri) AS uri,
      x.tmdb_id AS tmdb_id
    FROM jsonb_to_recordset(p_mappings) AS x(uri text, tmdb_id bigint);

  CREATE TEMP TABLE tmp_snapshot_diary_events ON COMMIT DROP AS
    SELECT
      v_uid AS user_id,
      trim(x.uri) AS uri,
      x.watched_date AS watched_date,
      x.rating AS rating,
      COALESCE(x.rewatch, false) AS rewatch
    FROM jsonb_to_recordset(p_diary_events) AS x(
      uri text,
      watched_date date,
      rating numeric,
      rewatch boolean
    );

  -- ---------------------------------------------------------------------------
  -- Validate films: required fields and duplicate URIs.
  -- ---------------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM tmp_snapshot_film_events
     WHERE uri IS NULL OR uri = '' OR title IS NULL
  ) THEN
    RAISE EXCEPTION 'film event rows require uri and title' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM tmp_snapshot_film_events
    GROUP BY uri HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate film uri in snapshot' USING ERRCODE = '23505';
  END IF;

  -- ---------------------------------------------------------------------------
  -- Validate mappings: required fields, duplicate URIs, and orphan mappings that
  -- reference a film absent from the snapshot.
  -- ---------------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM tmp_snapshot_mappings
     WHERE uri IS NULL OR uri = '' OR tmdb_id IS NULL
  ) THEN
    RAISE EXCEPTION 'mapping rows require uri and tmdb_id' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM tmp_snapshot_mappings
    GROUP BY uri HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate mapping uri in snapshot' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1 FROM tmp_snapshot_mappings AS m
     WHERE NOT EXISTS (
       SELECT 1 FROM tmp_snapshot_film_events AS f WHERE f.uri = m.uri
     )
  ) THEN
    RAISE EXCEPTION 'mapping references a film not in the snapshot' USING ERRCODE = '23503';
  END IF;

  -- ---------------------------------------------------------------------------
  -- Validate diary events: required uri and duplicate identities. Identity is
  -- (uri, watched_date, rewatch); GROUP BY treats NULL watched_date values as
  -- equal, matching the NULLS NOT DISTINCT unique index semantics.
  -- ---------------------------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM tmp_snapshot_diary_events WHERE uri IS NULL OR uri = ''
  ) THEN
    RAISE EXCEPTION 'diary event rows require uri' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM tmp_snapshot_diary_events
    GROUP BY uri, watched_date, rewatch HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate diary event identity in snapshot' USING ERRCODE = '23505';
  END IF;

  -- A diary event whose film is absent from the snapshot would dangle once the
  -- film row is deleted. Reject it here (like orphan mappings) before any write.
  IF EXISTS (
    SELECT 1 FROM tmp_snapshot_diary_events AS d
     WHERE NOT EXISTS (
       SELECT 1 FROM tmp_snapshot_film_events AS f WHERE f.uri = d.uri
     )
  ) THEN
    RAISE EXCEPTION 'diary event references a film not in the snapshot' USING ERRCODE = '23503';
  END IF;

  -- ---------------------------------------------------------------------------
  -- All validation passed: apply the snapshot atomically.
  -- ---------------------------------------------------------------------------

  -- 1) Film events. user_id is always auth.uid(); any payload user_id is ignored.
  INSERT INTO public.film_events (
    user_id, uri, title, year, rating, rewatch, last_date,
    watch_count, liked, on_watchlist, watchlist_added_at, updated_at
  )
  SELECT
    user_id, uri, title, year, rating, rewatch, last_date,
    watch_count, liked, on_watchlist, watchlist_added_at, now()
  FROM tmp_snapshot_film_events
  ON CONFLICT (user_id, uri) DO UPDATE SET
    title = EXCLUDED.title,
    year = EXCLUDED.year,
    rating = EXCLUDED.rating,
    rewatch = EXCLUDED.rewatch,
    last_date = EXCLUDED.last_date,
    watch_count = EXCLUDED.watch_count,
    liked = EXCLUDED.liked,
    on_watchlist = EXCLUDED.on_watchlist,
    watchlist_added_at = EXCLUDED.watchlist_added_at,
    updated_at = now();
  GET DIAGNOSTICS v_films_upserted = ROW_COUNT;

  DELETE FROM public.film_events AS fe
   WHERE fe.user_id = v_uid
     AND NOT EXISTS (
       SELECT 1 FROM tmp_snapshot_film_events AS s WHERE s.uri = fe.uri
     );
  GET DIAGNOSTICS v_films_deleted = ROW_COUNT;

  -- 2) TMDB mappings.
  INSERT INTO public.film_tmdb_map (user_id, uri, tmdb_id, updated_at)
  SELECT user_id, uri, tmdb_id, now()
  FROM tmp_snapshot_mappings
  ON CONFLICT (user_id, uri) DO UPDATE SET
    tmdb_id = EXCLUDED.tmdb_id,
    updated_at = now();
  GET DIAGNOSTICS v_mappings_upserted = ROW_COUNT;

  DELETE FROM public.film_tmdb_map AS m
   WHERE m.user_id = v_uid
     AND NOT EXISTS (
       SELECT 1 FROM tmp_snapshot_mappings AS s WHERE s.uri = m.uri
     );
  GET DIAGNOSTICS v_mappings_deleted = ROW_COUNT;

  -- 3) Diary watch events. Identity is (user_id, uri, watched_date, rewatch)
  --    with NULLS NOT DISTINCT, matching film_diary_events_raw_unique.
  --
  --    Delete absent rows BEFORE upserting retained ones. The
  --    trg_sync_film_events_last_date trigger fires AFTER INSERT OR UPDATE on
  --    this table and only ever increases film_events.last_date
  --    (last_date IS NULL OR last_date < max_date). If retained rows were
  --    upserted while stale (newer) rows still existed, the trigger would latch
  --    the stale MAX(watched_date) and the later deletion -- which does not fire
  --    the trigger -- would never recompute it, leaving a stale last_date.
  --    Deleting first lets the upsert trigger recompute from the final rows only.
  DELETE FROM public.film_diary_events_raw AS d
   WHERE d.user_id = v_uid
     AND NOT EXISTS (
       SELECT 1 FROM tmp_snapshot_diary_events AS s
        WHERE s.uri = d.uri
          AND s.rewatch = d.rewatch
          AND s.watched_date IS NOT DISTINCT FROM d.watched_date
     );
  GET DIAGNOSTICS v_events_deleted = ROW_COUNT;

  INSERT INTO public.film_diary_events_raw (
    user_id, uri, watched_date, rating, rewatch
  )
  SELECT user_id, uri, watched_date, rating, rewatch
  FROM tmp_snapshot_diary_events
  ON CONFLICT (user_id, uri, watched_date, rewatch) DO UPDATE SET
    rating = EXCLUDED.rating;
  GET DIAGNOSTICS v_events_upserted = ROW_COUNT;

  -- 4) Exact last_date recompute. The film upsert above trusts the snapshot
  --    last_date, and the trg_sync_film_events_last_date trigger only ever
  --    INCREASES film_events.last_date (last_date IS NULL OR last_date <
  --    max_date). Neither guarantees the exact final value: a stale snapshot
  --    last_date, or a deleted late diary event the trigger already latched,
  --    would otherwise survive. Now that film_diary_events_raw holds exactly the
  --    snapshot's events, set EVERY snapshot film's last_date to the exact
  --    MAX(watched_date)::text from the final diary rows -- NULL when a film has
  --    no diary events (the LEFT JOIN yields no watched_date). This runs AFTER
  --    the diary write and does not re-capture v_films_upserted, so the returned
  --    films_upserted count is exactly the value fixed at the film upsert.
  UPDATE public.film_events AS fe
     SET last_date = exact.last_date,
         updated_at = now()
    FROM (
      SELECT s.uri AS uri,
             MAX(d.watched_date)::text AS last_date
        FROM tmp_snapshot_film_events AS s
        LEFT JOIN public.film_diary_events_raw AS d
          ON d.user_id = v_uid AND d.uri = s.uri
       GROUP BY s.uri
    ) AS exact
   WHERE fe.user_id = v_uid
     AND fe.uri = exact.uri;

  RETURN jsonb_build_object(
    'ok', true,
    'films_upserted', v_films_upserted,
    'films_deleted', v_films_deleted,
    'mappings_upserted', v_mappings_upserted,
    'mappings_deleted', v_mappings_deleted,
    'events_upserted', v_events_upserted,
    'events_deleted', v_events_deleted
  );
END;
$fn$;

COMMENT ON FUNCTION public.reconcile_import_snapshot(jsonb, jsonb, jsonb) IS
  'Atomically replaces the authenticated user''s film events, TMDB mappings, and diary watch events with the supplied snapshot. Validates the full snapshot before any write and rolls back all changes on validation or persistence failure.';

-- Authenticated-only execution; remove inherited PUBLIC and anonymous access.
REVOKE ALL ON FUNCTION public.reconcile_import_snapshot(jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_import_snapshot(jsonb, jsonb, jsonb)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
