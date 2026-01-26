-- Add source metadata to suggestion_feedback for per-source reliability tracking
-- Stores which providers contributed to the recommendation and the consensus level at time of feedback
alter table suggestion_feedback
  add column if not exists recommendation_sources text[] default '{}'::text[],
  add column if not exists consensus_level text check (consensus_level in ('high','medium','low'));

-- GIN index to filter/aggregate by contributing sources
create index if not exists suggestion_feedback_sources_gin on suggestion_feedback using gin (recommendation_sources);

comment on column suggestion_feedback.recommendation_sources is 'Sources that contributed to the recommendation (e.g., tmdb, tastedive, trakt, omdb)';
comment on column suggestion_feedback.consensus_level is 'Consensus strength when the suggestion was shown (high|medium|low)';;
