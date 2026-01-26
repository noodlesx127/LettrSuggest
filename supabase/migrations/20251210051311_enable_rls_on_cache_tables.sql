-- Enable RLS on cache tables that are missing it

-- 1. trakt_related_cache
ALTER TABLE public.trakt_related_cache ENABLE ROW LEVEL SECURITY;

-- Allow public read access (this is cached public API data)
DROP POLICY IF EXISTS "Allow public read access on trakt_related_cache" ON public.trakt_related_cache;
CREATE POLICY "Allow public read access on trakt_related_cache"
ON public.trakt_related_cache
FOR SELECT
TO public
USING (true);

-- Allow authenticated users to insert/update (for caching)
DROP POLICY IF EXISTS "Allow authenticated insert on trakt_related_cache" ON public.trakt_related_cache;
CREATE POLICY "Allow authenticated insert on trakt_related_cache"
ON public.trakt_related_cache
FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated update on trakt_related_cache" ON public.trakt_related_cache;
CREATE POLICY "Allow authenticated update on trakt_related_cache"
ON public.trakt_related_cache
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- 2. tmdb_similar_cache
ALTER TABLE public.tmdb_similar_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access on tmdb_similar_cache" ON public.tmdb_similar_cache;
CREATE POLICY "Allow public read access on tmdb_similar_cache"
ON public.tmdb_similar_cache
FOR SELECT
TO public
USING (true);

DROP POLICY IF EXISTS "Allow authenticated insert on tmdb_similar_cache" ON public.tmdb_similar_cache;
CREATE POLICY "Allow authenticated insert on tmdb_similar_cache"
ON public.tmdb_similar_cache
FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated update on tmdb_similar_cache" ON public.tmdb_similar_cache;
CREATE POLICY "Allow authenticated update on tmdb_similar_cache"
ON public.tmdb_similar_cache
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- 3. tuimdb_uid_cache
ALTER TABLE public.tuimdb_uid_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access on tuimdb_uid_cache" ON public.tuimdb_uid_cache;
CREATE POLICY "Allow public read access on tuimdb_uid_cache"
ON public.tuimdb_uid_cache
FOR SELECT
TO public
USING (true);

DROP POLICY IF EXISTS "Allow authenticated insert on tuimdb_uid_cache" ON public.tuimdb_uid_cache;
CREATE POLICY "Allow authenticated insert on tuimdb_uid_cache"
ON public.tuimdb_uid_cache
FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated update on tuimdb_uid_cache" ON public.tuimdb_uid_cache;
CREATE POLICY "Allow authenticated update on tuimdb_uid_cache"
ON public.tuimdb_uid_cache
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- 4. tmdb_trending
ALTER TABLE public.tmdb_trending ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access on tmdb_trending" ON public.tmdb_trending;
CREATE POLICY "Allow public read access on tmdb_trending"
ON public.tmdb_trending
FOR SELECT
TO public
USING (true);

DROP POLICY IF EXISTS "Allow authenticated insert on tmdb_trending" ON public.tmdb_trending;
CREATE POLICY "Allow authenticated insert on tmdb_trending"
ON public.tmdb_trending
FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated update on tmdb_trending" ON public.tmdb_trending;
CREATE POLICY "Allow authenticated update on tmdb_trending"
ON public.tmdb_trending
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);;
