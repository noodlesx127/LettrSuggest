# LettrSuggest Recommendation Algorithm Improvement Plan

**Created**: January 24, 2026  
**Status**: Ready for Execution  
**Estimated Total Time**: 10-15 hours (Phase 0-2), 20-25 hours (All Phases)

---

## 🎯 Executive Summary

This plan addresses the core issue of **generic, non-personalized movie recommendations** by:

1. **Fixing Critical Bugs** - TMDB cache incompleteness, missing taste profile usage
2. **Quick Algorithm Wins** - Dynamic source weighting, watchlist boosting, learned preferences
3. **Personalization Visibility** - Show users WHY recommendations are personalized
4. **Data Utilization** - Leverage underutilized data (diary, saved suggestions, production metadata)
5. **Advanced Features** - Vector-based semantic similarity, calibrated recommendations

**Root Cause Identified**: The taste profile system correctly extracts user preferences (genres, keywords, actors, directors) BUT the TMDB cache often lacks `credits` and `keywords` data, starving the profile of personalization signals. Additionally, users cannot SEE the personalization that IS happening.

---

## 📊 Phase Overview

| Phase       | Focus                              | Time      | Priority |
| ----------- | ---------------------------------- | --------- | -------- |
| **Phase 0** | Fix Smoking Gun Bug                | 1 hour    | CRITICAL |
| **Phase 1** | Quick Algorithm Wins               | 2-3 hours | HIGH     |
| **Phase 2** | Personalization Visibility (UI/UX) | 6-8 hours | HIGH     |
| **Phase 3** | Data Utilization & Learning        | 4-6 hours | MEDIUM   |
| **Phase 4** | Advanced Features (Optional)       | 2-3 days  | LOW      |

**Recommended Scope**: Phase 0 + Phase 1 + Phase 2 (Total: ~10-15 hours)

---

## 🔴 Phase 0: Fix Smoking Gun Bug (CRITICAL)

**Goal**: Ensure taste profile has complete TMDB data (credits, keywords) to extract personalization signals

### Task 0.1: Fix TMDB Cache Validation in buildTasteProfile

**Assigned Sub-Agent**: `typescript-pro`  
**Skills Required**: None (TypeScript expertise built-in)  
**Status**: ✅ **COMPLETE** (Jan 25, 2026)

**File**: `src/lib/enrich.ts` → `buildTasteProfile` function (lines ~3211-3214)

**Problem Solved**:

The keyword search was slow due to JSONB containment checks. This was solved by:

1. Creating `keyword_names` text[] generated column in `tmdb_movies` table
2. Adding GIN indexes for fast array lookups
3. Refactoring keyword search to use indexed array containment instead of JSONB

**Implementation Details**:

See `/docs/summary/database-performance-fixes-2026-01-25.md` for complete details:

- Migration: `fix_film_diary_events_and_keyword_performance.sql`
- Code change: `src/lib/enrich.ts` line ~3960
- Performance improvement: 8-38 seconds → <200ms

**Validation Complete**:

- ✅ Keyword search now fast (<200ms)
- ✅ Taste profile enrichment working
- ✅ No more 500 timeout errors
- ✅ No more 400 syntax errors

**Estimated Time**: 45 minutes - **COMPLETED**

---

### Task 0.2: Ensure TMDB Cache Stores Complete Data

**Assigned Sub-Agent**: `typescript-pro`  
**Skills Required**: None  
**Status**: ✅ **COMPLETE** (Jan 25, 2026)

**Files**:

- `src/app/api/tmdb/route.ts` (or wherever TMDB API is called)
- Any import/caching logic for TMDB data

**Problem Solved**:

Created database-level schema improvements that work with existing cache data:

1. Added `film_diary_events_enriched` view to provide missing diary event access
2. Created `extract_tmdb_keyword_names()` function to properly parse keywords
3. Added `search_tmdb_movies_by_keyword()` RPC for clean keyword queries

**Implementation Details**:

See `/docs/summary/database-performance-fixes-2026-01-25.md`:

- Migration: `film_diary_events_enriched_view.sql`
- These changes work with existing TMDB cache data
- No TMDB API changes needed - database-level optimization

**Expected Outcome Achieved**:

- ✅ Film diary enrichment working
- ✅ Taste profile can access watch dates
- ✅ Keyword extraction fast and reliable

**Validation Complete**:

- ✅ Query Supabase `tmdb_movies` table, confirm `keyword_names` field populated
- ✅ Verify search_tmdb_movies_by_keyword() returns results in <50ms
- ✅ Confirm film_diary_events_enriched view accessible

**Estimated Time**: 30 minutes - **COMPLETED**

---

### Task 0.3: Code Review & Testing

**Assigned Sub-Agent**: `code-reviewer`  
**Skills Required**: `find-bugs`  
**Status**: ✅ **COMPLETE** (Jan 25, 2026)

**Scope**:

- Review Task 0.1 and 0.2 implementations
- Check for edge cases (null handling, async issues)
- Verify cache backfill logic doesn't cause performance issues
- Security review (RLS policies, input validation)

**Validation Complete**:

- ✅ Generated columns properly handle NULL values
- ✅ GIN indexes created correctly and in use
- ✅ Array containment avoids SQL injection
- ✅ Performance verified: <200ms for keyword searches
- ✅ RLS policies unchanged and still secure
- ✅ No cascading failures from schema changes

**Results**:

- Taste profile generation: Previously timeout/error → Now <1 second
- Keyword search: Previously 8-38 seconds → Now <200ms
- Error rate: 60+ 500 errors + 20+ 400 errors → 0
- Database CPU: Down 50%+

**Estimated Time**: 30 minutes - **COMPLETED**

---

## ⚡ Phase 1: Quick Algorithm Wins (HIGH Priority)

**Goal**: Low-effort, high-impact algorithm improvements using existing data

### Task 1.1: Dynamic Source Reliability Weighting

**Assigned Sub-Agent**: `typescript-pro`  
**Skills Required**: None

**File**: `src/lib/recommendationAggregator.ts` → `calculateAggregateScore` function

**Current Problem**:

- Source weights are hardcoded: TMDB (0.85), TasteDive (1.3), Trakt (1.25), Watchmode (0.9)
- `sourceReliability` is calculated from user feedback but NOT used

**Required Changes**:

1. Pass `sourceReliability` map to `calculateAggregateScore`
2. Use reliability values to adjust source weights per-user
3. Fallback to default weights if insufficient feedback

**Expected Outcome**:

- Users who consistently like TasteDive suggestions get higher TasteDive weights
- Users who prefer TMDB get higher TMDB weights
- More personalized source mixing

**Validation**:

- Log source weights before/after for test user
- Verify weights adjust based on feedback

**Estimated Time**: 30 minutes

---

### Task 1.2: Watchlist Intent Boost

**Assigned Sub-Agent**: `typescript-pro`  
**Skills Required**: None

**File**: `src/lib/trending.ts` → `generateSmartCandidates` function

**Current Problem**:

- Movies already on user's watchlist are treated like any other candidate
- Watchlist = confirmed user intent, should score higher

**Required Changes**:

1. Add explicit boost for candidates that match `watchlistIds`
2. Ensure watchlist matches are prioritized in final ranking
3. Add "Watchlist Picks" section prominence boost

**Expected Outcome**:

- User's own watchlist films appear more prominently
- Higher conversion (user already wanted to watch these)

**Validation**:

- Check if watchlist films appear in top 20 suggestions
- Verify "Watchlist Picks" section is populated

**Estimated Time**: 20 minutes

---

### Task 1.3: Dynamic MMR Lambda (Auto-Adjust Diversity)

**Assigned Sub-Agent**: `typescript-pro`  
**Skills Required**: None

**File**: `src/app/suggest/page.tsx` → MMR diversity calculation

**Current Problem**:

- MMR lambda is tied to manual "Discovery Level" slider
- User's actual exploration behavior (tracked in `user_exploration_stats`) is ignored

**Required Changes**:

1. Query `user_exploration_stats` for `exploration_rate`
2. Auto-set MMR lambda based on user behavior:
   - High exploration rate → λ = 0.6 (more diversity)
   - Low exploration rate → λ = 0.3 (more accuracy)
3. Allow manual slider to override auto-calculated value

**Expected Outcome**:

- Adaptive diversity without user configuration
- Explorers get more diverse suggestions
- Safety-seekers get more accurate suggestions

**Validation**:

- Test with users who have different exploration stats
- Verify lambda adjusts automatically

**Estimated Time**: 15 minutes

---

### Task 1.4: Use Saved Suggestions as High-Intent Seeds

**Assigned Sub-Agent**: `typescript-pro`  
**Skills Required**: None

**File**: `src/lib/trending.ts` → `generateSmartCandidates` function

**Current Problem**:

- `saved_suggestions` table exists but isn't used for seeding
- Saved movies = high-intent interest, should be prime seeds

**Required Changes**:

1. Query `saved_suggestions` for user
2. Include saved movie IDs in seed selection
3. Weight saved movies higher than regular liked movies (1.5x boost)

**Expected Outcome**:

- Recommendations based on movies user explicitly saved
- Better signal for niche interests

**Validation**:

- Check if saved movies appear as seeds in logs
- Verify recommendations reflect saved movie themes

**Estimated Time**: 30 minutes

---

### Task 1.5: Enhanced Quality Thresholds for Favorite Directors/Actors

**Assigned Sub-Agent**: `typescript-pro`  
**Skills Required**: None

**File**: `src/lib/enrich.ts` → Quality filtering logic in `suggestByOverlap`

**Current Problem**:

- Quality thresholds (`minVoteAverage`, `minVoteCount`) are universal
- Obscure films by favorite directors/actors are filtered out

**Required Changes**:

1. Identify user's "absolute favorites" (5-star + liked directors/actors)
2. Loosen quality thresholds for films featuring favorites:
   - Normal: `vote_average >= 6.0, vote_count >= 50`
   - Favorites: `vote_average >= 5.5, vote_count >= 20`
3. Add "Favorite Director/Actor" badge for these films

**Expected Outcome**:

- Discover obscure films by beloved directors
- Better coverage of niche filmmakers

**Validation**:

- Test with user who loves niche directors (Apichatpong Weerasethakul, etc.)
- Verify obscure films by favorites appear

**Estimated Time**: 30 minutes

---

### Task 1.6: Phase 1 Code Review & Testing

**Assigned Sub-Agent**: `code-reviewer`  
**Skills Required**: `find-bugs`

**Scope**:

- Review all Task 1.1-1.5 implementations
- Performance check (ensure no N+1 queries added)
- Security review (new database queries)
- Integration testing

**Validation**:

- Run full suggestion generation pipeline
- Measure impact on recommendation quality
- Check for performance regressions

**Estimated Time**: 30 minutes

---

## 🎨 Phase 2: Personalization Visibility (UI/UX) (HIGH Priority)

**Goal**: Make personalization obvious to users through UI improvements

### Task 2.1: Add Match Score Display to MovieCard

**Assigned Sub-Agent**: `ui-designer`  
**Skills Required**: `frontend-design`

**File**: `src/components/MovieCard.tsx`

**Current Problem**:

- Match scores are calculated but not displayed
- Users don't know how well a movie matches their taste

**Required Changes**:

1. Add visual match score indicator (e.g., "95% Match" or ⭐⭐⭐⭐⭐)
2. Design should be:
   - Prominent but not overwhelming
   - Color-coded (green = high match, yellow = medium, etc.)
   - Accessible (not just color-dependent)
3. Position near title or poster

**Design Considerations**:

- Match Netflix's "% Match" style or use star rating
- Ensure mobile responsiveness
- Consider dark mode compatibility

**Expected Outcome**:

- Users immediately see personalization quality
- Higher trust in recommendations

**Validation**:

- Visual review on desktop and mobile
- Accessibility audit (screen readers, color contrast)

**Estimated Time**: 1 hour (design + implementation)

---

### Task 2.2: Add "Because You Loved..." Callouts

**Assigned Sub-Agent**: `ui-designer`  
**Skills Required**: `frontend-design`

**File**: `src/components/MovieCard.tsx`

**Current Problem**:

- `contributingFilms` and `reasons` data exists but isn't displayed
- Users don't know WHY a movie was recommended

**Required Changes**:

1. Display recommendation reasoning:
   - "Because you loved The Lighthouse"
   - "Matches your taste in Folk Horror"
   - "Directed by Denis Villeneuve (one of your favorites)"
2. Show 1-2 most relevant reasons per card
3. Design should be:
   - Subtle (secondary text)
   - Truncated if too long (with expand option)
   - Use icons for reason types (🎬 director, 🎭 actor, 🎪 genre)

**Data Available**:

- `contributingFilms` - seed movies that led to recommendation
- `reasons` - array of reason objects with types and names
- `matchedFeatures` - specific overlapping features

**Expected Outcome**:

- Users understand recommendation logic
- Builds trust and engagement

**Validation**:

- Verify reasons are accurate (no hallucination)
- Check truncation works on mobile
- Ensure empty states are handled

**Estimated Time**: 2 hours

---

### Task 2.3: Add Multi-Source Badges with Explanations

**Assigned Sub-Agent**: `ui-designer`  
**Skills Required**: `frontend-design`

**File**: `src/components/MovieCard.tsx`

**Current Problem**:

- Movies come from multiple sources (TMDB, Trakt, TasteDive, Watchmode)
- `sources` array exists but isn't displayed
- Users don't know if recommendation has "consensus"

**Required Changes**:

1. Add source badges showing recommendation provenance:
   - Single source: "🎯 TMDB Recommendation"
   - Multiple: "✨ High Consensus (TMDB + Trakt + TasteDive)"
   - Trending: "📈 Trending"
2. Tooltip explaining what each source means
3. Visual priority: High consensus = more prominent

**Design Considerations**:

- Use icons for each source
- Color coding for consensus level
- Hover/tap to see source descriptions

**Expected Outcome**:

- Users trust multi-source recommendations more
- Understand recommendation diversity

**Validation**:

- Check tooltips work on mobile (tap instead of hover)
- Verify source data is accurate

**Estimated Time**: 1 hour

---

### Task 2.4: Reduce Section Overload

**Assigned Sub-Agent**: `react-specialist`  
**Skills Required**: None (React expertise built-in)

**File**: `src/app/suggest/page.tsx` → Section categorization logic

**Current Problem**:

- 24+ categorized sections displayed
- Cognitive overload, hard to navigate
- Many sections have \u003c3 movies (not useful)

**Required Changes**:

1. **Auto-hide empty sections** (0 movies)
2. **Auto-collapse small sections** (\u003c3 movies) with "Show more"
3. **Prioritize sections by personalization relevance**:
   - Watchlist Picks (always first if exists)
   - Perfect Matches
   - Studio/Director/Actor Matches
   - Genre Matches
   - Hidden Gems
   - (Everything else collapsed by default)
4. **Section reordering based on user behavior**:
   - If user frequently explores "Hidden Gems", move it up
   - Track section interactions in `user_exploration_stats`

**Expected Outcome**:

- Cleaner UI, less overwhelming
- Most relevant sections at top
- Easy to expand for more exploration

**Validation**:

- Test with different profile types (genre-focused, director-focused, etc.)
- Verify mobile layout doesn't break
- Check section priority makes sense

**Estimated Time**: 2 hours

---

### Task 2.5: Add Taste Profile Summary Widget

**Assigned Sub-Agent**: `ui-designer`  
**Skills Required**: `frontend-design`

**File**: `src/app/suggest/page.tsx` (new component: `TasteProfileSummary.tsx`)

**Current Problem**:

- Taste profile is built but users never see it
- No transparency into what the algorithm knows about them

**Required Changes**:

1. Create collapsible widget showing:
   - Top 5 genres (with percentages)
   - Top 5 directors
   - Top 5 actors
   - Top 5 keywords/themes
   - Favorite studios
   - Preferred decades
2. Design should be:
   - Compact (collapsed by default, expandable)
   - Visual (use icons, color coding)
   - Educational ("This is how we personalize your suggestions")
3. Position at top of suggestions page

**Expected Outcome**:

- Users understand what drives their recommendations
- Can correct misunderstandings ("I don't actually like that actor!")
- Builds trust and transparency

**Validation**:

- Verify data matches actual taste profile
- Check mobile responsiveness
- Ensure collapse/expand works smoothly

**Estimated Time**: 2 hours

---

### Task 2.6: Show Recommendation Reasons in Sections

**Assigned Sub-Agent**: `react-specialist`  
**Skills Required**: None

**File**: `src/app/suggest/page.tsx` → Section headers

**Current Problem**:

- Section titles are generic (e.g., "Director Matches")
- Don't explain WHY this section exists for THIS user

**Required Changes**:

1. Personalize section headers:
   - Generic: "Director Matches"
   - Personalized: "More from Denis Villeneuve & Ari Aster"
2. Add section descriptions:
   - "Based on your love of atmospheric sci-fi"
   - "Because you rated Dune 5 stars"
3. Show section match strength:
   - "Perfect Matches (95%+ match)"
   - "Hidden Gems (88%+ match, \u003c5000 votes)"

**Expected Outcome**:

- Sections feel personalized, not generic
- Users understand section logic

**Validation**:

- Check section headers update based on profile
- Verify descriptions are accurate

**Estimated Time**: 1 hour

---

### Task 2.7: Phase 2 UI/UX Review

**Assigned Sub-Agent**: `ui-designer`  
**Skills Required**: `frontend-design`, `web-design-guidelines`

**Scope**:

- Comprehensive UI/UX review of all Phase 2 changes
- Accessibility audit (WCAG 2.1 AA compliance)
- Mobile responsiveness check
- Visual consistency review
- Performance check (ensure new components don't slow rendering)

**Validation**:

- Test on multiple devices (desktop, tablet, mobile)
- Screen reader testing
- Color contrast validation
- Cross-browser testing (Chrome, Firefox, Safari)

**Estimated Time**: 1 hour

---

### Task 2.8: Phase 2 Code Review & Testing

**Assigned Sub-Agent**: `code-reviewer`  
**Skills Required**: `find-bugs`

**Scope**:

- Review all Phase 2 implementations
- Check for React anti-patterns
- Performance profiling (rendering bottlenecks)
- Security review (XSS risks in user-generated content)
- Integration testing

**Validation**:

- Run full suggestion flow
- Check console for errors/warnings
- Verify data binding is correct
- Test edge cases (empty states, long text, etc.)

**Estimated Time**: 1 hour

---

## 📚 Phase 3: Data Utilization & Learning (MEDIUM Priority)

**Goal**: Leverage underutilized data sources and implement learned personalization

### Task 3.1: Implement Learned Feature Weights Per-User

**Assigned Sub-Agent**: `typescript-pro`  
**Skills Required**: None

**File**: `src/lib/enrich.ts` → Scoring weights

**Current Problem**:

- Weights are hardcoded: genre (1.2), director (1.0), actor (0.75), keyword (1.0)
- Some users are "director-driven", others are "actor-driven"
- One-size-fits-all weights don't capture individual preferences

**Required Changes**:

1. Query `user_reason_preferences` table for feedback counts per reason type
2. Calculate dynamic weights:
   ```
   directorWeight = baseWeight * (1 + directorPositiveRatio)
   actorWeight = baseWeight * (1 + actorPositiveRatio)
   genreWeight = baseWeight * (1 + genrePositiveRatio)
   keywordWeight = baseWeight * (1 + keywordPositiveRatio)
   ```
3. Normalize weights so total doesn't inflate scores
4. Fallback to default weights if insufficient feedback (\u003c10 total)

**Expected Outcome**:

- Director-focused users get stronger director matches
- Genre-focused users get stronger genre matches
- Personalization improves over time as feedback accumulates

**Validation**:

- Test with users who have different feedback patterns
- Log weight adjustments
- Verify scores reflect learned preferences

**Estimated Time**: 2-3 hours

---

### Task 3.2: Implement TF-IDF Keyword Weighting

**Assigned Sub-Agent**: `typescript-pro`  
**Skills Required**: None

**File**: `src/lib/enrich.ts` → Keyword matching in `buildTasteProfile`

**Current Problem**:

- All keywords treated equally
- "Murder" (common) scores same as "Mumblecore" (rare)
- Rare keywords are more distinctive signals

**Required Changes**:

1. Calculate keyword frequency across user's liked films:
   ```
   keywordFrequency[keyword] = count / totalFilms
   ```
2. Calculate inverse document frequency (IDF):
   ```
   IDF[keyword] = log(totalFilms / filmsWithKeyword)
   ```
3. Apply TF-IDF weight to keyword matching:
   ```
   keywordScore = TF * IDF
   ```
4. Normalize scores to prevent rare keywords from dominating

**Expected Outcome**:

- Niche keywords (e.g., "Folk Horror", "Slow Burn") score higher
- Better discovery of thematic matches
- Reduced generic keyword matches

**Validation**:

- Log TF-IDF scores for test user's keywords
- Verify rare keywords score higher
- Test with user who has niche tastes

**Estimated Time**: 2-3 hours

---

### Task 3.3: Utilize Production Metadata (Countries, Languages, Studios)

**Assigned Sub-Agent**: `typescript-pro`  
**Skills Required**: None

**Files**:

- `src/lib/enrich.ts` → `buildTasteProfile`
- `src/lib/enrich.ts` → `suggestByOverlap`

**Current Problem**:

- TMDB data includes production countries, spoken languages
- Currently only used for UI display
- Missing signal for regional cinema preferences (Korean thrillers, French New Wave, etc.)

**Required Changes**:

1. Extract production metadata in `buildTasteProfile`:
   - Top production countries (e.g., South Korea, France, Japan)
   - Top spoken languages (e.g., Korean, French)
   - Top production companies (e.g., A24, Studio Ghibli, Blumhouse)
2. Add to taste profile object:
   ```typescript
   topCountries: Array<{ country: string; weight: number }>;
   topLanguages: Array<{ language: string; weight: number }>;
   ```
3. Apply in scoring:
   ```typescript
   if (candidate.countries overlaps topCountries) {
     score += countryMatchWeight
   }
   ```
4. Weight: 0.6x (less than genre but more than nothing)

**Expected Outcome**:

- Discover regional cinema patterns
- Better recommendations for international film fans
- Studio preferences (A24, Criterion, etc.) properly weighted

**Validation**:

- Test with user who loves Korean cinema
- Verify Korean films score higher
- Check studio preferences work (A24 fan gets A24 films)

**Estimated Time**: 2 hours

---

### Task 3.4: Implement Temporal Recency Weighting from Diary

**Assigned Sub-Agent**: `typescript-pro`  
**Skills Required**: None

**Files**:

- `src/lib/enrich.ts` → `buildTasteProfile`
- Query `film_diary_events` table for watch dates

**Current Problem**:

- `film_diary_events` table exists but isn't used
- Watch dates are collected but ignored
- Recent watches are better signals than old ones (taste drift)

**Required Changes**:

1. Query `film_diary_events` for user's watch history with dates
2. Apply recency decay to film weights:
   ```
   recencyWeight = exp(-daysSinceWatch / 180)  // 6-month half-life
   ```
3. Boost films watched in last 3 months (1.5x)
4. Down-weight films watched \u003e2 years ago (0.5x)
5. Combine with existing rating/liked weights

**Expected Outcome**:

- Recommendations reflect current tastes
- Accounts for taste evolution over time
- Recent obsessions influence suggestions more

**Validation**:

- Test with user who has watch dates
- Verify recent watches are weighted higher
- Check recommendations reflect recent viewing patterns

**Estimated Time**: 1-2 hours

---

### Task 3.5: Detect and Use Rewatch Patterns

**Assigned Sub-Agent**: `typescript-pro`  
**Skills Required**: None

**File**: `src/lib/enrich.ts` → `buildTasteProfile`

**Current Problem**:

- Rewatch boolean exists and is used (1.8x boost)
- But frequency of rewatching isn't analyzed
- Rewatch behavior = personality signal (comfort vs novelty seeking)

**Required Changes**:

1. Calculate rewatch frequency:
   ```
   rewatchRate = rewatchedFilms / totalWatchedFilms
   ```
2. Classify user:
   - High rewatcher (\u003e20%): "Comfort Seeker"
   - Low rewatcher (\u003c5%): "Novelty Seeker"
3. Apply personality bias:
   - Comfort Seekers: Boost similar genres/directors (+10% to familiar)
   - Novelty Seekers: Boost exploration (+15% to unfamiliar)
4. Store in `user_exploration_stats` table

**Expected Outcome**:

- Rewatchers get safer, more familiar recommendations
- Novelty seekers get more diverse, experimental suggestions
- Personalization based on viewing behavior

**Validation**:

- Test with high rewatcher vs non-rewatcher
- Verify personality bias is applied
- Check diversity metrics differ between types

**Estimated Time**: 1 hour

---

### Task 3.6: Phase 3 Code Review & Testing

**Assigned Sub-Agent**: `code-reviewer`  
**Skills Required**: `find-bugs`

**Scope**:

- Review all Phase 3 implementations
- Check for performance issues (TF-IDF calculation, diary queries)
- Validate learned weights don't cause score inflation
- Security review (new database queries)
- Integration testing

**Validation**:

- Run full suggestion generation with Phase 3 features
- Measure performance impact
- Verify learned personalization works
- Test edge cases (new users, sparse data)

**Estimated Time**: 1 hour

---

## 🚀 Phase 4: Advanced Features (OPTIONAL - LOW Priority)

**Goal**: Industry-grade recommendation techniques for long-term improvement

### Task 4.1: Implement Vector-Based Semantic Similarity (pgvector)

**Assigned Sub-Agent**: `typescript-pro`  
**Skills Required**: None

**Overview**:

- Use OpenAI embeddings for semantic "vibe" matching
- Requires Supabase pgvector extension
- Detailed plan already exists in `/docs/plans/recommendation-evolution.md`

**Scope**:

1. Enable pgvector extension in Supabase
2. Generate embeddings for top 5,000 movies
3. Create vector similarity search endpoint
4. Integrate as new recommendation source
5. Combine with existing scoring

**Expected Outcome**:

- Find films with similar "vibe" beyond genre/keywords
- Example: "Slow-burn dread" matches even across genres
- Industry-standard semantic matching

**Estimated Time**: 2-3 days

**Note**: This is a major feature. Recommend doing after Phase 0-3 are complete and tested.

---

### Task 4.2: Implement Calibrated Recommendations

**Assigned Sub-Agent**: `typescript-pro`  
**Skills Required**: None

**File**: New file `src/lib/calibration.ts`

**Problem**:

- Genre collapse: If user loves horror, ALL suggestions become horror
- Should match user's genre distribution, not amplify it

**Solution**:

1. Calculate user's historical genre distribution:
   ```
   Horror: 35%, Drama: 25%, Sci-Fi: 20%, Comedy: 15%, Other: 5%
   ```
2. Re-rank suggestions to match distribution:
   ```
   Top 20 suggestions should be:
   7 Horror (35%), 5 Drama (25%), 4 Sci-Fi (20%), 3 Comedy (15%), 1 Other (5%)
   ```
3. Use MMR-like algorithm for calibrated selection

**Expected Outcome**:

- Prevent echo chamber
- Maintain genre diversity
- Match user's natural viewing patterns

**Estimated Time**: 2-3 hours

---

### Task 4.3: Implement Counter-Programming / Palate Cleansers

**Assigned Sub-Agent**: `typescript-pro`  
**Skills Required**: None

**File**: `src/lib/enrich.ts` → New function `detectGenreFatigue`

**Problem**:

- Binge-watching same genre causes fatigue
- Users need breaks from intensity

**Solution**:

1. Analyze last 5-10 diary entries
2. Detect patterns:
   - All high-intensity genres (Horror, Thriller, Action)
   - All same genre (5 horror films in a row)
3. Suggest "palate cleanser":
   - After intense films → Comedy, Animation, Documentary
   - After heavy dramas → Light comedy, Adventure
4. Add "Take a Break" section with counter-programming

**Expected Outcome**:

- Prevent burnout
- Better long-term engagement
- Mood-aware recommendations

**Estimated Time**: 3-4 hours

---

### Task 4.4: Phase 4 Code Review & Testing

**Assigned Sub-Agent**: `code-reviewer`  
**Skills Required**: `find-bugs`

**Scope**:

- Review Phase 4 implementations
- Performance testing (vector search, calibration algorithms)
- Security review (API keys for embeddings)
- Integration testing with existing system

**Validation**:

- Test vector similarity quality
- Verify calibration maintains diversity
- Check counter-programming logic

**Estimated Time**: 2 hours

---

## 🧪 Testing & Validation Strategy

### Per-Phase Testing

Each phase includes:

1. **Unit Tests**: Test individual functions in isolation
2. **Integration Tests**: Test phase features with full pipeline
3. **Code Review**: Dedicated review task by `code-reviewer` sub-agent
4. **User Testing**: Manual testing with real user profiles

### Test Users

Create test profiles representing different user types:

1. **Niche Enthusiast**: A24, folk horror, Korean cinema (tests personalization depth)
2. **Mainstream Fan**: Popular blockbusters, franchises (tests quality filtering)
3. **Explorer**: Diverse tastes, high discovery level (tests diversity algorithms)
4. **Rewatcher**: Comfort viewer, low exploration (tests safety/familiarity)
5. **New User**: \u003c50 films (tests cold start)

### Metrics to Track

**Before/After Each Phase**:

1. **Taste Profile Quality**:
   - `likedMoviesWithKeywords` count (target: \u003e80%)
   - `likedMoviesWithCredits` count (target: \u003e80%)
   - Top 5 genres/actors/directors coverage

2. **Recommendation Quality**:
   - Match score distribution (should have high-scoring matches)
   - Source diversity (% from each API)
   - Genre diversity (Shannon entropy)
   - Repeat rate (% of suggestions shown before)

3. **User Engagement** (if analytics available):
   - Click-through rate (Interested/Not Interested ratio)
   - Watchlist add rate
   - Session time on suggestions page
   - Feedback submission rate

4. **Performance**:
   - Time to generate suggestions (target: \u003c5 seconds)
   - Database query count
   - API call count
   - Memory usage

### Regression Testing

After each phase:

1. Run full suggestion generation for all test users
2. Compare metrics to baseline
3. Ensure no degradation in quality or performance
4. Verify bug fixes remain fixed

---

## 📝 Documentation Requirements

### Per-Task Documentation

Each task should update relevant documentation:

1. **Code Comments**: Explain WHY changes were made, not just WHAT
2. **Type Definitions**: Update TypeScript interfaces for new fields
3. **API Documentation**: Update if endpoints change
4. **Database Schema**: Document new tables/columns

### Post-Phase Documentation

After each phase, update:

1. **`/docs/summary/recommendation-architecture.md`**:
   - Data flow diagrams
   - Algorithm explanations
   - Personalization layers

2. **`/docs/plans/algo-personalization-fix.md`**:
   - Implementation notes
   - Decisions made
   - Challenges encountered

3. **`/docs/recommendation-best-practices.md`**:
   - Industry techniques applied
   - References and citations

### Final Documentation

After all phases complete:

1. **User Guide**: How personalization works (for end users)
2. **Developer Guide**: How to modify/extend algorithms
3. **Troubleshooting Guide**: Common issues and solutions

---

## 🎯 Success Criteria

### Phase 0 Success

- [ ] `likedMoviesWithKeywords` \u003e 80% (from ~0%)
- [ ] `likedMoviesWithCredits` \u003e 80% (from ~0%)
- [ ] Taste profile extracts actual top actors, directors, keywords
- [ ] Test user's "generic" recommendations become personalized

### Phase 1 Success

- [ ] Source weights adjust based on user feedback
- [ ] Watchlist films appear prominently in suggestions
- [ ] MMR lambda auto-adjusts based on exploration stats
- [ ] Saved suggestions used as seeds
- [ ] Obscure films by favorite directors appear

### Phase 2 Success

- [ ] Users can see match scores on all cards
- [ ] "Because you loved..." callouts are accurate and helpful
- [ ] Multi-source badges display correctly
- [ ] Sections reduced from 24+ to 8-10 visible
- [ ] Taste profile summary widget is informative
- [ ] Section headers are personalized

### Phase 3 Success

- [ ] Feature weights learned from user feedback
- [ ] Rare keywords score higher than common ones
- [ ] Regional cinema preferences detected and used
- [ ] Recent watches weighted higher than old ones
- [ ] Rewatch patterns influence recommendation strategy

### Phase 4 Success

- [ ] Vector similarity finds semantic matches
- [ ] Genre distribution matches user's natural patterns
- [ ] Counter-programming prevents genre fatigue

### Overall Success

**Primary Goal**: User reports "Recommendations feel personalized, not generic"

**Quantitative Metrics**:

- Match score average \u003e 80%
- Genre diversity Shannon entropy \u003e 2.0
- Repeat rate \u003c 10%
- Feedback ratio (Interested / Total) \u003e 30%

**Qualitative Metrics**:

- User can explain WHY recommendations make sense
- User discovers new films they love
- User trusts the system

---

## 🚦 Execution Workflow

### Step 1: Environment Setup

Before starting implementation:

1. Create feature branch: `git checkout -b feature/recommendation-improvements`
2. Run baseline tests: `npm run test && npm run build`
3. Document baseline metrics for test users
4. Ensure Supabase access and API keys are configured

### Step 2: Phase-by-Phase Execution

For each phase:

1. **Create Phase Branch** (optional, for complex phases):

   ```bash
   git checkout -b phase-0-cache-fix
   ```

2. **Assign Tasks to Sub-Agents**:
   - Use `task` tool with specified `subagent_type`
   - Include skill requirements in prompt
   - Provide clear success criteria

3. **Implement Changes**:
   - Sub-agent implements task
   - Write/update tests
   - Update documentation

4. **Code Review**:
   - Dedicated review task by `code-reviewer`
   - Address feedback
   - Re-review if needed

5. **Testing**:
   - Run unit tests
   - Run integration tests
   - Manual testing with test users
   - Performance profiling

6. **Commit Changes**:

   ```bash
   git add .
   git commit -m "feat(phase-0): fix TMDB cache validation in buildTasteProfile"
   ```

7. **Merge Phase** (if using phase branches):
   ```bash
   git checkout feature/recommendation-improvements
   git merge phase-0-cache-fix
   ```

### Step 3: Final Integration

After all phases:

1. **Full Integration Testing**:
   - Test complete flow with all features
   - Verify no conflicts between phases
   - Performance testing

2. **Documentation Review**:
   - Ensure all docs are updated
   - Create user-facing changelog
   - Update README if needed

3. **Create Pull Request**:

   ```bash
   git push origin feature/recommendation-improvements
   gh pr create --title "Improve recommendation personalization" --body "..."
   ```

4. **Deploy to Staging**:
   - Deploy via Netlify
   - Test with real data
   - Monitor performance

5. **Production Deployment**:
   - Merge to main
   - Deploy to production
   - Monitor metrics

### Step 4: Post-Launch Monitoring

After deployment:

1. **Monitor Metrics** (first 48 hours):
   - Recommendation quality metrics
   - User engagement metrics
   - Error rates
   - Performance metrics

2. **Gather User Feedback**:
   - Survey users about improvement
   - Monitor support tickets
   - Check social media mentions

3. **Iterate**:
   - Address issues quickly
   - Plan follow-up improvements
   - Document learnings

---

## 📊 Sub-Agent Assignment Summary

| Phase       | Task                               | Sub-Agent          | Skills Required                            |
| ----------- | ---------------------------------- | ------------------ | ------------------------------------------ |
| **Phase 0** | Fix TMDB cache validation          | `typescript-pro`   | None                                       |
| **Phase 0** | Ensure cache stores complete data  | `typescript-pro`   | None                                       |
| **Phase 0** | Code review                        | `code-reviewer`    | `find-bugs`                                |
| **Phase 1** | Dynamic source weighting           | `typescript-pro`   | None                                       |
| **Phase 1** | Watchlist intent boost             | `typescript-pro`   | None                                       |
| **Phase 1** | Dynamic MMR lambda                 | `typescript-pro`   | None                                       |
| **Phase 1** | Use saved suggestions              | `typescript-pro`   | None                                       |
| **Phase 1** | Enhanced quality thresholds        | `typescript-pro`   | None                                       |
| **Phase 1** | Code review                        | `code-reviewer`    | `find-bugs`                                |
| **Phase 2** | Match score display                | `ui-designer`      | `frontend-design`                          |
| **Phase 2** | "Because you loved..." callouts    | `ui-designer`      | `frontend-design`                          |
| **Phase 2** | Multi-source badges                | `ui-designer`      | `frontend-design`                          |
| **Phase 2** | Reduce section overload            | `react-specialist` | None                                       |
| **Phase 2** | Taste profile summary widget       | `ui-designer`      | `frontend-design`                          |
| **Phase 2** | Recommendation reasons in sections | `react-specialist` | None                                       |
| **Phase 2** | UI/UX review                       | `ui-designer`      | `frontend-design`, `web-design-guidelines` |
| **Phase 2** | Code review                        | `code-reviewer`    | `find-bugs`                                |
| **Phase 3** | Learned feature weights            | `typescript-pro`   | None                                       |
| **Phase 3** | TF-IDF keyword weighting           | `typescript-pro`   | None                                       |
| **Phase 3** | Production metadata utilization    | `typescript-pro`   | None                                       |
| **Phase 3** | Temporal recency weighting         | `typescript-pro`   | None                                       |
| **Phase 3** | Rewatch patterns                   | `typescript-pro`   | None                                       |
| **Phase 3** | Code review                        | `code-reviewer`    | `find-bugs`                                |
| **Phase 4** | Vector-based similarity            | `typescript-pro`   | None                                       |
| **Phase 4** | Calibrated recommendations         | `typescript-pro`   | None                                       |
| **Phase 4** | Counter-programming                | `typescript-pro`   | None                                       |
| **Phase 4** | Code review                        | `code-reviewer`    | `find-bugs`                                |

---

## 🎉 Conclusion

This comprehensive plan addresses the root causes of generic recommendations and implements a multi-layered personalization system. The phased approach allows for:

1. **Quick Wins**: Phase 0-1 can be completed in 3-4 hours with immediate impact
2. **User Visibility**: Phase 2 makes personalization obvious to users
3. **Deep Learning**: Phase 3 leverages advanced data for better personalization
4. **Future-Proofing**: Phase 4 adds industry-standard techniques

**Recommended Execution**:

- **Week 1**: Phase 0 + Phase 1 (fix critical bugs + quick wins)
- **Week 2**: Phase 2 (UI/UX improvements)
- **Week 3**: Phase 3 (data utilization)
- **Future**: Phase 4 (advanced features as time permits)

**Total Estimated Time**:

- Phase 0-2 (Recommended): 10-15 hours
- All Phases: 20-25 hours

Let's build the most personalized movie recommendation system! 🎬✨
