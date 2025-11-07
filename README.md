# LettrSuggest

[![CI](https://github.com/noodlesx127/LettrSuggest/actions/workflows/ci.yml/badge.svg)](https://github.com/noodlesx127/LettrSuggest/actions/workflows/ci.yml)
[![Netlify Status](https://api.netlify.com/api/v1/badges/00000000-0000-0000-0000-000000000000/deploy-status)](https://app.netlify.com/sites/lettrsuggest/deploys)

Personalized movie suggestions and rich stats from your Letterboxd data.

## Tech Stack
- Next.js (App Router) + TypeScript + Tailwind
- Supabase (Auth, Database, Edge Functions)
- Netlify hosting
- ECharts for charts

## Getting Started
1. Install dependencies
```pwsh
npm install
```
2. Create `.env.local` with Supabase client config and TMDB server secret
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
# Server-only TMDB v4 Bearer token used by Next.js API routes
TMDB_API_KEY=
```
3. Initialize the database (once)
- In Supabase SQL editor, run the contents of `supabase/schema.sql` to create tables and RLS policies.
4. Run the dev server
```pwsh
npm run dev
```

## Deployment
- Connect GitHub repo to Netlify
- Set env vars in Netlify: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `TMDB_API_KEY` (server secret for the built-in Next.js API proxy).

### Netlify
- Live site: https://lettrsuggest.netlify.app/
- Replace the Netlify badge ID in the README badge (Site settings → Status badges) to show real-time deploy status.


## Supabase Setup (summary)
- Enable Email/Password auth.
- Run the SQL in `supabase/schema.sql` to create tables and RLS.
- Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY locally and on Netlify.

## Notes
- Admin route `/admin` includes a simple TMDB search tool.
- Import route `/import` supports ZIP or folder drag-and-drop, normalization, local preview, saving to Supabase, and TMDB mapping. Preview and Mapping now render side-by-side on desktop for quicker workflows.
- Library route `/library` shows your watched films in a poster-like grid, with watch counts and quick mapping edit controls.
	- Posters are loaded from TMDB (cached rows) using `image.tmdb.org` CDN; unmapped films show a title fallback.
	- Watch count derives from the number of diary entries per film (fallback to 1 if only in watched list or rated).

## Usage
1) Sign in or register via `/auth/login` or `/auth/register`.
2) Go to `/import` and upload your Letterboxd export (ZIP or CSVs/folder).
3) Review the preview, then click “Save to Supabase” to upsert into `film_events`.
4) Click “Map to TMDB” to:
	- Auto-map all unmapped titles (best-effort, concurrency-limited), and/or
	- Manually search and map remaining titles.
	Mappings are stored in `film_tmdb_map` and movie metadata cached in `tmdb_movies`.
5) Open `/stats` to see charts; use “Load from Supabase” to render from your cloud data.
6) Visit `/library` to browse a poster grid of your watched films, inspect accurate watch counts, and adjust TMDB mappings.

## Security & Secrets
- Never commit secrets. Use `.env.local` for local dev and Netlify env vars for deploys.
- Public client config lives behind `NEXT_PUBLIC_*`; do not expose server secrets (e.g., `TMDB_API_KEY`).
- GitHub Actions runs a secret scan (`.github/workflows/secret-scan.yml`) using Gitleaks on every push/PR.
- `.gitleaks.toml` allows NEXT_PUBLIC_* while flagging other keys.

## Supabase
- Supabase is used for authentication and per-user data (with Row Level Security): `film_events`, `film_tmdb_map`.
- Shared movie metadata cache lives in `tmdb_movies`.
- Client also writes a local IndexedDB cache for quick reloads without hitting the network.

## TMDB Proxy (built-in)
- Server routes: `/api/tmdb/search?query=Heat&year=1995`, `/api/tmdb/movie?id=123`
- Requires `TMDB_API_KEY` (TMDB v4 Bearer token) set in env. The key is never exposed to the browser.