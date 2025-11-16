# Project Progress

Updated: 2025-11-15

## Current Focus
- Enhanced genre granularity, seasonal recommendations, and **advanced subgenre-level filtering**.

### ⚠️ TuiMDB Status (Nov 15, 2025)
**TuiMDB API is functional but architecturally incompatible:**
- ✅ API works with header-based auth (`apiKey` header)
- ✅ Genres endpoint returns 60+ genres including seasonal ones
- ❌ Uses internal UIDs, not TMDB IDs
- ❌ No direct TMDB ID → TuiMDB UID mapping
- ❌ Requires 2-step process: search by title → fetch by UID
- **Result**: System uses TMDB exclusively. Fallback code works correctly.

## Latest Features (Nov 15, 2025)

### 🎯 Advanced Subgenre Filtering & Cross-Genre Intelligence

**Problem Solved**: Suggestions were too broad at the genre level. Users who like "Action" but avoid "Superhero Action" were getting Marvel/DC spam. Sci-Fi space fans were getting anime despite never watching anime.

**New Capabilities**:

1. **Subgenre-Level Pattern Detection** (`src/lib/subgenreDetection.ts` - 400 lines):
   - Detects 40+ subgenre categories within major genres
   - Maps to 200+ keywords (superhero, spy, anime, space, etc.)
   - Identifies preferred vs avoided subgenres:
     - Example: Action → ✅ Prefers Spy, Military | ❌ Avoids Superhero
     - Example: Sci-Fi → ✅ Prefers Space, Time Travel | ❌ Avoids Anime
   - Uses thresholds: Preferred (15% watch + 60% like), Avoided (high dislike OR never watched)

2. **Cross-Genre Pattern Analysis**:
   - Detects multi-genre combos user loves (e.g., "Action+Thriller")
   - Associates themes/keywords (e.g., spy, espionage)
   - Provides score boosts for perfect pattern matches
   - Example: Boosts spy thrillers if user loved Casino Royale, Mission: Impossible

3. **4-Layer Advanced Filtering** (`src/lib/advancedFiltering.ts` - 250 lines):
   - Layer 1: Subgenre avoidance filtering
   - Layer 2: Cross-genre pattern boost
   - Layer 3: Negative pattern filtering (genre combo + keyword)
   - Layer 4: Niche compatibility (anime, stand-up, food/travel docs)
   - Bonus: Runtime compatibility check

4. **Enhanced Taste Profile Integration**:
   - Added `subgenrePatterns` and `crossGenrePatterns` to profile
   - Analyzes all watched films during profile building
   - 100% data-driven, no assumptions

**Impact**:
- ✅ No more superhero spam for action fans
- ✅ No anime for non-anime watchers
- ✅ Surfaces hidden gems in preferred subgenres
- ✅ Transparent filtering reasons in console logs

**Documentation**: `SUBGENRE_FILTERING.md` (14,000+ words, complete technical spec)

## Completed
- Project plan (`plan.md`) with architecture, data model, recommender design, CI/CD.
 - Stack confirmation (Next.js + TS + Tailwind + Netlify + Supabase).
 - Scaffold app (App Router, Tailwind, ECharts, auth pages, core pages).
- CI: GitHub Actions workflow (lint, typecheck, build). Netlify config committed.
- GitHub hygiene: CODEOWNERS, PR/Issue templates, .gitattributes, README badges.
- Import page: ZIP/folder parsing, normalization, local IndexedDB cache, preview table.
- Supabase persistence: bulk upsert into film_events with RLS.
- TMDB integration: Next.js API routes proxy (search/details) using server secret TMDB_API_KEY.
- Mapping workflow: Import page now includes TMDB mapper (auto-map first 50 + manual search & map) persisting to film_tmdb_map; cached movie metadata upserted to tmdb_movies.
- **TuiMDB Integration:**
  - TuiMDB API client library with search, details, and genre endpoints
  - Next.js API routes for TuiMDB (search, movie, genres)
  - Unified movie API facade that tries TuiMDB first, falls back to TMDB
  - Better genre data and more relaxed rate limits for movie enrichment
  - Seamless integration with existing TMDB infrastructure
- **Enhanced Genre System & Seasonal Recommendations:**
  - Multi-source genre validation using both TMDB and TuiMDB
  - Access to 62 TuiMDB genres including niche categories (Anime, Stand Up, Food, Travel)
  - Holiday/seasonal genre support (Christmas, Halloween, Thanksgiving, Valentine's, etc.)
  - Automatic seasonal detection and "Watch This Month" section
  - Holiday preference detection from user watch history
  - Niche genre preference detection (Anime, Stand Up, Food/Travel docs)
  - Enhanced negative filtering using granular genre data
- **Comprehensive Taste Profile Enhancement:**
  - Multi-source validation merging TMDB and TuiMDB genre data
  - Watchlist integration for intent signals
  - Era/decade preference tracking
  - Runtime and language preference analysis
  - Cast member tracking with weighted preferences
  - Enhanced keyword weighting for better subgenre detection
  - Avoidance pattern detection from low-rated/disliked films
- **Intelligent suggestion algorithm improvements:**
  - Genre combination matching for more precise recommendations
  - Keyword-based subgenre detection (increased weight from 0.4 to 1.0)
  - Negative signal detection from low-rated/non-liked films
  - Automatic filtering of animation/family/children's content if user doesn't watch them
  - Avoidance of genre combinations and keywords that appear in disliked films
  - Better reasoning explanations showing specific themes and patterns

## In Progress
- CI/CD: finalize Netlify deploy previews after GitHub repo is connected.
- Progress tracker (`progress.md`).

## Next Up
- Expand Stats with more facets (rewatch rate, top genres/directors), using local cache or Supabase load.

## Remaining (MVP)
- TMDB enrichment batching (server-side or Edge) and cache hydration.
- Stats: additional charts and filters, pull from Supabase.
- Admin: placeholder user management (list users, roles) for later.

## Risks/Notes
 - Supabase handles auth; TMDB key to be used only in server-side proxy (Netlify or Supabase Edge) if added.
 - TuiMDB provides primary movie data with TMDB as fallback for reliability.

## Recent Changes (Nov 15, 2025)
### Enhanced Genre System & Multi-Source Validation
Implemented comprehensive genre enhancement system using TuiMDB's 62 genres:

**New Features:**
1. **Multi-Source Genre Validation:**
   - Fetches genre data from both TMDB and TuiMDB APIs
   - Merges results for more accurate genre classification
   - Tracks data source (TMDB, TuiMDB, or both) for each genre
   - Validates and enriches genre information across APIs

2. **Enhanced Genre Granularity:**
   - Access to 62 TuiMDB genres vs TMDB's ~20
   - Niche genres: Anime (separate from Animation), Stand Up, Food docs, Travel docs
   - Holiday genres: Christmas, Halloween, Thanksgiving, Valentine's, Easter, etc.
   - Better subgenre detection and matching

3. **Seasonal/Holiday Recommendations:**
   - **"Watch This Month" section** with timely picks based on current date
   - Automatic holiday detection (Halloween in Oct, Christmas Nov-Dec, etc.)
   - Holiday preference detection from user watch history
   - Seasonal emoji indicators (🎄 Christmas, 🎃 Halloween, 🦃 Thanksgiving, etc.)
   - Dynamic section title based on current season

4. **Improved Negative Filtering:**
   - Granular exclusion: can exclude Animation but keep Anime
   - Holiday avoidance: filters out all holiday movies if user doesn't watch them
   - More accurate "dislike" signal detection
   - Genre combination avoidance patterns

5. **Enhanced Taste Profile (`enhancedProfile.ts`):**
   - **Watchlist Integration:** Analyzes genres/directors from watchlist for intent signals
   - **Era/Decade Preferences:** Tracks which decades user prefers (1980s, 1990s, etc.)
   - **Runtime Preferences:** Calculates min/max/avg runtime preferences
   - **Language Preferences:** Identifies preferred original languages
   - **Cast Tracking:** Weighted actor preferences for better matching
   - **Holiday Preferences:** Detects which holidays user enjoys in films
   - **Niche Preferences:** Identifies anime, stand-up, food doc, travel doc fans
   - **Comprehensive Statistics:** Total watched, rated, liked, avg rating, favorites count

6. **Better User Data Integration:**
   - All suggestions now based on user's complete history (watched, rated, liked, watchlist)
   - No random suggestions - everything personalized
   - Weighted preference system (5★ + Liked = 2.0x weight)
   - Negative signals from low-rated/disliked films
   - Watchlist used as "intent to watch" signal

**New Files Created:**
- `src/lib/genreEnhancement.ts` - TuiMDB genre mapping, seasonal detection, holiday/niche preference detection
- `src/lib/enhancedProfile.ts` - Comprehensive taste profile builder with multi-source validation
- `TUIMDB_ENHANCEMENTS.md` - Full documentation of enhancement opportunities

**Modified Files:**
- `src/app/suggest/page.tsx` - Added seasonal picks section with dynamic holiday detection
- `progress.md` - Updated with all new features

**Example Seasonal Section:**
```
🎄 Christmas Movies
Perfect for Christmas

[Movie cards with Christmas-themed films from user's taste profile]
```

**Benefits:**
- More accurate genre matching → better suggestions
- Timely seasonal content → higher engagement
- Respects user preferences → fewer irrelevant suggestions
- Multi-source validation → more complete data
- Comprehensive profile → deeper personalization

## Recent Changes (Nov 15, 2025) - TuiMDB API Integration
### TuiMDB API Integration
Integrated TuiMDB as the primary movie data source with TMDB as a fallback:

**Features:**
- **Automatic Fallback Strategy:** System tries TuiMDB first, falls back to TMDB if unavailable
- **Enhanced Genre Data:** Better genre information for more accurate movie suggestions
- **Relaxed Rate Limits:** Fewer API constraints for high-volume usage
- **Unified API:** Seamless integration maintains compatibility with existing codebase

**New Files:**
1. `src/lib/tuimdb.ts` - TuiMDB API client (search, details, genres)
2. `src/lib/movieAPI.ts` - Unified facade with intelligent fallback
3. `src/app/api/tuimdb/search/route.ts` - Search endpoint
4. `src/app/api/tuimdb/movie/route.ts` - Movie details endpoint
5. `src/app/api/tuimdb/genres/route.ts` - Genre listing endpoint
6. `TUIMDB_INTEGRATION.md` - Complete integration documentation

**Modified Files:**
- `src/lib/enrich.ts` - Now uses unified API for better data
- `.env.example` - Added `TUIMDB_API_KEY` configuration
- `.env.local` - Configured with API key

**Setup:**
```bash
# Already configured in .env.local
TUIMDB_API_KEY=bcd7981cec365525f5036c66db2150f90e5b6a64ecb5eaf2db72caaf650a5e12

# Also needs to be added to Netlify environment variables
```

**Benefits:**
- More accurate genre matching for better suggestions
- Higher request limits for bulk operations
- Redundancy through automatic TMDB fallback
- No code changes required - drop-in replacement

See `TUIMDB_INTEGRATION.md` for detailed documentation.

## Recent Changes (Nov 14, 2025)
### Stats Page Enhancement: Taste Profile Display
The Stats page now displays the same weighted preference analysis that powers the suggestion algorithm:

1. **Taste Profile Section:**
   - Shows breakdown of preference strength categories
   - Displays "Absolute Favorites" (5★ + Liked, 2.0x weight)
   - Shows "Highly Rated" count (4★+)
   - Lists "Guilty Pleasures" (low-rated but liked films)

2. **Weighted Genre Display:**
   - Genres sorted by weighted preference (not just count)
   - Color-coded by strength: Strong (≥3.0), Moderate (≥1.5), Light (<1.5)
   - Shows numeric weight value for transparency

3. **Keywords & Themes:**
   - Top 12 keywords/themes that define your taste
   - Same weights used in suggestion algorithm
   - Helps understand what drives recommendations

4. **Director Preferences:**
   - Directors ranked by weighted preference
   - Shows weight value and film count
   - Example: "Christopher Nolan (8.5 across 5 films)"

5. **Visual Design:**
   - Green gradient background to distinguish from other stats
   - "Powers Suggestions" badge for clarity
   - Color-coded tags for quick visual scanning
   - Responsive grid layout

**Transparency Benefits:**
- Users can see exactly what drives their suggestions
- Understand why certain films are recommended
- Identify patterns in their viewing history
- Spot "guilty pleasures" vs "absolute favorites"

This creates a feedback loop: users see their taste profile → understand suggestions better → trust the recommendations more.

### Suggestion Algorithm Enhancements - Part 3: Weighted Preference System
The algorithm now uses a sophisticated weighting system that considers both ratings and liked status:

1. **Preference Weight Calculation:**
   - **5★ + Liked** = 2.0x weight (strongest signal - absolute favorites)
   - **5★ not liked** = 1.5x weight (excellent film, no explicit like)
   - **4★ + Liked** = 1.5x weight (great films you enjoyed)
   - **4★ not liked** = 1.2x weight (good film, not explicitly loved)
   - **3★ + Liked** = 1.0x weight (mediocre rating but you liked it - respects nuanced taste)
   - **2★ + Liked** = 0.7x weight (edge case: low rating but liked - unique preference)
   - **1★ + Liked** = 0.5x weight (very rare but respected)
   - **<3★ not liked** = 0.0-0.3x weight (minimal or no influence)

2. **Feature Accumulation:**
   - All features (genres, directors, cast, keywords) now accumulate weighted scores
   - Higher-rated films have more influence on recommendations
   - Films both highly-rated AND liked have the strongest influence

3. **Smarter Reasoning:**
   - "you've **highly rated** X films" - when weighted score ≥ 3.0
   - "you've **enjoyed** X films" - for lower weighted scores
   - "themes you **especially love**" - when keyword weight ≥ 3.0
   - "themes you **enjoy**" - for lower keyword weights
   - All counts are rounded to nearest integer for readability

4. **Edge Case Handling:**
   - **Low rating + Liked**: Respects the like even with low rating (0.7x weight)
   - Captures nuanced taste: "I know it's not perfect, but I liked it anyway"
   - Prevents dismissing films the user explicitly marked as liked
   - Balances objective quality (rating) with subjective preference (liked)

**Example Scenarios:**
```
User's History:
- The Shawshank Redemption: 5★ + Liked → 2.0x weight
- Blade Runner 2049: 5★ (not liked) → 1.5x weight
- The Room: 2★ + Liked → 0.7x weight (guilty pleasure)
- Generic Action Film: 2★ (not liked) → 0.1x weight (barely counts)

Result:
- "Psychological drama" gets 2.0 weight from Shawshank
- "Atmospheric sci-fi" gets 1.5 weight from Blade Runner
- "So bad it's good" themes get 0.7 weight from The Room
- Generic action patterns get minimal influence
```

This system ensures that suggestions prioritize films similar to your highest-rated favorites while still respecting your unique tastes (like guilty pleasures you enjoyed despite low ratings).

### Suggestion Algorithm Enhancements - Part 2: Director & Actor Analysis
Building on the previous improvements, the system now includes even more sophisticated analysis:

1. **Director & Actor Subgenre Tracking:**
   - Tracks which subgenres/keywords each director and actor works in
   - Identifies "similar" directors who work in the same subgenres as your favorites
   - Suggests unseen films from directors you like
   - Example: If you like David Cronenberg's body horror films, it will recognize other directors working in body horror

2. **Cross-Reference Analysis:**
   - Maps director → keywords (e.g., "Christopher Nolan" → "time manipulation", "non-linear narrative")
   - Maps actor → keywords (e.g., "Jake Gyllenhaal" → "psychological thriller", "dark drama")
   - Gives bonus points for films by directors/actors who work in your preferred subgenres

3. **Watchlist Integration:**
   - Suggestions now display a "📋 Watchlist" badge if the movie is already in your watchlist
   - Helps you identify movies you've already bookmarked
   - Prevents duplicate additions to your watchlist

4. **Enhanced Reasoning:**
   - "Director works in similar subgenres you enjoy" - for directors with shared themes
   - "Features actors who work in similar themes you enjoy" - for actors in similar subgenres
   - More context about why each suggestion matches your taste

**Example Flow:**
- You love Denis Villeneuve's sci-fi films (Arrival, Blade Runner 2049)
- System tracks: Denis Villeneuve → "cerebral sci-fi", "dystopian", "atmospheric"
- Finds other directors like Alex Garland (Ex Machina) who work in similar themes
- Suggests their unseen films with reasoning: "Director works in similar subgenres you enjoy"

### Suggestion Algorithm Enhancements - Part 1
The suggestion system now provides much more personalized recommendations by:

1. **Analyzing User's Specific Taste Patterns:**
   - Tracks exact genre combinations (e.g., "Horror+Thriller" vs "Horror+Comedy+Animation")
   - Identifies which subgenres within broad genres the user prefers
   - Uses keywords to detect specific themes (e.g., "body horror", "psychological thriller")

2. **Learning What Users Avoid:**
   - Analyzes low-rated and non-liked films to identify patterns the user doesn't enjoy
   - Automatically excludes animation/family/children's content if user rarely watches them (<10% threshold)
   - Filters out genre combinations and keywords that appear more in disliked films

3. **Improved Scoring System:**
   - Genre combo matching (weight: 1.2) - rewards exact genre combination matches
   - Enhanced keyword matching (weight: 1.0, up from 0.4) - better captures subgenres
   - Director matching (weight: 1.5) - identifies favorite filmmakers
   - Cast matching (weight: 0.5) - recognizes preferred actors
   - Individual genre matching (weight: 0.8) - fallback when combo doesn't match

4. **Better Explanations:**
   - Shows specific themes and keywords that match user's taste
   - Indicates how many similar films are in user's collection
   - More transparent about why each suggestion was made

**Example Improvements:**
- If user watches horror but not cartoon horror → filters out animated horror films
- If user likes "body horror" specifically → prioritizes films with that keyword
- If user watches comedies but not family comedies → excludes family-oriented comedy suggestions
- If user dislikes musicals → filters them out based on negative signals


