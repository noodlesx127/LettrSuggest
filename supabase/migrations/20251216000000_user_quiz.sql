-- User Quiz Responses table
-- Tracks user quiz answers for learning and analytics

create table if not exists public.user_quiz_responses (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_type text not null, -- 'genre_rating', 'theme_preference', 'movie_rating'
  question_data jsonb not null, -- Question details (e.g., { genreId: 28, genreName: "Action" })
  answer jsonb not null, -- User's response (e.g., { rating: 4 } or { thumbsUp: true })
  created_at timestamp with time zone default now()
);

-- Indexes for efficient querying
create index if not exists user_quiz_responses_user_idx on public.user_quiz_responses (user_id);
create index if not exists user_quiz_responses_type_idx on public.user_quiz_responses (question_type);
create index if not exists user_quiz_responses_created_idx on public.user_quiz_responses (user_id, created_at desc);

-- Row Level Security
alter table public.user_quiz_responses enable row level security;

drop policy if exists "user_quiz_responses_read" on public.user_quiz_responses;
create policy "user_quiz_responses_read" on public.user_quiz_responses
  for select using (auth.uid() = user_id);

drop policy if exists "user_quiz_responses_insert" on public.user_quiz_responses;
create policy "user_quiz_responses_insert" on public.user_quiz_responses
  for insert with check (auth.uid() = user_id);

-- Comments for documentation
comment on table public.user_quiz_responses is 'Stores user responses to the taste quiz for preference learning';
comment on column public.user_quiz_responses.question_type is 'Type of quiz question: genre_rating, theme_preference, or movie_rating';
comment on column public.user_quiz_responses.question_data is 'JSON containing question details like genre/keyword/movie info';
comment on column public.user_quiz_responses.answer is 'JSON containing user response (rating scale or thumbs up/down)';
