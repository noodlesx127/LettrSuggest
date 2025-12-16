-- Add 'subgenre' to the allowed feature_type values in user_feature_feedback
-- We have to drop the constraint and recreate it because PostgreSQL doesn't support altering a check constraint directly to add a value

alter table public.user_feature_feedback
  drop constraint if exists user_feature_feedback_feature_type_check;

alter table public.user_feature_feedback
  add constraint user_feature_feedback_feature_type_check
  check (feature_type in ('actor', 'director', 'keyword', 'genre', 'collection', 'studio', 'franchise', 'subgenre'));
