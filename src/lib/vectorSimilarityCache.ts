import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isCacheValid } from "@/lib/apiCache";
import {
  VECTOR_EMBEDDING_DIMENSIONS,
  VECTOR_EMBEDDING_MODEL_VERSION,
  VECTOR_SIMILARITY_CACHE_VERSION,
  type VectorSimilarityResult,
} from "@/lib/recommendationCandidates";

const VECTOR_SIMILARITY_CACHE_TTL_DAYS = 7;

export type VectorSimilarityCacheEntry = Readonly<{
  tmdbId: number;
  modelVersion: string;
  dimensions: number;
  cacheVersion: string;
  neighborCount: number;
  results: VectorSimilarityResult[];
}>;

export type VectorSimilarityCachePayload = Readonly<{
  tmdb_id: number;
  related_ids: number[];
  related_scores: number[];
  model_version: string;
  embedding_dimensions: number;
  cache_version: string;
  neighbor_count: number;
  cached_at: string;
}>;

export type VectorSimilarityCacheRow = Readonly<{
  related_ids: unknown;
  related_scores: unknown;
  cached_at: unknown;
  model_version: unknown;
  embedding_dimensions: unknown;
  cache_version: unknown;
  neighbor_count: unknown;
}>;

export type VectorSimilarityCacheRowReader = (
  tmdbId: number,
) => Promise<VectorSimilarityCacheRow | null>;

function assertCacheResults(
  results: readonly VectorSimilarityResult[],
): VectorSimilarityResult[] {
  if (
    results.some(
      (result) =>
        !Number.isSafeInteger(result.tmdbId) ||
        result.tmdbId <= 0 ||
        !Number.isFinite(result.similarity),
    )
  ) {
    throw new Error(
      "[Cache] Vector similarity results must contain finite scores and positive TMDB IDs",
    );
  }

  return results.map((result) => ({
    tmdbId: result.tmdbId,
    similarity: result.similarity,
  }));
}

export function createVectorSimilarityCachePayload(
  tmdbId: number,
  results: readonly VectorSimilarityResult[],
  metadata: Readonly<{
    modelVersion?: string;
    dimensions?: number;
      cacheVersion?: string;
      neighborCount?: number;
      cachedAt?: string;
    }> = {},
): VectorSimilarityCachePayload {
  if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) {
    throw new Error("[Cache] Vector similarity cache requires a positive TMDB ID");
  }

  const modelVersion = metadata.modelVersion ?? VECTOR_EMBEDDING_MODEL_VERSION;
  const dimensions = metadata.dimensions ?? VECTOR_EMBEDDING_DIMENSIONS;
  const cacheVersion = metadata.cacheVersion ?? VECTOR_SIMILARITY_CACHE_VERSION;
  const neighborCount = metadata.neighborCount ?? results.length;
  if (
    modelVersion !== VECTOR_EMBEDDING_MODEL_VERSION ||
    dimensions !== VECTOR_EMBEDDING_DIMENSIONS ||
    cacheVersion !== VECTOR_SIMILARITY_CACHE_VERSION ||
    !Number.isSafeInteger(neighborCount) ||
    neighborCount <= 0 ||
    neighborCount < results.length
  ) {
    throw new Error("[Cache] Vector similarity metadata is incompatible");
  }

  const validResults = assertCacheResults(results);
  return {
    tmdb_id: tmdbId,
    related_ids: validResults.map((result) => result.tmdbId),
    related_scores: validResults.map((result) => result.similarity),
    model_version: modelVersion,
    embedding_dimensions: dimensions,
    cache_version: cacheVersion,
    neighbor_count: neighborCount,
    cached_at: metadata.cachedAt ?? new Date().toISOString(),
  };
}

function parseVectorSimilarityCacheRow(
  tmdbId: number,
  row: unknown,
  requiredNeighborCount: number,
  modelVersion: string,
  dimensions: number,
): Omit<VectorSimilarityCacheEntry, "tmdbId"> | null {
  if (!row || typeof row !== "object") return null;
  const data = row as VectorSimilarityCacheRow;
  const neighborCount = data.neighbor_count;

  if (
    typeof data.cached_at !== "string" ||
    data.model_version !== modelVersion ||
    data.embedding_dimensions !== dimensions ||
    data.cache_version !== VECTOR_SIMILARITY_CACHE_VERSION ||
    typeof neighborCount !== "number" ||
    !Number.isSafeInteger(neighborCount) ||
    neighborCount < requiredNeighborCount ||
    !Array.isArray(data.related_ids) ||
    !Array.isArray(data.related_scores) ||
    data.related_ids.length !== data.related_scores.length ||
    data.related_ids.length > neighborCount
  ) {
    return null;
  }

  const results: VectorSimilarityResult[] = [];
  for (let index = 0; index < data.related_ids.length; index += 1) {
    const rawId = data.related_ids[index];
    const rawScore = data.related_scores[index];

    if (
      typeof rawId !== "number" ||
      !Number.isSafeInteger(rawId) ||
      rawId <= 0 ||
      typeof rawScore !== "number" ||
      !Number.isFinite(rawScore)
    ) {
      return null;
    }

    results.push({ tmdbId: rawId, similarity: rawScore });
  }

  return {
    modelVersion,
    dimensions,
    cacheVersion: VECTOR_SIMILARITY_CACHE_VERSION,
    neighborCount,
    results: results.slice(0, requiredNeighborCount),
  };
}

async function readVectorSimilarityCacheRow(
  tmdbId: number,
): Promise<VectorSimilarityCacheRow | null> {
  const { data, error } = await supabaseAdmin
    .from("vector_similarity_cache")
    .select(
      "related_ids, related_scores, cached_at, model_version, embedding_dimensions, cache_version, neighbor_count",
    )
    .eq("tmdb_id", tmdbId)
    .single();

  if (error || !data) return null;
  return data as VectorSimilarityCacheRow;
}

export async function getCachedVectorSimilarity(
  tmdbId: number,
  requiredNeighborCount = 20,
  modelVersion = VECTOR_EMBEDDING_MODEL_VERSION,
  dimensions = VECTOR_EMBEDDING_DIMENSIONS,
  readRow: VectorSimilarityCacheRowReader = readVectorSimilarityCacheRow,
): Promise<VectorSimilarityCacheEntry | null> {
  try {
    if (!Number.isSafeInteger(requiredNeighborCount) || requiredNeighborCount <= 0) {
      return null;
    }

    const data = await readRow(tmdbId);
    if (!data || typeof data.cached_at !== "string") return null;
    if (!isCacheValid(data.cached_at, VECTOR_SIMILARITY_CACHE_TTL_DAYS)) {
      console.log(`[Cache] Vector similarity cache expired for ${tmdbId}`);
      return null;
    }

    const parsed = parseVectorSimilarityCacheRow(
      tmdbId,
      data,
      requiredNeighborCount,
      modelVersion,
      dimensions,
    );
    if (!parsed) {
      console.log(`[Cache] Vector similarity cache row is incompatible for ${tmdbId}`);
      return null;
    }

    console.log(`[Cache] Vector similarity cache HIT for ${tmdbId}`);
    return {
      tmdbId,
      ...parsed,
    };
  } catch (e) {
    console.error("[Cache] Error reading vector similarity cache:", e);
    return null;
  }
}

export async function setCachedVectorSimilarity(
  tmdbId: number,
  results: readonly VectorSimilarityResult[],
  neighborCount = results.length,
): Promise<void> {
  try {
    const payload = createVectorSimilarityCachePayload(tmdbId, results, {
      neighborCount,
    });
    const { error } = await supabaseAdmin
      .from("vector_similarity_cache")
      .upsert(payload, { onConflict: "tmdb_id" });

    if (error) {
      console.error("[Cache] Error writing vector similarity cache:", error);
    } else {
      console.log(
        `[Cache] Vector similarity cache SET for ${tmdbId} (${results.length} results)`,
      );
    }
  } catch (e) {
    console.error("[Cache] Exception writing vector similarity cache:", e);
  }
}
