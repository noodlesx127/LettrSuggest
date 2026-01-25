import { supabase } from "@/lib/supabaseClient";
import { type TMDBMovie, fetchTmdbMovieCached } from "@/lib/enrich";

const OPENAI_EMBEDDINGS_MODEL = "text-embedding-ada-002";
const OPENAI_EMBEDDINGS_DIMENSIONS = 1536;
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
  model_version: string | null;
  created_at?: string;
  updated_at?: string;
};

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

async function getCachedEmbedding(
  tmdbId: number,
  modelVersion: string,
): Promise<number[] | null> {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from("movie_embeddings")
      .select("embedding, model_version")
      .eq("tmdb_id", tmdbId)
      .maybeSingle();

    if (error || !data?.embedding) return null;
    if (data.model_version && data.model_version !== modelVersion) return null;
    return data.embedding as number[];
  } catch (e) {
    console.error("[Embeddings] Cache read failed", e);
    return null;
  }
}

async function setCachedEmbedding(
  tmdbId: number,
  embedding: number[],
  modelVersion: string,
): Promise<void> {
  if (!supabase) return;

  try {
    const payload: MovieEmbeddingRow = {
      tmdb_id: tmdbId,
      embedding,
      model_version: modelVersion,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("movie_embeddings")
      .upsert(payload, { onConflict: "tmdb_id" });

    if (error) {
      console.error("[Embeddings] Cache write failed", error);
    }
  } catch (e) {
    console.error("[Embeddings] Cache write exception", e);
  }
}

function normalizeEmbeddingDimensions(vector: number[]): number[] {
  if (vector.length === OPENAI_EMBEDDINGS_DIMENSIONS) return vector;
  if (vector.length > OPENAI_EMBEDDINGS_DIMENSIONS) {
    return vector.slice(0, OPENAI_EMBEDDINGS_DIMENSIONS);
  }

  const padded = vector.slice();
  while (padded.length < OPENAI_EMBEDDINGS_DIMENSIONS) padded.push(0);
  return padded;
}

export async function generateMovieEmbedding(
  movie: TMDBMovie,
): Promise<number[]> {
  // Server-side only - prevent client-side execution
  if (typeof window !== "undefined") {
    throw new Error("[Embeddings] This function must run server-side only");
  }
  const tmdbId = movie.id;
  const cached = await getCachedEmbedding(tmdbId, OPENAI_EMBEDDINGS_MODEL);
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
    return normalizeEmbeddingDimensions(vector.map((v: number) => Number(v)));
  });

  if (result.length === OPENAI_EMBEDDINGS_DIMENSIONS) {
    await setCachedEmbedding(tmdbId, result, OPENAI_EMBEDDINGS_MODEL);
  }

  return result;
}

export async function generateMovieEmbeddingById(
  tmdbId: number,
): Promise<number[]> {
  const cached = await getCachedEmbedding(tmdbId, OPENAI_EMBEDDINGS_MODEL);
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
