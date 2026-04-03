-- One-time cleanup: clamp exploratory_films_rated to not exceed actual rated film count
-- Uses CTE for performance to avoid repeated correlated subqueries
WITH rated_counts AS (
  SELECT user_id, COUNT(*) AS cnt
  FROM film_events
  WHERE rating IS NOT NULL
  GROUP BY user_id
)
UPDATE user_exploration_stats ues
SET exploratory_films_rated = LEAST(ues.exploratory_films_rated, rc.cnt)
FROM rated_counts rc
WHERE ues.user_id = rc.user_id
  AND ues.exploratory_films_rated > rc.cnt;

-- Only fix exploration_rate if it violates the CHECK constraint bounds.
-- Do NOT recalculate rates that are already valid (preserves adaptive tuning).
UPDATE user_exploration_stats
SET exploration_rate = GREATEST(0.05, LEAST(0.30, exploration_rate))
WHERE exploration_rate < 0.05 OR exploration_rate > 0.30;
