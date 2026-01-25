import { supabase } from "../src/lib/supabaseClient";
import { generateMovieEmbeddingById } from "../src/lib/embeddings";

const BATCH_SIZE = 100;
const MAX_MOVIES = 5000;

type TmdbRow = {
  tmdb_id: number;
  popularity?: number | null;
  vote_count?: number | null;
};

async function getTopTmdbIds(offset: number, limit: number): Promise<number[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("tmdb_movies")
    .select("tmdb_id, popularity, vote_count")
    .order("popularity", { ascending: false })
    .order("vote_count", { ascending: false })
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
  if (!supabase) {
    console.error("[Embeddings] Supabase client not initialized");
    return;
  }

  console.log("[Embeddings] Starting batch generation");
  let processed = 0;
  let offset = 0;

  while (processed < MAX_MOVIES) {
    const ids = await getTopTmdbIds(offset, BATCH_SIZE);
    if (!ids.length) break;

    const toProcess = await filterExistingEmbeddings(ids);
    for (const tmdbId of toProcess) {
      await generateMovieEmbeddingById(tmdbId);
      processed += 1;

      if (processed % 100 === 0) {
        console.log("[Embeddings] Progress", { processed });
      }

      if (processed >= MAX_MOVIES) break;
    }

    offset += BATCH_SIZE;
  }

  console.log("[Embeddings] Completed batch generation", { processed });
}

run().catch((e) => {
  console.error("[Embeddings] Batch generation failed", e);
});
