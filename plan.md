# LettrSuggest – Project Plan

## Overview
Build a web app that uses a user’s Letterboxd export to
1) suggest movies with clear, data-backed reasons and dynamic filters (exclude films/genres), and
2) present rich stats and trends across their entire history.

Hosting on Netlify, using Supabase for auth and database (optional cloud sync). GitHub for source control and CI/CD.

## Goals and MVP Scope
- Import: Upload Letterboxd CSV zip/folder; parse watched, diary, ratings, watchlist, likes.
- Enrich: Resolve films to TMDB and fetch genres, crew, keywords, runtime, countries, year.
- Recommend: Content-based, explainable suggestions; focus watchlist-first + discovery; support excludes (films/genres/years) and re-rank dynamically.
- Stats: Ratings distribution, trends, rewatches, top genres/directors/actors, by year/decade, runtime histograms, watchlist aging.
- Privacy: User data is private to the user; no cross-user sharing.

Stretch (post-MVP)
- Collaborative hints via popular films (non-personal data) without storing other users.
- "Because you liked X" carousels per feature (director/genre/actor).
- Embeddings for keywords/overviews to improve similarity.

## Product Requirements
- Upload wizard: drag-and-drop Letterboxd export; validate files; quick summary.
- Suggestions page: query box (e.g., mood/filters), top N suggestions with reason strings and badges; exclude toggle for films/genres/years.
- Stats dashboard: time-series and facets; interactive filters (year range, genre, rewatch-only, new-to-me).
- Film detail drawer: compact metadata, user history/ratings, similar films.
- Settings: connect TMDB key, data refresh, export enriched data as JSON.
- Performance: under 2s for typical queries (5k films). Client cache + server cache.
- Accessibility: keyboard nav and ARIA for charts and lists.

## Technical Architecture
- Frontend: Next.js (App Router) + TypeScript + Tailwind + React Query.
- Backend: Firebase
  - Auth: email/password + OAuth (Google) optional.
  - Firestore: user documents, film metadata cache, user vectors, events.
  - Cloud Functions: TMDB enrichment + scheduled cache warming.
  - Storage: optional for raw uploads.
- Hosting: Netlify (Next.js adapter). Netlify env vars for Supabase config, TMDB API key (if using a proxy). Use edge/runtime where possible.
- GitHub: trunk-based dev, PRs, Actions for lint/typecheck/test/build, Netlify deploy previews.

### Data Flow
1) User uploads CSVs
2) Client parses and summarises
3) Client sends canonicalized film events to Firestore or calls a Function for enrichment batch
4) Function resolves TMDB IDs and fetches metadata; stores Film document cache
5) Client requests recommendations; server computes (or client-side using cached metadata) and returns scored results + reasons
6) Client renders stats directly from cached metadata + events

### Data Model (Firestore)
- users/{uid}
  - profile: { displayName, createdAt }
  - settings: { excludeGenres: string[], filters... }
- users/{uid}/events/{filmUri}
  - { uri, title, year, ratings[], diary[], liked: boolean, lastWatchedDate }
- films/{tmdbId}
  - { tmdbId, imdbId, title, year, genres[], keywords[], directors[], cast[], countries[], runtime }
- users/{uid}/vectors/profile
  - { featureWeights: { [feature]: weight }, updatedAt }
- users/{uid}/recommendations/snapshots/{id}
  - { createdAt, filters, top: [{ tmdbId, score, reasons: string[] }] }

Note: Use Letterboxd URI as temporary key until TMDB ID is known; maintain mapping in users/{uid}/mappings.

## Recommendation Design (Explainable)
- Build feature vectors per film using:
  - Genres (one-hot), directors, top N actors, keywords; optional: decade, country.
- User preference vector u:
  - Positive signals: high ratings, likes, rewatches; recency weighting.
  - Negative signals: low ratings, explicit excludes.
- Scoring: weighted cosine(u, v) + bonuses (watchlist, novelty) − penalties (excluded genres/films).
- Explanations: surface top contributing features and cite source films/ratings, e.g.,
  - "Shares director with Drive (4.5★) and fits your neo-noir + 2010s crime pattern."
- Filters: exclude films/genres/years; client sends as query; server prunes and recomputes quickly.

## Stats & Visualizations
- Time series: watches/ratings by month; moving average rating; rewatch share.
- Distributions: ratings histogram; runtime; by year/decade; by country.
- Facets: top directors/actors/genres by count and avg rating; discovery vs comfort.
- Watchlist analytics: age buckets; high-fit not-yet-watched.
- Tech: Recharts (SSR-safe) or ECharts via dynamic import.

## Supabase Setup
- Create project; enable Authentication (Email/Password, Google optional).
- Create Firestore (production mode); set rules to limit to uid == request.auth.uid.
- Create Functions (Node 20 runtime). Secrets: TMDB_API_KEY.
- Optional Storage bucket for raw uploads.

Firestore Security Rules (sketch)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    match /films/{tmdbId} {
      allow read: if true; // public metadata cache
      allow write: if false; // only via Functions
    }
  }
}
```

## Netlify Deployment
- Connect GitHub repo to Netlify.
- Build command: `npm run build` (Next.js) with adapter. Publish dir: `.next`/ Netlify adapter default.
- Env vars: NEXT_PUBLIC_FIREBASE_*; FIREBASE_* (service account for Functions local use if needed); TMDB_API_KEY (stored as Netlify Secret, not exposed to client—Functions read it).
- Deploy Previews for PRs; Production on main branch.

## GitHub Workflow
- Branching: `main` protected; feature branches via PRs.
- PR checks (GitHub Actions):
  - Lint: ESLint
  - Typecheck: tsc
  - Test: Vitest/React Testing Library
  - Build: Next.js
- Automatic deploy previews via Netlify GitHub App.
- Conventional commits; auto-changelog.

## CI/CD (GitHub Actions)
- Node 20; cache npm; run lint/typecheck/test/build; upload artifacts.
- Netlify CLI for deploy previews if GitHub App not used.

## Environment & Secrets
 - Local `.env.local`: Supabase client config (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY).
 - Netlify environment: Supabase client config.
 - For a TMDB proxy, prefer Netlify Functions or Supabase Edge Functions with secrets.

## Milestones & Timeline (indicative)
1. Day 1–2: Scaffold Next.js app, Supabase init, Netlify deploy, Auth.
2. Day 3–4: CSV import, normalization, merge events; basic stats.
3. Day 5–7: TMDB enrichment Function + Firestore cache.
4. Day 8–9: Recommender v1 + explanations + filters.
5. Day 10–12: Stats polish, accessibility, tests, performance.

## Risks & Mitigations
- TMDB rate limits → batch with delays; cache aggressively; retries and backoff.
- Title/year mismatches → fuzzy matching; manual resolve tool in UI.
- Large exports → chunk parsing; web workers; pagination; memoized selectors.
- Privacy → strict security rules; optional local-only mode (client mode without server).

## Next Steps
- Confirm stack and scope above.
- Initialize repo + CI + Netlify site + Supabase project.
- Implement CSV import + basic stats first; then enrichment + recommender.
