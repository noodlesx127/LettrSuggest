-- Migration: Add OMDb fields to tmdb_movies table
-- Purpose: Store IMDB ratings, Rotten Tomatoes, Metacritic, awards, and box office data
-- Author: API Integration - Week 1
-- Date: 2025-11-25

-- Add OMDb-specific columns to existing tmdb_movies table
ALTER TABLE tmdb_movies 
  ADD COLUMN IF NOT EXISTS imdb_rating VARCHAR(10),
  ADD COLUMN IF NOT EXISTS imdb_votes VARCHAR(20),
  ADD COLUMN IF NOT EXISTS rotten_tomatoes VARCHAR(10),
  ADD COLUMN IF NOT EXISTS metacritic VARCHAR(5),
  ADD COLUMN IF NOT EXISTS awards TEXT,
  ADD COLUMN IF NOT EXISTS box_office VARCHAR(20),
  ADD COLUMN IF NOT EXISTS rated VARCHAR(10), -- Content rating (PG-13, R, etc.)
  ADD COLUMN IF NOT EXISTS omdb_plot_full TEXT,
  ADD COLUMN IF NOT EXISTS omdb_fetched_at TIMESTAMPTZ;

-- Create index for OMDb refresh tracking
CREATE INDEX IF NOT EXISTS idx_tmdb_movies_omdb_fetch 
  ON tmdb_movies(omdb_fetched_at);

-- Create index for IMDB rating queries (for stats page)
CREATE INDEX IF NOT EXISTS idx_tmdb_movies_imdb_rating 
  ON tmdb_movies(imdb_rating) WHERE imdb_rating IS NOT NULL;

-- Create index for awards queries
CREATE INDEX IF NOT EXISTS idx_tmdb_movies_awards 
  ON tmdb_movies(awards) WHERE awards IS NOT NULL;

-- Comments for documentation
COMMENT ON COLUMN tmdb_movies.imdb_rating IS 'IMDB rating from OMDb API (e.g., "8.9")';
COMMENT ON COLUMN tmdb_movies.imdb_votes IS 'Number of IMDB votes (e.g., "2,500,000")';
COMMENT ON COLUMN tmdb_movies.rotten_tomatoes IS 'Rotten Tomatoes score (e.g., "91%")';
COMMENT ON COLUMN tmdb_movies.metacritic IS 'Metacritic score (e.g., "82")';
COMMENT ON COLUMN tmdb_movies.awards IS 'Awards text from OMDb (e.g., "Won 3 Oscars. 145 wins & 142 nominations")';
COMMENT ON COLUMN tmdb_movies.box_office IS 'Box office gross (e.g., "$28,767,189")';
COMMENT ON COLUMN tmdb_movies.rated IS 'Content rating (e.g., "PG-13", "R")';
COMMENT ON COLUMN tmdb_movies.omdb_plot_full IS 'Full plot summary from OMDb';
COMMENT ON COLUMN tmdb_movies.omdb_fetched_at IS 'Timestamp when OMDb data was last fetched (for 7-day TTL)';
