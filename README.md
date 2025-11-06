# LettrSuggest

[![CI](https://github.com/noodlesx127/LettrSuggest/actions/workflows/ci.yml/badge.svg)](https://github.com/noodlesx127/LettrSuggest/actions/workflows/ci.yml)
[![Netlify Status](https://api.netlify.com/api/v1/badges/00000000-0000-0000-0000-000000000000/deploy-status)](https://app.netlify.com/sites/lettrsuggest/deploys)

Personalized movie suggestions and rich stats from your Letterboxd data.

## Tech Stack
- Next.js (App Router) + TypeScript + Tailwind
- Firebase (Auth, Firestore, Functions)
- Netlify hosting
- ECharts for charts

## Getting Started
1. Install dependencies
```pwsh
npm install
```
2. Create `.env.local` with Firebase client config
```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```
3. Run the dev server
```pwsh
npm run dev
```

## Deployment
- Connect GitHub repo to Netlify
- Set env vars in Netlify: the NEXT_PUBLIC_FIREBASE_* values. TMDB_API_KEY will be set as a Function secret later.

### Netlify
- Live site: https://lettrsuggest.netlify.app/
- Replace the Netlify badge ID in the README badge (Site settings → Status badges) to show real-time deploy status.


## Firebase Setup (summary)
- Enable Email/Password auth first. Keep Google as optional to enable later.
- Create Firestore (production rules in `plan.md`).
- For Functions (later): store TMDB_API_KEY via `functions:secrets:set` and call TMDB in server code only.

### Firebase CLI quickstart
1) Install tools
```pwsh
npm i -g firebase-tools
firebase login
```
2) Set your project ID in `.firebaserc` (replace YOUR_FIREBASE_PROJECT_ID)
3) Configure secrets (from your shell; not checked into Git)
```pwsh
firebase functions:secrets:set TMDB_API_KEY
```
4) Deploy functions
```pwsh
cd functions
npm install
npm run build
cd ..
firebase deploy --only functions
```
5) Call the enrichment endpoint (example)
GET https://us-east1-lettrsuggest.cloudfunctions.net/enrich?title=Heat&year=1995

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