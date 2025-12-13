-- Fix unique constraint on user_feature_feedback to use feature_name instead of feature_id
-- This allows proper tracking when we only have the feature name (common for user-selected feedback)

-- Drop the old constraint
alter table user_feature_feedback 
  drop constraint if exists user_feature_feedback_user_id_feature_type_feature_id_key;

-- Add new constraint using feature_name (case-insensitive)
alter table user_feature_feedback 
  add constraint user_feature_feedback_user_id_feature_type_name_key 
  unique(user_id, feature_type, feature_name);

-- Update the lookup index to match
drop index if exists user_feature_feedback_lookup_idx;
create index user_feature_feedback_lookup_idx on user_feature_feedback (user_id, feature_type, feature_name);

-- Add index for feature_id lookups (still useful when we have IDs)
create index if not exists user_feature_feedback_feature_id_idx on user_feature_feedback (user_id, feature_type, feature_id);

comment on constraint user_feature_feedback_user_id_feature_type_name_key on user_feature_feedback 
  is 'Ensures one feedback record per user/type/name combination. Feature ID is stored when available but names are the primary identifier.';
