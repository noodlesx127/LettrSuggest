alter table public.user_feature_feedback
  drop constraint if exists user_feature_feedback_feature_type_check;

alter table public.user_feature_feedback
  add constraint user_feature_feedback_feature_type_check
  check (feature_type in ('actor', 'director', 'keyword', 'genre', 'collection', 'studio', 'franchise', 'subgenre'));;
