# LettrSuggest AI Coding Guide

## Project Overview
Next.js 14 (App Router) + Supabase app that imports Letterboxd data and generates personalized movie suggestions using multi-source recommendation aggregation.

## Architecture

### Data Flow
1. **Import**: Users upload Letterboxd CSVs/ZIP → normalized via `normalize.ts` → stored in `film_events` (Supabase) and IndexedDB (client cache via Dexie)
2. **Mapping**: Films matched to TMDB IDs → stored in `film_tmdb_map` (user-specific) → metadata cached in `tmdb_movies` (shared)
3. **Recommendations**: Multi-source aggregator (`recommendationAggregator.ts`) combines TMDB, Trakt, TasteDive, TuiMDB, Watchmode → consensus scoring → filtered suggestions

### Key Components
- **Server Actions** (`src/app/actions/`): Use `'use server'` directive for API-key-protected operations (recommendations, enrichment)
- **API Routes** (`src/app/api/`): Proxy external APIs (TMDB, Trakt, etc.) with server-side keys. All routes use `fetchWithRetry` with exponential backoff
- **Supabase**: RLS-enabled per-user tables (`film_events`, `film_tmdb_map`, `suggestion_feedback`) + shared caches (`tmdb_movies`, `trakt_related_cache`, `tmdb_similar_cache`)
- **Client State**: Dexie IndexedDB for offline access (`db.ts`), React Context for import state (`importStore.tsx`), SWR for poster caching (`usePostersSWR.ts`)

## Critical Patterns

### Supabase Usage
- **Client Access**: Import from `@/lib/supabaseClient` (singleton, checks env vars)
- **Auth**: Always verify session with `supabase.auth.getSession()` before user-specific queries
- **RLS Enforcement**: User tables filter by `auth.uid() = user_id`. Never bypass RLS
- **Schema Changes**: Add migrations to `supabase/migrations/`, use backfill-safe DDL (see `schema.sql` DO blocks), run `notify pgrst, 'reload schema'`

### API Caching Strategy
- **Cache-first**: Check Supabase cache tables (`trakt_related_cache`, `tmdb_similar_cache`, `tuimdb_uid_cache`) before API calls
- **TTL Validation**: Use `isCacheValid()` from `apiCache.ts` (7 days for recommendations, 30 days for UID lookups)
- **Upsert Pattern**: Cache misses trigger API calls → upsert results back to cache
- **Example**: See `getCachedTraktRelated()` / `setCachedTraktRelated()` in `apiCache.ts`

### Recommendation System
- **Aggregator** (`recommendationAggregator.ts`): Fetches from 5 sources in parallel, deduplicates by TMDB ID, calculates consensus score
- **Scoring**: More sources agreeing = higher score. Weights: 3+ sources = high consensus, 2 = medium, 1 = low
- **Feedback Loop**: User interactions stored in `suggestion_feedback` and `pairwise_events` → adaptive learning via `adaptiveLearning.ts`

### Concurrent API Calls
- **Batch Processing**: Use `Promise.allSettled()` for parallel API calls (see `aggregateRecommendations`)
- **Rate Limiting**: TMDB auto-mapping uses `pLimit` (concurrency: 5) to avoid 429s
- **Retry Logic**: All API routes implement `fetchWithRetry` with 3 attempts, exponential backoff, and Retry-After header handling

## Development Workflows

### Local Dev
```pwsh
npm install
# Set .env.local with NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, TMDB_API_KEY, TUIMDB_API_KEY, TRAKT_CLIENT_ID
npm run dev  # Starts on localhost:3000
```

### Database Changes
1. Create migration in `supabase/migrations/` (timestamp_description.sql)
2. Use `create table if not exists` and `drop policy if exists` for idempotency
3. Add backfill-safe column additions with DO blocks (see `schema.sql` watch_count example)
4. Test locally, then apply via Supabase dashboard or CLI

### Testing
- **Playwright**: `npx playwright test` (requires `npm run dev` running)
- **Auth Required**: Tests use real credentials (see `movie-card-features.spec.ts` beforeEach)
- **Timeouts**: Recommendation tests need 5+ min (set `test.setTimeout(300000)`)

### Deployment
- **Netlify**: Automatic deploys from GitHub via `@netlify/plugin-nextjs`
- **Env Vars**: Set in Netlify UI or `netlify env:set KEY "value"`
- **Required Keys**: All `NEXT_PUBLIC_*`, `TMDB_API_KEY`, `TUIMDB_API_KEY`, `TRAKT_CLIENT_ID`

## Code Conventions

### File Organization
- **Route Handlers**: `src/app/api/[service]/[endpoint]/route.ts` (TMDB, Trakt, etc.)
- **Libraries**: `src/lib/` for reusable logic (API clients, caching, algorithms)
- **Components**: `src/components/` for shared UI (AuthGate, MovieCard, Chart)
- **Types**: Define inline or in `src/types/` for shared type definitions

### Import Patterns
- Use `@/` alias for absolute imports (`@/lib/supabaseClient`, `@/components/NavBar`)
- Server Actions: Import from `@/app/actions/` (never call API routes directly)
- Client-only libraries (Dexie, SWR): Import only in `'use client'` files

### Error Handling
- **API Routes**: Return `NextResponse.json({ error: string }, { status: number })`
- **Console Logging**: Prefix with service name `[Aggregator]`, `[Cache]`, `[TMDB]` for searchability
- **Graceful Degradation**: Cache misses/API failures return empty arrays, not thrown errors

### Naming
- **Functions**: Descriptive verbs (`fetchTmdbMovie`, `upsertFilmMapping`, `getCachedTraktRelated`)
- **Types**: PascalCase with descriptive names (`AggregatedRecommendation`, `SourceRecommendation`)
- **Constants**: SCREAMING_SNAKE_CASE for config (`TRAKT_CACHE_TTL_DAYS`)

## Security Notes
- **Never commit secrets**: Use `.env.local` locally, Netlify env vars for production
- **Public vs Server Keys**: `NEXT_PUBLIC_*` exposed to browser; API keys stay server-side in API routes/Server Actions
- **Secret Scanning**: Gitleaks runs on all pushes (`.github/workflows/secret-scan.yml`). `.gitleaks.toml` allows `NEXT_PUBLIC_*`

## Common Tasks

### Adding a New API Source
1. Create client library in `src/lib/[service].ts` with typed functions
2. Add API route in `src/app/api/[service]/route.ts` with retry logic
3. Update `recommendationAggregator.ts` to include new source
4. (Optional) Add cache table in new migration if needed

### Adding a New Page
1. Create `src/app/[route]/page.tsx` with `'use client'` if interactive
2. Wrap authenticated pages with `<AuthGate>` component
3. Use `supabase.auth.getSession()` to get user context
4. Import shared components from `@/components/`

### Modifying Recommendation Algorithm
- Core logic in `recommendationAggregator.ts` (`calculateAggregateScore`, `mergeRecommendations`)
- Feedback learning in `adaptiveLearning.ts` and `enrich.ts` (`applyPairwiseFeatureLearning`)
- Test changes with real data via `/suggest` page (requires authenticated user with import history)
