-- Fix duplicate records and add correct unique constraint
-- Step 1: Remove duplicates by keeping only the row with highest ID for each (user_id, feature_type, feature_id) combo

WITH duplicates AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY user_id, feature_type, feature_id 
               ORDER BY last_updated DESC NULLS LAST, id DESC
           ) as rn
    FROM user_feature_feedback
)
DELETE FROM user_feature_feedback
WHERE id IN (
    SELECT id FROM duplicates WHERE rn > 1
);

-- Step 2: Drop the incorrect unique constraint
ALTER TABLE user_feature_feedback DROP CONSTRAINT IF EXISTS user_feature_feedback_user_id_feature_type_name_key;

-- Step 3: Add the correct unique constraint that matches the code's onConflict clause
ALTER TABLE user_feature_feedback ADD CONSTRAINT user_feature_feedback_user_feature_unique UNIQUE (user_id, feature_type, feature_id);

-- Step 4: Make feature_name nullable since some calls might not always provide it
ALTER TABLE user_feature_feedback ALTER COLUMN feature_name DROP NOT NULL;;
