# Advanced Subgenre Filtering & Cross-Genre Pattern Detection

## Overview
This document describes the **advanced taste profile enhancements** that enable nuanced filtering at the subgenre level. The system now understands preferences like:

- ✅ **Likes Action movies** BUT ❌ **avoids Superhero Action**
- ✅ **Loves Sci-Fi Space operas** BUT ❌ **avoids Anime Sci-Fi**
- ✅ **Enjoys Spy Thrillers** (Action+Thriller with espionage themes)
- ❌ **Avoids Stand-Up Comedy** (if never watched)

## Key Features

### 1. Subgenre Detection (`subgenreDetection.ts`)

#### What It Does
Analyzes user's watch history to detect **granular preferences within major genres**. For example:

```
Action Genre:
  ✅ Prefers: Spy, Military, Heist
  ❌ Avoids: Superhero, Car Chase
  
Science Fiction:
  ✅ Prefers: Space, Time Travel
  ❌ Avoids: Anime, Cyberpunk
```

#### How It Works

**Subgenre Keywords Mapping** (`SUBGENRE_KEYWORDS`):
- Contains 40+ subgenre categories
- Maps to 200+ keywords (e.g., "superhero", "marvel", "dc comics" → `ACTION_SUPERHERO`)
- Covers Action, Sci-Fi, Horror, Comedy, Drama, Thriller subgenres

**Analysis Algorithm**:
1. **Text Extraction**: Combines movie title + keywords + genres
2. **Keyword Matching**: Checks against subgenre keyword database
3. **Pattern Detection**: Tracks which subgenres are watched & liked
4. **Threshold Calculation**:
   - **Preferred**: `watchRatio >= 15%` AND `likeRatio >= 60%`
   - **Avoided**: `watched >= 3` AND `likeRatio < 30%` OR `watchRatio < 5%` with `totalWatched >= 20`

**Example**:
```typescript
User watches 50 Action films:
- 20 Spy films (40%), 18 liked (90% like ratio) → ✅ PREFERRED
- 5 Superhero films (10%), 1 liked (20% like ratio) → ❌ AVOIDED
- 3 Martial Arts (6%), 3 liked (100%) → ✅ PREFERRED (edge case: small sample but all liked)
```

### 2. Cross-Genre Pattern Analysis

#### What It Does
Identifies **multi-genre combinations** the user loves, with associated themes.

**Examples**:
- `Action+Thriller` with keywords: `spy`, `espionage`, `cia`
- `Drama+History` with keywords: `world war ii`, `biography`, `true story`
- `Horror+Thriller` with keywords: `psychological`, `mind games`

#### How It Works

**Pattern Building**:
1. Combines 2-3 genres per film (sorted alphabetically for consistency)
2. Collects keywords from liked/highly-rated films in that combination
3. Tracks statistics: `watched`, `liked`, `avgRating`, `weight`
4. Stores example films for context

**Boost Calculation**:
```typescript
boost = (pattern.weight / pattern.watched) * (1 + keywordMatches * 0.2)
```

**Filtering Requirement**:
- Minimum 3 films watched in that combo to establish pattern
- Keyword overlap required for boost

### 3. Advanced Filtering System (`advancedFiltering.ts`)

Provides 4 filtering layers:

#### Layer 1: Subgenre Avoidance
```typescript
applyAdvancedFiltering(candidate, profile)
→ Checks if candidate contains avoided subgenres
→ Returns: { shouldFilter: true, reason: "User avoids superhero action" }
```

#### Layer 2: Cross-Genre Boost
```typescript
→ Checks for matching genre combos + keywords
→ Returns: { boost: 1.8, boostReason: "Matches your taste in Action+Thriller with themes: spy, espionage (like Mission: Impossible, Casino Royale)" }
```

#### Layer 3: Negative Pattern Filtering
```typescript
applyNegativeFiltering(candidate, profile)
→ Checks avoided genre combos (e.g., "Animation+Family")
→ Checks avoided keywords (requires 2+ matches to filter)
```

#### Layer 4: Niche Compatibility
```typescript
checkNicheCompatibility(candidate, profile)
→ Filters Anime if user has never watched anime
→ Filters Stand-Up if user avoids comedy specials
→ Filters Food/Travel docs if user doesn't watch those niches
```

**Additional Checks**:
- **Runtime Compatibility**: Filters if candidate is ±30min outside user's typical range
- Works when user has consistent runtime preferences (max - min < 60 minutes)

## Integration with Taste Profile

### Enhanced Profile Type (`enhancedProfile.ts`)

Added fields:
```typescript
export type EnhancedTasteProfile = {
  // ... existing fields ...
  
  // NEW: Subgenre intelligence
  subgenrePatterns: Map<string, SubgenrePattern>;
  crossGenrePatterns: Map<string, CrossGenrePattern>;
}

export type SubgenrePattern = {
  parentGenre: string;
  subgenres: Map<string, { 
    watched: number; 
    liked: number; 
    avgRating: number;
    weight: number;
  }>;
  avoidedSubgenres: Set<string>;
  preferredSubgenres: Set<string>;
};

export type CrossGenrePattern = {
  combination: string; // e.g., "Action+Thriller"
  keywords: Set<string>;
  watched: number;
  liked: number;
  avgRating: number;
  weight: number;
  examples: string[]; // Example titles
};
```

### Profile Building Process

**Step 1**: Build base profile (genres, keywords, directors, cast)

**Step 2**: Analyze subgenre patterns
```typescript
const filmsForSubgenreAnalysis = watchedFilms.map(f => ({
  title: f.title,
  genres: cached?.genres?.map(g => g.name) || [],
  keywords: cached?.keywords?.map(k => k.name) || [],
  rating: f.rating,
  liked: f.liked
}));

const subgenrePatterns = analyzeSubgenrePatterns(filmsForSubgenreAnalysis);
const crossGenrePatterns = analyzeCrossGenrePatterns(filmsForSubgenreAnalysis);
```

**Step 3**: Include in final profile
```typescript
profile.subgenrePatterns = subgenrePatterns;
profile.crossGenrePatterns = crossGenrePatterns;
```

## Usage in Suggestion Pipeline

### Current Implementation

The filtering can be applied in the `suggestByOverlap` function in `enrich.ts`:

**Option 1: Pre-Filter Candidates**
```typescript
// Before scoring loop, filter candidates
const filteredCandidates = candidates.filter(cid => {
  const movie = tmdbCache.get(cid);
  if (!movie) return true; // Keep if no data
  
  const filterResult = applyAdvancedFiltering(movie, profile);
  return !filterResult.shouldFilter;
});
```

**Option 2: Apply During Scoring**
```typescript
// Inside scoreCandidate function
const filterResult = applyAdvancedFiltering(m, profile);
if (filterResult.shouldFilter) return null;

// Apply cross-genre boost to score
if (filterResult.boost) {
  score += filterResult.boost;
  if (filterResult.boostReason) {
    reasons.push(filterResult.boostReason);
  }
}
```

**Option 3: Post-Filter Results**
```typescript
// After generating suggestions, filter final results
const filteredResults = results.filter(result => {
  const movie = tmdbCache.get(result.tmdbId);
  if (!movie) return true;
  
  const check = applyAdvancedFiltering(movie, profile);
  return !check.shouldFilter;
});
```

### Recommended Integration Point

**Best approach**: Hybrid (Option 2 + Option 3)

1. **During scoring**: Apply subgenre filtering and boost
   - Faster (filters early)
   - Boosts score for perfect matches
   
2. **Post-scoring**: Apply niche & runtime filtering
   - More flexible (can adjust thresholds)
   - Doesn't affect relative scoring

## Example Scenarios

### Scenario 1: Action Fan Who Avoids Superhero Movies

**User History**:
- Watched 30 Action films
- 15 Spy films (all liked) → ✅ Prefers `ACTION_SPY`
- 3 Superhero films (0 liked, avg rating 2.0) → ❌ Avoids `ACTION_SUPERHERO`

**Filtering Behavior**:
```typescript
Candidate: "Avengers: Endgame"
Genres: ["Action", "Adventure", "Science Fiction"]
Keywords: ["superhero", "marvel", "based on comic"]

Result: shouldFilterBySubgenre()
→ Detects ACTION_SUPERHERO subgenre
→ Checks against profile.subgenrePatterns.get("Action")
→ Finds "ACTION_SUPERHERO" in avoidedSubgenres
→ Returns: { shouldFilter: true, reason: "User avoids action superhero within Action" }
```

### Scenario 2: Sci-Fi Space Fan (No Anime)

**User History**:
- Watched 25 Sci-Fi films
- 18 Space films (high ratings) → ✅ Prefers `SCIFI_SPACE`
- 0 Anime films

**Filtering Behavior**:
```typescript
Candidate: "Cowboy Bebop: The Movie"
Genres: ["Science Fiction", "Animation", "Action"]
Keywords: ["anime", "space", "bounty hunter"]

Result: checkNicheCompatibility()
→ Detects anime (genre + keywords)
→ Checks profile.nichePreferences.likesAnime
→ Returns: { compatible: false, reason: "User has not shown interest in anime" }
```

### Scenario 3: Spy Thriller Enthusiast

**User History**:
- Watched 20 `Action+Thriller` films with spy themes (avg rating 4.5)
- Keywords: `spy`, `espionage`, `cia`, `secret agent`

**Boost Behavior**:
```typescript
Candidate: "Tinker Tailor Soldier Spy"
Genres: ["Thriller", "Mystery", "Action"]
Keywords: ["spy", "cold war", "espionage", "intelligence"]

Result: boostForCrossGenreMatch()
→ Combo "Action+Thriller" matches profile pattern
→ Keywords overlap: ["spy", "espionage"]
→ boost = (90.0 / 20) * (1 + 2 * 0.2) = 6.3
→ Returns: { boost: 6.3, boostReason: "Matches your taste in Action+Thriller with themes: spy, espionage (like Casino Royale, Mission: Impossible)" }
```

## Benefits

### 1. **Eliminates False Positives**
- No more superhero movie spam for action fans
- No anime recommendations for non-anime watchers
- No stand-up specials for narrative film lovers

### 2. **Surfaces Hidden Gems**
- Finds niche subgenres user loves (e.g., heist films, space operas)
- Boosts cross-genre matches with specific themes
- Discovers patterns user didn't know they had

### 3. **User-Data-Driven**
- 100% based on actual watch history
- No assumptions or defaults
- Adapts as user watches more

### 4. **Transparent & Explainable**
- Clear reasons for filtering ("User avoids superhero action")
- Clear boost reasons ("Matches your taste in spy thrillers")
- Debug reports available (`generateSubgenreReport`, `generateFilteringReport`)

## Performance Considerations

### Memory Usage
- **Subgenre Patterns**: ~10 patterns × 5-10 subgenres each = ~100 entries
- **Cross-Genre Patterns**: ~20-50 patterns with keyword sets
- **Total**: ~5-10 KB per user profile

### Computational Cost
- **Profile Building**: O(n) where n = watched films (runs once on page load)
- **Filtering**: O(1) per candidate (simple Set lookups)
- **Total Overhead**: <50ms for 1000 candidates

### Optimization Tips
1. Cache profile in session storage
2. Pre-compute patterns server-side
3. Lazy-load cross-genre analysis (only if needed)

## Future Enhancements

### 1. Machine Learning Integration
- Use embeddings for semantic subgenre matching
- Cluster films by themes automatically

### 2. Temporal Patterns
- Track subgenre preferences over time
- Detect changing tastes (e.g., used to like superhero movies, now avoids)

### 3. Social Patterns
- Compare subgenre preferences with similar users
- Discover new subgenres based on taste twins

### 4. Multi-User Profiles
- Household profiles with combined avoidance patterns
- "Not for kids" filtering based on niche preferences

## Debugging & Monitoring

### Console Logs
```typescript
[EnhancedProfile] Subgenre analysis complete
  patternsDetected: 8
  crossPatternsDetected: 15
  exampleAvoidances: [
    "Action: avoids ACTION_SUPERHERO, ACTION_CAR_CHASE",
    "Science Fiction: avoids SCIFI_CYBERPUNK",
    "Horror: avoids HORROR_SLASHER"
  ]

[AdvancedFilter] Filtering "Avengers: Endgame" - User avoids superhero action within Action
[AdvancedFilter] Boosting "Casino Royale" by 5.2 - Matches your taste in Action+Thriller with themes: spy, espionage (like Mission: Impossible, Skyfall)
```

### Reports
```typescript
// Generate human-readable report
const report = generateSubgenreReport(profile.subgenrePatterns);
console.log(report);

// Generate filtering report
const filterReport = generateFilteringReport(profile);
console.log(filterReport);
```

**Output**:
```
Action:
  ✅ Prefers: spy, military, heist
  ❌ Avoids: superhero, car chase

Science Fiction:
  ✅ Prefers: space, time travel, alien
  ❌ Avoids: anime, cyberpunk

🔗 Cross-Genre Patterns:
  ✅ Action+Thriller: 18 watched, keywords: spy, espionage, secret agent
     Examples: Casino Royale, Mission: Impossible, The Bourne Identity
```

## API Reference

### Core Functions

#### `analyzeSubgenrePatterns(films): Map<string, SubgenrePattern>`
Analyzes watch history to detect subgenre preferences.

**Parameters**:
- `films`: Array of `{ title, genres, keywords, rating, liked }`

**Returns**: Map of genre → SubgenrePattern

#### `analyzeCrossGenrePatterns(films): Map<string, CrossGenrePattern>`
Detects multi-genre combinations with themes.

**Parameters**:
- `films`: Array of `{ title, genres, keywords, rating, liked }`

**Returns**: Map of combo → CrossGenrePattern

#### `shouldFilterBySubgenre(genres, keywords, title, patterns): FilterResult`
Checks if candidate should be filtered based on subgenre avoidance.

**Returns**: `{ shouldFilter: boolean, reason?: string }`

#### `boostForCrossGenreMatch(genres, keywords, patterns): BoostResult`
Calculates score boost for cross-genre pattern match.

**Returns**: `{ boost: number, reason?: string }`

#### `applyAdvancedFiltering(candidate, profile): FilterResult`
Main filtering function combining subgenre + cross-genre logic.

**Returns**: `{ shouldFilter: boolean, reason?: string, boost?: number, boostReason?: string }`

## Conclusion

This enhancement transforms the suggestion system from **genre-level matching** to **subgenre-level intelligence**, eliminating unwanted recommendations while surfacing highly relevant hidden gems based on the user's actual watch patterns.

**Key Insight**: Users don't just like "Action" or "Sci-Fi" — they like **specific flavors** within those genres. This system captures and leverages those nuances.
