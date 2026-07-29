import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  runEmbeddingBackfill,
  type BackfillState,
  type EmbeddingBackfillDependencies,
} from "../../scripts/generate-embeddings";

function createDependencies(
  overrides: Partial<EmbeddingBackfillDependencies> = {},
): EmbeddingBackfillDependencies {
  return {
    claimBackfillOwnership: vi.fn(async () => true),
    persistBackfillState: vi.fn(async () => true),
    getTopTmdbIds: vi.fn(async () => ({ ids: [101], failed: false })),
    filterExistingEmbeddings: vi.fn(async (ids: number[]) => ({
      toProcess: [],
      compatibleCount: ids.length,
      failed: false,
    })),
    fetchTmdbMovie: vi.fn(async (id: number) => ({ id, title: "Test movie" })),
    generateMovieEmbeddingWithPersistence: vi.fn(async () => ({
      embedding: [],
      persisted: false,
    })),
    runId: "run-default",
    now: () => "2026-07-29T00:00:00.000Z",
    ...overrides,
  };
}

describe("embedding backfill lifecycle orchestration", () => {
  it("aborts before any movie or embedding work when the initial marker fails", async () => {
    const getTopTmdbIds = vi.fn(async () => ({ ids: [101], failed: false }));
    const fetchTmdbMovie = vi.fn(async () => ({ id: 101, title: "Test movie" }));
    const generateMovieEmbeddingWithPersistence = vi.fn(async () => ({
      embedding: [],
      persisted: false,
    }));

    const result = await runEmbeddingBackfill(
      createDependencies({
        claimBackfillOwnership: vi.fn(async () => false),
        getTopTmdbIds,
        fetchTmdbMovie,
        generateMovieEmbeddingWithPersistence,
      }),
    );

    expect(result).toMatchObject({
      status: "aborted",
      success: false,
      initialStatePersisted: false,
      finalStatePersisted: false,
    });
    expect(getTopTmdbIds).not.toHaveBeenCalled();
    expect(fetchTmdbMovie).not.toHaveBeenCalled();
    expect(generateMovieEmbeddingWithPersistence).not.toHaveBeenCalled();
  });

  it("does no expensive work for a concurrent run whose atomic claim loses", async () => {
    let claimed = false;
    const claimBackfillOwnership = vi.fn(async () => {
      if (claimed) return false;
      claimed = true;
      return true;
    });
    const firstGetTopTmdbIds = vi.fn(async () => ({
      ids: [],
      failed: false,
    }));
    const secondGetTopTmdbIds = vi.fn(async () => ({
      ids: [202],
      failed: false,
    }));
    const secondFetchTmdbMovie = vi.fn(async () => ({
      id: 202,
      title: "Should not fetch",
    }));
    const secondGenerateEmbedding = vi.fn(async () => ({
      embedding: [],
      persisted: false,
    }));

    const firstRun = runEmbeddingBackfill(
      createDependencies({
        claimBackfillOwnership,
        runId: "run-first",
        getTopTmdbIds: firstGetTopTmdbIds,
      }),
    );
    const secondRun = runEmbeddingBackfill(
      createDependencies({
        claimBackfillOwnership,
        runId: "run-second",
        getTopTmdbIds: secondGetTopTmdbIds,
        fetchTmdbMovie: secondFetchTmdbMovie,
        generateMovieEmbeddingWithPersistence: secondGenerateEmbedding,
      }),
    );

    const [firstResult, secondResult] = await Promise.all([firstRun, secondRun]);

    expect(firstResult.success).toBe(false);
    expect(secondResult).toMatchObject({
      status: "aborted",
      initialStatePersisted: false,
      finalStatePersisted: false,
      success: false,
    });
    expect(claimBackfillOwnership).toHaveBeenNthCalledWith(
      1,
      "run-first",
      "2026-07-29T00:00:00.000Z",
    );
    expect(claimBackfillOwnership).toHaveBeenNthCalledWith(
      2,
      "run-second",
      "2026-07-29T00:00:00.000Z",
    );
    expect(firstGetTopTmdbIds).toHaveBeenCalledTimes(1);
    expect(secondGetTopTmdbIds).not.toHaveBeenCalled();
    expect(secondFetchTmdbMovie).not.toHaveBeenCalled();
    expect(secondGenerateEmbedding).not.toHaveBeenCalled();
  });

  it("fails when an owner-scoped lifecycle write is lost", async () => {
    const states: BackfillState[] = [];
    const persistBackfillState = vi.fn(async (state: BackfillState) => {
      states.push(state);
      return states.length === 1;
    });

    const result = await runEmbeddingBackfill(
      createDependencies({
        claimBackfillOwnership: vi.fn(async () => true),
        persistBackfillState,
        runId: "run-owner",
        filterExistingEmbeddings: vi.fn(async (ids: number[]) => ({
          toProcess: [],
          compatibleCount: ids.length,
          failed: false,
        })),
      }),
    );

    expect(result).toMatchObject({
      status: "failed",
      finalStatePersisted: false,
      success: false,
    });
    expect(states).toHaveLength(2);
    expect(states).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ownerRunId: "run-owner" }),
      ]),
    );
    expect(states.every((state) => state.ownerRunId === "run-owner")).toBe(
      true,
    );
  });

  it("fails a complete run when the final marker cannot be persisted", async () => {
    const persistBackfillState = vi.fn(async (state: { status: string }) =>
      state.status !== "complete",
    );

    const result = await runEmbeddingBackfill(
      createDependencies({ persistBackfillState }),
    );

    expect(result).toMatchObject({
      status: "failed",
      success: false,
      initialStatePersisted: true,
      finalStatePersisted: false,
    });
  });

  it.each([
    ["partial", { ids: [], failed: false }],
    ["failed", { ids: [101], failed: false }],
  ] as const)("fails when the final lifecycle status is %s", async (status, page) => {
    const result = await runEmbeddingBackfill(
      createDependencies({
        getTopTmdbIds: vi.fn(async () => ({
          ids: [...page.ids],
          failed: page.failed,
        })),
        ...(status === "failed"
          ? {
              filterExistingEmbeddings: vi.fn(async (ids: number[]) => ({
                toProcess: ids,
                compatibleCount: 0,
                failed: false,
              })),
              fetchTmdbMovie: vi.fn(async () => null),
            }
          : {}),
      }),
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe(status);
    expect(result.finalStatePersisted).toBe(true);
  });

  it("succeeds only for a complete run with a persisted final marker", async () => {
    const result = await runEmbeddingBackfill(createDependencies());

    expect(result).toMatchObject({
      status: "complete",
      success: true,
      initialStatePersisted: true,
      finalStatePersisted: true,
    });
  });

  it("uses an injected run ID for every lifecycle state", async () => {
    const states: BackfillState[] = [];
    const persistBackfillState = vi.fn(async (state: BackfillState) => {
      states.push(state);
      return true;
    });

    await runEmbeddingBackfill(
      createDependencies({
        claimBackfillOwnership: vi.fn(async () => true),
        persistBackfillState,
        runId: "deterministic-run",
      }),
    );

    expect(states).toHaveLength(2);
    expect(
      states.every((state) => state.ownerRunId === "deterministic-run"),
    ).toBe(true);
  });

  it("claims through the RPC and updates lifecycle rows instead of upserting", () => {
    const script = readFileSync(
      new URL("../../scripts/generate-embeddings.ts", import.meta.url),
      "utf8",
    );

    expect(script).toMatch(/randomUUID/);
    expect(script).toMatch(/\.rpc\(\s*"claim_vector_embedding_backfill"/);
    expect(script).toMatch(/\.update\(/);
    expect(script).toMatch(/\.eq\("owner_run_id", state\.ownerRunId\)/);
    expect(script).not.toMatch(/\.upsert\(/);
  });
});
