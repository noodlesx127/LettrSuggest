import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  evaluateVectorCapability,
  rankVectorSimilarityResults,
  type VectorBackfillMarker,
  type VectorSimilarityResult,
} from "@/lib/recommendationCandidates";
import {
  VECTOR_EMBEDDING_DIMENSIONS,
  VECTOR_EMBEDDING_MODEL_VERSION,
  isEmbeddingCompletionConfirmed,
  isEmbeddingPersisted,
} from "@/lib/embeddings";
import {
  createVectorSimilarityCachePayload,
  getCachedVectorSimilarity,
} from "@/lib/vectorSimilarityCache";

const uncachedResults: VectorSimilarityResult[] = [
  { tmdbId: 303, similarity: 0.72 },
  { tmdbId: 101, similarity: 0.94 },
  { tmdbId: 202, similarity: 0.81 },
];

const completeBackfill: VectorBackfillMarker = {
  status: "complete",
  modelVersion: VECTOR_EMBEDDING_MODEL_VERSION,
  dimensions: VECTOR_EMBEDDING_DIMENSIONS,
  expectedCount: 3,
  completedCount: 3,
  failureCount: 0,
};

const capableInput = {
  modelVersion: VECTOR_EMBEDDING_MODEL_VERSION,
  dimensions: VECTOR_EMBEDDING_DIMENSIONS,
  backfill: completeBackfill,
  cachedResults: [...uncachedResults].reverse(),
  uncachedResults,
};

describe("vector capability gate", () => {
  it("returns named failed checks and never activates production retrieval", () => {
    const result = evaluateVectorCapability({});

    expect(result).toMatchObject({
      capable: false,
      eligible: false,
      productionEnabled: false,
    });
    expect(result.failedChecks).toEqual([
      "model-version",
      "dimensions",
      "backfill",
      "similarity-scores",
      "rank-parity",
    ]);
  });

  it.each([
    ["model-version", { modelVersion: "wrong-model" }],
    ["dimensions", { dimensions: VECTOR_EMBEDDING_DIMENSIONS - 1 }],
    [
      "backfill",
      {
        backfill: {
          ...completeBackfill,
          status: "running" as const,
        },
      },
    ],
    ["similarity-scores", { cachedResults: null }],
    [
      "rank-parity",
      {
        cachedResults: [
          { tmdbId: 101, similarity: 0.1 },
          { tmdbId: 202, similarity: 0.9 },
        ],
      },
    ],
  ])("does not pass without the %s check", (failedCheck, change) => {
    const result = evaluateVectorCapability({ ...capableInput, ...change });

    expect(result.capable).toBe(false);
    expect(result.eligible).toBe(false);
    expect(result.productionEnabled).toBe(false);
    expect(result.failedChecks).toContain(failedCheck);
  });

  it("accepts only a matching complete lifecycle and exact rank parity", () => {
    const result = evaluateVectorCapability(capableInput);

    expect(result).toMatchObject({
      capable: true,
      eligible: true,
      productionEnabled: false,
      failedChecks: [],
    });
  });

  it("rejects non-finite persisted similarity scores", () => {
    const result = evaluateVectorCapability({
      ...capableInput,
      cachedResults: [
        { tmdbId: 101, similarity: Number.NaN },
        { tmdbId: 202, similarity: 0.8 },
      ],
    });

    expect(result.failedChecks).toContain("similarity-scores");
    expect(result.capable).toBe(false);
  });

  it("uses the same stable ranking for cached and uncached scores", () => {
    expect(rankVectorSimilarityResults(uncachedResults)).toEqual([
      { tmdbId: 101, similarity: 0.94 },
      { tmdbId: 202, similarity: 0.81 },
      { tmdbId: 303, similarity: 0.72 },
    ]);

    const cachePayload = createVectorSimilarityCachePayload(
      999,
      uncachedResults,
    );

    expect(cachePayload).toMatchObject({
      tmdb_id: 999,
      model_version: VECTOR_EMBEDDING_MODEL_VERSION,
      embedding_dimensions: VECTOR_EMBEDDING_DIMENSIONS,
      related_ids: [303, 101, 202],
      related_scores: [0.72, 0.94, 0.81],
    });
  });

  it("does not count a generated vector when persistence cannot be confirmed", async () => {
    const embedding = Array.from(
      { length: VECTOR_EMBEDDING_DIMENSIONS },
      (_, index) => index / VECTOR_EMBEDDING_DIMENSIONS,
    );
    const readRow = vi.fn(async () => null);

    expect(await isEmbeddingPersisted(999, embedding, readRow)).toBe(false);
    expect(isEmbeddingCompletionConfirmed(embedding, false)).toBe(false);
    expect(isEmbeddingCompletionConfirmed(embedding, true)).toBe(true);
  });

  it("accepts an exact compatible embedding reread as durable persistence", async () => {
    const embedding = Array.from(
      { length: VECTOR_EMBEDDING_DIMENSIONS },
      (_, index) => index / VECTOR_EMBEDDING_DIMENSIONS,
    );

    await expect(
      isEmbeddingPersisted(999, embedding, async () => ({
        embedding: [...embedding],
        model_version: VECTOR_EMBEDDING_MODEL_VERSION,
        embedding_dimensions: VECTOR_EMBEDDING_DIMENSIONS,
      })),
    ).resolves.toBe(true);

    await expect(
      isEmbeddingPersisted(999, embedding, async () => ({
        embedding: [...embedding],
        model_version: "wrong-model",
        embedding_dimensions: VECTOR_EMBEDDING_DIMENSIONS,
      })),
    ).resolves.toBe(false);
  });

  it("accepts PostgreSQL float32 rereads but rejects materially different or non-finite values", async () => {
    const embedding = Array.from(
      { length: VECTOR_EMBEDDING_DIMENSIONS },
      (_, index) => (index === 0 ? 0.123456789 : index / VECTOR_EMBEDDING_DIMENSIONS),
    );
    const float32Embedding = embedding.map((value) => Math.fround(value));
    const row = (persistedEmbedding: readonly number[]) => ({
      embedding: [...persistedEmbedding],
      model_version: VECTOR_EMBEDDING_MODEL_VERSION,
      embedding_dimensions: VECTOR_EMBEDDING_DIMENSIONS,
    });

    await expect(
      isEmbeddingPersisted(999, embedding, async () => row(float32Embedding)),
    ).resolves.toBe(true);

    const materiallyDifferent = [...float32Embedding];
    materiallyDifferent[0] += 0.01;
    await expect(
      isEmbeddingPersisted(999, embedding, async () =>
        row(materiallyDifferent),
      ),
    ).resolves.toBe(false);

    const nonFinite = [...float32Embedding];
    nonFinite[0] = Number.NaN;
    await expect(
      isEmbeddingPersisted(999, embedding, async () => row(nonFinite)),
    ).resolves.toBe(false);
  });

  it("rejects a cached row containing a non-number score instead of coercing it", async () => {
    const readRow = vi.fn(async () => ({
      related_ids: [101, 202],
      related_scores: [0.94, null],
      cached_at: new Date().toISOString(),
      model_version: VECTOR_EMBEDDING_MODEL_VERSION,
      embedding_dimensions: VECTOR_EMBEDDING_DIMENSIONS,
      cache_version: "vector-similarity-v1",
      neighbor_count: 2,
    }));

    await expect(
      getCachedVectorSimilarity(
        999,
        2,
        VECTOR_EMBEDDING_MODEL_VERSION,
        VECTOR_EMBEDDING_DIMENSIONS,
        readRow,
      ),
    ).resolves.toBeNull();
  });

  it("requires cached neighbor coverage and slices a larger ordered window safely", async () => {
    const results = Array.from({ length: 20 }, (_, index) => ({
      tmdbId: index + 1,
      similarity: 1 - index / 100,
    }));
    const row = {
      related_ids: results.map((result) => result.tmdbId),
      related_scores: results.map((result) => result.similarity),
      cached_at: new Date().toISOString(),
      model_version: VECTOR_EMBEDDING_MODEL_VERSION,
      embedding_dimensions: VECTOR_EMBEDDING_DIMENSIONS,
      cache_version: "vector-similarity-v1",
    };

    await expect(
      getCachedVectorSimilarity(
        999,
        20,
        VECTOR_EMBEDDING_MODEL_VERSION,
        VECTOR_EMBEDDING_DIMENSIONS,
        async () => ({ ...row, neighbor_count: 5 }),
      ),
    ).resolves.toBeNull();

    await expect(
      getCachedVectorSimilarity(
        999,
        5,
        VECTOR_EMBEDDING_MODEL_VERSION,
        VECTOR_EMBEDDING_DIMENSIONS,
        async () => ({ ...row, neighbor_count: null }),
      ),
    ).resolves.toBeNull();

    await expect(
      getCachedVectorSimilarity(
        999,
        5,
        VECTOR_EMBEDDING_MODEL_VERSION,
        VECTOR_EMBEDDING_DIMENSIONS,
        async () => ({ ...row, neighbor_count: 20 }),
      ),
    ).resolves.toMatchObject({
      results: results.slice(0, 5),
    });

    expect(
      createVectorSimilarityCachePayload(999, results, {
        neighborCount: 20,
      }),
    ).toMatchObject({ neighbor_count: 20 });
  });

  it("defines strict lifecycle and neighbor-window migration contracts", () => {
    const migration = readFileSync(
      new URL(
        "../../supabase/migrations/20260729231305_vector_capability_lifecycle.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toMatch(/add column if not exists neighbor_count/i);
    expect(migration).toMatch(
      /vector_embedding_backfill_complete_state_check/i,
    );
    expect(migration).toMatch(/btrim\(model_version\)/i);
    expect(migration).toMatch(/embedding_dimensions[^\n]*> 0/i);
    expect(migration).toMatch(/expected_count[^\n]*> 0/i);
    expect(migration).toMatch(/completed_count[^\n]*= expected_count/i);
    expect(migration).toMatch(/failure_count[^\n]*= 0/i);
    expect(migration).toMatch(/completed_at is not null/i);
    expect(migration).toMatch(/status = 'complete'[^\n]*completed_at is null/i);
    expect(migration).toMatch(/owner_run_id\s+text\s+not null/i);
    expect(migration).toMatch(
      /create or replace function public\.claim_vector_embedding_backfill/i,
    );
    expect(migration).toMatch(/returns boolean/i);
    expect(migration).toMatch(/insert into public\.vector_embedding_backfill/i);
    expect(migration).toMatch(/on conflict \(source_key\) do update/i);
    expect(migration).toMatch(
      /where public\.vector_embedding_backfill\.status <> 'running'/i,
    );
    expect(migration).toMatch(/get diagnostics[^;]*row_count/i);
    expect(migration).toMatch(
      /revoke all on function public\.claim_vector_embedding_backfill/i,
    );
    expect(migration).toMatch(
      /grant execute on function public\.claim_vector_embedding_backfill/i,
    );
    expect(migration).toMatch(/to service_role/i);
    expect(migration).toMatch(/set search_path = ''/i);
    expect(migration).toMatch(/query_embedding extensions\.vector\(1536\)/i);
    expect(migration).toMatch(/operator\(extensions\.<=>\)/i);
    expect(migration).not.toMatch(/public\.vector\(1536\)/i);
    expect(migration).not.toMatch(/operator\(public\.<=>\)/i);
  });

  it("uses a unique final TMDB-ID tie-breaker for offset pagination", () => {
    const script = readFileSync(
      new URL("../../scripts/generate-embeddings.ts", import.meta.url),
      "utf8",
    );

    expect(script).toMatch(
      /\.order\("imdb_votes", \{ ascending: false \}\)\s*\.order\("imdb_rating", \{ ascending: false \}\)\s*\.order\("tmdb_id", \{ ascending: true \}\)/,
    );
  });
});
