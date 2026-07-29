import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { type TMDBMovie, fetchTmdbMovieCached } from "@/lib/enrich";
import {
  VECTOR_EMBEDDING_DIMENSIONS,
  VECTOR_EMBEDDING_MODEL_VERSION,
} from "@/lib/recommendationCandidates";

export {
  VECTOR_EMBEDDING_DIMENSIONS,
  VECTOR_EMBEDDING_MODEL_VERSION,
} from "@/lib/recommendationCandidates";

const OPENAI_EMBEDDINGS_MODEL = VECTOR_EMBEDDING_MODEL_VERSION;
const OPENAI_EMBEDDINGS_DIMENSIONS = VECTOR_EMBEDDING_DIMENSIONS;
const EMBEDDING_RATE_LIMIT_PER_MINUTE = 3000;
const EMBEDDING_CONCURRENCY = 10;
const EMBEDDING_TIMEOUT_MS = 12000;
const EMBEDDING_MAX_ATTEMPTS = 4;

const limiter = pLimit(EMBEDDING_CONCURRENCY);
const rateLimit = createRateLimiter(
  Math.ceil(60000 / EMBEDDING_RATE_LIMIT_PER_MINUTE),
);

type MovieEmbeddingRow = {
  tmdb_id: number;
  embedding: number[];
  model_version: string;
  embedding_dimensions: number;
  created_at?: string;
  updated_at?: string;
};

export type EmbeddingCacheRow = Readonly<{
  embedding: unknown;
  model_version: unknown;
  embedding_dimensions: unknown;
}>;

export type EmbeddingCacheRowReader = (
  tmdbId: number,
) => Promise<EmbeddingCacheRow | null>;

function pLimit(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    active -= 1;
    const resolve = queue.shift();
    if (resolve) resolve();
  };

  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }

    active += 1;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}

function createRateLimiter(intervalMs: number) {
  let lastTime = 0;
  let chain = Promise.resolve();

  return async function waitTurn() {
    chain = chain.then(async () => {
      const now = Date.now();
      const waitMs = Math.max(0, intervalMs - (now - lastTime));
      if (waitMs > 0) await sleep(waitMs);
      lastTime = Date.now();
    });

    await chain;
  };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: { timeoutMs: number; maxAttempts: number },
): Promise<Response> {
  let lastStatus: number | undefined;
  let lastBody = "";
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

    try {
      const r = await fetch(url, { ...init, signal: controller.signal });
      lastStatus = r.status;
      if (r.ok) return r;

      lastBody = await r.text().catch(() => "");
      const retryable =
        r.status === 429 ||
        r.status === 500 ||
        r.status === 502 ||
        r.status === 503 ||
        r.status === 504;

      if (!retryable || attempt === opts.maxAttempts) return r;

      const ra = r.headers.get("retry-after");
      const retryAfterMs =
        ra && !Number.isNaN(Number(ra)) ? Math.max(0, Number(ra) * 1000) : 0;
      const backoffMs =
        Math.min(4000, 250 * Math.pow(2, attempt - 1)) +
        Math.floor(Math.random() * 200);
      await sleep(Math.max(retryAfterMs, backoffMs));
    } catch (e) {
      lastError = e;
      if (attempt === opts.maxAttempts) break;
      const backoffMs =
        Math.min(4000, 250 * Math.pow(2, attempt - 1)) +
        Math.floor(Math.random() * 200);
      await sleep(backoffMs);
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    ok: false,
    status: lastStatus ?? 502,
    text: async () => lastBody,
    json: async () => ({
      error: "OpenAI request failed",
      status: lastStatus ?? 502,
      body: lastBody,
      exception: String((lastError as any)?.message ?? lastError ?? ""),
    }),
    headers: new Headers(),
  } as unknown as Response;
}

function buildEmbeddingInput(movie: TMDBMovie): string {
  const title = (movie.title || "").trim();
  const overview = (movie.overview || "").trim();
  const genres = (movie.genres || [])
    .map((g) => g.name)
    .filter(Boolean)
    .slice(0, 5);
  const keywords = (movie.keywords?.keywords || movie.keywords?.results || [])
    .map((k) => k.name)
    .filter(Boolean)
    .slice(0, 10);
  const directors = (movie.credits?.crew || [])
    .filter((c) => c.job?.toLowerCase() === "director")
    .map((c) => c.name)
    .filter(Boolean)
    .slice(0, 2);
  const actors = (movie.credits?.cast || [])
    .slice(0, 5)
    .map((c) => c.name)
    .filter(Boolean);

  const parts = [
    title ? `${title}:` : "",
    overview ? overview : "",
    directors.length ? `Directed by ${directors.join(", ")}.` : "",
    actors.length ? `Starring ${actors.join(", ")}.` : "",
    genres.length ? `Genres: ${genres.join(", ")}.` : "",
    keywords.length ? `Keywords: ${keywords.join(", ")}.` : "",
  ];

  return parts.filter(Boolean).join(" ").trim();
}

function parseEmbeddingVector(value: unknown): number[] | null {
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
  const tokens = contents.split(",").map((token) => token.trim());
  if (tokens.some((token) => token.length === 0)) return null;

  const parsed = tokens.map((token) => Number(token));
  return parsed.every((item) => Number.isFinite(item)) ? parsed : null;
}

async function readCachedEmbeddingRow(
  tmdbId: number,
): Promise<EmbeddingCacheRow | null> {
  const { data, error } = await supabaseAdmin
    .from("movie_embeddings")
    .select("embedding, model_version, embedding_dimensions")
    .eq("tmdb_id", tmdbId)
    .maybeSingle();

  if (error || !data) return null;
  return data as EmbeddingCacheRow;
}

async function getCachedEmbedding(
  tmdbId: number,
  modelVersion: string,
  dimensions: number,
): Promise<number[] | null> {
  try {
    const row = await readCachedEmbeddingRow(tmdbId);
    if (!row?.embedding) return null;
    if (row.model_version !== modelVersion) return null;
    if (row.embedding_dimensions !== dimensions) return null;

    const embedding = parseEmbeddingVector(row.embedding);
    if (!embedding) return null;
    return validateEmbeddingVector(embedding, dimensions);
  } catch (e) {
    console.error("[Embeddings] Cache read failed", e);
    return null;
  }
}

async function setCachedEmbedding(
  tmdbId: number,
  embedding: number[],
  modelVersion: string,
): Promise<boolean> {
  try {
    const compatibleEmbedding = validateEmbeddingVector(
      embedding,
      OPENAI_EMBEDDINGS_DIMENSIONS,
    );
    const payload: MovieEmbeddingRow = {
      tmdb_id: tmdbId,
      embedding: compatibleEmbedding,
      model_version: modelVersion,
      embedding_dimensions: OPENAI_EMBEDDINGS_DIMENSIONS,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabaseAdmin
      .from("movie_embeddings")
      .upsert(payload, { onConflict: "tmdb_id" });

    if (error) {
      console.error("[Embeddings] Cache write failed", error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[Embeddings] Cache write exception", e);
    return false;
  }
}

export function validateEmbeddingVector(
  vector: readonly number[],
  expectedDimensions = OPENAI_EMBEDDINGS_DIMENSIONS,
): number[] {
  if (
    !Array.isArray(vector) ||
    vector.length !== expectedDimensions ||
    !vector.every(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
    )
  ) {
    throw new Error(
      `[Embeddings] Incompatible embedding vector: expected ${expectedDimensions} finite values, received ${vector.length}`,
    );
  }

  return [...vector];
}

export function isEmbeddingCompletionConfirmed(
  embedding: readonly number[],
  persistenceConfirmed: boolean,
): boolean {
  return (
    persistenceConfirmed &&
    Array.isArray(embedding) &&
    embedding.length === OPENAI_EMBEDDINGS_DIMENSIONS &&
    embedding.every(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
    )
  );
}

export async function isEmbeddingPersisted(
  tmdbId: number,
  expectedEmbedding: readonly number[],
  readRow: EmbeddingCacheRowReader = readCachedEmbeddingRow,
): Promise<boolean> {
  try {
    if (!isEmbeddingCompletionConfirmed(expectedEmbedding, true)) return false;

    const row = await readRow(tmdbId);
    if (
      !row ||
      row.model_version !== OPENAI_EMBEDDINGS_MODEL ||
      row.embedding_dimensions !== OPENAI_EMBEDDINGS_DIMENSIONS
    ) {
      return false;
    }

    const persistedEmbedding = parseEmbeddingVector(row.embedding);
    return (
      persistedEmbedding !== null &&
      persistedEmbedding.length === expectedEmbedding.length &&
      persistedEmbedding.every(
        (value, index) =>
          Math.fround(value) === Math.fround(expectedEmbedding[index]),
      )
    );
  } catch (e) {
    console.error("[Embeddings] Persistence verification failed", e);
    return false;
  }
}

export async function generateMovieEmbeddingWithPersistence(
  movie: TMDBMovie,
): Promise<{ embedding: number[]; persisted: boolean }> {
  const embedding = await generateMovieEmbedding(movie);
  const persisted = isEmbeddingCompletionConfirmed(embedding, true)
    ? await isEmbeddingPersisted(movie.id, embedding)
    : false;

  return { embedding, persisted };
}

export async function generateMovieEmbedding(
  movie: TMDBMovie,
): Promise<number[]> {
  // Server-side only - prevent client-side execution
  if (typeof window !== "undefined") {
    throw new Error("[Embeddings] This function must run server-side only");
  }
  const tmdbId = movie.id;
  const cached = await getCachedEmbedding(
    tmdbId,
    OPENAI_EMBEDDINGS_MODEL,
    OPENAI_EMBEDDINGS_DIMENSIONS,
  );
  if (cached) return cached;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[Embeddings] OPENAI_API_KEY not configured");
    return [];
  }

  const input = buildEmbeddingInput(movie);
  if (!input) return [];

  const result = await limiter(async () => {
    await rateLimit();

    const r = await fetchWithRetry(
      "https://api.openai.com/v1/embeddings",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: OPENAI_EMBEDDINGS_MODEL,
          input,
        }),
      },
      { timeoutMs: EMBEDDING_TIMEOUT_MS, maxAttempts: EMBEDDING_MAX_ATTEMPTS },
    );

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      console.error("[Embeddings] OpenAI error", {
        status: r.status,
        body: text,
      });
      return [] as number[];
    }

    const data = await r.json();
    const vector = data?.data?.[0]?.embedding;
    if (!Array.isArray(vector)) return [];
    return validateEmbeddingVector(
      vector.map((v: number) => Number(v)),
      OPENAI_EMBEDDINGS_DIMENSIONS,
    );
  });

  if (result.length === OPENAI_EMBEDDINGS_DIMENSIONS) {
    await setCachedEmbedding(tmdbId, result, OPENAI_EMBEDDINGS_MODEL);
  }

  return result;
}

export async function generateMovieEmbeddingById(
  tmdbId: number,
): Promise<number[]> {
  const cached = await getCachedEmbedding(
    tmdbId,
    OPENAI_EMBEDDINGS_MODEL,
    OPENAI_EMBEDDINGS_DIMENSIONS,
  );
  if (cached) return cached;

  const movie = await fetchTmdbMovieCached(tmdbId);
  if (!movie) return [];
  return generateMovieEmbedding(movie);
}

export async function generateEmbeddingsBatch(
  tmdbIds: number[],
): Promise<Map<number, number[]>> {
  const unique = Array.from(new Set(tmdbIds)).filter(Boolean);
  const results = new Map<number, number[]>();

  for (const tmdbId of unique) {
    const embedding = await generateMovieEmbeddingById(tmdbId);
    if (embedding.length === OPENAI_EMBEDDINGS_DIMENSIONS) {
      results.set(tmdbId, embedding);
    }
  }

  return results;
}
