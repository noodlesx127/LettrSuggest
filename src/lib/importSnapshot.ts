import { supabase } from "@/lib/supabaseClient";
import {
  serializeFilmEventsForCloud,
  type FilmEvent,
  type WatchEvent,
} from "@/lib/normalize";
import { serializeWatchEvents } from "@/lib/diary";

export type ImportSnapshotMapping = {
  uri: string;
  tmdbId: number;
};

export type ImportSnapshotInput = {
  films: FilmEvent[];
  watchEvents: WatchEvent[];
  mappings: ImportSnapshotMapping[];
};

export type ImportSnapshotCounts = {
  filmsUpserted: number;
  filmsDeleted: number;
  mappingsUpserted: number;
  mappingsDeleted: number;
  eventsUpserted: number;
  eventsDeleted: number;
};

export type ImportSnapshotResult = { ok: true } & ImportSnapshotCounts;

export type ImportSnapshotRpcError = {
  message: string;
  code?: string | null;
};

export type ImportSnapshotRpcResponse = {
  data: unknown;
  error: ImportSnapshotRpcError | null;
};

export type ImportSnapshotRpcClient = {
  rpc: (
    fn: "reconcile_import_snapshot",
    params: Record<string, unknown>,
  ) => Promise<ImportSnapshotRpcResponse>;
};

export type ImportSnapshotPayload = {
  p_film_events: Record<string, unknown>[];
  p_mappings: Array<{ uri: string; tmdb_id: number }>;
  p_diary_events: Array<{
    uri: string;
    watched_date: string | null;
    rating: number | null;
    rewatch: boolean;
  }>;
};

/**
 * Errors raised by snapshot reconciliation. `retryable` distinguishes transient
 * transport/schema-cache failures (worth retrying with the same local input)
 * from fatal validation/integrity failures (the snapshot itself was rejected).
 */
export class ImportSnapshotError extends Error {
  readonly retryable: boolean;
  readonly code: string;

  constructor(
    message: string,
    options: { retryable: boolean; code?: string | null },
  ) {
    super(message);
    this.name = "ImportSnapshotError";
    this.retryable = options.retryable;
    this.code = options.code ?? "IMPORT_SNAPSHOT_ERROR";
  }
}

// Postgres/PostgREST codes that indicate the snapshot was rejected rather than
// a transient transport problem. These must not be retried blindly.
const FATAL_RPC_CODES = new Set([
  "22023", // invalid_parameter_value (snapshot validation)
  "28000", // invalid_authorization_specification (unauthenticated)
  "23502", // not_null_violation
  "23503", // foreign_key_violation (mapping references missing metadata)
  "23505", // unique_violation
  "23514", // check_violation
  "42501", // insufficient_privilege
]);

function isRetryableCode(code?: string | null): boolean {
  if (!code) return true;
  return !FATAL_RPC_CODES.has(code);
}

/**
 * Validate a snapshot before it is reconciled. Fails closed so a destructive
 * full-snapshot replace can never be triggered by an empty or internally
 * inconsistent snapshot. There is no explicit-clear UI contract, so a zero-film
 * snapshot is always rejected. Duplicate URIs/events and orphan mappings are
 * rejected here (and again in the RPC) to avoid nondeterministic ON CONFLICT
 * cardinality failures.
 */
export function assertReconcilableSnapshot(input: ImportSnapshotInput): void {
  if (!Array.isArray(input.films) || input.films.length === 0) {
    throw new ImportSnapshotError("Refusing to reconcile an empty film snapshot", {
      retryable: false,
      code: "EMPTY_SNAPSHOT",
    });
  }

  const filmUris = new Set<string>();
  for (const film of input.films) {
    if (!film.uri) {
      throw new ImportSnapshotError("Film row missing uri", {
        retryable: false,
        code: "INVALID_FILM",
      });
    }
    if (filmUris.has(film.uri)) {
      throw new ImportSnapshotError(`Duplicate film uri in snapshot: ${film.uri}`, {
        retryable: false,
        code: "DUPLICATE_FILM_URI",
      });
    }
    filmUris.add(film.uri);
  }

  const mappingUris = new Set<string>();
  for (const mapping of input.mappings) {
    if (mappingUris.has(mapping.uri)) {
      throw new ImportSnapshotError(`Duplicate mapping uri in snapshot: ${mapping.uri}`, {
        retryable: false,
        code: "DUPLICATE_MAPPING_URI",
      });
    }
    mappingUris.add(mapping.uri);
    if (!filmUris.has(mapping.uri)) {
      throw new ImportSnapshotError(
        `Mapping references film not in snapshot: ${mapping.uri}`,
        { retryable: false, code: "ORPHAN_MAPPING" },
      );
    }
  }

  const eventIds = new Set<string>();
  for (const event of input.watchEvents) {
    if (!filmUris.has(event.uri)) {
      throw new ImportSnapshotError(
        `Diary event references film not in snapshot: ${event.uri}`,
        { retryable: false, code: "ORPHAN_EVENT" },
      );
    }
    const id = JSON.stringify([event.uri, event.watchedDate, event.rewatch]);
    if (eventIds.has(id)) {
      throw new ImportSnapshotError("Duplicate diary event in snapshot", {
        retryable: false,
        code: "DUPLICATE_EVENT",
      });
    }
    eventIds.add(id);
  }
}

/**
 * Serialize the complete current snapshot into the RPC payload. The payload IS
 * the snapshot: any cloud row not represented here is removed by the RPC, so no
 * prior cloud state is merged in.
 */
export function buildImportSnapshotPayload(
  userId: string,
  input: ImportSnapshotInput,
): ImportSnapshotPayload {
  return {
    p_film_events: serializeFilmEventsForCloud(userId, input.films),
    p_mappings: input.mappings.map((mapping) => ({
      uri: mapping.uri,
      tmdb_id: mapping.tmdbId,
    })),
    p_diary_events: serializeWatchEvents(userId, input.watchEvents).map(
      (event) => ({
        uri: event.uri,
        watched_date: event.watched_date,
        rating: event.rating,
        rewatch: event.rewatch,
      }),
    ),
  };
}

function isSafeCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  );
}

/**
 * Validate the structured RPC response. Malformed or non-ok results throw a
 * fatal ImportSnapshotError so a reconciliation can never report success on an
 * unconfirmed or rejected write.
 */
export function validateImportSnapshotResponse(
  data: unknown,
): ImportSnapshotResult {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ImportSnapshotError("Malformed reconciliation response", {
      retryable: false,
      code: "MALFORMED_RESPONSE",
    });
  }

  const record = data as Record<string, unknown>;
  if (record.ok !== true) {
    throw new ImportSnapshotError("Reconciliation did not confirm success", {
      retryable: false,
      code: "RECONCILIATION_NOT_OK",
    });
  }

  const rawCounts: Array<[keyof ImportSnapshotCounts, unknown]> = [
    ["filmsUpserted", record.films_upserted],
    ["filmsDeleted", record.films_deleted],
    ["mappingsUpserted", record.mappings_upserted],
    ["mappingsDeleted", record.mappings_deleted],
    ["eventsUpserted", record.events_upserted],
    ["eventsDeleted", record.events_deleted],
  ];

  const counts = {} as ImportSnapshotCounts;
  for (const [key, value] of rawCounts) {
    if (!isSafeCount(value)) {
      throw new ImportSnapshotError(
        "Reconciliation returned invalid counts",
        { retryable: false, code: "MALFORMED_COUNTS" },
      );
    }
    counts[key] = value;
  }

  return { ok: true, ...counts };
}

function defaultRpcClient(): ImportSnapshotRpcClient {
  if (!supabase) {
    throw new ImportSnapshotError("Supabase not initialized", {
      retryable: false,
      code: "NO_CLIENT",
    });
  }
  return supabase as unknown as ImportSnapshotRpcClient;
}

/**
 * Atomically reconcile the authenticated user's cloud import tables to the
 * supplied snapshot via one transactional RPC. Throws ImportSnapshotError on
 * any RPC, validation, or malformed-response failure so callers can never treat
 * a failed reconciliation as a successful import.
 */
export async function reconcileImportSnapshot(
  userId: string,
  input: ImportSnapshotInput,
  client: ImportSnapshotRpcClient = defaultRpcClient(),
): Promise<ImportSnapshotResult> {
  assertReconcilableSnapshot(input);
  const payload = buildImportSnapshotPayload(userId, input);

  let response: ImportSnapshotRpcResponse;
  try {
    response = await client.rpc("reconcile_import_snapshot", payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Reconciliation request failed";
    throw new ImportSnapshotError(message, { retryable: true });
  }

  if (response.error) {
    throw new ImportSnapshotError(
      response.error.message || "Reconciliation failed",
      {
        retryable: isRetryableCode(response.error.code),
        code: response.error.code ?? "RPC_ERROR",
      },
    );
  }

  return validateImportSnapshotResponse(response.data);
}
