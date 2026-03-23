import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { generateMovieEmbeddingById } from "@/lib/embeddings";
import {
  getCachedVectorSimilarity,
  setCachedVectorSimilarity,
} from "@/lib/vectorSimilarityCache";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

type SimilarityResult = {
  tmdbId: number;
  similarity: number;
};

async function getNeighborIds(
  embedding: number[],
  limit: number,
): Promise<SimilarityResult[]> {
  try {
    const { data, error } = await supabaseAdmin.rpc("match_movie_embeddings", {
      query_embedding: embedding,
      match_count: limit,
    });

    if (!error && Array.isArray(data)) {
      return data.map((row: any) => ({
        tmdbId: Number(row.tmdb_id),
        similarity: Number(row.similarity ?? 0),
      }));
    }
  } catch (e) {
    console.error("[VectorSimilarity] RPC match failed", e);
  }

  return [];
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const tmdbIds = Array.isArray(body?.tmdbIds)
      ? body.tmdbIds
          .map((id: any) => Number(id))
          .filter((id: number) => Number.isInteger(id) && id > 0)
      : [];

    // Validate array length to prevent DoS
    if (tmdbIds.length > 50) {
      return NextResponse.json(
        { error: "Too many tmdbIds (max 50)" },
        { status: 400 },
      );
    }
    const limitRaw = Number(body?.limit ?? DEFAULT_LIMIT);
    const limit = Math.min(MAX_LIMIT, Math.max(1, limitRaw || DEFAULT_LIMIT));

    // TODO: add rate limiting for this endpoint

    if (!tmdbIds.length) {
      return NextResponse.json(
        { ok: false, error: "Missing tmdbIds" },
        { status: 400 },
      );
    }

    console.log("[VectorSimilarity] Request", {
      seedCount: tmdbIds.length,
      limit,
    });

    const aggregated = new Map<number, { score: number; count: number }>();

    for (const tmdbId of tmdbIds) {
      const cachedNeighbors = await getCachedVectorSimilarity(tmdbId);
      let neighbors: SimilarityResult[] = [];

      if (cachedNeighbors) {
        neighbors = cachedNeighbors.map((id) => ({
          tmdbId: id,
          similarity: 0,
        }));
      } else {
        const embedding = await generateMovieEmbeddingById(tmdbId);
        if (!embedding.length) {
          console.log("[VectorSimilarity] Missing embedding", { tmdbId });
          continue;
        }

        try {
          neighbors = await getNeighborIds(embedding, limit);
          await setCachedVectorSimilarity(
            tmdbId,
            neighbors.map((n) => n.tmdbId),
          );
        } catch (e) {
          console.error("[VectorSimilarity] Neighbor lookup failed", e);
          neighbors = [];
        }
      }

      for (const neighbor of neighbors) {
        if (neighbor.tmdbId === tmdbId) continue;
        const current = aggregated.get(neighbor.tmdbId) ?? {
          score: 0,
          count: 0,
        };
        current.score += neighbor.similarity || 0;
        current.count += 1;
        aggregated.set(neighbor.tmdbId, current);
      }
    }

    const sorted = Array.from(aggregated.entries())
      .map(([id, data]) => ({
        tmdbId: id,
        score: data.score + data.count * 0.05,
        matches: data.count,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    console.log("[VectorSimilarity] Response", {
      resultCount: sorted.length,
    });

    return NextResponse.json({ ok: true, results: sorted });
  } catch (e: any) {
    console.error("[VectorSimilarity] Unexpected error", e);
    return NextResponse.json(
      { ok: false, error: "Unexpected error" },
      { status: 500 },
    );
  }
}
