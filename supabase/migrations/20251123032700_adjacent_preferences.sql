-- Phase 5+: Personalized Adjacent Genre Preferences
-- Learn which adjacent genres work best for each user

create table if not exists user_adjacent_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  from_genre_id integer not null,
  from_genre_name text not null,
  to_genre_id integer not null,
  to_genre_name text not null,
  rating_count integer default 0 not null,
  avg_rating decimal(3,2) default 0.0 not null,
  success_rate decimal(3,2) default 0.0 not null check (success_rate >= 0.0 and success_rate <= 1.0),
  last_updated timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(user_id, from_genre_id, to_genre_id)
);

-- Enable RLS
alter table user_adjacent_preferences enable row level security;

-- Policies
create policy "Users can view own adjacent preferences"
  on user_adjacent_preferences for select
  using (auth.uid() = user_id);

create policy "Users can insert own adjacent preferences"
  on user_adjacent_preferences for insert
  with check (auth.uid() = user_id);

create policy "Users can update own adjacent preferences"
  on user_adjacent_preferences for update
  using (auth.uid() = user_id);

-- Indexes for faster lookups
create index if not exists user_adjacent_preferences_user_id_idx on user_adjacent_preferences (user_id);
create index if not exists user_adjacent_preferences_from_genre_idx on user_adjacent_preferences (user_id, from_genre_id);
create index if not exists user_adjacent_preferences_success_idx on user_adjacent_preferences (user_id, success_rate desc);

-- Comments
comment on table user_adjacent_preferences is 'Learns which adjacent genre transitions work best for each user';
comment on column user_adjacent_preferences.from_genre_id is 'Genre ID the user already likes';
comment on column user_adjacent_preferences.to_genre_id is 'Adjacent genre ID being explored';
comment on column user_adjacent_preferences.success_rate is 'Percentage of films rated >= 3.5 (0.0-1.0)';
