import { supabase } from "@/lib/supabaseClient";
import { isCacheValid } from "@/lib/apiCache";

const VECTOR_SIMILARITY_CACHE_TTL_DAYS = 7;

export async function getCachedVectorSimilarity(
  tmdbId: number,
): Promise<number[] | null> {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from("vector_similarity_cache")
      .select("related_ids, cached_at")
      .eq("tmdb_id", tmdbId)
      .single();

    if (error || !data) return null;
    if (!isCacheValid(data.cached_at, VECTOR_SIMILARITY_CACHE_TTL_DAYS)) {
      console.log(`[Cache] Vector similarity cache expired for ${tmdbId}`);
      return null;
    }

    console.log(`[Cache] Vector similarity cache HIT for ${tmdbId}`);
    return data.related_ids as number[];
  } catch (e) {
    console.error("[Cache] Error reading vector similarity cache:", e);
    return null;
  }
}

export async function setCachedVectorSimilarity(
  tmdbId: number,
  relatedIds: number[],
): Promise<void> {
  if (!supabase) return;

  try {
    const { error } = await supabase.from("vector_similarity_cache").upsert({
      tmdb_id: tmdbId,
      related_ids: relatedIds,
      cached_at: new Date().toISOString(),
    });

    if (error) {
      console.error("[Cache] Error writing vector similarity cache:", error);
    } else {
      console.log(
        `[Cache] Vector similarity cache SET for ${tmdbId} (${relatedIds.length} IDs)`,
      );
    }
  } catch (e) {
    console.error("[Cache] Exception writing vector similarity cache:", e);
  }
}
