# Project Progress

Updated: 2025-11-05

## Current Focus
- Finish import → Supabase persistence and mapping to TMDB IDs; wire Stats to normalized data.

## Completed
- Project plan (`plan.md`) with architecture, data model, recommender design, CI/CD.
 - Stack confirmation (Next.js + TS + Tailwind + Netlify + Supabase).
 - Scaffold app (App Router, Tailwind, ECharts, auth pages, core pages).
- CI: GitHub Actions workflow (lint, typecheck, build). Netlify config committed.
- GitHub hygiene: CODEOWNERS, PR/Issue templates, .gitattributes, README badges.

## In Progress
- CI/CD: finalize Netlify deploy previews after GitHub repo is connected.
- Progress tracker (`progress.md`).

## Next Up
- Expand Stats with more facets (rewatch rate, top genres/directors), using local cache or Supabase load.

## Remaining (MVP)
- TMDB enrichment batching (server-side or Edge) and cache hydration.
- Recommender v1 (explainable, filters/ excludes).
- Stats: additional charts and filters, pull from Supabase.
- Admin: placeholder user management (list users, roles) for later.

## Risks/Notes
 - Supabase handles auth; TMDB key to be used only in server-side proxy (Netlify or Supabase Edge) if added.

## Recent Changes
- Import page: ZIP/folder parsing, normalization, local IndexedDB cache, preview table.
- Supabase persistence: bulk upsert into film_events with RLS.
- TMDB integration: Next.js API routes proxy (search/details) using server secret TMDB_API_KEY.
- Mapping workflow: Import page now includes TMDB mapper (auto-map first 50 + manual search & map) persisting to film_tmdb_map; cached movie metadata upserted to tmdb_movies.
