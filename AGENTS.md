# AGENTS.md - AI Coding Agent Guidelines

## Project Overview

**LettrSuggest** - Next.js 14 (App Router) + Supabase app that imports Letterboxd data and generates personalized movie recommendations using multi-source aggregation.

## Build/Lint/Test Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server (localhost:3000)
npm run build        # Production build
npm run lint         # ESLint (next/core-web-vitals)
npm run typecheck    # TypeScript type checking
```

### Testing (Playwright E2E)

```bash
npx playwright test                                    # Run all tests
npx playwright test tests/movie-card-features.spec.ts  # Single test file
npx playwright test -g "test name"                     # Tests matching name
npx playwright test --ui                               # Interactive UI mode
npx playwright test --headed                           # With browser visible
```

**Note**: Tests require real auth credentials. Recommendation tests need 5+ minute timeouts.

### CI Pipeline

Runs: `npm ci` -> `npm run lint` -> `npm run typecheck` -> `npm run build`

---

## Code Style Guidelines

### Import Organization

1. External libraries (`next`, `react`, `@supabase`)
2. Path-aliased imports (`@/lib/*`, `@/components/*`, `@/app/*`)
3. Use inline `type` keyword for type-only imports

```typescript
import { NextResponse } from "next/server";
import { useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "@/lib/supabaseClient";
```

### Path Aliases (always use instead of relative imports)

- `@/components/*`, `@/lib/*`, `@/app/*`

### Naming Conventions

| Element            | Convention           | Example                    |
| ------------------ | -------------------- | -------------------------- |
| Files (components) | PascalCase           | `MovieCard.tsx`            |
| Files (libraries)  | camelCase            | `apiCache.ts`              |
| Functions          | camelCase verbs      | `fetchTmdbMovie`           |
| Types/Interfaces   | PascalCase           | `AggregatedRecommendation` |
| Constants          | SCREAMING_SNAKE_CASE | `TRAKT_CACHE_TTL_DAYS`     |
| Event Handlers     | `handle` prefix      | `handleClick`              |

### TypeScript

- Strict mode enabled, Target: ES2022
- No `allowJs` - all code must be TypeScript
- Types inline or in `src/types/` for shared definitions

### Error Handling

**API Routes**: Return structured JSON

```typescript
return NextResponse.json({ error: "Missing query" }, { status: 400 });
```

**Console Logging**: Prefix with service name

```typescript
console.log("[Aggregator] Starting aggregation", { seedCount });
console.error("[Cache] Error:", error);
```

**Graceful Degradation**: Return empty arrays on failure, don't throw

### Component Patterns

```typescript
'use client';     // Client components - add at top
'use server';     // Server Actions - add at top
<AuthGate>...</AuthGate>  // Wrap authenticated pages
```

---

## Architecture

### Directory Structure

- `src/app/` - Pages and API routes
- `src/app/api/[service]/` - API route handlers
- `src/app/actions/` - Server Actions
- `src/components/` - Shared React components
- `src/lib/` - Libraries (API clients, caching, algorithms)
- `src/types/` - TypeScript type definitions
- `supabase/migrations/` - SQL migrations (timestamp-prefixed)

### Key Patterns

- **Supabase**: Import from `@/lib/supabaseClient`, verify session with `getSession()`, RLS enforced
- **Caching**: Cache-first via Supabase tables, use `isCacheValid()` from `apiCache.ts`
- **Concurrency**: `Promise.allSettled()` for parallel calls, `pLimit` for rate limiting
- **Retry**: All routes use `fetchWithRetry` with exponential backoff

---

## MCP & Tool Usage

- Use Netlify CLI/MCP for deployment - users don't need to do this manually
- Use Supabase MCP for database changes - users don't need to do this manually
- **Never stub or mock MCP calls**
- **Commit after every major change** - do not push until user instructs

---

## Security

- Never commit secrets - use `.env.local` locally, Netlify env vars for prod
- `NEXT_PUBLIC_*` exposed to browser; API keys stay server-side only
- Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `TMDB_API_KEY`, `TUIMDB_API_KEY`, `TRAKT_CLIENT_ID`

---

## Common Tasks

### Adding a New API Source

1. Create `src/lib/[service].ts`
2. Add `src/app/api/[service]/route.ts` with retry logic
3. Update `recommendationAggregator.ts`
4. (Optional) Add cache table via migration

### Adding a New Page

1. Create `src/app/[route]/page.tsx`
2. Add `'use client'` if interactive
3. Wrap with `<AuthGate>` if authenticated
4. Use `supabase.auth.getSession()` for user context

### Database Changes

1. Create `supabase/migrations/TIMESTAMP_description.sql`
2. Use `IF NOT EXISTS`, `DROP POLICY IF EXISTS` for idempotency
3. Run `NOTIFY pgrst, 'reload schema'` after changes
