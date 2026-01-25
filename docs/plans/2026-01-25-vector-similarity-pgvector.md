# Vector-Based Semantic Similarity (pgvector) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add pgvector-backed semantic similarity using OpenAI embeddings and integrate it into recommendations.

**Architecture:** Add a pgvector table for embeddings, a server-side embedding generator with Supabase caching, a vector similarity API route, and integrate results into the recommendation aggregator. Provide a batch script scaffold to generate embeddings for popular movies.

**Tech Stack:** Next.js 14 (App Router), Supabase (pgvector), OpenAI embeddings, TypeScript.

---

### Task 1: Add pgvector migration

**Files:**

- Create: `supabase/migrations/<timestamp>_enable_pgvector.sql`

**Step 1: Write the migration**

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS movie_embeddings (
  tmdb_id INTEGER PRIMARY KEY,
  embedding VECTOR(1536),
  model_version TEXT DEFAULT 'text-embedding-ada-002',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS movie_embeddings_embedding_idx
  ON movie_embeddings USING ivfflat (embedding vector_cosine_ops);
```

**Step 2: Commit**

```bash
git add supabase/migrations/<timestamp>_enable_pgvector.sql
git commit -m "feat: enable pgvector movie embeddings"
```

---

### Task 2: Embedding generation library

**Files:**

- Create: `src/lib/embeddings.ts`

**Step 1: Implement generateMovieEmbedding**

```ts
export async function generateMovieEmbedding(
  movie: TMDBMovie,
): Promise<number[]> {
  // build prompt from title, overview, genres, keywords, directors, cast
  // cache in movie_embeddings table
}
```

**Step 2: Implement retry/backoff and rate limiting**

```ts
const limiter = pLimit(50);
```

**Step 3: Commit**

```bash
git add src/lib/embeddings.ts
git commit -m "feat: add movie embedding generator"
```

---

### Task 3: Vector similarity API route

**Files:**

- Create: `src/app/api/vector-similarity/route.ts`

**Step 1: Implement POST handler**

```ts
export async function POST(req: Request) {
  // validate body
  // load seed embeddings from Supabase
  // query neighbors via SQL cosine similarity
  // aggregate and return results
}
```

**Step 2: Commit**

```bash
git add src/app/api/vector-similarity/route.ts
git commit -m "feat: add vector similarity api"
```

---

### Task 4: Batch embedding generation script

**Files:**

- Create: `scripts/generate-embeddings.ts`

**Step 1: Implement batch runner**

```ts
// query top 5000 movies
// skip already embedded
// log progress every 100
```

**Step 2: Commit**

```bash
git add scripts/generate-embeddings.ts
git commit -m "chore: add embedding batch generator"
```

---

### Task 5: Integrate into aggregator + types

**Files:**

- Modify: `src/lib/recommendationAggregator.ts`
- Modify: `src/types/*` (if needed)

**Step 1: Add new source and weighting**

```ts
source: "vector-similarity";
```

**Step 2: Fetch vector similarity results using top liked seeds**

**Step 3: Commit**

```bash
git add src/lib/recommendationAggregator.ts src/types/*
git commit -m "feat: integrate vector similarity source"
```

---

### Task 6: Validate

**Steps:**

- Run `npm run typecheck`
- Manually test `/api/vector-similarity` with known movies

---

Plan complete and saved to `docs/plans/2026-01-25-vector-similarity-pgvector.md`. Two execution options:

1. Subagent-Driven (this session) - I dispatch fresh subagent per task, review between tasks, fast iteration
2. Parallel Session (separate) - Open new session with executing-plans, batch execution with checkpoints

Which approach?
