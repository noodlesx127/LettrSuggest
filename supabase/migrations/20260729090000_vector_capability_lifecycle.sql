-- Version vector source data and record the lifecycle of the embedding backfill.
-- Existing rows remain conservative: missing model metadata is not inferred and
-- cache rows without persisted scores are naturally rejected by the application.

ALTER TABLE IF EXISTS public.movie_embeddings
  ADD COLUMN IF NOT EXISTS embedding_dimensions INTEGER;

-- The vector itself is the source of truth for dimensions. Do not fill
-- model_version here: a missing model cannot be reconstructed safely.
UPDATE public.movie_embeddings
SET embedding_dimensions = vector_dims(embedding)
WHERE embedding IS NOT NULL
  AND embedding_dimensions IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.movie_embeddings'::regclass
      AND conname = 'movie_embeddings_embedding_dimensions_positive'
  ) THEN
    ALTER TABLE public.movie_embeddings
      ADD CONSTRAINT movie_embeddings_embedding_dimensions_positive
      CHECK (embedding_dimensions IS NULL OR embedding_dimensions > 0);
  END IF;
END
$$;

ALTER TABLE IF EXISTS public.vector_similarity_cache
  ADD COLUMN IF NOT EXISTS related_scores DOUBLE PRECISION[],
  ADD COLUMN IF NOT EXISTS model_version TEXT,
  ADD COLUMN IF NOT EXISTS embedding_dimensions INTEGER,
  ADD COLUMN IF NOT EXISTS cache_version TEXT,
  ADD COLUMN IF NOT EXISTS neighbor_count INTEGER;

-- This is the requested neighbor window, not the number of rows returned.
-- It cannot be reconstructed from legacy related_ids, so NULL legacy metadata
-- deliberately causes a cache miss.

-- Older rows have no score vector and therefore remain stale/capability-ineligible.
-- Never synthesize zero scores from their related_ids array.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.vector_similarity_cache'::regclass
      AND conname = 'vector_similarity_cache_scores_aligned'
  ) THEN
    ALTER TABLE public.vector_similarity_cache
      ADD CONSTRAINT vector_similarity_cache_scores_aligned
      CHECK (
        related_scores IS NULL
        OR cardinality(related_ids) = cardinality(related_scores)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.vector_similarity_cache'::regclass
      AND conname = 'vector_similarity_cache_embedding_dimensions_positive'
  ) THEN
    ALTER TABLE public.vector_similarity_cache
      ADD CONSTRAINT vector_similarity_cache_embedding_dimensions_positive
      CHECK (embedding_dimensions IS NULL OR embedding_dimensions > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.vector_similarity_cache'::regclass
      AND conname = 'vector_similarity_cache_neighbor_count_valid'
  ) THEN
    ALTER TABLE public.vector_similarity_cache
      ADD CONSTRAINT vector_similarity_cache_neighbor_count_valid
      CHECK (
        neighbor_count IS NULL
        OR (
          neighbor_count > 0
          AND cardinality(related_ids) <= neighbor_count
        )
      );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.vector_embedding_backfill (
  source_key TEXT PRIMARY KEY,
  owner_run_id TEXT NOT NULL,
  model_version TEXT,
  embedding_dimensions INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  expected_count INTEGER NOT NULL DEFAULT 0,
  completed_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT vector_embedding_backfill_status_check
    CHECK (status IN ('pending', 'running', 'partial', 'failed', 'complete')),
  CONSTRAINT vector_embedding_backfill_owner_run_id_nonempty
    CHECK (btrim(owner_run_id) <> ''),
  CONSTRAINT vector_embedding_backfill_dimensions_positive
    CHECK (embedding_dimensions IS NULL OR embedding_dimensions > 0),
  CONSTRAINT vector_embedding_backfill_counts_nonnegative
    CHECK (
      expected_count >= 0
      AND completed_count >= 0
      AND failure_count >= 0
      AND completed_count <= expected_count
    ),
  CONSTRAINT vector_embedding_backfill_complete_state_check
    CHECK (
      status <> 'complete'
      OR (
        model_version IS NOT NULL
        AND btrim(model_version) <> ''
        AND embedding_dimensions IS NOT NULL
        AND embedding_dimensions > 0
        AND expected_count > 0
        AND completed_count = expected_count
        AND failure_count = 0
        AND completed_at IS NOT NULL
      )
    ),
  CONSTRAINT vector_embedding_backfill_noncomplete_timestamp_check
    CHECK (status = 'complete' OR completed_at IS NULL)
);

-- Normalize rows created by an earlier draft before adding the strict
-- lifecycle constraints. No existing invalid row may retain a false complete
-- state or a non-complete completion timestamp.
UPDATE public.vector_embedding_backfill
SET status = 'failed', completed_at = NULL
WHERE status = 'complete'
  AND NOT (
    model_version IS NOT NULL
    AND btrim(model_version) <> ''
    AND embedding_dimensions IS NOT NULL
    AND embedding_dimensions > 0
    AND expected_count > 0
    AND completed_count = expected_count
    AND failure_count = 0
    AND completed_at IS NOT NULL
  );

UPDATE public.vector_embedding_backfill
SET completed_at = NULL
WHERE status <> 'complete'
  AND completed_at IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.vector_embedding_backfill'::regclass
      AND conname = 'vector_embedding_backfill_complete_state_check'
  ) THEN
    ALTER TABLE public.vector_embedding_backfill
      ADD CONSTRAINT vector_embedding_backfill_complete_state_check
      CHECK (
        status <> 'complete'
        OR (
          model_version IS NOT NULL
          AND btrim(model_version) <> ''
          AND embedding_dimensions IS NOT NULL
          AND embedding_dimensions > 0
          AND expected_count > 0
          AND completed_count = expected_count
          AND failure_count = 0
          AND completed_at IS NOT NULL
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.vector_embedding_backfill'::regclass
      AND conname = 'vector_embedding_backfill_noncomplete_timestamp_check'
  ) THEN
    ALTER TABLE public.vector_embedding_backfill
      ADD CONSTRAINT vector_embedding_backfill_noncomplete_timestamp_check
      CHECK (status = 'complete' OR completed_at IS NULL);
  END IF;
END
$$;

ALTER TABLE public.vector_embedding_backfill ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vector_embedding_backfill_service_role"
  ON public.vector_embedding_backfill;
CREATE POLICY "vector_embedding_backfill_service_role"
  ON public.vector_embedding_backfill
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Claiming a run and replacing a non-running lifecycle row must happen in one
-- database operation. A running row is never taken over by another owner.
CREATE OR REPLACE FUNCTION public.claim_vector_embedding_backfill(
  p_source_key TEXT,
  p_owner_run_id TEXT,
  p_model_version TEXT,
  p_embedding_dimensions INTEGER,
  p_started_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  affected_rows BIGINT;
BEGIN
  INSERT INTO public.vector_embedding_backfill (
    source_key,
    owner_run_id,
    model_version,
    embedding_dimensions,
    status,
    expected_count,
    completed_count,
    failure_count,
    started_at,
    completed_at,
    updated_at
  )
  VALUES (
    p_source_key,
    p_owner_run_id,
    p_model_version,
    p_embedding_dimensions,
    'running',
    0,
    0,
    0,
    p_started_at,
    NULL,
    NOW()
  )
  ON CONFLICT (source_key) DO UPDATE
  SET owner_run_id = EXCLUDED.owner_run_id,
      model_version = EXCLUDED.model_version,
      embedding_dimensions = EXCLUDED.embedding_dimensions,
      status = EXCLUDED.status,
      expected_count = EXCLUDED.expected_count,
      completed_count = EXCLUDED.completed_count,
      failure_count = EXCLUDED.failure_count,
      started_at = EXCLUDED.started_at,
      completed_at = EXCLUDED.completed_at,
      updated_at = EXCLUDED.updated_at
  WHERE public.vector_embedding_backfill.status <> 'running';

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_vector_embedding_backfill(
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  TIMESTAMPTZ
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_vector_embedding_backfill(
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  TIMESTAMPTZ
) FROM anon;
REVOKE ALL ON FUNCTION public.claim_vector_embedding_backfill(
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  TIMESTAMPTZ
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_vector_embedding_backfill(
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  TIMESTAMPTZ
) TO service_role;

COMMENT ON TABLE public.vector_embedding_backfill IS
  'Durable, service-only lifecycle state for the versioned movie embedding backfill.';
COMMENT ON COLUMN public.vector_embedding_backfill.model_version IS
  'Explicit embedding model version; NULL is never inferred for legacy rows.';
COMMENT ON COLUMN public.vector_similarity_cache.related_scores IS
  'Similarity scores aligned one-for-one with related_ids; NULL legacy rows are stale.';
COMMENT ON COLUMN public.vector_similarity_cache.neighbor_count IS
  'Requested ordered neighbor window; NULL legacy rows are stale and miss.';

-- Keep vector retrieval restricted to embeddings with explicit current metadata.
CREATE OR REPLACE FUNCTION public.match_movie_embeddings(
  query_embedding public.vector(1536),
  match_count integer
)
RETURNS TABLE (tmdb_id integer, similarity float)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    public.movie_embeddings.tmdb_id,
    1 - (public.movie_embeddings.embedding OPERATOR(public.<=>) query_embedding) AS similarity
  FROM public.movie_embeddings
  WHERE public.movie_embeddings.model_version = 'text-embedding-ada-002'
    AND public.movie_embeddings.embedding_dimensions = 1536
  ORDER BY public.movie_embeddings.embedding OPERATOR(public.<=>) query_embedding
  LIMIT match_count;
$$;

NOTIFY pgrst, 'reload schema';
