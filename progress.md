# Project Progress

Updated: 2025-11-03

## Current Focus
- Implement CSV import pipeline (ZIP + CSVs/folder drag-and-drop). Add normalization and preview before persisting.

## Completed
- Project plan (`plan.md`) with architecture, data model, recommender design, CI/CD.
 - Stack confirmation (Next.js + TS + Tailwind + Netlify + Supabase).
 - Scaffold app (App Router, Tailwind, ECharts, auth pages, core pages).
- CI: GitHub Actions workflow (lint, typecheck, build). Netlify config committed.
- GitHub hygiene: CODEOWNERS, PR/Issue templates, .gitattributes, README badges.

## In Progress
- CSV import pipeline with normalization, preview table, and client cache.
- CI/CD: finalize Netlify deploy previews after GitHub repo is connected.
- Progress tracker (`progress.md`).
- Migrated to Supabase; removed Firebase Functions and related config.

## Next Up
- Wire Stats to normalized data (ratings histogram, watches by year).

## Remaining (MVP)
- Firestore schema + write flow for imported events and mappings.
- TMDB enrichment Function and Firestore cache.
- Recommender v1 (explainable, filters/ excludes).
- Stats: baseline charts fed by parsed data.
- Admin: placeholder user management (list users, roles) for later.

## Risks/Notes
 - Supabase handles auth; TMDB key to be used only in server-side proxy (Netlify or Supabase Edge) if added.
