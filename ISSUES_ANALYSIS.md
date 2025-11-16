# LettrSuggest Issues Analysis

## Date: November 15, 2025

## Critical Issues Found

### 1. ❌ HTTP 406 Errors from Supabase (CRITICAL)
**Problem:** All direct browser queries to `tmdb_movies` table return HTTP 406 (Not Acceptable)
```
XHRGET https://xtcsekftikdsauttlcin.supabase.co/rest/v1/tmdb_movies?select=data&tmdb_id=eq.32195
[HTTP/3 406  66ms]
```

**Root Cause:** Supabase PostgREST is rejecting requests, likely due to:
- Missing or incorrect `Accept` header (should be `application/json`)
- CORS misconfiguration
- RLS (Row Level Security) policies blocking anonymous access

**Impact:** Movie metadata caching completely broken, forcing all movie lookups to go through TMDB API

**Fix Required:**
1. Check Supabase RLS policies for `tmdb_movies` table - ensure SELECT is allowed for authenticated users
2. Verify Supabase client is sending proper headers
3. Consider adding explicit headers to Supabase queries:
```typescript
const { data, error } = await supabase
  .from('tmdb_movies')
  .select('data')
  .eq('tmdb_id', id)
  .maybeSingle();
```

### 2. ❌ HTTP 400 Errors from TuiMDB API Route (CRITICAL)  
**Problem:** All 30 TuiMDB movie enrichment requests fail with HTTP 400
```
XHRGET https://lettrsuggest.netlify.app/api/tuimdb/movie?id=1907&_t=1763262460137
[HTTP/2 400  341ms]
```

**Root Cause:** API route expects `uid` parameter but code is sending `id` parameter
- API route: `const uid = url.searchParams.get('uid');`
- Frontend code: `tuiUrl.searchParams.set('id', String(s.tmdbId));`

**Impact:** 
- No TuiMDB enrichment happening
- All movies show "TuiMDB UID not found"
- Missing enhanced genre data from TuiMDB
- Suggestion quality degraded

**Fix Applied:** Removed broken TuiMDB calls from suggest page (they were incorrectly trying to fetch by TMDB ID instead of TuiMDB UID)

**Proper Fix Needed:**
1. Implement UID mapping cache (TMDB ID → TuiMDB UID)
2. Or modify API route to accept TMDB ID and do the search internally
3. Current `fetchTmdbMovie` in `enrich.ts` already tries to get TuiMDB UID via search - use that

### 3. ⚠️ Poor TMDB Discovery Results
**Problem:** Most TMDB discover API calls return 0 results
```
[TMDB] discover ok { count: 0 }  // Happened 5 times
[TMDB] discover ok { count: 60 } // Only 2 successful queries
```

**Root Cause:** 
- Invalid or non-existent keyword IDs being passed to TMDB discover API
- Invalid people (director/actor) IDs
- Overly restrictive year range filters (2000-2015, 2010+, etc.)
- Multiple filter combinations being too narrow
- TMDB API returning empty results when filters don't match any movies

**Example from logs:**
```javascript
// These queries returned 0 results:
[TMDB] discover { genres: (3), keywords: (5), sortBy: "vote_average.desc", minVotes: 100, yearMin: 2000, yearMax: 2015, limit: 150 }
[TMDB] discover { genres: (3), sortBy: "vote_average.desc", minVotes: 50, yearMin: 2000, yearMax: 2015, limit: 150 }
[TMDB] discover { people: (3), sortBy: "primary_release_date.desc", yearMin: 2010, limit: 75 }
[TMDB] discover { people: (3), sortBy: "vote_average.desc", yearMin: 1990, limit: 75 }

// Only these succeeded:
[TMDB] discover { keywords: (3), sortBy: "popularity.desc", minVotes: 50, limit: 75 } => 60 results
[TMDB] discover { genres: (2), sortBy: "vote_average.desc", minVotes: 100, limit: 100 } => 60 results
```

**Impact:** Only 140 candidates generated instead of desired 500+, leading to:
- Limited suggestion variety
- Heavy filtering leaving very few suggestions
- Subgenre filtering further reduces pool

**Recommended Fixes:**
1. **Add logging** to see which specific IDs are being passed
2. **Validate IDs** before calling discover API - check if they exist in TMDB
3. **Relax year filters** - current 2000-2015 range may be too restrictive
4. **Remove keyword filters** from initial discovery, apply as post-filter
5. **Increase fallback limits** - if query returns <10 results, double the limit and retry
6. **Add "or" logic** - instead of requiring ALL genres, try ANY of top genres
7. **Test with known-good IDs** to isolate if it's ID validation or filter combination issue

### 4. ⚠️ Excessive Subgenre Filtering
**Problem:** Many good candidates filtered out by subgenre detection
```
[SubgenreFilter] Filtered "The Aeronauts" - User avoids drama historical within Drama
[SubgenreFilter] Filtered "Deadfall" - User avoids thriller crime within Thriller
[SubgenreFilter] Filtered "City Hunter" - User avoids action martial arts within Action
... (8+ more filtered)
```

**Impact:** Starting with only 140 candidates, then:
- After initial filter: 122 candidates
- After subgenre filter: ~80-90 candidates
- After scoring: 30 final suggestions

**Recommendation:** 
- Make subgenre filtering less aggressive
- Only filter if pattern appears in 10+ highly-rated films (not just 5+)
- Add confidence threshold for avoidance patterns

### 5. ⚠️ No Seasonal Picks Generated
**Problem:** Despite seasonal config active, 0 seasonal picks generated
```
[Suggest] Seasonal picks result { configGenres: (1) […], configKeywords: (1) […], seasonalPicksCount: 0 }
```

**Impact:** Missing themed recommendations that could enhance user engagement

**Likely Cause:** Seasonal genre/keyword IDs not matching any candidates in the small pool

## Performance Issues

### 1. Sequential Movie Detail Fetching
**Current:** 30 sequential fetch calls for movie details (videos, collections, etc.)
**Impact:** Slow page load, ~2-5 seconds per movie = 60-150 seconds total
**Recommendation:** Implement batching or parallel fetches (limit to 5-10 concurrent)

### 2. Redundant TMDB Cache Refreshes
```
[Suggest] refreshing TMDB cache for suggested ids 30
```
**Impact:** Makes redundant API calls for movies already cached
**Recommendation:** Check cache first, only refresh if missing critical data (poster_path, etc.)

## Data Quality Issues

### 1. All TuiMDB UIDs Missing
**Problem:** Every single movie shows `[UnifiedAPI] TuiMDB UID not found`
**Impact:** No enhanced genre data, no TuiMDB ratings, no cross-referencing benefits
**Recommendation:** 
- Pre-populate common movie UID mappings
- Cache successful UID lookups
- Fallback gracefully when UID not found

### 2. Missing Poster Metadata
**Problem:** After TMDB cache refresh, still need to fetch posters via `usePostersSWR`
**Impact:** Additional round-trip, delayed poster display
**Recommendation:** Ensure TMDB cache includes poster_path from the start

## Recommendations Priority List

### 🔴 Critical (Fix Immediately)
1. **Fix Supabase RLS policies** for `tmdb_movies` table - add SELECT policy for authenticated users
2. **Remove broken TuiMDB calls** (DONE) or properly implement UID mapping
3. **Improve TMDB discover** - validate IDs, relax filters, add fallbacks

### 🟡 High Priority (Fix Soon)
4. **Reduce subgenre filtering** aggressiveness
5. **Parallelize movie detail fetching** for faster page loads
6. **Add better error handling** and logging for failed API calls

### 🟢 Medium Priority (Nice to Have)
7. **Implement TuiMDB UID mapping cache** for better enrichment
8. **Fix seasonal picks** generation
9. **Add TMDB discover fallbacks** when queries return 0 results
10. **Optimize cache refresh** logic to avoid redundant calls

## Quick Wins

1. **Increase candidate pool target** from 140 to 300-500
2. **Reduce concurrent discover calls** from 7 to 3-4 (TMDB rate limits)
3. **Add retry logic** for failed Supabase queries
4. **Cache TuiMDB UIDs** in localStorage to avoid repeated searches

## Code Changes Made

### ✅ Fixed - Supabase RLS Policies (APPLIED)
- **Applied SQL migration** to `tmdb_movies` table via Supabase MCP
- Added three RLS policies:
  - `tmdb_movies_authenticated_read` - allows SELECT for all authenticated users
  - `tmdb_movies_authenticated_upsert` - allows INSERT for all authenticated users  
  - `tmdb_movies_authenticated_update` - allows UPDATE for all authenticated users
- Created index `tmdb_movies_tmdb_id_idx` for faster lookups
- **Result:** HTTP 406 errors should now be resolved

### ✅ Fixed - TMDB Discovery Improvements
**File:** `src/lib/trending.ts`

1. **Added ID validation and logging**
   - Validates genre, keyword, and people IDs before sending to API
   - Logs exactly which IDs are being used in each query
   - Warns when queries return 0 results with full filter details

2. **Removed restrictive year filters**
   - Eliminated hardcoded year ranges (2000-2015, 2010+, etc.)
   - Let TMDB return movies from all eras unless user explicitly filters
   - Increases candidate pool significantly

3. **Improved fallback strategies**
   - Genre+keyword query → falls back to genre-only if < 30 results
   - Genre-only → falls back to popular in genre if < 100 total results
   - Director query → falls back to single director if multiple returns 0
   - Each step logs results for debugging

4. **Progressive discovery approach**
   - Start with specific filters (genres + keywords)
   - Progressively relax filters if not enough candidates
   - Target 300+ discovered candidates vs previous 120

5. **Better error context**
   - All console.log statements include filter details
   - Easy to identify which specific IDs cause problems
   - Can now debug keyword/director ID issues

### ✅ Fixed - Subgenre Filtering (Less Aggressive)
**File:** `src/lib/subgenreDetection.ts`

**Changed avoidance thresholds from:**
- Old: `watched >= 3 && likeRatio < 0.3` (very aggressive)
- New: `watched >= 10 && likeRatio < 0.2` (more conservative)

**Result:** 
- Only filters if user has watched 10+ movies in subgenre AND dislikes it strongly
- Should filter ~50% less candidates
- Better balance between personalization and variety

### ✅ Fixed in `src/app/suggest/page.tsx` (PREVIOUS)
- Removed broken TuiMDB API calls that were using wrong parameter
- Simplified to use only TMDB API for now
- Removed unnecessary try-catch nesting
- Added proper error logging

### ⚠️ Still Needed
- TuiMDB UID mapping implementation (future enhancement)
- Parallel movie detail fetching (performance optimization)
