import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  VECTOR_EMBEDDING_DIMENSIONS,
  VECTOR_EMBEDDING_MODEL_VERSION,
  generateMovieEmbeddingWithPersistence,
  isEmbeddingCompletionConfirmed,
  validateEmbeddingVector,
} from "../src/lib/embeddings";
import type { TMDBMovie } from "../src/lib/enrich";
import { getSupabaseAdmin } from "../src/lib/supabaseAdmin";

const BATCH_SIZE = 100;
const MAX_MOVIES = 5000;
const TMDB_FETCH_TIMEOUT_MS = 10000;
const BACKFILL_SOURCE_KEY = "movie_embeddings";

export type BackfillStatus = "running" | "partial" | "failed" | "complete";

export type BackfillState = {
  ownerRunId: string;
  status: BackfillStatus;
  expectedCount: number;
  completedCount: number;
  failureCount: number;
  startedAt: string;
  completedAt: string | null;
};

export type BackfillPage = {
  ids: number[];
  failed: boolean;
};

export type ExistingEmbeddingCheck = {
  toProcess: number[];
  compatibleCount: number;
  failed: boolean;
};

export type EmbeddingBackfillDependencies = {
  claimBackfillOwnership: (
    ownerRunId: string,
    startedAt: string,
  ) => Promise<boolean>;
  persistBackfillState: (state: BackfillState) => Promise<boolean>;
  getTopTmdbIds: (offset: number, limit: number) => Promise<BackfillPage>;
  filterExistingEmbeddings: (ids: number[]) => Promise<ExistingEmbeddingCheck>;
  fetchTmdbMovie: (id: number) => Promise<TMDBMovie | null>;
  generateMovieEmbeddingWithPersistence: (
    movie: TMDBMovie,
  ) => Promise<{ embedding: number[]; persisted: boolean }>;
  runId?: string;
  now?: () => string;
};

export type EmbeddingBackfillResult = {
  status: BackfillStatus | "aborted";
  expectedCount: number;
  completedCount: number;
  failureCount: number;
  initialStatePersisted: boolean;
  finalStatePersisted: boolean;
  success: boolean;
};

type TmdbRow = {
  tmdb_id: number;
};

export type ExistingEmbeddingRow = {
  tmdb_id: number;
  embedding: unknown;
  model_version: string | null;
  embedding_dimensions: number | null;
};

function parseEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    if (
      !value.every(
        (item): item is number =>
          typeof item === "number" && Number.isFinite(item),
      )
    ) {
      return null;
    }
    return [...value];
  }

  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;

  const contents = trimmed.slice(1, -1).trim();
  if (!contents) return [];
  const values = contents.split(",").map((item) => item.trim());
  if (values.some((item) => item.length === 0)) return null;
  const parsed = values.map((item) => Number(item));
  return parsed.every((item) => Number.isFinite(item)) ? parsed : null;
}

export function isCompatibleEmbeddingRow(row: ExistingEmbeddingRow): boolean {
  const embedding = parseEmbedding(row.embedding);
  return (
    row.model_version === VECTOR_EMBEDDING_MODEL_VERSION &&
    row.embedding_dimensions === VECTOR_EMBEDDING_DIMENSIONS &&
    embedding !== null &&
    embedding.length === VECTOR_EMBEDDING_DIMENSIONS &&
    embedding.every((value) => Number.isFinite(value))
  );
}

async function persistBackfillState(state: BackfillState): Promise<boolean> {
  try {
    const { count, error } = await getSupabaseAdmin()
      .from("vector_embedding_backfill")
      .update(
        {
          model_version: VECTOR_EMBEDDING_MODEL_VERSION,
          embedding_dimensions: VECTOR_EMBEDDING_DIMENSIONS,
          status: state.status,
          expected_count: state.expectedCount,
          completed_count: state.completedCount,
          failure_count: state.failureCount,
          started_at: state.startedAt,
          completed_at: state.completedAt,
          updated_at: new Date().toISOString(),
        },
        { count: "exact" },
      )
      .eq("source_key", BACKFILL_SOURCE_KEY)
      .eq("owner_run_id", state.ownerRunId);

    if (error) {
      console.error("[Embeddings] Failed to persist backfill state", error);
      return false;
    }
    if (count !== 1) {
      console.error("[Embeddings] Backfill ownership was lost");
      return false;
    }
    return true;
  } catch (error) {
    console.error("[Embeddings] Backfill state write failed", error);
    return false;
  }
}

async function claimBackfillOwnership(
  ownerRunId: string,
  startedAt: string,
): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc(
      "claim_vector_embedding_backfill",
      {
        p_source_key: BACKFILL_SOURCE_KEY,
        p_owner_run_id: ownerRunId,
        p_model_version: VECTOR_EMBEDDING_MODEL_VERSION,
        p_embedding_dimensions: VECTOR_EMBEDDING_DIMENSIONS,
        p_started_at: startedAt,
      },
    );

    if (error) {
      console.error("[Embeddings] Failed to claim backfill ownership", error);
      return false;
    }
    return data === true;
  } catch (error) {
    console.error("[Embeddings] Backfill ownership claim failed", error);
    return false;
  }
}

async function persistStateSafely(
  persist: EmbeddingBackfillDependencies["persistBackfillState"],
  state: BackfillState,
): Promise<boolean> {
  try {
    return await persist(state);
  } catch {
    console.error("[Embeddings] Backfill state write failed");
    return false;
  }
}

async function claimOwnershipSafely(
  claim: EmbeddingBackfillDependencies["claimBackfillOwnership"],
  ownerRunId: string,
  startedAt: string,
): Promise<boolean> {
  try {
    return await claim(ownerRunId, startedAt);
  } catch {
    console.error("[Embeddings] Backfill ownership claim failed");
    return false;
  }
}

/**
 * Run the backfill lifecycle with all external work supplied as dependencies.
 * The initial database claim owns the expensive work, and all later lifecycle
 * writes remain scoped to that owner. A run is successful only when its final
 * marker is both complete and persisted.
 */
export async function runEmbeddingBackfill(
  dependencies: EmbeddingBackfillDependencies,
): Promise<EmbeddingBackfillResult> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const ownerRunId = dependencies.runId ?? randomUUID();
  const startedAt = now();
  const initialStatePersisted = await claimOwnershipSafely(
    dependencies.claimBackfillOwnership,
    ownerRunId,
    startedAt,
  );

  if (!initialStatePersisted) {
    return {
      status: "aborted",
      expectedCount: 0,
      completedCount: 0,
      failureCount: 0,
      initialStatePersisted: false,
      finalStatePersisted: false,
      success: false,
    };
  }

  const expectedIds = new Set<number>();
  let completedCount = 0;
  let failureCount = 0;
  let markerWriteFailed = false;
  let offset = 0;

  while (expectedIds.size < MAX_MOVIES) {
    const page = await dependencies.getTopTmdbIds(offset, BATCH_SIZE);
    if (page.failed) {
      failureCount += 1;
      break;
    }
    if (!page.ids.length) break;

    const pageSeen = new Set<number>();
    const ids = page.ids.filter((id) => {
      if (expectedIds.has(id) || pageSeen.has(id)) return false;
      pageSeen.add(id);
      return true;
    });
    const pageIds = ids.slice(0, MAX_MOVIES - expectedIds.size);
    for (const id of pageIds) expectedIds.add(id);

    if (!pageIds.length) {
      offset += BATCH_SIZE;
      continue;
    }

    const existing = await dependencies.filterExistingEmbeddings(pageIds);
    if (existing.failed) {
      failureCount += pageIds.length;
      break;
    }
    completedCount += existing.compatibleCount;

    for (const tmdbId of existing.toProcess) {
      try {
        const movie = await dependencies.fetchTmdbMovie(tmdbId);
        if (!movie) {
          console.warn("[Embeddings] Skipping movie (no TMDB data)", {
            tmdbId,
          });
          failureCount += 1;
          continue;
        }

        const { embedding, persisted } =
          await dependencies.generateMovieEmbeddingWithPersistence(movie);
        validateEmbeddingVector(embedding, VECTOR_EMBEDDING_DIMENSIONS);
        if (!isEmbeddingCompletionConfirmed(embedding, persisted)) {
          throw new Error(
            "[Embeddings] Compatible embedding persistence could not be confirmed",
          );
        }
        completedCount += 1;

        if ((completedCount + failureCount) % 100 === 0) {
          console.log("[Embeddings] Progress", {
            completed: completedCount,
            failed: failureCount,
          });
        }
      } catch (error) {
        failureCount += 1;
        console.error("[Embeddings] Failed to process movie", {
          tmdbId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const progressPersisted = await persistStateSafely(
      dependencies.persistBackfillState,
      {
        ownerRunId,
        status: "running",
        expectedCount: expectedIds.size,
        completedCount,
        failureCount,
        startedAt,
        completedAt: null,
      },
    );
    if (!progressPersisted) {
      markerWriteFailed = true;
      break;
    }
    offset += BATCH_SIZE;
    if (page.ids.length < BATCH_SIZE) break;
  }

  const expectedCount = expectedIds.size;
  const coverageComplete =
    expectedCount > 0 &&
    completedCount === expectedCount &&
    failureCount === 0 &&
    !markerWriteFailed;
  const status: BackfillStatus = coverageComplete
    ? "complete"
    : failureCount > 0 || markerWriteFailed
      ? "failed"
      : "partial";
  const finalState: BackfillState = {
    ownerRunId,
    status,
    expectedCount,
    completedCount,
    failureCount,
    startedAt,
    completedAt: coverageComplete ? now() : null,
  };
  const finalStatePersisted = await persistStateSafely(
    dependencies.persistBackfillState,
    finalState,
  );
  const reportedStatus: BackfillStatus = finalStatePersisted
    ? status
    : "failed";

  return {
    status: reportedStatus,
    expectedCount,
    completedCount,
    failureCount,
    initialStatePersisted,
    finalStatePersisted,
    success: reportedStatus === "complete",
  };
}

/**
 * Fetch movie details directly from the TMDB REST API.
 * This bypasses the Next.js /api/tmdb/movie route which requires a running
 * dev server — essential for standalone script usage.
 */
async function fetchTmdbMovieDirect(
  id: number,
  apiKey: string,
): Promise<TMDBMovie | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TMDB_FETCH_TIMEOUT_MS);

  try {
    const appendToResponse = "credits,keywords,videos,similar,recommendations";
    const url = `https://api.themoviedb.org/3/movie/${encodeURIComponent(id)}?api_key=${apiKey}&append_to_response=${appendToResponse}`;

    const r = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!r.ok) {
      if (r.status === 404) return null;
      const text = await r.text().catch(() => "");
      console.error("[Embeddings] TMDB API error", {
        id,
        status: r.status,
        body: text.slice(0, 200),
      });
      return null;
    }

    const data = (await r.json()) as TMDBMovie;
    return data;
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      console.error("[Embeddings] TMDB fetch timed out", { id });
    } else {
      console.error("[Embeddings] TMDB fetch failed", { id, error: e });
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function getTopTmdbIds(
  offset: number,
  limit: number,
): Promise<{ ids: number[]; failed: boolean }> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("tmdb_movies")
      .select("tmdb_id")
      .order("imdb_votes", { ascending: false })
      .order("imdb_rating", { ascending: false })
      .order("tmdb_id", { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error("[Embeddings] Failed to query tmdb_movies", error);
      return { ids: [], failed: true };
    }

    return {
      ids: (data as TmdbRow[])
        .map((row) => Number(row.tmdb_id))
        .filter((id) => Number.isSafeInteger(id) && id > 0),
      failed: false,
    };
  } catch (error) {
    console.error("[Embeddings] Failed to query tmdb_movies", error);
    return { ids: [], failed: true };
  }
}

async function filterExistingEmbeddings(
  ids: number[],
): Promise<{ toProcess: number[]; compatibleCount: number; failed: boolean }> {
  if (ids.length === 0) {
    return { toProcess: [], compatibleCount: 0, failed: false };
  }

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("movie_embeddings")
      .select("tmdb_id, embedding, model_version, embedding_dimensions")
      .in("tmdb_id", ids);

    if (error) {
      console.error("[Embeddings] Failed to check embeddings", error);
      return { toProcess: ids, compatibleCount: 0, failed: true };
    }

    const compatible = new Set(
      ((data ?? []) as ExistingEmbeddingRow[])
        .filter(isCompatibleEmbeddingRow)
        .map((row) => Number(row.tmdb_id)),
    );
    return {
      toProcess: ids.filter((id) => !compatible.has(id)),
      compatibleCount: compatible.size,
      failed: false,
    };
  } catch (error) {
    console.error("[Embeddings] Failed to check embeddings", error);
    return { toProcess: ids, compatibleCount: 0, failed: true };
  }
}

async function run() {
  // ── Validate required environment variables ──────────────────────────
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      "[Embeddings] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY " +
        "are required for durable embedding backfill state",
    );
  }

  const tmdbApiKey = process.env.TMDB_API_KEY;
  if (!tmdbApiKey) {
    throw new Error(
      "[Embeddings] TMDB_API_KEY is not set in .env.local. " +
        "Cannot fetch movie data.",
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    console.warn(
      "[Embeddings] OPENAI_API_KEY is not set — generated embeddings will fail " +
        "and the backfill cannot claim completion.",
    );
  }

  // ── Batch processing ─────────────────────────────────────────────────
  console.log("[Embeddings] Starting batch generation");
  const result = await runEmbeddingBackfill({
    claimBackfillOwnership,
    persistBackfillState,
    getTopTmdbIds,
    filterExistingEmbeddings,
    fetchTmdbMovie: (id) => fetchTmdbMovieDirect(id, tmdbApiKey),
    generateMovieEmbeddingWithPersistence,
  });

  console.log("[Embeddings] Completed batch generation", {
    ...result,
  });

  if (!result.success) {
    throw new Error(
      `[Embeddings] Backfill did not complete successfully (status: ${result.status})`,
    );
  }
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  return (
    entryPoint !== undefined &&
    pathToFileURL(resolve(entryPoint)).href === import.meta.url
  );
}

if (isMainModule()) {
  run().catch(() => {
    // Keep failures non-zero without echoing environment values or API errors.
    console.error("[Embeddings] Unexpected fatal error");
    process.exitCode = 1;
  });
}
