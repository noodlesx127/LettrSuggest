# LettrSuggest

[![CI](https://github.com/noodlesx127/LettrSuggest/actions/workflows/ci.yml/badge.svg)](https://github.com/noodlesx127/LettrSuggest/actions/workflows/ci.yml)

LettrSuggest turns a Letterboxd export into a private movie library, detailed viewing statistics, and personalized recommendations. It combines a user's watch history, ratings, likes, watchlist, feedback, and inferred taste profile with several movie-data sources.

[Open the live app](https://lettrsuggest.netlify.app/)

## Features

- Import Letterboxd ZIP files, folders, or CSV exports and normalize them into a per-user library.
- Browse watched films, diary history, watchlist entries, lists, posters, and TMDB mappings.
- Generate personalized suggestions, genre picks, counter-programming choices, and palate cleansers.
- Learn from likes, blocks, feature feedback, pairwise choices, and the onboarding taste quiz.
- Explore viewing statistics, taste and avoidance profiles, watchlist analysis, and algorithm insights.
- Use the authenticated `/api/v1` API with user, developer, and admin API keys.
- Manage users, cache state, diagnostics, API keys, and signed webhooks from the admin surface.

## Technology

- Next.js 14 App Router, React 18, TypeScript, and Tailwind CSS
- Supabase Auth, Postgres, Row Level Security, migrations, and pgvector
- TMDB as the primary movie source, with optional TuiMDB, TasteDive, Watchmode, and OpenAI enrichment
- ECharts for visualizations and Dexie/IndexedDB for local caching
- Vitest for unit and integration tests; Playwright for end-to-end and API tests
- Netlify for production hosting and GitHub Actions for CI and secret scanning

## Prerequisites

- Node.js 20 and npm
- A Supabase project
- A TMDB API key
- The Supabase CLI when applying migrations or running Supabase locally

## Local setup

1. Install the locked dependencies:

   ```powershell
   npm ci
   ```

2. Copy `.env.example` to `.env.local` and fill in the required values:

   ```powershell
   Copy-Item .env.example .env.local
   ```

3. Apply the versioned database migrations to a linked Supabase project:

   ```powershell
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```

   The files in `supabase/migrations/` are the source of truth for database changes. `supabase/schema.sql` is retained as a schema reference.

4. Start the application:

   ```powershell
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000), create an account, and import a Letterboxd export from `/import`.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL used by the browser and server. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Public Supabase anonymous key; access is constrained by RLS. |
| `TMDB_API_KEY` | Yes | Server-only key for movie search, metadata, discovery, and recommendations. |
| `SUPABASE_SERVICE_ROLE_KEY` | For API/admin features | Server-only key for privileged `/api/v1`, admin, and maintenance operations. |
| `TUIMDB_API_KEY` | No | Additional genre and movie enrichment. |
| `TASTEDIVE_API_KEY` | No | TasteDive similarity candidates. |
| `WATCHMODE_API_KEY` | No | Streaming availability and related movie data. |
| `OPENAI_API_KEY` | No | Embedding generation for vector similarity features. |
| `NEXT_PUBLIC_SITE_URL` | No | Public application origin; defaults to `http://localhost:3000`. |
| `PLAYWRIGHT_BASE_URL` | No | Runs Playwright against an existing deployment instead of starting the dev server. |

Never expose `SUPABASE_SERVICE_ROLE_KEY` or any movie-provider key through a `NEXT_PUBLIC_*` variable. Local environment files are ignored; `.env.example` contains names only and is intentionally tracked.

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Next.js development server. |
| `npm run build` | Create a production build. |
| `npm run start` | Serve the production build. |
| `npm run lint` | Run the Next.js ESLint configuration. |
| `npm run typecheck` | Run TypeScript without emitting files. |
| `npm test` | Run all Vitest tests once. |
| `npm run test:unit` | Run the unit-test directory. |
| `npm run test:integration` | Run the integration-test directory. |
| `npx playwright test` | Run Playwright end-to-end and API tests. |

Playwright tests use real Supabase authentication and data. Configure suitable test credentials and allow longer timeouts for recommendation-generation scenarios. When `PLAYWRIGHT_BASE_URL` is unset, Playwright starts the local development server automatically.

## Typical workflow

1. Register or sign in.
2. Import the ZIP file downloaded from Letterboxd.
3. Review normalized events and map titles to TMDB metadata.
4. Browse the library, diary, watchlist, lists, and statistics pages.
5. Complete the taste quiz and generate suggestions or genre picks.
6. Like, block, save, and rate recommendation features so later results can adapt.

Letterboxd exports contain personal activity and are ignored by Git under `letterboxd-userdata/`. Do not add real exports as fixtures; use anonymized, purpose-built test data instead.

## API

The versioned API supports Supabase JWTs and LettrSuggest API keys. It includes health, profile, film, diary, watchlist, stats, movie, suggestion, feedback, API-key, webhook, cache, diagnostics, and user-administration endpoints.

See [docs/API.md](docs/API.md) for authentication, permissions, request/response formats, pagination, rate limits, webhook signing, and the endpoint reference.

## Project layout

```text
src/app/               Pages, server actions, and API route handlers
src/components/        Shared application and UI components
src/lib/               API clients, caching, imports, and recommendation logic
src/types/             Shared TypeScript declarations
supabase/migrations/   Versioned database changes
supabase/tests/        Database security and behavior tests
tests/unit/            Vitest unit tests
tests/integration/     Vitest integration tests
tests/*.spec.ts        Playwright end-to-end and API tests
docs/                  API, design, plans, and implementation summaries
```

## Deployment and security

Netlify builds with `npm run build` and publishes the Next.js output through `@netlify/plugin-nextjs`. Configure the same required environment variables in Netlify and keep every server-only key in the site's protected environment settings.

GitHub Actions runs lint, type checking, and a production build on pushes and pull requests to `main`. A separate Gitleaks workflow scans for committed secrets. Supabase tables use Row Level Security for per-user data, while privileged server operations use the service-role key only on the server.

Before committing, run:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```
