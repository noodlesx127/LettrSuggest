import { supabase } from "../src/lib/supabaseClient";
import { generateMovieEmbedding } from "../src/lib/embeddings";
import type { TMDBMovie } from "../src/lib/enrich";

const BATCH_SIZE = 100;
const MAX_MOVIES = 5000;
const TMDB_FETCH_TIMEOUT_MS = 10000;

type TmdbRow = {
  tmdb_id: number;
};

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

async function getTopTmdbIds(offset: number, limit: number): Promise<number[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("tmdb_movies")
    .select("tmdb_id")
    .order("imdb_votes", { ascending: false })
    .order("imdb_rating", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[Embeddings] Failed to query tmdb_movies", error);
    return [];
  }

  return (data as TmdbRow[]).map((row) => Number(row.tmdb_id)).filter(Boolean);
}

async function filterExistingEmbeddings(ids: number[]): Promise<number[]> {
  if (!supabase || ids.length === 0) return ids;

  const { data, error } = await supabase
    .from("movie_embeddings")
    .select("tmdb_id")
    .in("tmdb_id", ids);

  if (error) {
    console.error("[Embeddings] Failed to check embeddings", error);
    return ids;
  }

  const existing = new Set((data ?? []).map((row) => Number(row.tmdb_id)));
  return ids.filter((id) => !existing.has(id));
}

async function run() {
  // ── Validate required environment variables ──────────────────────────
  if (!supabase) {
    console.error(
      "[Embeddings] Supabase client not initialized. " +
        "Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY " +
        "are set in .env.local",
    );
    return;
  }

  const tmdbApiKey = process.env.TMDB_API_KEY;
  if (!tmdbApiKey) {
    console.error(
      "[Embeddings] TMDB_API_KEY is not set in .env.local. " +
        "Cannot fetch movie data.",
    );
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error(
      "[Embeddings] OPENAI_API_KEY is not set in .env.local. " +
        "Cannot generate embeddings.",
    );
    return;
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn(
      "[Embeddings] SUPABASE_SERVICE_ROLE_KEY is not set. " +
        "Embedding cache reads/writes will be skipped (embeddings will " +
        "still be generated but not persisted to movie_embeddings table).",
    );
  }

  // ── Batch processing ─────────────────────────────────────────────────
  console.log("[Embeddings] Starting batch generation");
  let processed = 0;
  let failed = 0;
  let offset = 0;

  while (processed < MAX_MOVIES) {
    const ids = await getTopTmdbIds(offset, BATCH_SIZE);
    if (!ids.length) break;

    const toProcess = await filterExistingEmbeddings(ids);
    for (const tmdbId of toProcess) {
      try {
        // Fetch movie data directly from TMDB API (no localhost API route)
        const movie = await fetchTmdbMovieDirect(tmdbId, tmdbApiKey);
        if (!movie) {
          console.warn("[Embeddings] Skipping movie (no TMDB data)", {
            tmdbId,
          });
          failed += 1;
          continue;
        }

        await generateMovieEmbedding(movie);
        processed += 1;

        if ((processed + failed) % 100 === 0) {
          console.log("[Embeddings] Progress", { processed, failed });
        }
      } catch (e) {
        failed += 1;
        console.error("[Embeddings] Failed to process movie", {
          tmdbId,
          error: e instanceof Error ? e.message : String(e),
        });
      }

      if (processed >= MAX_MOVIES) break;
    }

    offset += BATCH_SIZE;
  }

  console.log("[Embeddings] Completed batch generation", { processed, failed });
}

run().catch((e) => {
  console.error("[Embeddings] Unexpected fatal error", e);
  process.exit(1);
});
