-- Create suggestion_exposure_log table to track when suggestions are shown
-- This enables repeat-suggestion rate tracking and counterfactual analysis

create table if not exists suggestion_exposure_log (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  tmdb_id integer not null,
  exposed_at timestamptz not null default now(),
  -- Categorization and context
  category text, -- e.g. 'seasonalPicks', 'perfectMatches', 'multiSourceConsensus'
  session_context jsonb, -- Discovery slider position, filters applied, etc.
  -- Scoring metadata for counterfactual replay
  base_score numeric,
  consensus_level text, -- 'high', 'medium', 'low'
  sources text[], -- Contributing recommendation sources
  reasons text[], -- Reason types shown
  -- MMR/diversity parameters used
  mmr_lambda numeric, -- Lambda value at exposure time
  diversity_rank integer, -- Position after diversity rerank
  -- Quality metadata
  has_poster boolean,
  has_trailer boolean,
  metadata_completeness numeric, -- 0-1 score
  -- Index for efficient queries
  created_at timestamptz not null default now()
);

-- Enable RLS
alter table suggestion_exposure_log enable row level security;

-- Policies
create policy "Users can view their own exposure logs"
  on suggestion_exposure_log for select
  using (auth.uid() = user_id);

create policy "Users can insert their own exposure logs"
  on suggestion_exposure_log for insert
  with check (auth.uid() = user_id);

-- Indexes for performance
create index if not exists suggestion_exposure_log_user_id_idx on suggestion_exposure_log (user_id);
create index if not exists suggestion_exposure_log_tmdb_id_idx on suggestion_exposure_log (tmdb_id);
create index if not exists suggestion_exposure_log_user_tmdb_idx on suggestion_exposure_log (user_id, tmdb_id);
create index if not exists suggestion_exposure_log_exposed_at_idx on suggestion_exposure_log (exposed_at desc);
create index if not exists suggestion_exposure_log_category_idx on suggestion_exposure_log (category);
create index if not exists suggestion_exposure_log_consensus_idx on suggestion_exposure_log (consensus_level);

-- Notify PostgREST to reload schema
notify pgrst, 'reload schema';
