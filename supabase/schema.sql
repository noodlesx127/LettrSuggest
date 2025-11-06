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
  liked boolean,
  on_watchlist boolean,
  updated_at timestamp with time zone default now(),
  primary key (user_id, uri)
);

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

-- Map user's film URI to a TMDB id
create table if not exists public.film_tmdb_map (
  user_id uuid not null references public.profiles(id) on delete cascade,
  uri text not null,
  tmdb_id bigint not null references public.tmdb_movies(tmdb_id) on delete cascade,
  updated_at timestamp with time zone default now(),
  primary key (user_id, uri)
);

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
