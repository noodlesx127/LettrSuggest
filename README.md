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
2. Create `.env.local` with Supabase client config
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```
3. Run the dev server
```pwsh
npm run dev
```

## Deployment
- Connect GitHub repo to Netlify
- Set env vars in Netlify: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. TMDB_API_KEY will be set where your proxy runs (Netlify or Supabase Edge) if you add one.

### Netlify
- Live site: https://lettrsuggest.netlify.app/
- Replace the Netlify badge ID in the README badge (Site settings → Status badges) to show real-time deploy status.


## Supabase Setup (summary)
- Enable Email/Password auth.
- Run the SQL in `supabase/schema.sql` to create tables and RLS.
- Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY locally and on Netlify.

## Notes
- Admin route `/admin` placeholder for user management UI (to add later).
- Import route `/import` parses Letterboxd CSVs (to implement next).

## Security & Secrets
- Never commit secrets. Use `.env.local` for local dev and Netlify env vars for deploys.
- Public client config lives behind `NEXT_PUBLIC_*`; do not expose server secrets (e.g., `TMDB_API_KEY`).
- GitHub Actions runs a secret scan (`.github/workflows/secret-scan.yml`) using Gitleaks on every push/PR.
- `.gitleaks.toml` allows NEXT_PUBLIC_* while flagging other keys.

## Supabase (optional)

If you prefer Supabase for auth + database:

- Add to your `.env.local` (see `.env.example`):
	- `NEXT_PUBLIC_SUPABASE_URL`
	- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Do not expose the service_role key in the browser. Use it only in server-side code or managed functions.
- We will add a `supabase/schema.sql` with tables and RLS policies for per-user data.

In this project’s current state, all core features work fully client-side via IndexedDB; Supabase enables optional cloud sync and auth.