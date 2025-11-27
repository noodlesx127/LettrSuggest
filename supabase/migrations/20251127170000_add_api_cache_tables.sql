-- Migration: Add TasteDive and Watchmode cache tables
-- Created: 2025-11-27
-- Description: Creates cache tables for TasteDive similar content and Watchmode streaming sources

-- ============================================================================
-- TasteDive Similar Content Cache
-- ============================================================================

CREATE TABLE IF NOT EXISTS tastedive_cache (
    id BIGSERIAL PRIMARY KEY,
    movie_title TEXT NOT NULL,
    similar_titles JSONB NOT NULL DEFAULT '[]'::jsonb,
    cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(movie_title)
);

-- Index for fast lookups by movie title
CREATE INDEX IF NOT EXISTS idx_tastedive_cache_movie_title 
    ON tastedive_cache(movie_title);

-- Index for cache expiration queries (7-day TTL)
CREATE INDEX IF NOT EXISTS idx_tastedive_cache_cached_at 
    ON tastedive_cache(cached_at);

-- Add comment
COMMENT ON TABLE tastedive_cache IS 'Caches TasteDive similar content recommendations with 7-day TTL';
COMMENT ON COLUMN tastedive_cache.movie_title IS 'Movie title used for TasteDive query';
COMMENT ON COLUMN tastedive_cache.similar_titles IS 'Array of similar movie titles from TasteDive';
COMMENT ON COLUMN tastedive_cache.cached_at IS 'Timestamp when this cache entry was last updated';

-- ============================================================================
-- Watchmode Streaming Sources Cache
-- ============================================================================

CREATE TABLE IF NOT EXISTS watchmode_cache (
    id BIGSERIAL PRIMARY KEY,
    tmdb_id INTEGER NOT NULL,
    watchmode_id INTEGER,
    sources JSONB NOT NULL DEFAULT '[]'::jsonb,
    cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tmdb_id)
);

-- Index for fast lookups by TMDB ID
CREATE INDEX IF NOT EXISTS idx_watchmode_cache_tmdb_id 
    ON watchmode_cache(tmdb_id);

-- Index for cache expiration queries (24-hour TTL)
CREATE INDEX IF NOT EXISTS idx_watchmode_cache_cached_at 
    ON watchmode_cache(cached_at);

-- Add comment
COMMENT ON TABLE watchmode_cache IS 'Caches Watchmode streaming sources with 24-hour TTL';
COMMENT ON COLUMN watchmode_cache.tmdb_id IS 'TMDB movie ID for cross-referencing';
COMMENT ON COLUMN watchmode_cache.watchmode_id IS 'Watchmode internal ID for the title';
COMMENT ON COLUMN watchmode_cache.sources IS 'Array of streaming sources (Netflix, Hulu, etc.)';
COMMENT ON COLUMN watchmode_cache.cached_at IS 'Timestamp when this cache entry was last updated';

-- ============================================================================
-- Cache Cleanup Functions
-- ============================================================================

-- Function to clean up expired TasteDive cache entries (older than 7 days)
CREATE OR REPLACE FUNCTION cleanup_tastedive_cache()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM tastedive_cache
    WHERE cached_at < NOW() - INTERVAL '7 days';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_tastedive_cache() IS 'Removes TasteDive cache entries older than 7 days';

-- Function to clean up expired Watchmode cache entries (older than 24 hours)
CREATE OR REPLACE FUNCTION cleanup_watchmode_cache()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM watchmode_cache
    WHERE cached_at < NOW() - INTERVAL '24 hours';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_watchmode_cache() IS 'Removes Watchmode cache entries older than 24 hours';

-- ============================================================================
-- Enable Row Level Security (RLS)
-- ============================================================================

-- Enable RLS on both tables
ALTER TABLE tastedive_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchmode_cache ENABLE ROW LEVEL SECURITY;

-- Create policies for public read access (cache is shared across all users)
CREATE POLICY "Allow public read access to TasteDive cache"
    ON tastedive_cache FOR SELECT
    USING (true);

CREATE POLICY "Allow public read access to Watchmode cache"
    ON watchmode_cache FOR SELECT
    USING (true);

-- Create policies for service role write access (only backend can write)
CREATE POLICY "Allow service role to insert/update TasteDive cache"
    ON tastedive_cache FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "Allow service role to insert/update Watchmode cache"
    ON watchmode_cache FOR ALL
    USING (auth.role() = 'service_role');
