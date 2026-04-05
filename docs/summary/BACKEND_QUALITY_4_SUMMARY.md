# Backend Quality Pass 4 — Summary

**Date:** 2026-04-04  
**Branch:** `claude/competent-hermann`  
**Source:** HANDOFF_BACKEND_QUALITY_4.md

---

## Status of All Issues

| #   | Issue                                         | Status           | Action Taken                                               |
| --- | --------------------------------------------- | ---------------- | ---------------------------------------------------------- |
| 1   | `/similar` → `/recommendations`               | Already deployed | Verified at `serverSuggestionsEngine.ts:830`               |
| 2   | `MAX_GENRE_WEIGHT` 15 → 8                     | Already deployed | Verified at `enrich.ts:5970`                               |
| 3   | `MIN_GENRE_SCORE` threshold                   | Already deployed | Verified at `route.ts:437–450`                             |
| 4   | EuroTrip weak-seed blocklist                  | Fixed            | `WEAK_SEED_TMDB_IDS` added to `serverSuggestionsEngine.ts` |
| 5a  | `SUBGENRE_PREFER_OVERRIDE_THRESHOLD` 10 → 5   | Fixed            | `feedbackConstants.ts:30`                                  |
| 5b  | `analyzeSubgenrePatterns` avoidance threshold | Fixed            | `subgenreDetection.ts:1619`                                |
| 6   | Taste profile staleness                       | Self-resolving   | No action                                                  |

---

## Code Changes (Commit: `fix: weak-seed blocklist and subgenre override threshold`)

### Issue 4 — `serverSuggestionsEngine.ts`

Added module-level constant after imports:

```typescript
const WEAK_SEED_TMDB_IDS = new Set<number>([
  9352, // EuroTrip — neighbourhood (Girls Trip, 21 & Over) diverges from taste profile
]);
```

Added filter to `getTopSeedTmdbIds` chain (after dedup):

```typescript
.filter((tmdbId) => !WEAK_SEED_TMDB_IDS.has(tmdbId)); // exclude known weak seeds
```

EuroTrip can still appear in final recommendations (via other seeds) — it is only excluded as a seed itself.

### Issue 5a — `feedbackConstants.ts`

```typescript
// Before
export const SUBGENRE_PREFER_OVERRIDE_THRESHOLD = 10;
// After
export const SUBGENRE_PREFER_OVERRIDE_THRESHOLD = 5;
```

Affects two usage sites: `subgenreDetection.ts:1828` (filtering) and `enrich.ts:6879` (scoring penalty). Both use `>=` comparison.

### Issue 5b — `subgenreDetection.ts`

```typescript
// Before
if (stats.watched >= 10 && likeRatio < 0.2) {
// After
if (stats.watched >= 15 && likeRatio < 0.15) {
```

Requires stronger evidence (15 watched + 85% dislike rate) before suppressing an entire subgenre.

---

## Verification Checklist (from HANDOFF)

- [x] Issue 1: `/recommendations` primary at `serverSuggestionsEngine.ts:830`
- [x] Issue 2: `MAX_GENRE_WEIGHT = 8.0` at `enrich.ts:5970`
- [x] Issue 3: `MIN_GENRE_SCORE = 15.0` block at `route.ts:437`
- [x] Issue 4: `WEAK_SEED_TMDB_IDS` constant + filter implemented
- [x] Issue 5a: `SUBGENRE_PREFER_OVERRIDE_THRESHOLD` lowered to 5
- [x] Issue 5b: Avoidance threshold tightened to `(>= 15, < 0.15)`

---

## Follow-up Notes

- **Root cause of Issue 5 unaddressed**: The underlying data issue — `inferred_preference` stored as `null` in `feature_feedback` table — is worked around by 5a/5b but not resolved. A future data migration could backfill `inferred_preference` for subgenre rows where `positive_count > negative_count`.
- **`WEAK_SEED_TMDB_IDS` is hand-curated**: Only add entries when a specific film is confirmed to generate consistently off-profile candidates across multiple runs. As the set grows, consider moving to a DB-backed config table.
