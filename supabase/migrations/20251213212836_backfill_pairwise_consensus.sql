-- Backfill NULL consensus levels in pairwise_events table
-- Default to 'low' for any events that don't have consensus level set

UPDATE pairwise_events
SET winner_consensus = 'low'
WHERE winner_consensus IS NULL;

UPDATE pairwise_events
SET loser_consensus = 'low'
WHERE loser_consensus IS NULL;;
