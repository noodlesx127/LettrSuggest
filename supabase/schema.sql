-- Enable UUID and extensions if needed
-- create extension if not exists "uuid-ossp";

-- Profiles table (mirror auth users)
create table if not exists public.profiles (
  id uuid primary key,
  email text,
  created_at timestamp with time zone default now()
);

-- Film events: one row per distinct film import entry for a user
create table if not exists public.film_events (
  user_id uuid not null references public.profiles(id) on delete cascade,
  uri text not null,
  title text not null,
  year int,
  rating numeric,
  rewatch boolean,
  last_date text,
  watch_count int,
  liked boolean,
  on_watchlist boolean,
  updated_at timestamp with time zone default now(),
  primary key (user_id, uri)
);

-- Backfill-safe: add column if it doesn't exist on existing deployments
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'film_events' and column_name = 'watch_count'
  ) then
    alter table public.film_events add column watch_count int;
  end if;
end $$;

-- RLS
alter table public.profiles enable row level security;
alter table public.film_events enable row level security;

-- Policies (drop-then-create for idempotency; CREATE POLICY has no IF NOT EXISTS)
drop policy if exists "profiles self access" on public.profiles;
create policy "profiles self access" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles self insert" on public.profiles;
create policy "profiles self insert" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "film_events user read" on public.film_events;
create policy "film_events user read" on public.film_events
  for select using (auth.uid() = user_id);

drop policy if exists "film_events user upsert" on public.film_events;
create policy "film_events user upsert" on public.film_events
  for insert with check (auth.uid() = user_id);

drop policy if exists "film_events user update" on public.film_events;
create policy "film_events user update" on public.film_events
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Trigger to populate profiles from auth.users
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- TMDB metadata cache (no RLS; shared movie info)
create table if not exists public.tmdb_movies (
  tmdb_id bigint primary key,
  data jsonb not null,
  updated_at timestamp with time zone default now()
);

-- Cache of trending movie IDs (refreshed daily)
create table if not exists public.tmdb_trending (
  id bigserial primary key,
  period text not null default 'day', -- 'day' or 'week'
  tmdb_id bigint not null,
  rank int not null,
  updated_at timestamp with time zone default now()
);
create index if not exists tmdb_trending_period_idx on public.tmdb_trending (period);
create unique index if not exists tmdb_trending_unique on public.tmdb_trending (period, tmdb_id);

-- Map user's film URI to a TMDB id
create table if not exists public.film_tmdb_map (
  user_id uuid not null references public.profiles(id) on delete cascade,
  uri text not null,
  tmdb_id bigint not null references public.tmdb_movies(tmdb_id) on delete cascade,
  updated_at timestamp with time zone default now(),
  primary key (user_id, uri)
);

-- Add index for efficient user_id queries
create index if not exists film_tmdb_map_user_idx on public.film_tmdb_map (user_id);

alter table public.film_tmdb_map enable row level security;

drop policy if exists "film_tmdb_map user read" on public.film_tmdb_map;
create policy "film_tmdb_map user read" on public.film_tmdb_map
  for select using (auth.uid() = user_id);

drop policy if exists "film_tmdb_map user upsert" on public.film_tmdb_map;
create policy "film_tmdb_map user upsert" on public.film_tmdb_map
  for insert with check (auth.uid() = user_id);

drop policy if exists "film_tmdb_map user update" on public.film_tmdb_map;
create policy "film_tmdb_map user update" on public.film_tmdb_map
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Per-diary-entry table to support accurate watch counts and timelines
create table if not exists public.film_diary_events (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  uri text not null,
  watched_date date,
  rating numeric,
  rewatch boolean,
  created_at timestamp with time zone default now()
);

-- De-duplication on repeated imports: treat same (user, uri, date, rewatch) as one entry
create unique index if not exists film_diary_events_unique on public.film_diary_events (user_id, uri, watched_date, rewatch);

alter table public.film_diary_events enable row level security;

drop policy if exists "film_diary user read" on public.film_diary_events;
create policy "film_diary user read" on public.film_diary_events
  for select using (auth.uid() = user_id);

drop policy if exists "film_diary user insert" on public.film_diary_events;
create policy "film_diary user insert" on public.film_diary_events
  for insert with check (auth.uid() = user_id);

drop policy if exists "film_diary user update" on public.film_diary_events;
create policy "film_diary user update" on public.film_diary_events
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Aggregated watch counts view
create or replace view public.film_watch_counts as
  select user_id, uri, count(*)::bigint as watch_count
  from public.film_diary_events
  group by user_id, uri;
