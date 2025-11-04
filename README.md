# LettrSuggest

[![CI](https://github.com/noodlesx127/LettrSuggest/actions/workflows/ci.yml/badge.svg)](https://github.com/noodlesx127/LettrSuggest/actions/workflows/ci.yml)
[![Netlify Status](https://api.netlify.com/api/v1/badges/00000000-0000-0000-0000-000000000000/deploy-status)](https://app.netlify.com/sites/YOUR-NETLIFY-SITE/deploys)

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
- Replace the Netlify badge ID and site name in the README once your site is created.


## Firebase Setup (summary)
- Enable Email/Password auth first. Keep Google as optional to enable later.
- Create Firestore (production rules in `plan.md`).
- For Functions (later): store TMDB_API_KEY via `functions:secrets:set` and call TMDB in server code only.

## Notes
- Admin route `/admin` placeholder for user management UI (to add later).
- Import route `/import` parses Letterboxd CSVs (to implement next).