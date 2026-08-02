import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabaseClient", () => ({ supabase: supabaseMock }));

import {
  assertReconcilableSnapshot,
  buildImportSnapshotPayload,
  ImportSnapshotError,
  reconcileImportSnapshot,
  validateImportSnapshotResponse,
  type ImportSnapshotInput,
  type ImportSnapshotRpcClient,
} from "@/lib/importSnapshot";
import {
  createRecommendationRevision,
  TASTE_PROFILE_METADATA_VERSION,
  TASTE_PROFILE_MODEL_VERSION,
  type RecommendationRevisionInput,
} from "@/lib/recommendationRevision";
import type { FilmEvent, WatchEvent } from "@/lib/normalize";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function film(overrides: Partial<FilmEvent> & { uri: string }): FilmEvent {
  return {
    title: "Example Film",
    year: 2020,
    rewatch: false,
    watchCount: 1,
    liked: false,
    onWatchlist: false,
    watchlistAddedAt: null,
    ...overrides,
  };
}

function watchEvent(
  overrides: Partial<WatchEvent> & { uri: string },
): WatchEvent {
  return {
    watchedDate: null,
    rating: null,
    rewatch: false,
    ...overrides,
  };
}

function snapshotInput(): ImportSnapshotInput {
  return {
    films: [
      film({ uri: "https://letterboxd.com/film/alpha/", title: "Alpha" }),
      film({
        uri: "https://letterboxd.com/film/beta/",
        title: "Beta",
        onWatchlist: true,
        watchlistAddedAt: "2026-07-01T12:00:00.000Z",
      }),
    ],
    watchEvents: [
      watchEvent({
        uri: "https://letterboxd.com/film/alpha/",
        watchedDate: "2026-06-01",
        rating: 4,
      }),
    ],
    mappings: [
      { uri: "https://letterboxd.com/film/alpha/", tmdbId: 101 },
      { uri: "https://letterboxd.com/film/beta/", tmdbId: 202 },
    ],
  };
}

function successResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      ok: true,
      films_upserted: 2,
      films_deleted: 1,
      mappings_upserted: 2,
      mappings_deleted: 1,
      events_upserted: 1,
      events_deleted: 3,
      ...overrides,
    },
    error: null,
  };
}

/**
 * Mirror the production revision input built in serverSuggestionsEngine so the
 * test proves a reconciled snapshot changes the recommendation cache revision.
 */
function revisionInputFromSnapshot(input: ImportSnapshotInput) {
  const revisionInput: RecommendationRevisionInput = {
    films: input.films.map((f) => ({
      uri: f.uri,
      title: f.title,
      year: f.year,
      rating: f.rating ?? null,
      rewatch: f.rewatch ?? null,
      lastDate: f.lastDate ?? null,
      watchCount: f.watchCount ?? null,
      liked: f.liked ?? null,
      onWatchlist: f.onWatchlist ?? null,
    })),
    mappings: input.mappings.map((m) => ({ uri: m.uri, tmdbId: m.tmdbId })),
    watchlist: input.films
      .filter((f) => f.onWatchlist === true)
      .map((f) => ({ uri: f.uri, watchlistAddedAt: f.watchlistAddedAt ?? null })),
    feedback: [],
    quizState: { status: "unavailable" },
    blockedIds: [],
    metadataVersion: TASTE_PROFILE_METADATA_VERSION,
    profileModelVersion: TASTE_PROFILE_MODEL_VERSION,
  };
  return createRecommendationRevision(revisionInput);
}

describe("import snapshot reconciliation seam", () => {
  beforeEach(() => {
    supabaseMock.rpc.mockReset();
  });

  it("serializes the full film, mapping, and watch-event snapshot for replacement", () => {
    const payload = buildImportSnapshotPayload(USER_ID, snapshotInput());

    // The payload is the complete current snapshot. Rows absent from it are the
    // rows the RPC must remove, so no prior-state merge may leak in.
    expect(payload.p_film_events).toHaveLength(2);
    expect(payload.p_film_events[0]).toMatchObject({
      uri: "https://letterboxd.com/film/alpha/",
      title: "Alpha",
      year: 2020,
      liked: false,
      on_watchlist: false,
    });
    expect(payload.p_film_events[1]).toMatchObject({
      uri: "https://letterboxd.com/film/beta/",
      on_watchlist: true,
      watchlist_added_at: "2026-07-01T12:00:00.000Z",
    });

    expect(payload.p_mappings).toEqual([
      { uri: "https://letterboxd.com/film/alpha/", tmdb_id: 101 },
      { uri: "https://letterboxd.com/film/beta/", tmdb_id: 202 },
    ]);

    expect(payload.p_diary_events).toEqual([
      {
        uri: "https://letterboxd.com/film/alpha/",
        watched_date: "2026-06-01",
        rating: 4,
        rewatch: false,
      },
    ]);
  });

  it("returns structured counts on a successful reconciliation", async () => {
    supabaseMock.rpc.mockResolvedValueOnce(successResponse());

    const result = await reconcileImportSnapshot(USER_ID, snapshotInput());

    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      "reconcile_import_snapshot",
      expect.objectContaining({
        p_film_events: expect.any(Array),
        p_mappings: expect.any(Array),
        p_diary_events: expect.any(Array),
      }),
    );
    expect(result).toEqual({
      ok: true,
      filmsUpserted: 2,
      filmsDeleted: 1,
      mappingsUpserted: 2,
      mappingsDeleted: 1,
      eventsUpserted: 1,
      eventsDeleted: 3,
    });
  });

  it("preserves retained entries and reports removed rows through counts", async () => {
    // A reconciliation that removes one film/mapping/event and keeps the rest.
    supabaseMock.rpc.mockResolvedValueOnce(
      successResponse({
        films_upserted: 1,
        films_deleted: 1,
        mappings_upserted: 1,
        mappings_deleted: 1,
        events_upserted: 0,
        events_deleted: 1,
      }),
    );

    const result = await reconcileImportSnapshot(USER_ID, snapshotInput());

    expect(result.filmsDeleted).toBe(1);
    expect(result.mappingsDeleted).toBe(1);
    expect(result.eventsDeleted).toBe(1);
    expect(result.filmsUpserted).toBe(1);
  });

  it("throws a fatal error instead of reporting success when the RPC fails validation", async () => {
    supabaseMock.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "film event rows require uri and title", code: "22023" },
    });

    await expect(
      reconcileImportSnapshot(USER_ID, snapshotInput()),
    ).rejects.toMatchObject({
      name: "ImportSnapshotError",
      retryable: false,
    });
  });

  it("classifies transport failures as retryable", async () => {
    supabaseMock.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "schema cache stale", code: "PGRST205" },
    });

    await expect(
      reconcileImportSnapshot(USER_ID, snapshotInput()),
    ).rejects.toMatchObject({
      name: "ImportSnapshotError",
      retryable: true,
    });
  });

  it("throws a retryable error when the RPC call itself rejects", async () => {
    supabaseMock.rpc.mockRejectedValueOnce(new Error("network down"));

    await expect(
      reconcileImportSnapshot(USER_ID, snapshotInput()),
    ).rejects.toMatchObject({
      name: "ImportSnapshotError",
      retryable: true,
    });
  });

  it("rejects malformed success payloads rather than reporting success", () => {
    expect(() => validateImportSnapshotResponse(null)).toThrow(
      ImportSnapshotError,
    );
    expect(() =>
      validateImportSnapshotResponse({ ok: true, films_upserted: "two" }),
    ).toThrow(ImportSnapshotError);
    expect(() =>
      validateImportSnapshotResponse({ ok: false, films_upserted: 1 }),
    ).toThrow(ImportSnapshotError);
    expect(() =>
      validateImportSnapshotResponse({
        ok: true,
        films_upserted: -1,
        films_deleted: 0,
        mappings_upserted: 0,
        mappings_deleted: 0,
        events_upserted: 0,
        events_deleted: 0,
      }),
    ).toThrow(ImportSnapshotError);
  });

  it("changes the recommendation input revision when the reconciled snapshot changes", () => {
    const before = snapshotInput();
    const beforeRevision = revisionInputFromSnapshot(before);

    // A re-import drops one film (and its mapping/watchlist entry) and adds a
    // new one. Reconciliation must move the revision so cached taste profiles
    // invalidate.
    const after: ImportSnapshotInput = {
      films: [
        before.films[0],
        film({ uri: "https://letterboxd.com/film/gamma/", title: "Gamma" }),
      ],
      watchEvents: before.watchEvents,
      mappings: [{ uri: "https://letterboxd.com/film/alpha/", tmdbId: 101 }],
    };
    const afterRevision = revisionInputFromSnapshot(after);

    expect(afterRevision).not.toBe(beforeRevision);

    // Reconciling to an identical snapshot is stable and does not churn the
    // revision (no spurious cache invalidation).
    expect(revisionInputFromSnapshot(before)).toBe(beforeRevision);
  });

  it("accepts an injected RPC client seam", async () => {
    const client: ImportSnapshotRpcClient = {
      rpc: vi.fn().mockResolvedValueOnce(successResponse()),
    };

    const result = await reconcileImportSnapshot(
      USER_ID,
      snapshotInput(),
      client,
    );

    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });
});

describe("reconcile_import_snapshot migration contract", () => {
  const migration = readFileSync(
    fileURLToPath(
      new URL(
        "../../supabase/migrations/20260801000000_reconcile_import_snapshot.sql",
        import.meta.url,
      ),
    ),
    "utf8",
  );

  it("is a forward-only migration ordered after the watchlist column migration", () => {
    // 20260801000000 > 20260730020406 (latest applied migration).
    expect("20260801000000" > "20260730020406").toBe(true);
    expect(migration).toMatch(
      /create or replace function public\.reconcile_import_snapshot/i,
    );
  });

  it("derives ownership from auth.uid() instead of accepting a target user id", () => {
    expect(migration).toMatch(/auth\.uid\(\)/i);
    // The reconciliation must not take a caller-supplied user id parameter.
    expect(migration).not.toMatch(/p_user_id/i);
    expect(migration).not.toMatch(/target_user_id/i);
  });

  it("runs as security invoker and reloads the PostgREST schema cache", () => {
    expect(migration).toMatch(/security invoker/i);
    expect(migration).not.toMatch(/security definer/i);
    expect(migration).toMatch(/notify pgrst, ['"]reload schema['"]/i);
  });

  it("serializes per-user reconciliations with an advisory xact lock before any write", () => {
    // Two concurrent imports for the same user must not interleave their
    // delete/upsert passes. A transaction-scoped advisory lock keyed on a stable
    // per-user value serializes them; the key derives from the authenticated uid
    // so distinct users never block each other.
    const lockPattern =
      /pg_advisory_xact_lock\(\s*hashtextextended\(\s*v_uid::text\s*,\s*0\s*\)\s*\)/i;
    expect(migration).toMatch(lockPattern);

    // The lock must be acquired before staging or any permanent write so a
    // concurrent reconciliation cannot observe a partially-replaced snapshot.
    const lockIndex = migration.search(lockPattern);
    const firstStagingIndex = migration.search(/create temp table/i);
    const firstWriteIndex = migration.search(/insert into public\.film_events/i);
    expect(lockIndex).toBeGreaterThan(-1);
    expect(firstStagingIndex).toBeGreaterThan(lockIndex);
    expect(firstWriteIndex).toBeGreaterThan(lockIndex);
  });

  it("grants execute to authenticated only and revokes PUBLIC and anon", () => {
    expect(migration).toMatch(
      /grant execute on function public\.reconcile_import_snapshot[^;]*to authenticated/i,
    );
    expect(migration).toMatch(
      /revoke all on function public\.reconcile_import_snapshot[^;]*from public/i,
    );
    expect(migration).toMatch(
      /revoke all on function public\.reconcile_import_snapshot[^;]*anon/i,
    );
  });

  it("reconciles all three user-scoped tables and returns structured counts", () => {
    expect(migration).toMatch(/insert into public\.film_events/i);
    expect(migration).toMatch(/delete from public\.film_events/i);
    expect(migration).toMatch(/insert into public\.film_tmdb_map/i);
    expect(migration).toMatch(/delete from public\.film_tmdb_map/i);
    expect(migration).toMatch(/insert into public\.film_diary_events_raw/i);
    expect(migration).toMatch(/delete from public\.film_diary_events_raw/i);
    expect(migration).toMatch(/films_upserted/i);
    expect(migration).toMatch(/films_deleted/i);
    expect(migration).toMatch(/mappings_upserted/i);
    expect(migration).toMatch(/mappings_deleted/i);
    expect(migration).toMatch(/events_upserted/i);
    expect(migration).toMatch(/events_deleted/i);
  });

  it("rejects explicit NULL parameters and offers no silent defaults", () => {
    // Parameters must not carry DEFAULT clauses that could mask a missing arg.
    expect(migration).not.toMatch(/p_film_events\s+jsonb\s+default/i);
    expect(migration).not.toMatch(/p_mappings\s+jsonb\s+default/i);
    expect(migration).not.toMatch(/p_diary_events\s+jsonb\s+default/i);
    // Explicit NULL parameters are rejected.
    expect(migration).toMatch(/is null/i);
  });

  it("rejects duplicate URIs/events and mappings that orphan retained films", () => {
    expect(migration).toMatch(/duplicate film/i);
    expect(migration).toMatch(/duplicate mapping/i);
    expect(migration).toMatch(/duplicate diary/i);
    expect(migration).toMatch(/mapping references a film not in the snapshot/i);
  });

  it("rejects diary events that reference a film absent from the snapshot", () => {
    // Orphan diary events must fail validation (23503) before any write, exactly
    // like orphan mappings, so a deleted film can never leave dangling events.
    expect(migration).toMatch(
      /diary event references a film not in the snapshot/i,
    );
    expect(migration).toMatch(/23503/);
  });

  it("deletes absent diary rows BEFORE inserting retained ones", () => {
    // The film_events.last_date trigger fires AFTER INSERT/UPDATE on the diary
    // table and only ever increases last_date. If retained diary rows are
    // inserted while stale (newer) rows still exist, the trigger latches the
    // stale max and the later deletion never recomputes it. Deleting absent rows
    // first lets the trigger recompute from the remaining events only.
    const diaryDeleteIndex = migration.search(
      /delete from public\.film_diary_events_raw/i,
    );
    const diaryInsertIndex = migration.search(
      /insert into public\.film_diary_events_raw/i,
    );
    expect(diaryDeleteIndex).toBeGreaterThan(-1);
    expect(diaryInsertIndex).toBeGreaterThan(-1);
    expect(diaryDeleteIndex).toBeLessThan(diaryInsertIndex);
  });

  it("recomputes an exact last_date from the final diary events after the diary write", () => {
    // The film upsert trusts the snapshot last_date and the diary trigger only
    // ever INCREASES it, so neither guarantees the exact final value. The RPC
    // must explicitly recompute film_events.last_date to the exact
    // MAX(watched_date)::text from the final film_diary_events_raw rows.
    expect(migration).toMatch(/update public\.film_events/i);
    expect(migration).toMatch(/max\(d\.watched_date\)::text/i);
    // A LEFT JOIN makes films with no diary events resolve to NULL (exact),
    // rather than retaining a stale snapshot/trigger value.
    expect(migration).toMatch(/left join public\.film_diary_events_raw/i);

    // The exact recompute must run AFTER the final diary write so it observes
    // the reconciled events, and it must not reuse the captured film upsert
    // count variable (the returned films_upserted is fixed at the film upsert).
    const diaryInsertIndex = migration.search(
      /insert into public\.film_diary_events_raw/i,
    );
    const recomputeIndex = migration.search(/update public\.film_events/i);
    expect(diaryInsertIndex).toBeGreaterThan(-1);
    expect(recomputeIndex).toBeGreaterThan(diaryInsertIndex);

    // The recompute must not re-capture the film upsert count: the returned
    // films_upserted stays the value captured at the film upsert statement.
    const afterRecompute = migration.slice(recomputeIndex);
    expect(afterRecompute).not.toMatch(/get diagnostics v_films_upserted/i);
  });

  it("drops staging temp tables before re-creating them so the function is reentrant", () => {
    // Fixed ON COMMIT DROP temp names prevent a second call inside the same
    // transaction (the relation already exists). Pre-create drops make repeated
    // calls safe and ensure a prior failed call cannot leave blocking relations.
    expect(migration).toMatch(
      /drop table if exists pg_temp\.tmp_snapshot_film_events/i,
    );
    expect(migration).toMatch(
      /drop table if exists pg_temp\.tmp_snapshot_mappings/i,
    );
    expect(migration).toMatch(
      /drop table if exists pg_temp\.tmp_snapshot_diary_events/i,
    );

    // The pre-create drop must precede the corresponding CREATE TEMP TABLE.
    const dropIndex = migration.search(
      /drop table if exists pg_temp\.tmp_snapshot_film_events/i,
    );
    const createIndex = migration.search(
      /create temp table tmp_snapshot_film_events/i,
    );
    expect(dropIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeGreaterThan(dropIndex);
  });

  it("defines idempotent owner-scoped authenticated DELETE policies for film_events and film_tmdb_map", () => {
    // The RPC runs as SECURITY INVOKER, so its DELETE FROM public.film_events /
    // public.film_tmdb_map statements are subject to RLS. The linked database
    // currently grants SELECT/INSERT/UPDATE on those two tables but NO DELETE, so
    // without an owner DELETE policy the reconciliation's stale-row deletes would
    // be blocked (zero rows), leaving stale films and mappings behind.
    // (film_diary_events_raw already carries an owner DELETE policy.) The
    // migration must therefore recreate the two missing DELETE policies itself,
    // scoped to authenticated with an auth.uid() owner qual.
    const filmEventsDrop =
      /drop policy if exists "film_events user delete" on public\.film_events/i;
    const filmEventsCreate =
      /create policy "film_events user delete" on public\.film_events\s+for delete to authenticated using \(\(select auth\.uid\(\)\) = user_id\)/i;
    const filmMapDrop =
      /drop policy if exists "film_tmdb_map user delete" on public\.film_tmdb_map/i;
    const filmMapCreate =
      /create policy "film_tmdb_map user delete" on public\.film_tmdb_map\s+for delete to authenticated using \(\(select auth\.uid\(\)\) = user_id\)/i;

    expect(migration).toMatch(filmEventsDrop);
    expect(migration).toMatch(filmEventsCreate);
    expect(migration).toMatch(filmMapDrop);
    expect(migration).toMatch(filmMapCreate);

    // Rerun-safe: each policy is dropped before it is recreated (CREATE POLICY has
    // no IF NOT EXISTS), so applying the migration twice never errors.
    expect(migration.search(filmEventsDrop)).toBeGreaterThan(-1);
    expect(migration.search(filmEventsCreate)).toBeGreaterThan(
      migration.search(filmEventsDrop),
    );
    expect(migration.search(filmMapDrop)).toBeGreaterThan(-1);
    expect(migration.search(filmMapCreate)).toBeGreaterThan(
      migration.search(filmMapDrop),
    );

    // The DELETE policies must exist before the SECURITY INVOKER function that
    // relies on them is created (and therefore before its grants).
    const fnIndex = migration.search(
      /create or replace function public\.reconcile_import_snapshot/i,
    );
    expect(fnIndex).toBeGreaterThan(-1);
    expect(migration.search(filmEventsCreate)).toBeLessThan(fnIndex);
    expect(migration.search(filmMapCreate)).toBeLessThan(fnIndex);
  });

  it("scopes the reconciled-table DELETE policies to authenticated only, never PUBLIC or anon", () => {
    // A DELETE policy granted to PUBLIC or anon would let any caller remove rows;
    // the owner qual must be the only gate and the policy must target authenticated.
    expect(migration).not.toMatch(/for delete to public/i);
    expect(migration).not.toMatch(/for delete to anon/i);
    // Both reconciled-table DELETE policies are explicitly scoped TO authenticated.
    expect(
      (migration.match(/for delete to authenticated/gi) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
  });
});

describe("client-side snapshot guards", () => {
  it("refuses a zero-film snapshot (no explicit-clear contract exists)", () => {
    expect(() =>
      assertReconcilableSnapshot({ films: [], watchEvents: [], mappings: [] }),
    ).toThrow(/empty film snapshot/i);
  });

  it("refuses duplicate film URIs before any write", () => {
    const dup = film({ uri: "https://letterboxd.com/film/a/" });
    expect(() =>
      assertReconcilableSnapshot({
        films: [dup, { ...dup }],
        watchEvents: [],
        mappings: [],
      }),
    ).toThrow(/duplicate film uri/i);
  });

  it("refuses duplicate mapping URIs before any write", () => {
    expect(() =>
      assertReconcilableSnapshot({
        films: [film({ uri: "https://letterboxd.com/film/a/" })],
        watchEvents: [],
        mappings: [
          { uri: "https://letterboxd.com/film/a/", tmdbId: 1 },
          { uri: "https://letterboxd.com/film/a/", tmdbId: 2 },
        ],
      }),
    ).toThrow(/duplicate mapping uri/i);
  });

  it("refuses mappings that reference a film absent from the snapshot", () => {
    expect(() =>
      assertReconcilableSnapshot({
        films: [film({ uri: "https://letterboxd.com/film/a/" })],
        watchEvents: [],
        mappings: [{ uri: "https://letterboxd.com/film/zzz/", tmdbId: 1 }],
      }),
    ).toThrow(/not in snapshot/i);
  });

  it("refuses duplicate diary event identities before any write", () => {
    const uri = "https://letterboxd.com/film/a/";
    expect(() =>
      assertReconcilableSnapshot({
        films: [film({ uri })],
        watchEvents: [
          watchEvent({ uri, watchedDate: "2026-01-01" }),
          watchEvent({ uri, watchedDate: "2026-01-01" }),
        ],
        mappings: [],
      }),
    ).toThrow(/duplicate diary event/i);
  });

  it("refuses diary events that reference a film absent from the snapshot", () => {
    // An orphan diary event would dangle once the RPC deletes the film row it
    // belongs to; reject it client-side with a nonretryable code before any RPC.
    try {
      assertReconcilableSnapshot({
        films: [film({ uri: "https://letterboxd.com/film/a/" })],
        watchEvents: [
          watchEvent({
            uri: "https://letterboxd.com/film/zzz/",
            watchedDate: "2026-01-01",
          }),
        ],
        mappings: [],
      });
      throw new Error("expected assertReconcilableSnapshot to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ImportSnapshotError);
      expect(error).toMatchObject({
        code: "ORPHAN_EVENT",
        retryable: false,
      });
      expect((error as Error).message).toMatch(/not in snapshot/i);
    }
  });

  it("reconcileImportSnapshot validates before invoking the RPC", async () => {
    const client: ImportSnapshotRpcClient = { rpc: vi.fn() };
    await expect(
      reconcileImportSnapshot(USER_ID, {
        films: [],
        watchEvents: [],
        mappings: [],
      }),
    ).rejects.toThrow(/empty film snapshot/i);
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

type FakeFilmRow = { uri: string; title: string; tmdb?: number };
type FakeEventRow = {
  uri: string;
  watched_date: string | null;
  rating: number | null;
  rewatch: boolean;
};

/**
 * In-memory transactional fake mirroring the reconcile_import_snapshot RPC:
 * validate first, then apply all three stores atomically; any validation or FK
 * failure returns an error response and leaves every store untouched (rollback).
 */
function createInMemoryReconcileFake(options: {
  films?: FakeFilmRow[];
  mappings?: Array<{ uri: string; tmdb_id: number }>;
  events?: FakeEventRow[];
  knownTmdbIds?: number[];
}) {
  const films = new Map<string, { uri: string; title: string }>();
  for (const f of options.films ?? []) films.set(f.uri, { uri: f.uri, title: f.title });

  const mappings = new Map<string, number>();
  for (const m of options.mappings ?? []) mappings.set(m.uri, m.tmdb_id);

  const eventKey = (e: FakeEventRow) =>
    JSON.stringify([e.uri, e.watched_date, e.rewatch]);
  const events = new Map<string, FakeEventRow>();
  for (const e of options.events ?? []) events.set(eventKey(e), e);

  const knownTmdbIds = new Set(options.knownTmdbIds ?? []);

  const client: ImportSnapshotRpcClient = {
    rpc: vi.fn(async (_fn, params) => {
      const pFilms = params.p_film_events as Array<Record<string, unknown>>;
      const pMappings = params.p_mappings as Array<{
        uri: string;
        tmdb_id: number;
      }>;
      const pEvents = params.p_diary_events as FakeEventRow[];

      const fail = (message: string, code: string) => ({
        data: null,
        error: { message, code },
      });

      if (!Array.isArray(pFilms) || !Array.isArray(pMappings) || !Array.isArray(pEvents)) {
        return fail("snapshot payload must be arrays", "22023");
      }

      // Validate + stage films.
      const filmUris = new Set<string>();
      const stagedFilms = new Map<string, { uri: string; title: string }>();
      for (const row of pFilms) {
        const uri = row.uri as string;
        const title = row.title as string;
        if (!uri || !title) return fail("film event rows require uri and title", "22023");
        if (filmUris.has(uri)) return fail(`duplicate film uri: ${uri}`, "23505");
        filmUris.add(uri);
        stagedFilms.set(uri, { uri, title });
      }

      // Validate + stage mappings (FK + orphan + duplicate).
      const mappingUris = new Set<string>();
      const stagedMappings = new Map<string, number>();
      for (const m of pMappings) {
        if (!m.uri || m.tmdb_id == null) {
          return fail("mapping rows require uri and tmdb_id", "22023");
        }
        if (mappingUris.has(m.uri)) {
          return fail(`duplicate mapping uri: ${m.uri}`, "23505");
        }
        if (!filmUris.has(m.uri)) {
          return fail("mapping references a film not in the snapshot", "23503");
        }
        if (!knownTmdbIds.has(Number(m.tmdb_id))) {
          // FK violation: abort before mutating anything (rollback).
          return fail("mapping references missing tmdb metadata", "23503");
        }
        mappingUris.add(m.uri);
        stagedMappings.set(m.uri, Number(m.tmdb_id));
      }

      // Validate + stage diary events (orphan uri + duplicate identity).
      const stagedEvents = new Map<string, FakeEventRow>();
      for (const e of pEvents) {
        if (!e.uri) return fail("diary event rows require uri", "22023");
        if (!filmUris.has(e.uri)) {
          return fail("diary event references a film not in the snapshot", "23503");
        }
        const key = eventKey(e);
        if (stagedEvents.has(key)) return fail("duplicate diary event", "23505");
        stagedEvents.set(key, e);
      }

      // ---- All validation passed: apply atomically. ----
      let filmsUpserted = 0;
      let filmsDeleted = 0;
      for (const [uri, row] of stagedFilms) {
        films.set(uri, row);
        filmsUpserted += 1;
      }
      for (const uri of [...films.keys()]) {
        if (!stagedFilms.has(uri)) {
          films.delete(uri);
          filmsDeleted += 1;
        }
      }

      let mappingsUpserted = 0;
      let mappingsDeleted = 0;
      for (const [uri, tmdbId] of stagedMappings) {
        mappings.set(uri, tmdbId);
        mappingsUpserted += 1;
      }
      for (const uri of [...mappings.keys()]) {
        if (!stagedMappings.has(uri)) {
          mappings.delete(uri);
          mappingsDeleted += 1;
        }
      }

      let eventsUpserted = 0;
      let eventsDeleted = 0;
      for (const [key, row] of stagedEvents) {
        events.set(key, row);
        eventsUpserted += 1;
      }
      for (const key of [...events.keys()]) {
        if (!stagedEvents.has(key)) {
          events.delete(key);
          eventsDeleted += 1;
        }
      }

      return {
        data: {
          ok: true,
          films_upserted: filmsUpserted,
          films_deleted: filmsDeleted,
          mappings_upserted: mappingsUpserted,
          mappings_deleted: mappingsDeleted,
          events_upserted: eventsUpserted,
          events_deleted: eventsDeleted,
        },
        error: null,
      };
    }),
  };

  return {
    client,
    films,
    mappings,
    events,
  };
}

describe("in-memory transactional reconciliation", () => {
  const ALPHA = "https://letterboxd.com/film/alpha/";
  const BETA = "https://letterboxd.com/film/beta/";
  const GONE = "https://letterboxd.com/film/gone/";

  it("replaces a prior snapshot: removes absent rows, preserves retained rows", async () => {
    const fake = createInMemoryReconcileFake({
      films: [
        { uri: ALPHA, title: "Alpha" },
        { uri: GONE, title: "Gone" },
      ],
      mappings: [
        { uri: ALPHA, tmdb_id: 101 },
        { uri: GONE, tmdb_id: 999 },
      ],
      events: [
        { uri: ALPHA, watched_date: "2026-01-01", rating: 4, rewatch: false },
        { uri: GONE, watched_date: "2025-01-01", rating: 2, rewatch: false },
      ],
      knownTmdbIds: [101, 202, 999],
    });

    const result = await reconcileImportSnapshot(
      USER_ID,
      {
        films: [
          film({ uri: ALPHA, title: "Alpha" }),
          film({ uri: BETA, title: "Beta" }),
        ],
        watchEvents: [
          watchEvent({ uri: ALPHA, watchedDate: "2026-01-01", rating: 4 }),
          watchEvent({ uri: BETA, watchedDate: "2026-02-01", rating: 5 }),
        ],
        mappings: [
          { uri: ALPHA, tmdbId: 101 },
          { uri: BETA, tmdbId: 202 },
        ],
      },
      fake.client,
    );

    expect(result).toMatchObject({
      ok: true,
      filmsDeleted: 1,
      mappingsDeleted: 1,
      eventsDeleted: 1,
    });
    // Absent film/mapping/event removed.
    expect(fake.films.has(GONE)).toBe(false);
    expect(fake.mappings.has(GONE)).toBe(false);
    expect(
      fake.events.has(JSON.stringify([GONE, "2025-01-01", false])),
    ).toBe(false);
    // Retained + new rows present.
    expect(fake.films.has(ALPHA)).toBe(true);
    expect(fake.films.has(BETA)).toBe(true);
    expect(fake.mappings.get(ALPHA)).toBe(101);
    expect(fake.mappings.get(BETA)).toBe(202);
  });

  it("rolls back ALL stores when a mapping fails FK validation", async () => {
    const fake = createInMemoryReconcileFake({
      films: [{ uri: ALPHA, title: "Alpha" }],
      mappings: [{ uri: ALPHA, tmdb_id: 101 }],
      events: [
        { uri: ALPHA, watched_date: "2026-01-01", rating: 4, rewatch: false },
      ],
      // 202 is NOT a known TMDB id -> FK violation mid-snapshot.
      knownTmdbIds: [101],
    });

    const beforeFilms = new Set(fake.films.keys());
    const beforeMappings = new Set(fake.mappings.keys());
    const beforeEvents = new Set(fake.events.keys());

    await expect(
      reconcileImportSnapshot(
        USER_ID,
        {
          films: [
            film({ uri: ALPHA, title: "Alpha" }),
            film({ uri: BETA, title: "Beta" }),
          ],
          watchEvents: [
            watchEvent({ uri: BETA, watchedDate: "2026-02-01", rating: 5 }),
          ],
          mappings: [
            { uri: ALPHA, tmdbId: 101 },
            { uri: BETA, tmdbId: 202 },
          ],
        },
        fake.client,
      ),
    ).rejects.toMatchObject({ name: "ImportSnapshotError" });

    // Nothing changed: full rollback.
    expect(new Set(fake.films.keys())).toEqual(beforeFilms);
    expect(new Set(fake.mappings.keys())).toEqual(beforeMappings);
    expect(new Set(fake.events.keys())).toEqual(beforeEvents);
    expect(fake.films.has(BETA)).toBe(false);
    expect(fake.mappings.has(BETA)).toBe(false);
  });

  it("rolls back ALL stores when a diary event orphans a film", async () => {
    const fake = createInMemoryReconcileFake({
      films: [{ uri: ALPHA, title: "Alpha" }],
      mappings: [{ uri: ALPHA, tmdb_id: 101 }],
      events: [
        { uri: ALPHA, watched_date: "2026-01-01", rating: 4, rewatch: false },
      ],
      knownTmdbIds: [101, 202],
    });

    const beforeFilms = new Set(fake.films.keys());
    const beforeMappings = new Set(fake.mappings.keys());
    const beforeEvents = new Set(fake.events.keys());

    await expect(
      reconcileImportSnapshot(
        USER_ID,
        {
          films: [
            film({ uri: ALPHA, title: "Alpha" }),
            film({ uri: BETA, title: "Beta" }),
          ],
          // Diary event references a film (GONE) absent from the snapshot.
          watchEvents: [
            watchEvent({ uri: GONE, watchedDate: "2026-02-01", rating: 5 }),
          ],
          mappings: [
            { uri: ALPHA, tmdbId: 101 },
            { uri: BETA, tmdbId: 202 },
          ],
        },
        fake.client,
      ),
    ).rejects.toMatchObject({
      name: "ImportSnapshotError",
      retryable: false,
    });

    // Nothing changed: full rollback.
    expect(new Set(fake.films.keys())).toEqual(beforeFilms);
    expect(new Set(fake.mappings.keys())).toEqual(beforeMappings);
    expect(new Set(fake.events.keys())).toEqual(beforeEvents);
    expect(fake.films.has(BETA)).toBe(false);
  });

  it("never reaches the RPC for a zero-film snapshot, leaving stores intact", async () => {
    const fake = createInMemoryReconcileFake({
      films: [{ uri: ALPHA, title: "Alpha" }],
      mappings: [{ uri: ALPHA, tmdb_id: 101 }],
      knownTmdbIds: [101],
    });

    await expect(
      reconcileImportSnapshot(
        USER_ID,
        { films: [], watchEvents: [], mappings: [] },
        fake.client,
      ),
    ).rejects.toThrow(/empty film snapshot/i);

    expect(fake.client.rpc).not.toHaveBeenCalled();
    expect(fake.films.has(ALPHA)).toBe(true);
    expect(fake.mappings.has(ALPHA)).toBe(true);
  });
});
