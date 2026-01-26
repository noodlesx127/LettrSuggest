-- Create user_feature_feedback table for tracking granular user preferences
-- This table stores learned preferences for actors, keywords, genres, subgenres, directors, decades, collections

CREATE TABLE IF NOT EXISTS user_feature_feedback (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    feature_type TEXT NOT NULL,  -- 'actor', 'keyword', 'genre', 'subgenre', 'director', 'decade', 'collection', 'era'
    feature_id BIGINT NOT NULL,  -- TMDB ID or hashed ID for subgenres
    feature_name TEXT,           -- Human-readable name
    positive_count INTEGER NOT NULL DEFAULT 0,
    negative_count INTEGER NOT NULL DEFAULT 0,
    inferred_preference NUMERIC(5,4),  -- Bayesian preference score 0-1
    last_updated TIMESTAMPTZ DEFAULT now(),
    
    -- Unique constraint for upsert operations
    CONSTRAINT user_feature_feedback_unique UNIQUE (user_id, feature_type, feature_id)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_user_feature_feedback_user_id ON user_feature_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_user_feature_feedback_feature_type ON user_feature_feedback(feature_type);
CREATE INDEX IF NOT EXISTS idx_user_feature_feedback_lookup ON user_feature_feedback(user_id, feature_type);

-- Enable Row Level Security
ALTER TABLE user_feature_feedback ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own data
DROP POLICY IF EXISTS "Users can view own feature feedback" ON user_feature_feedback;
CREATE POLICY "Users can view own feature feedback"
    ON user_feature_feedback FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own feature feedback" ON user_feature_feedback;
CREATE POLICY "Users can insert own feature feedback"
    ON user_feature_feedback FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own feature feedback" ON user_feature_feedback;
CREATE POLICY "Users can update own feature feedback"
    ON user_feature_feedback FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own feature feedback" ON user_feature_feedback;
CREATE POLICY "Users can delete own feature feedback"
    ON user_feature_feedback FOR DELETE
    USING (auth.uid() = user_id);

-- Add comment for documentation
COMMENT ON TABLE user_feature_feedback IS 'Stores learned user preferences for movie features (actors, genres, keywords, etc.) used by the recommendation algorithm';
COMMENT ON COLUMN user_feature_feedback.feature_type IS 'Type of feature: actor, keyword, genre, subgenre, director, decade, collection, era';
COMMENT ON COLUMN user_feature_feedback.feature_id IS 'TMDB ID for standard features, or hash for subgenres';
COMMENT ON COLUMN user_feature_feedback.inferred_preference IS 'Bayesian preference score with Laplace smoothing (0-1 scale)';;
