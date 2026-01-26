-- Deduplicate user_feature_feedback prior to adding unique(user_id, feature_type, feature_name)
-- Keeps the most recent row (highest id) and rolls up counts from duplicates.

-- 1) Update the most recent row with summed counts
WITH duplicates AS (
  SELECT
    user_id,
    feature_type,
    feature_name,
    array_agg(id ORDER BY id DESC) AS ids,
    sum(coalesce(positive_count, 0)) AS total_positive,
    sum(coalesce(negative_count, 0)) AS total_negative
  FROM user_feature_feedback
  WHERE feature_name IS NOT NULL
  GROUP BY user_id, feature_type, feature_name
  HAVING count(*) > 1
)
UPDATE user_feature_feedback AS uff
SET
  positive_count = d.total_positive,
  negative_count = d.total_negative
FROM duplicates AS d
WHERE
  uff.id = (d.ids)[1];

-- 2) Delete all older duplicate rows
WITH duplicates AS (
  SELECT
    user_id,
    feature_type,
    feature_name,
    array_agg(id ORDER BY id DESC) AS ids
  FROM user_feature_feedback
  WHERE feature_name IS NOT NULL
  GROUP BY user_id, feature_type, feature_name
  HAVING count(*) > 1
)
DELETE FROM user_feature_feedback
WHERE id IN (
  SELECT unnest(ids[2:]) FROM duplicates
);
