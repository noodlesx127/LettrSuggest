# Suggestions Improvement Plan

## Overview
This document outlines the improvements to enhance suggestion quality in LettrSuggest, leveraging existing but underutilized APIs and modules.

---

## 🎯 High-Impact Improvements

### 1. Multi-Source Recommendation Aggregator Integration
**Status:** 🔴 Not Started  
**File:** `src/lib/recommendationAggregator.ts`  
**Effort:** Medium | **Impact:** High

**Problem:** We have a fully built `recommendationAggregator.ts` that combines recommendations from 5 sources (TMDB, TasteDive, Trakt, TuiMDB, Watchmode), but it's NOT being used in the suggest page.

**Why it matters:** Films recommended by multiple independent sources have higher confidence. A movie suggested by both TasteDive AND Trakt is likely better than one from just TMDB.

**Implementation:**
- [ ] Import `aggregateRecommendations` into suggest page
- [ ] Use user's top-rated films as seed movies
- [ ] Merge aggregated recommendations into candidate pool
- [ ] Add "Multi-source match" as a reason badge
- [ ] Weight candidates higher if they appear in multiple sources

---

### 2. TasteDive Integration for Cross-Media Discovery
**Status:** 🔴 Not Started  
**File:** `src/lib/tastedive.ts`  
**Effort:** Low | **Impact:** High

**Problem:** TasteDive is built but underutilized. It provides cross-media recommendations that TMDB's algorithm misses.

**Why it matters:** TasteDive catches non-obvious matches. If you loved "Blade Runner", it might suggest "Ex Machina" based on thematic similarities that keyword matching would miss.

**Implementation:**
- [ ] Call `getMovieRecommendations()` with user's top 10-20 rated films
- [ ] Map TasteDive results to TMDB IDs via search
- [ ] Add to candidate pool with "Thematically similar" reason
- [ ] Cache TasteDive results (7-day TTL as per API guidelines)

---

### 3. Letterboxd List Analysis for Community Discovery
**Status:** 🔴 Not Started  
**Files:** `letterboxd-userdata/likes/lists.csv`  
**Effort:** Medium | **Impact:** Medium

**Problem:** We parse `likes/lists.csv` but don't use it for recommendations. Users who "liked" the same lists often have similar taste.

**Why it matters:** If a user likes "A24 Hidden Gems" list and we know other films on that list, those are strong candidates.

**Implementation:**
- [ ] Parse liked lists from user's export
- [ ] Find films from those lists that user hasn't watched
- [ ] Add "From a list you liked" as a reason
- [ ] Weight by list overlap (more of user's favorites on list = higher weight)

---

### 4. Feedback-Driven Reason Weighting
**Status:** 🔴 Not Started  
**Tables:** `suggestion_feedback`  
**Effort:** Medium | **Impact:** Medium

**Problem:** We track positive/negative feedback but only use it for exploration rate. We could learn which REASON TYPES work best for each user.

**Why it matters:** Some users respond better to "Director match" while others prefer "Genre match". Learning this improves future suggestions.

**Implementation:**
- [ ] Track which reason types (director, genre, actor, keyword) get positive feedback
- [ ] Store reason success rates per user
- [ ] Boost candidates that match successful reason patterns
- [ ] Surface "reasons you usually like" in explanations

---

### 5. Temporal Preference Matching
**Status:** 🔴 Not Started  
**Effort:** Low | **Impact:** Low-Medium

**Problem:** Trending films have equal weight regardless of user's temporal preferences. Users who watch mostly classics shouldn't get spammed with new releases.

**Why it matters:** Match source weights to user's actual watching patterns.

**Implementation:**
- [ ] Calculate user's "recency preference" from watch history
- [ ] If user watches 70% films from 2000+, boost trending/recent candidates
- [ ] If user watches 60% pre-2000 films, reduce trending weight
- [ ] Add "Matches your era preference" reason

---

### 6. Trakt Integration for Anticipated Films
**Status:** 🔴 Not Started  
**File:** `src/app/api/trakt/related/route.ts`  
**Effort:** Low | **Impact:** Low

**Problem:** Trakt API route exists but is minimally used. Trakt has "most anticipated" and community-driven lists.

**Implementation:**
- [ ] Fetch related movies from Trakt for user's favorites
- [ ] Add Trakt recommendations to aggregator sources
- [ ] Consider Trakt popularity as a quality signal

---

## 📊 Priority Matrix

| Priority | Improvement | Effort | Impact | Dependencies |
|----------|-------------|--------|--------|--------------|
| 🔴 1 | Multi-Source Aggregator | Medium | High | None |
| 🔴 2 | TasteDive Integration | Low | High | #1 (optional) |
| 🟡 3 | Letterboxd List Analysis | Medium | Medium | None |
| 🟡 4 | Feedback-Driven Reasons | Medium | Medium | Existing feedback data |
| 🟢 5 | Temporal Preference | Low | Low-Medium | None |
| 🟢 6 | Trakt Integration | Low | Low | Trakt API key |

---

## Implementation Order

1. **Phase 1 - Quick Wins (TasteDive + Aggregator)**
   - Wire up TasteDive recommendations
   - Integrate multi-source aggregator into suggest flow
   - Expected: +20-30% suggestion diversity

2. **Phase 2 - Community Intelligence (Lists)**
   - Parse and utilize liked Letterboxd lists
   - Expected: Better niche/cult film discovery

3. **Phase 3 - Learning Loop (Feedback)**
   - Track reason type success
   - Personalize explanation strategy
   - Expected: Higher user satisfaction

4. **Phase 4 - Polish (Temporal + Trakt)**
   - Fine-tune temporal weighting
   - Add Trakt as additional source
   - Expected: Subtle quality improvements

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
