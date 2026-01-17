# Algorithm Fixes: Personalization Over Generic Recommendations

**Created:** January 16, 2026  
**Updated:** January 16, 2026 (Phase 0 Complete)  
**Status:** Phase 0 Complete - Phase 1 In Progress  
**Priority:** High - Core User Experience Issue

---

## Problem Statement

Users are receiving **generic, mainstream movie recommendations** instead of **personalized, niche suggestions** that reflect their unique taste profiles. This issue affects both:

- **Suggestions Page** (`/suggest`)
- **Genre Suggestions Page** (`/genre-suggest`)

---

## Deep Dive Research Findings

### Taste Profile Analysis

The taste profile (`buildTasteProfile` in `enrich.ts`) is comprehensive and well-designed:

**Strengths:**

- Weighted scoring based on rating + liked status (5-star + liked = 2.0 weight)
- Fractional genre weighting to prevent multi-genre films from over-inflating
- Recency decay with exponential half-life of 1 year
- Ratio-based avoidance (only avoid if 60%+ dislike ratio)
- Watchlist override protection (won't avoid things on user's watchlist)
- Guilty pleasure detection (low-rated but liked = not disliked)
- Subgenre pattern analysis with keyword ID mapping

**Issues Found:**

- `topDecades` computed but **never passed** to `generateSmartCandidates()`
- `preferredSubgenreKeywordIds` computed but **never used** in discovery
- Genre-suggest page **missing many profile fields** vs main suggest page

---

## Code Review: Bugs Found (28 Total)

### Critical Bugs in `enrich.ts`

| #   | Severity | Issue                                                                                                        | Lines      | Impact                      |
| --- | -------- | ------------------------------------------------------------------------------------------------------------ | ---------- | --------------------------- |
| 1   | HIGH     | Index mismatch in weight calculation - `likedFeats[i]` may not align with `likedFilmData[i]` after filtering | 3767-3771  | Wrong preference weights    |
| 2   | HIGH     | Quality filter (6.5-7.0 rating, 50 votes) too aggressive for niche content                                   | 3999-4004  | Blocks personalized picks   |
| 3   | HIGH     | Quality boost (+3.0) dominates personal match scores                                                         | 4063-4076  | Generic over personalized   |
| 4   | MEDIUM   | Borrowed confidence decay applied after cap (ineffective)                                                    | 4293-4302  | Feature less effective      |
| 5   | MEDIUM   | Empty candidate pool returns silently with no fallback                                                       | 3970-3979  | Zero recommendations        |
| 6   | MEDIUM   | Race condition in feedback processing                                                                        | 3507-3510  | Dismissed movies reappear   |
| 7   | LOW      | Genre combo loses order significance (sorted alphabetically)                                                 | 3895       | Subgenre detection weakened |
| 8   | LOW      | New user cold start - zero liked films = zero recommendations                                                | 3362, 4972 | New users get nothing       |

### Critical Bugs in `trending.ts`

| #   | Severity | Issue                                                 | Lines     | Impact                         |
| --- | -------- | ----------------------------------------------------- | --------- | ------------------------------ |
| 9   | HIGH     | `topDecades` computed but **NEVER USED**              | 1124-1128 | Decade discovery is random     |
| 10  | HIGH     | `preferredSubgenreKeywordIds` ignored in discovery    | 549-550   | Subgenre data wasted           |
| 11  | HIGH     | Genre diversity check has inverted logic              | 163-172   | Seeds cluster in genres        |
| 12  | HIGH     | Score threshold 0.5 filters niche single-source picks | 641-651   | Long-tail recommendations lost |
| 13  | MEDIUM   | Excessive randomization (genre count, sort, temporal) | Multiple  | Inconsistent quality           |
| 14  | MEDIUM   | No fallback for empty profile data                    | 678-780   | Silent generic fallback        |
| 15  | MEDIUM   | `likesStandUp` niche preference defined but unused    | 541-547   | Stand-up fans neglected        |

### Critical Bugs in `recommendationAggregator.ts`

| #   | Severity | Issue                                                 | Lines     | Impact                    |
| --- | -------- | ----------------------------------------------------- | --------- | ------------------------- |
| 16  | HIGH     | TuiMDB source declared but **NEVER IMPLEMENTED**      | 18, 56-61 | Missing source            |
| 17  | HIGH     | Consensus divisor wrong (/5 but only 4 sources)       | 187       | Consensus undervalued     |
| 18  | HIGH     | Trakt returns empty titles → breaks display           | 367       | Missing movie titles      |
| 19  | HIGH     | Watchmode is NOT personalized (global trending)       | 388-421   | 20 generic movies compete |
| 20  | MEDIUM   | Same-source duplicates inflate consensus              | 243-268   | False consensus boost     |
| 21  | MEDIUM   | TasteDive high confidence (0.88) on fuzzy title match | 310-318   | Wrong movie matches       |

### Critical Bugs in Page Integration

| #   | Severity | Issue                                                      | File          | Lines     |
| --- | -------- | ---------------------------------------------------------- | ------------- | --------- |
| 22  | HIGH     | Genre-suggest missing `topActors`/`topStudios`             | genre-suggest | 328-337   |
| 23  | HIGH     | Genre-suggest missing `sourceMetadata`/`sourceReliability` | genre-suggest | 478-517   |
| 24  | HIGH     | Genre-suggest missing `adjacentGenres`/`recentGenres`      | genre-suggest | 490-500   |
| 25  | HIGH     | Genre-suggest hardcoded context mode                       | genre-suggest | 488       |
| 26  | MEDIUM   | Replacement suggestions missing profile fields             | suggest       | 2175-2193 |
| 27  | MEDIUM   | Missing `negativeFeedbackIds` in replacement               | suggest       | 2175-2182 |
| 28  | LOW      | Subgenre undo not applied to `subgenreSuggestions` state   | genre-suggest | 754-782   |

---

## Root Cause Analysis

### Core Tension: Diversity vs. Personalization

The system over-optimizes for variety and "freshness" at the expense of precision. Multiple mechanisms compound this:

1. **Candidate pool dilution** - 12+ discovery strategies mixed together, drowning personalized picks in generic trending content
2. **Popularity sort dominance** - Fallback queries use `popularity.desc`, inherently favoring mainstream films
3. **Consensus favors mainstream** - Multi-source agreement bonuses reward movies appearing in TMDB + Trakt + TasteDive (typically popular content)
4. **Subgenre underweighting** - Keywords/subgenres weighted at 0.5 vs genres at 1.2, but subgenres create personalization
5. **Excessive randomization** - Random genre counts, sort methods, and temporal filters prioritize variety over precision
6. **Profile data not utilized** - Several computed fields (`topDecades`, `preferredSubgenreKeywordIds`, `topActors`, `topStudios`) are never passed through

---

## Prioritized Fixes

### CRITICAL PRIORITY (Bugs That Break Personalization)

#### Bug Fix #1: Genre-Suggest Page Parameter Parity

**Files:** `src/app/genre-suggest/page.tsx`

**Problem:** Genre-suggest is missing many parameters that suggest page passes:

- `topActors`, `topStudios` in `generateSmartCandidates`
- `sourceMetadata`, `sourceReliability`, `mmrLambda`, `mmrTopKFactor`, `recentExposures` in `suggestByOverlap`
- `adjacentGenres`, `recentGenres` in `enhancedProfile`

**Fix:** Copy the complete parameter sets from suggest/page.tsx to genre-suggest/page.tsx.

---

#### Bug Fix #2: Use `preferredSubgenreKeywordIds` in Discovery

**File:** `src/lib/trending.ts`

**Problem:** The taste profile builds `preferredSubgenreKeywordIds` from subgenre analysis, but `generateSmartCandidates` never uses them for discovery.

**Fix:**

```typescript
// Add to generateSmartCandidates after keyword discovery
if (profile.preferredSubgenreKeywordIds?.length) {
  const subgenreDiscovered = await discoverMoviesByProfile({
    keywords: profile.preferredSubgenreKeywordIds.slice(0, 5),
    sortBy: "vote_average.desc",
    minVotes: 50,
    limit: 75,
  });
  results.discovered.push(...subgenreDiscovered);
}
```

---

#### Bug Fix #3: Use `topDecades` for Decade-Based Discovery

**File:** `src/lib/trending.ts` (lines 1124-1128)

**Problem:** `topDecades` is computed but never used - decade discovery uses hardcoded values instead.

**Fix:**

```typescript
// Replace hardcoded decades with user preferences
const topDecades = profile.topDecades?.slice(0, 3).map((d) => d.decade) || [
  2010, 2000, 1990,
];

// Use in decade-based discovery
for (const decade of topDecades) {
  const decadeMovies = await discoverMoviesByProfile({
    yearMin: decade,
    yearMax: decade + 9,
    sortBy: "vote_average.desc",
    // ...
  });
}
```

---

#### Bug Fix #4: Fix TuiMDB Missing or Consensus Divisor

**File:** `src/lib/recommendationAggregator.ts`

**Problem:** TuiMDB is declared as a source but never implemented. Consensus divides by 5 but only 4 sources exist.

**Fix:** Either implement TuiMDB or change divisor:

```typescript
const ACTIVE_SOURCE_COUNT = 4; // tmdb, tastedive, trakt, watchmode
const consensusBonus =
  Math.min(rec.sources.length / ACTIVE_SOURCE_COUNT, 1.0) * 0.3;
```

---

#### Bug Fix #5: Fix Index Mismatch in Weight Calculation

**File:** `src/lib/enrich.ts` (lines 3767-3771)

**Problem:** `likedFeats` is filtered by `likedMovies.filter(Boolean)` but `likedFilmData` is not filtered the same way, causing index misalignment.

**Fix:**

```typescript
// Pair film data with fetched movies BEFORE filtering
const paired = likedIds
  .map((id, i) => ({
    movie: likedMovies[i],
    filmData: liked[i],
    id,
  }))
  .filter((p) => p.movie != null);

// Then use paired.forEach() instead of separate arrays
```

---

### HIGH PRIORITY (Core Algorithm Fixes)

#### Issue #1: Candidate Pool Dilution

**File:** `src/lib/trending.ts` (lines 676-725)

**Problem:** Random variation in discovery queries loses specificity:

```typescript
// Current: Random 1-3 genres, random 1-4 keywords
const genreCount = Math.floor(Math.random() * 3) + 1;
const keywordCount = Math.floor(Math.random() * 4) + 1;
```

**Fix:**

- Use minimum 2 genres and 2 keywords for specificity
- Weighted sort selection: 60% quality, 25% popularity, 15% recency

---

#### Issue #2: Popularity Sort Dominance

**Files:** `src/lib/trending.ts`, `src/app/genre-suggest/page.tsx`

**Problem:** Many fallback queries use `popularity.desc`

**Fix:** Change default sort to `vote_average.desc` for quality-first discovery

---

#### Issue #3: Quality Boost Dominates Personal Matches

**File:** `src/lib/enrich.ts` (lines 4063-4076)

**Problem:** A movie rated 8.0+ gets +3.0 boost, while genre match is only 1.2 weight. Generic 8.0 movies outscore personalized 6.9 movies.

**Fix:**

```typescript
// Scale quality boost down or make multiplicative
const qualityMultiplier = 1 + (feats.voteAverage - 6.0) * 0.1; // 1.0-1.2 range
// Instead of +3.0 additive
```

---

#### Issue #4: Recommendation Aggregator Weight Imbalance

**File:** `src/lib/recommendationAggregator.ts`

**Fix:**

```typescript
const sourceWeights = {
  tmdb: 0.85, // Reduced - already dominant
  tastedive: 1.3, // Boosted - best for niche
  trakt: 1.25, // Boosted - community curation
  tuimdb: 1.05, // If implemented
  watchmode: 0.9, // Reduced - trending = generic
};

// Add uniqueness bonus for single-source discoveries
const uniquenessBonus = rec.sources.length === 1 ? 0.15 : 0;
```

---

#### Issue #5: Watchmode Not Personalized

**File:** `src/lib/recommendationAggregator.ts` (lines 388-421)

**Problem:** Watchmode returns globally trending content, not personalized recommendations.

**Fix Options:**

1. Remove Watchmode from aggregation entirely
2. Only include Watchmode movies that also appear in other sources
3. Filter Watchmode to genres matching user preferences

---

### MEDIUM PRIORITY (Quality Improvements)

#### Issue #6: Quality Filter Too Aggressive for Niche Content

**File:** `src/lib/enrich.ts` (lines 3999-4004)

**Fix:** Tiered thresholds:

```typescript
const isNicheContent =
  feats.genres.some((g) =>
    ["Documentary", "Foreign", "Animation"].includes(g),
  ) ||
  (m.release_date && parseInt(m.release_date) < 1980);

const minVoteCount = isNicheContent ? 30 : 100;
const minVoteAverage = isNicheContent ? 6.5 : 7.0;
```

---

#### Issue #7: Fix Trakt Empty Titles

**File:** `src/lib/recommendationAggregator.ts` (line 367)

**Fix:** Prefer non-empty titles in merge:

```typescript
if (existing) {
    if (!existing.title && rec.title) {
        existing.title = rec.title;
    }
    existing.sources.push({ ... });
}
```

---

#### Issue #8: MMR Over-Diversification

**File:** `src/lib/enrich.ts`

**Fix:** Raise base lambda from 0.15 to 0.35

---

#### Issue #9: Add Cold Start Fallback

**File:** `src/lib/enrich.ts`

**Fix:**

```typescript
if (likedFeats.length === 0) {
  console.warn("[SuggestByOverlap] Cold start - no liked films");
  return getPopularMoviesForNewUser(params.candidates);
}
```

---

### LOW PRIORITY (Fine-Tuning)

- Fix `likesStandUp` niche preference to generate stand-up recommendations
- Fix subgenre undo to update `subgenreSuggestions` state
- Increase shown IDs limit from 200 to 500
- Add instrumentation/logging for source tracking

---

## Implementation Order

### Phase 0: Critical Bug Fixes (IMMEDIATE - 1 day)

1. [x] Bug Fix #1: Genre-suggest parameter parity
2. [x] Bug Fix #2: Use `preferredSubgenreKeywordIds` in discovery
3. [x] Bug Fix #3: Use `topDecades` for decade discovery
4. [x] Bug Fix #4: Fix TuiMDB/consensus divisor
5. [x] Bug Fix #5: Fix index mismatch in weight calculation

### Phase 1: Quick Wins (1-2 days)

6. [ ] Issue #4: Rebalance source weights in aggregator
7. [ ] Issue #2: Change default sort to `vote_average.desc`
8. [ ] Issue #5: Remove or filter Watchmode trending
9. [ ] Issue #7: Fix Trakt empty titles

### Phase 2: Core Algorithm Fixes (2-3 days)

10. [ ] Issue #3: Reduce quality boost dominance
11. [ ] Issue #1: Reduce randomization, add specificity mode
12. [ ] Issue #8: Tune MMR lambda for better balance
13. [ ] Issue #6: Tiered quality thresholds for niche content

### Phase 3: Enhancement (2-3 days)

14. [ ] Enhance TasteDive utilization
15. [ ] Improve seed selection with signature films
16. [ ] Add instrumentation/logging
17. [ ] Issue #9: Cold start fallback

### Phase 4: Polish (1 day)

18. [ ] Fix `likesStandUp` niche preference
19. [ ] Subgenre undo state fix
20. [ ] Increase shown IDs limit

---

## Success Metrics

After implementation, measure:

1. **Diversity of sources** - % of final recommendations from each source (target: TasteDive/Trakt > 40%)
2. **Reason quality** - % of recommendations with specific reasons ("Because you loved X") vs generic ("Trending")
3. **User engagement** - Thumbs up/down ratio on recommendations
4. **Subgenre coverage** - % of recommendations matching user's top 3 subgenres
5. **Profile utilization** - Verify all profile fields are actually used in scoring

---

## Testing Strategy

1. **Unit Tests:** Update existing tests for new weight values and thresholds
2. **Integration Tests:** Verify genre-suggest uses correct genres and all profile fields
3. **Manual Testing:** Compare recommendations before/after for test accounts with diverse taste profiles
4. **A/B Testing:** If possible, run old vs new algorithm for subset of users
5. **Regression Testing:** Ensure bug fixes don't break existing functionality

---

## Rollback Plan

All changes should be behind feature flags or easily reversible constants:

- `ENABLE_NICHE_SOURCE_BOOST` - Toggle source weight changes
- `ENABLE_QUALITY_FIRST_SORT` - Toggle sort order changes
- `ENABLE_GENRE_FORCE_MODE` - Toggle genre-suggest fix
- `ENABLE_DECADE_DISCOVERY` - Toggle decade-based personalization
- `ENABLE_SUBGENRE_DISCOVERY` - Toggle subgenre keyword discovery

---

## Related Documentation

- `Improv.md` - Previous improvement audit
- `progress.md` - Development progress tracker
- `plan.md` - Overall project roadmap
