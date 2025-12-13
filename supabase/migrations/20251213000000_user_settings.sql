-- User settings table for theme preferences and other user-specific configuration
create table if not exists public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  theme_mode text not null default 'system', -- 'system', 'light', 'dark'
  darkness_level text not null default 'moderate', -- 'soft', 'moderate', 'deep', 'pitch'
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Enable RLS
alter table public.user_settings enable row level security;

-- Policies
drop policy if exists "user_settings self read" on public.user_settings;
create policy "user_settings self read" on public.user_settings
  for select using (auth.uid() = user_id);

drop policy if exists "user_settings self upsert" on public.user_settings;
create policy "user_settings self upsert" on public.user_settings
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_settings self update" on public.user_settings;
create policy "user_settings self update" on public.user_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Create default settings for existing users
insert into public.user_settings (user_id, theme_mode, darkness_level)
select id, 'system', 'moderate'
from public.profiles
where id not in (select user_id from public.user_settings)
on conflict (user_id) do nothing;

-- Notify PostgREST to reload schema
notify pgrst, 'reload schema';
