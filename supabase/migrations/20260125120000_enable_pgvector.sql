CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.movie_embeddings (
  tmdb_id INTEGER PRIMARY KEY,
  embedding VECTOR(1536),
  model_version TEXT DEFAULT 'text-embedding-ada-002',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vector_similarity_cache (
  tmdb_id INTEGER PRIMARY KEY,
  related_ids INTEGER[] NOT NULL,
  cached_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.movie_embeddings IS
  'OpenAI embeddings for TMDB movies (ada-002, 1536d).';

COMMENT ON TABLE public.vector_similarity_cache IS
  'Cache for vector similarity results. TTL: 7 days.';

CREATE INDEX IF NOT EXISTS movie_embeddings_embedding_idx
  ON public.movie_embeddings USING ivfflat (embedding vector_cosine_ops);

CREATE OR REPLACE FUNCTION public.match_movie_embeddings(
  query_embedding VECTOR(1536),
  match_count INT
)
RETURNS TABLE (
  tmdb_id INT,
  similarity FLOAT
)
LANGUAGE SQL STABLE AS $$
  SELECT
    public.movie_embeddings.tmdb_id,
    1 - (public.movie_embeddings.embedding <=> query_embedding) AS similarity
  FROM public.movie_embeddings
  ORDER BY public.movie_embeddings.embedding <=> query_embedding
  LIMIT match_count;
$$;
