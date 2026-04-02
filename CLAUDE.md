# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**LettrSuggest** — Next.js 14 (App Router) + Supabase app that imports Letterboxd data and generates personalized movie recommendations via a multi-source aggregation engine.

## Commands

```bash
npm run dev          # Dev server at localhost:3000
npm run build        # Production build
npm run lint         # ESLint (next/core-web-vitals)
npm run typecheck    # tsc --noEmit

# Playwright E2E (requires dev server running)
npx playwright test                                     # All tests
npx playwright test tests/movie-card-features.spec.ts   # Single file
npx playwright test -g "test name"                      # Filter by name
npx playwright test --ui                                # Interactive mode
```

Tests require real auth credentials. Recommendation tests need `test.setTimeout(300000)`.

CI pipeline: `npm ci` → `lint` → `typecheck` → `build`

## Architecture

### Data Flow

1. **Import** — Users upload Letterboxd CSV/ZIP → parsed by `normalize.ts` → stored in `film_events` (Supabase) and IndexedDB (Dexie via `db.ts`)
2. **Mapping** — Films matched to TMDB IDs → `film_tmdb_map` (per-user) → metadata cached in `tmdb_movies` (shared)
3. **Recommendations** — `recommendationAggregator.ts` fetches from 4 sources in parallel (TMDB, TasteDive, TuiMDB, Watchmode), deduplicates by TMDB ID, scores by cross-source consensus
4. **Feedback Loop** — Reactions stored in `suggestion_feedback` + `pairwise_events` → adaptive learning via `adaptiveLearning.ts` and `enrich.ts`

### Key Source Locations

| Concern                     | Location                                           |
| --------------------------- | -------------------------------------------------- |
| Recommendation engine       | `src/lib/recommendationAggregator.ts`              |
| API caching helpers         | `src/lib/apiCache.ts`                              |
| Adaptive learning           | `src/lib/adaptiveLearning.ts`, `src/lib/enrich.ts` |
| Supabase singleton          | `src/lib/supabaseClient.ts`                        |
| Server Actions (secure ops) | `src/app/actions/`                                 |
| External API proxies        | `src/app/api/[service]/route.ts`                   |
| DB migrations               | `supabase/migrations/` (timestamp-prefixed)        |
| Master schema               | `supabase/schema.sql`                              |

### Server Actions vs API Routes

- **Server Actions** (`'use server'`): Use for anything requiring API keys — recommendations, enrichment. Import from `@/app/actions/`, never call internal API routes from here.
- **API Routes**: HTTP endpoints for external clients and proxying third-party APIs. All use `fetchWithRetry` (3 attempts, exponential backoff, Retry-After handling).

### Supabase Patterns

```typescript
// Always use the singleton
import { supabase } from "@/lib/supabaseClient";

// Always verify session before user-specific queries
const {
  data: { session },
} = await supabase.auth.getSession();
```

- RLS enforced on all user tables (`film_events`, `film_tmdb_map`, `suggestion_feedback`, `pairwise_events`) — never bypass
- Shared caches (`tmdb_movies`, `tmdb_similar_cache`, `tuimdb_uid_cache`) have no RLS; readable by all, writable server-side only

### Caching Strategy

Cache-first pattern against Supabase cache tables:

1. Check cache table, validate TTL with `isCacheValid()` from `apiCache.ts` (7 days for recommendations, 30 days for UID lookups)
2. On miss: call external API, upsert result back to cache
3. See `getCachedTMDBSimilar()` / `setCachedTMDBSimilar()` in `apiCache.ts` as the reference implementation

### Concurrency

- `Promise.allSettled()` for parallel multi-source API calls (see `aggregateRecommendations`)
- `pLimit(5)` for rate-limited batch operations (TMDB auto-mapping)

## Code Conventions

### Imports

```typescript
// Order: external → path-aliased; use inline `type` for type-only
import { NextResponse } from "next/server";
import type { ReactNode } from "react";
import { supabase } from "@/lib/supabaseClient";
```

Always use `@/` aliases — never relative imports.

### Naming

| Element          | Convention           | Example                    |
| ---------------- | -------------------- | -------------------------- |
| Component files  | PascalCase           | `MovieCard.tsx`            |
| Library files    | camelCase            | `apiCache.ts`              |
| Functions        | camelCase verbs      | `fetchTmdbMovie`           |
| Types/Interfaces | PascalCase           | `AggregatedRecommendation` |
| Constants        | SCREAMING_SNAKE_CASE | `TMDB_CACHE_TTL_DAYS`      |

### Error Handling

- API Routes return `NextResponse.json({ error: string }, { status: number })` — don't throw
- Log with service prefix: `console.error('[Aggregator] message', data)`
- Graceful degradation: cache/API failures return empty arrays

### Database Migrations

1. Create `supabase/migrations/TIMESTAMP_description.sql`
2. Use `CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` for idempotency
3. Use DO blocks for backfill-safe column additions (see `schema.sql` `watch_count` example)
4. End with `NOTIFY pgrst, 'reload schema'`

### Authenticated Pages

```typescript
'use client';
// Wrap with AuthGate; get user context from supabase.auth.getSession()
<AuthGate><YourPage /></AuthGate>
```

## Environment Variables

**Browser-exposed** (`NEXT_PUBLIC_*`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

**Server-only**: `TMDB_API_KEY`, `TUIMDB_API_KEY`, `WATCHMODE_API_KEY`, `TASTEDIVE_API_KEY`, `OMDB_API_KEY`

Set locally in `.env.local`; in production via Netlify UI or `netlify env:set KEY "value"`.

## Deployment

Netlify auto-deploys from GitHub via `@netlify/plugin-nextjs`. Gitleaks secret scanning runs on all pushes (`.github/workflows/secret-scan.yml`).

## Documentation

- All docs → `/docs/`
- Plans → `/docs/plans/`
- Summaries → `/docs/summary/`

Commit after every bug fix or feature. Update relevant docs before committing.
