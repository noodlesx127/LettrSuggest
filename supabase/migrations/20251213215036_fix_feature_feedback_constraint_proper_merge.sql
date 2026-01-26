-- Fix unique constraint on user_feature_feedback to use feature_name instead of feature_id
-- Merge duplicate feature_name entries, preferring records with real feature_ids (non-zero)

-- Step 1: Create temp table with merged data
create temp table merged_feedback as
select 
  user_id,
  feature_type,
  max(feature_id) as feature_id,  -- Keep the highest ID (real ID beats 0)
  feature_name,
  sum(positive_count) as positive_count,
  sum(negative_count) as negative_count,
  case 
    when sum(positive_count + negative_count) > 0 
    then sum(positive_count)::numeric / sum(positive_count + negative_count)
    else 0.5 
  end as inferred_preference,
  max(last_updated) as last_updated
from user_feature_feedback
group by user_id, feature_type, feature_name;

-- Step 2: Clear the original table
delete from user_feature_feedback;

-- Step 3: Insert merged data back
insert into user_feature_feedback (user_id, feature_type, feature_id, feature_name, positive_count, negative_count, inferred_preference, last_updated)
select user_id, feature_type, feature_id, feature_name, positive_count, negative_count, inferred_preference, last_updated
from merged_feedback;

-- Step 4: Drop temp table
drop table merged_feedback;

-- Step 5: Drop the old constraint
alter table user_feature_feedback 
  drop constraint if exists user_feature_feedback_user_id_feature_type_feature_id_key;

-- Step 6: Add new constraint using feature_name
alter table user_feature_feedback 
  add constraint user_feature_feedback_user_id_feature_type_name_key 
  unique(user_id, feature_type, feature_name);

-- Step 7: Update the lookup index to match
drop index if exists user_feature_feedback_lookup_idx;
create index user_feature_feedback_lookup_idx on user_feature_feedback (user_id, feature_type, feature_name);

-- Step 8: Add index for feature_id lookups (still useful when we have IDs)
create index if not exists user_feature_feedback_feature_id_idx on user_feature_feedback (user_id, feature_type, feature_id);

comment on constraint user_feature_feedback_user_id_feature_type_name_key on user_feature_feedback 
  is 'Ensures one feedback record per user/type/name combination. Feature ID is stored when available but names are the primary identifier.';;
