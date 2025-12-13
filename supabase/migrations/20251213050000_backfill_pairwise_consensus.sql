-- Backfill NULL consensus levels in pairwise_events table
-- Default to 'low' for any events that don't have consensus level set

UPDATE pairwise_events
SET winner_consensus = 'low'
WHERE winner_consensus IS NULL;

UPDATE pairwise_events
SET loser_consensus = 'low'
WHERE loser_consensus IS NULL;

-- Log the update
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO updated_count
  FROM pairwise_events
  WHERE winner_consensus = 'low' OR loser_consensus = 'low';
  
  RAISE NOTICE 'Backfilled consensus levels for % pairwise events', updated_count;
END $$;
