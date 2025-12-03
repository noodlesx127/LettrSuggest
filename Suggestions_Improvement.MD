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
**Status:** ✅ Completed  
**File:** `src/components/MovieCard.tsx`, `src/lib/trending.ts`, `src/lib/enrich.ts`  
**Effort:** Low | **Impact:** Medium

**Problem:** Users can't see when a film was recommended by multiple sources (TMDB + TasteDive + Trakt).

**Why it matters:** Multi-source consensus is a strong quality signal. Showing this builds user trust.

**Implementation:**
- [x] Updated `generateSmartCandidates` to return `sourceMetadata` map tracking which sources recommended each movie
- [x] Added `sources` and `consensusLevel` to `suggestByOverlap` params and result type
- [x] Added `sources` and `consensusLevel` props to MovieCard component
- [x] Display badge "🎯 N Sources" with color based on consensus level (high=emerald, medium=amber, low=blue)
- [x] Hover tooltip shows which sources recommended the film (e.g., "Recommended by: TMDB, TasteDive, Trakt")
- [x] Updated all 17 MovieCard instances in suggest page to pass source data

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

### 12. Expanded Suggestion Sections
**Status:** ✅ Completed  
**File:** `src/app/suggest/page.tsx`  
**Effort:** Medium | **Impact:** High

**Problem:** Users had limited categories for browsing suggestions (17 sections).

**Why it matters:** More categorization helps users find films based on specific criteria like runtime, language, critical reception, and more.

**New Sections Added:**
- [x] **Multi-Source Consensus** - Films recommended by 2+ sources (TMDB, TasteDive, Trakt)
- [x] **International Cinema** - Non-English language films matching user taste
- [x] **Animation Picks** - Animated films (non-documentary)
- [x] **Quick Watches** - Films under 100 minutes for busy viewers
- [x] **Epic Films** - Immersive films over 150 minutes (2.5+ hours)
- [x] **Critically Acclaimed** - Films with IMDB 8+, RT 90%+, or Metacritic 80+

**Implementation Details:**
- Extended `MovieItem` type with `runtime`, `original_language`, `spoken_languages`, `production_countries`
- Added 6 new sections to `CategorizedSuggestions` type
- Implemented filter functions for each new category
- Added section refresh capability for all new sections
- Fetches additional TMDB metadata (runtime, languages, countries) for categorization

**Total Sections:** 24 (was 18)

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
| ✅ 8 | Multi-Source Badge | Low | Medium | Complete |
| 🔴 9 | Reason Success Display | Medium | Low | Not Started |
| 🔴 10 | Collection Completion | Medium | Medium | Not Started |
| ✅ 11 | Weighting System Fixes | Low | Medium | Complete |
| ✅ 12 | Expanded Suggestion Sections | Medium | High | Complete |
| ✅ 13 | Genre Avoidance Logic Fix | Low | High | Complete |
| ✅ 14 | Avoidance Profile Display | Low | High | Complete |
| ✅ 15 | Watchlist Intent Analysis | Medium | High | Complete |

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

### 13. Genre Avoidance Logic Fix
**Status:** ✅ Completed  
**Files:** `src/lib/enrich.ts`, `src/lib/subgenreDetection.ts`  
**Effort:** Low | **Impact:** High

**Problem:** The system was aggressively penalizing the user's FAVORITE genres, even with no blocked movies or feedback!

**Root Causes Found:**
1. **`negativeFeedbackMovies`** (blocked movies) contributed to `avoidGenres` with weight 3.0 per movie
2. **No check against user's actual top genres** - could "avoid" their favorite genres
3. **Disliked films** (rated <2.5★) contributed to genre avoidance - even if user has 330+ points in that genre from likes
4. **Subgenre detection was too aggressive** - marked subgenres as "avoided" if rarely watched (<3%), not actually disliked
5. **No minimum threshold** - one disliked film could penalize an entire genre

**Fixes Applied:**
- [x] Blocked movies NO LONGER contribute to genre avoidance (only affect director/keyword learning)
- [x] Top genres are NEVER added to `avoidGenres` - prevents paradox of avoiding what you love
- [x] Minimum threshold of 3 disliked films required before a genre gets avoided
- [x] Reduced weight for low-rated films from variable (0-2.5) to capped (0-1.5)
- [x] **Fixed subgenre detection** - removed "rarely watched = avoided" logic
- [x] Subgenres now only avoided if user watched 10+ films AND liked <20% (actual dislike pattern)
- [x] Added logging to show prevented genre avoidances and final avoidance list

**Key Insights:**
1. "Rarely watched" ≠ "Avoided". A user not watching many spy movies doesn't mean they AVOID spy movies - they may just not have explored that subgenre yet!
2. **"Guilty Pleasures"** - A low rating + "liked" flag means the user enjoys the movie despite knowing it's "bad". These are NOT treated as dislikes!

**Example Impact:**
Before: User with Thriller (330.4), Drama (326.3), Action (221.4) as top genres was getting:
```
[SubgenreFilter] Filtered "F1" - User avoids drama sports within Drama
[NegativePenalty] Penalized "Sexy Beast" by 6.00 - Contains Thriller you typically avoid
```

After: These filters/penalties no longer apply because:
1. Drama/Thriller are the user's FAVORITE genres (never avoided)
2. Subgenres require actual dislike evidence, not just low watch counts

---

### 14. Avoidance Profile Display on Stats Page
**Status:** ✅ Completed  
**Files:** `src/app/stats/page.tsx`, `src/lib/enrich.ts`  
**Effort:** Low | **Impact:** High

**Problem:** The system was marking things as "avoided" incorrectly in multiple ways:
1. Treating 2-star ratings as "dislikes" when they're really "meh/average"
2. Not distinguishing between "logged without rating" (neutral) and "actively disliked"

**Critical Example from User:**
- Quentin Tarantino: 8👎 vs 0👍 - User probably just logged these films without rating
- On Letterboxd, users can: "just log", "log + like", "log + like + review", "log + rate", etc.
- A film that's just logged without rating or like is NEUTRAL - we don't know the user's opinion!

**Letterboxd Rating Scale Interpretation:**
- 0.5-1.5 stars = Bad/Poor → **DISLIKE** (active negative signal)
- 2-2.5 stars = Meh/Average → **NEUTRAL** (not enough signal either way)
- 3+ stars = Good → **LIKE** (positive signal)
- No rating + no like = **NEUTRAL** (unknown opinion)

**Why 2 stars ≠ dislike:**
A 2-star rating often means "it was okay" or "meh" - not "I actively disliked this".
Only truly bad films (1.5 stars or below) should be treated as dislikes.

**Solution: Proper Threshold-Based Classification**
- **Liked**: `f.liked || (f.rating != null && f.rating >= 3)`
- **Disliked**: `f.rating != null && f.rating <= 1.5 && !f.liked`
- **Neutral**: Everything else (unrated, 2-2.5 star zone, etc.)

**Implementation:**
- [x] Changed dislike threshold from < 2.5 to <= 1.5 stars
- [x] Films rated 2-2.5 stars are now NEUTRAL (not counted in avoidance)
- [x] Unrated films remain NEUTRAL (not assumed to be dislikes)
- [x] UI updated to explain: "Disliked = ≤1.5 stars"
- [x] Console logging shows neutral film count for debugging

**Console Logging:**
```
[AvoidanceProfile] Film categorization: {
  totalWatched: 500,
  likedCount: 235,
  dislikedCount: 45,  // Much lower now - only truly bad films
  neutralCount: 220,  // Many films are just "meh" or unrated
  dislikeThreshold: 1.5,
  note: 'Films rated 2-2.5 stars are NEUTRAL (meh), not disliked'
}
```

---

### 15. Watchlist Analysis for Intent Signals
**Status:** ✅ Completed  
**Files:** `src/app/stats/page.tsx`, `src/lib/enrich.ts`, `src/app/suggest/page.tsx`  
**Effort:** Medium | **Impact:** High

**Problem:** The system was not utilizing the user's watchlist as a positive signal. Watchlist shows explicit INTENT - films the user WANTS to see.

**Why it matters:** 
- Watchlist is a strong positive signal: "I want to watch more films like this"
- Watchlist patterns can reveal preferences (e.g., lots of Sci-Fi on watchlist = interested in Sci-Fi)
- Watchlist can OVERRIDE avoidance signals (if user has Horror films on watchlist, don't avoid Horror)

**Solution: Watchlist-Informed Taste Profile**
- Extract genres, keywords, directors, actors from watchlist films
- Boost these in the taste profile (moderate weight: 0.5)
- Count watchlist occurrences as "liked" for ratio calculations
- Override avoidance if item appears on watchlist

**Implementation:**
- [x] `buildTasteProfile` now accepts `watchlistFilms` parameter
- [x] Process watchlist films to extract: `watchlistGenreIds`, `watchlistKeywordIds`, `watchlistDirectorIds`
- [x] Boost positive weights for items appearing on watchlist
- [x] Count watchlist items as "liked" in ratio calculations
- [x] Check watchlist before applying avoidance filter - if on watchlist, don't avoid
- [x] All `buildTasteProfile` calls in suggest page updated to pass watchlist

**Stats Page UI:**
- [x] New "📋 What You Want to Watch" section showing:
  - Genres You Want (from watchlist)
  - Directors You Want (from watchlist)
  - Actors You Want (from watchlist)
  - Themes You Want (from watchlist)
- [x] "Avoidance Overrides" subsection showing items that would be avoided but are on watchlist

**Console Logging:**
```
[TasteProfile] Processing watchlist for intent signals: { watchlistCount: 47 }
[TasteProfile] Watchlist signals extracted: { genresOnWatchlist: 12, keywordsOnWatchlist: 89, directorsOnWatchlist: 31 }
[TasteProfile] Items NOT avoided due to watchlist interest: ["Horror(genre on watchlist)", "David Cronenberg(director on watchlist)"]
```

---

## Commits Made

1. **`30affec`** - Fix TMDB API auth, taste profile analysis, and data flow issues
2. **`da74009`** - Implement recommendation quality improvements (aggregator, TasteDive, lists, fractional weights)
3. **`756bf50`** - Add genres display to MovieCard and ensure all data props are passed
4. **`3354e23`** - Add feedback-driven reason weighting and temporal preference matching
5. **`788666c`** - Fix weighting system issues (studio double-counting, boost caps, discovery boosts)
6. **`TBD`** - Add multi-source badge display to MovieCard
7. **`TBD`** - Fix genre avoidance logic (don't penalize favorite genres)

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
- **Blocking a movie ≠ hating its genre** - these are different signals
- **Low rating + "liked" = guilty pleasure** - respect the like flag over the rating!