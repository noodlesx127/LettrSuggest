-- Deduplicate suggestion_feedback and add unique constraint
-- This prevents duplicate feedback entries when users undo+redismiss

-- Step 1: Create a temporary table with deduplicated feedback (keep most recent)
create temp table deduplicated_feedback as
select distinct on (user_id, tmdb_id)
  id,
  user_id,
  tmdb_id,
  feedback_type,
  created_at,
  reason_types,
  movie_features,
  recommendation_sources,
  consensus_level
from suggestion_feedback
order by user_id, tmdb_id, created_at desc;

-- Step 2: Delete all rows from suggestion_feedback
delete from suggestion_feedback;

-- Step 3: Insert deduplicated rows back
insert into suggestion_feedback (
  user_id,
  tmdb_id,
  feedback_type,
  created_at,
  reason_types,
  movie_features,
  recommendation_sources,
  consensus_level
)
select
  user_id,
  tmdb_id,
  feedback_type,
  created_at,
  reason_types,
  movie_features,
  recommendation_sources,
  consensus_level
from deduplicated_feedback;

-- Step 4: Add unique constraint to prevent future duplicates
create unique index if not exists suggestion_feedback_user_movie_unique
  on suggestion_feedback (user_id, tmdb_id);

-- Comment explaining the constraint
comment on index suggestion_feedback_user_movie_unique is 
  'Prevents duplicate feedback entries for the same user+movie pair. Latest feedback wins on upsert.';

-- Force PostgREST to reload schema cache
notify pgrst, 'reload schema';
