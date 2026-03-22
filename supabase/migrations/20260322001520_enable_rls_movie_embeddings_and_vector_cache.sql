-- Fix: Enable RLS on movie_embeddings and vector_similarity_cache.
-- Both tables are global (no user_id) and written exclusively by server-side processes.
-- Policy: authenticated users may SELECT; only service role may write.

-- movie_embeddings
ALTER TABLE public.movie_embeddings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read movie embeddings" ON public.movie_embeddings;
CREATE POLICY "Authenticated users can read movie embeddings"
  ON public.movie_embeddings
  FOR SELECT
  TO authenticated
  USING (true);

-- vector_similarity_cache
ALTER TABLE public.vector_similarity_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read vector similarity cache" ON public.vector_similarity_cache;
CREATE POLICY "Authenticated users can read vector similarity cache"
  ON public.vector_similarity_cache
  FOR SELECT
  TO authenticated
  USING (true);

NOTIFY pgrst, 'reload schema';
