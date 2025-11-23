-- Phase 5+: Adaptive Exploration Rate
-- Track how users respond to exploratory picks to adjust exploration rate

create table if not exists user_exploration_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  exploration_rate decimal(3,2) default 0.15 not null check (exploration_rate >= 0.05 and exploration_rate <= 0.30),
  exploratory_films_rated integer default 0 not null,
  exploratory_avg_rating decimal(3,2) default 0.0 not null,
  last_updated timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table user_exploration_stats enable row level security;

-- Policies
create policy "Users can view own exploration stats"
  on user_exploration_stats for select
  using (auth.uid() = user_id);

create policy "Users can insert own exploration stats"
  on user_exploration_stats for insert
  with check (auth.uid() = user_id);

create policy "Users can update own exploration stats"
  on user_exploration_stats for update
  using (auth.uid() = user_id);

-- Index for faster lookups
create index if not exists user_exploration_stats_user_id_idx on user_exploration_stats (user_id);

-- Comments
comment on table user_exploration_stats is 'Tracks user response to exploratory film suggestions to adaptively adjust exploration rate';
comment on column user_exploration_stats.exploration_rate is 'Current exploration rate (5-30%), adjusted based on user feedback';
comment on column user_exploration_stats.exploratory_avg_rating is 'Average rating of exploratory picks (0-5 scale)';
