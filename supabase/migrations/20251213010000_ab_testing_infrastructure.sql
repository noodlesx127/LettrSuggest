-- A/B Testing Infrastructure for Parameter Variation
-- Enables controlled experiments on recommendation algorithm parameters

-- Table to store active A/B test configurations
create table if not exists ab_test_configs (
  id bigserial primary key,
  test_name text not null unique,
  description text,
  status text not null default 'draft' check (status in ('draft', 'running', 'paused', 'completed')),
  start_date timestamptz,
  end_date timestamptz,
  -- Parameter variations being tested
  variants jsonb not null, -- Array of {name, params: {mmr_lambda, exploration_rate, source_weights, etc.}}
  traffic_split jsonb not null, -- {variant_a: 0.5, variant_b: 0.5} (must sum to 1.0)
  -- Targeting criteria (optional)
  user_criteria jsonb, -- {min_films_rated: 50, genres: ['sci-fi'], etc.}
  -- Success metrics
  primary_metric text not null, -- 'acceptance_rate', 'diversity_score', 'repeat_rate', etc.
  secondary_metrics text[],
  -- Metadata
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Table to track user assignments to test variants
create table if not exists ab_test_assignments (
  id bigserial primary key,
  test_id bigint not null references ab_test_configs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  variant_name text not null,
  assigned_at timestamptz not null default now(),
  -- Ensure one assignment per user per test
  unique (test_id, user_id)
);

-- Table to collect A/B test metrics
create table if not exists ab_test_metrics (
  id bigserial primary key,
  test_id bigint not null references ab_test_configs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  variant_name text not null,
  -- Metric data
  metric_name text not null,
  metric_value numeric not null,
  -- Context
  session_data jsonb, -- Discovery level, filters, mode, etc.
  -- Timestamp
  recorded_at timestamptz not null default now()
);

-- Enable RLS on all tables
alter table ab_test_configs enable row level security;
alter table ab_test_assignments enable row level security;
alter table ab_test_metrics enable row level security;

-- Policies for ab_test_configs (admins can manage, users can view active tests)
create policy "Anyone can view active AB tests"
  on ab_test_configs for select
  using (status = 'running');

-- Policies for ab_test_assignments (users can view their own assignments)
create policy "Users can view their own AB test assignments"
  on ab_test_assignments for select
  using (auth.uid() = user_id);

-- Policies for ab_test_metrics (users can insert their own metrics)
create policy "Users can insert their own AB test metrics"
  on ab_test_metrics for insert
  with check (auth.uid() = user_id);

create policy "Users can view their own AB test metrics"
  on ab_test_metrics for select
  using (auth.uid() = user_id);

-- Indexes for performance
create index if not exists ab_test_configs_status_idx on ab_test_configs (status);
create index if not exists ab_test_configs_dates_idx on ab_test_configs (start_date, end_date);
create index if not exists ab_test_assignments_user_idx on ab_test_assignments (user_id);
create index if not exists ab_test_assignments_test_idx on ab_test_assignments (test_id);
create index if not exists ab_test_metrics_test_variant_idx on ab_test_metrics (test_id, variant_name);
create index if not exists ab_test_metrics_recorded_idx on ab_test_metrics (recorded_at desc);

-- Notify PostgREST to reload schema
notify pgrst, 'reload schema';
