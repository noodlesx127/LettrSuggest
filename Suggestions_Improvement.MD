# Suggestions Improvement Plan

## Overview
This document outlines the improvements to enhance suggestion quality in LettrSuggest, leveraging existing but underutilized APIs and modules.

---

## 🎯 High-Impact Improvements

### 1. Multi-Source Recommendation Aggregator Integration
**Status:** ✅ Completed  
**File:** `src/lib/recommendationAggregator.ts`  
**Effort:** Medium | **Impact:** High

**Problem:** We have a fully built `recommendationAggregator.ts` that combines recommendations from 5 sources (TMDB, TasteDive, Trakt, TuiMDB, Watchmode), but it's NOT being used in the suggest page.

**Why it matters:** Films recommended by multiple independent sources have higher confidence. A movie suggested by both TasteDive AND Trakt is likely better than one from just TMDB.

**Implementation:**
- [x] Import `aggregateRecommendations` into suggest page (via `generateSmartCandidates`)
- [x] Use user's top-rated films as seed movies
- [x] Merge aggregated recommendations into candidate pool
- [x] Implemented `fetchTMDBRecommendations()` - fetches similar/recommendations from TMDB
- [x] Implemented `fetchTraktRecommendations()` - fetches related movies from Trakt API
- [x] Pass seed movie titles from `tmdbDetailsMap` for TasteDive to work

---

### 2. TasteDive Integration for Cross-Media Discovery
**Status:** ✅ Completed  
**File:** `src/lib/tastedive.ts`  
**Effort:** Low | **Impact:** High

**Problem:** TasteDive is built but underutilized. It provides cross-media recommendations that TMDB's algorithm misses.

**Why it matters:** TasteDive catches non-obvious matches. If you loved "Blade Runner", it might suggest "Ex Machina" based on thematic similarities that keyword matching would miss.

**Implementation:**
- [x] Call `getMovieRecommendations()` with user's top 10 rated films (via aggregator)
- [x] Map TasteDive results to TMDB IDs via search
- [x] Add to candidate pool with "Similar content via TasteDive" reason
- [x] Pass movie titles from `tmdbDetailsMap` so TasteDive queries work properly

---

### 3. TMDB List Discovery
**Status:** ✅ Completed  
**File:** `src/lib/enrich.ts` - `discoverFromLists()`  
**Effort:** Medium | **Impact:** Medium

**Problem:** TMDB lists that contain user's favorite films are a great source of similar movies.

**Why it matters:** Curated lists often group films by style, theme, or quality that algorithms miss.

**Implementation:**
- [x] `discoverFromLists()` function finds TMDB lists containing user's top-rated films
- [x] Extracts other films from those lists as candidates
- [x] Integrated into suggest page candidate generation flow
- [x] Logs list discovery progress

---

### 4. Fractional Genre/Keyword Weighting
**Status:** ✅ Completed  
**File:** `src/lib/enrich.ts` - `buildTasteProfile()`  
**Effort:** Low | **Impact:** Medium

**Problem:** Multi-genre films were inflating all their genres equally, skewing the taste profile.

**Why it matters:** A film tagged as Drama/Romance/Comedy shouldn't give equal weight to all three genres.

**Implementation:**
- [x] Implemented `sqrt(genreCount)` dampening for genre weights
- [x] Implemented `sqrt(keywordCount)` dampening for keyword weights
- [x] Prevents over-representation of common genres from multi-genre films

---

### 5. Genre Display in MovieCard
**Status:** ✅ Completed  
**File:** `src/components/MovieCard.tsx`  
**Effort:** Low | **Impact:** Medium

**Problem:** Users couldn't see genre information on suggestion cards.

**Implementation:**
- [x] Added `genres` prop to MovieCard component
- [x] Display genres as styled pill tags (max 4, with +N indicator)
- [x] Added to all 17 MovieCard instances in suggest page
- [x] Ensured all rating/metadata props passed consistently

---

### 6. Feedback-Driven Reason Weighting
**Status:** ✅ Completed  
**Tables:** `suggestion_feedback`, `user_reason_preferences`  
**Effort:** Medium | **Impact:** Medium

**Problem:** We track positive/negative feedback but only use it for exploration rate. We could learn which REASON TYPES work best for each user.

**Why it matters:** Some users respond better to "Director match" while others prefer "Genre match". Learning this improves future suggestions.

**Implementation:**
- [x] Track which reason types (director, genre, actor, keyword, studio, decade) get positive feedback
- [x] Created `user_reason_preferences` table with success_rate tracking
- [x] Added `reason_types` column to `suggestion_feedback` table
- [x] `extractReasonTypes()` parses reasons to identify types
- [x] `updateReasonPreferences()` updates success rates per user/type
- [x] `getReasonPreferences()` fetches learned preferences
- [x] Apply reason preference multipliers in `suggestByOverlap` scoring
- [x] MovieCard passes reasons to feedback handler

---

### 7. Temporal Preference Matching
**Status:** ✅ Completed  
**Effort:** Low | **Impact:** Low-Medium

**Problem:** Trending films have equal weight regardless of user's temporal preferences. Users who watch mostly classics shouldn't get spammed with new releases.

**Why it matters:** Match source weights to user's actual watching patterns.

**Implementation:**
- [x] Track user's decade preferences via `decadeWeights` in taste profile
- [x] `getDecadeCandidates()` fetches films from user's preferred decades
- [x] Pass `topDecades` to `suggestByOverlap` via `enhancedProfile`
- [x] Added decade matching in scoring with boost for preferred eras
- [x] Add explicit "From the Xs — matches your preference for this era" reason
- [x] Shows percentage of user's favorites from that era

---

### 8. Multi-Source Badge Display
**Status:** 🔴 Not Started  
**File:** `src/components/MovieCard.tsx`  
**Effort:** Low | **Impact:** Medium

**Problem:** Users can't see when a film was recommended by multiple sources (TMDB + TasteDive + Trakt).

**Why it matters:** Multi-source consensus is a strong quality signal. Showing this builds user trust.

**Implementation:**
- [ ] Track which sources recommended each candidate in aggregator
- [ ] Pass source count/names to MovieCard
- [ ] Display badge like "🎯 Recommended by 3 sources" or source icons
- [ ] Higher source count could also boost score

---

### 9. Reason Success Rates Display
**Status:** 🔴 Not Started  
**File:** `src/app/profile/page.tsx` or new stats section  
**Effort:** Medium | **Impact:** Low

**Problem:** Users can't see which recommendation types work best for them.

**Implementation:**
- [ ] Query `user_reason_preferences` table
- [ ] Display success rates per reason type (e.g., "Director matches: 78% success")
- [ ] Show in profile or stats page

---

### 10. Collection Completion Priority
**Status:** 🔴 Not Started  
**File:** `src/lib/enrich.ts`  
**Effort:** Medium | **Impact:** Medium

**Problem:** Incomplete collections exist but aren't prioritized in suggestions.

**Implementation:**
- [ ] Use existing `findIncompleteCollections()` function
- [ ] Boost missing collection films higher in scoring
- [ ] Add "Complete the X collection" reason

---

## 📊 Priority Matrix

| Priority | Improvement | Effort | Impact | Status |
|----------|-------------|--------|--------|--------|
| ✅ 1 | Multi-Source Aggregator | Medium | High | Complete |
| ✅ 2 | TasteDive Integration | Low | High | Complete |
| ✅ 3 | TMDB List Discovery | Medium | Medium | Complete |
| ✅ 4 | Fractional Genre Weights | Low | Medium | Complete |
| ✅ 5 | Genre Display in Cards | Low | Medium | Complete |
| ✅ 6 | Feedback-Driven Reasons | Medium | Medium | Complete |
| ✅ 7 | Temporal Preference | Low | Low-Medium | Complete |
| 🔴 8 | Multi-Source Badge | Low | Medium | Not Started |
| 🔴 9 | Reason Success Display | Medium | Low | Not Started |
| 🔴 10 | Collection Completion | Medium | Medium | Not Started |
| ✅ 11 | Weighting System Fixes | Low | Medium | Complete |

---

## 🔧 Weighting System Fixes

### 11. Scoring Weight Adjustments
**Status:** ✅ Completed  
**File:** `src/lib/enrich.ts` - `suggestByOverlap()`  
**Effort:** Low | **Impact:** Medium

**Problems Found:**
1. **Studio double-counting** - Studios were scored twice (legacy + enhanced profile)
2. **Recent boost uncapped** - Could stack to 5-6+ points causing recency bias
3. **Similar director/cast too weak** - Almost negligible in context of 10-25 point totals
4. **Cross-genre boost uncapped** - Could theoretically stack too high

**Fixes Applied:**
- [x] Fixed studio double-counting: Skip legacy matching when enhanced profile has studio data
- [x] Capped recent boost at 2.5 maximum to prevent recency over-dominating
- [x] Increased similar director boost: 0.8 → 1.2 (better discovery)
- [x] Increased similar cast boost: 0.3 → 0.5 (was effectively 0.06)
- [x] Capped cross-genre boost at 3.0 maximum

**Current Weight Structure:**
```typescript
const weights = {
  // Primary factors (70%)
  genre: 1.2,           // Base genre weight  
  genreCombo: 1.8,      // Bonus for exact genre combinations
  director: 1.0,        // Director matching
  actor: 0.75,          // Enhanced profile actor matching

  // Secondary factors (20%)
  keyword: 0.5,         // Keyword/subgenre matching
  studio: 0.5,          // Production company matching

  // Tertiary factors (10%)
  cast: 0.2,            // Supporting cast matching
  crossGenre: 0.2,      // Cross-genre pattern bonus

  // Penalties (negative deductions)
  avoidGenrePenalty: -2.0,    // Strong penalty for avoided genres
  avoidKeywordPenalty: -1.0,  // Moderate penalty for avoided keywords
  avoidDirectorPenalty: -3.0, // Very strong penalty for avoided directors
};
```

**Additional Scoring Factors:**
- Reason preference multiplier: 0.7 to 1.3 range (based on feedback success rates)
- Decade boost: up to 2.0 (capped)
- Adjacent genre boost: up to 2.0 (capped)
- Cross-genre boost: up to 3.0 (capped, NEW)
- Recent boost: up to 2.5 (capped, NEW)
- Similar director: 1.2 × director weight (improved)
- Similar cast: 0.5 × cast weight (improved)

---

## Commits Made

1. **`30affec`** - Fix TMDB API auth, taste profile analysis, and data flow issues
2. **`da74009`** - Implement recommendation quality improvements (aggregator, TasteDive, lists, fractional weights)
3. **`756bf50`** - Add genres display to MovieCard and ensure all data props are passed
4. **`3354e23`** - Add feedback-driven reason weighting and temporal preference matching
5. **`TBD`** - Fix weighting system issues (studio double-counting, boost caps, discovery boosts)

---

## Success Metrics

- **Diversity Score:** Unique genres/decades in top 20 suggestions
- **Multi-Source Rate:** % of suggestions appearing in 2+ sources
- **Feedback Ratio:** Positive vs negative feedback on suggestions
- **Discovery Rate:** % of suggestions user hadn't heard of

---

## Notes

- TasteDive has 300 requests/hour limit - cache aggressively
- Aggregator already handles deduplication by TMDB ID
- All improvements should add to existing flow, not replace it