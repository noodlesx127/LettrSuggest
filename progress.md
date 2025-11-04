# Project Progress

Updated: 2025-11-03

## Current Focus
- Implement CSV import pipeline (support ZIP and individual CSVs/folder drag-and-drop). Parse and summarize before persisting.

## Completed
- Project plan (`plan.md`) with architecture, data model, recommender design, CI/CD.
- Stack confirmation (Next.js + TS + Tailwind + Firebase + Netlify).
- Scaffold app (App Router, Tailwind, Firebase client guard for SSR, ECharts, auth pages, core pages).
- CI: GitHub Actions workflow (lint, typecheck, build). Netlify config committed.

## In Progress
- CSV import pipeline and preview UI.
- CI/CD: finalize Netlify deploy previews after GitHub repo is connected.
- Progress tracker (`progress.md`).

## Next Up
- Build CSV parser for watched/diary/ratings/watchlist/likes.
- ZIP extraction in browser and routing of files to parsers.
- Summary preview (counts by file, distinct films, watchlist size, likes).
- Save canonicalized data to client cache (local state) ahead of Firestore integration.

## Remaining (MVP)
- Firestore schema + write flow for imported events and mappings.
- TMDB enrichment Function and Firestore cache.
- Recommender v1 (explainable, filters/ excludes).
- Stats: baseline charts fed by parsed data.
- Admin: placeholder user management (list users, roles) for later.

## Risks/Notes
- Ensure Firebase only initializes on client to avoid SSR build errors (in place).
- TMDB key kept server-side only (for later Functions work).
