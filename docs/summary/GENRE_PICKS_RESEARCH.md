# Genre Picks Feature - Comprehensive Research Document

**Date**: January 25, 2026  
**Purpose**: Understanding how the Genre Picks feature works in LettrSuggest  
**Status**: Complete - Very Thorough Search

---

## Executive Summary

The **Genre Picks** feature is a sophisticated recommendation system that allows users to select specific genres and sub-genres from their watch history, then generates personalized movie suggestions filtered to those genres. It combines:

1. **Genre Selection UI** - Interactive component supporting both main genres and sub-genres
2. **Smart Candidate Discovery** - Multi-source data aggregation (TMDB, TasteDive, Watchmode)
3. **Advanced Filtering** - Subgenre-level pattern matching to exclude unwanted content
4. **Categorization** - Organization by genre and sub-genre with deduplication logic

---

## 1. Frontend Architecture

### 1.1 Genre Selection Component

**Location**: `src/components/GenreSelector.tsx`

#### Features:

- **Main Genres**: 19 TMDB standard genres + 5 TuiMDB niche genres (Anime, Food, Travel, Stand Up, Sports)
- **Sub-genres**: 90+ sub-genre categories with emoji indicators and keyword associations
- **Parent-Child Relationship**:
  - Horror (27): 13 subgenres (Supernatural, Psychological, Slasher, Zombie, etc.)
  - Thriller (53): 9 subgenres (Spy, Conspiracy, Crime, etc.)
  - Science Fiction (878): 9 subgenres (Space, Cyberpunk, Time Travel, etc.)
  - Action (28): 9 subgenres (Superhero, Martial Arts, Heist, etc.)
  - Drama (18): 9 subgenres (Historical, Biographical, Coming of Age, etc.)
  - Animation (16): 8 subgenres (Anime, Mecha, Shonen, etc.)
  - Comedy (35): 9 subgenres (Dark, Satire, Parody, etc.)
  - Documentary (99): 8 subgenres (True Crime, Nature, Food, Travel, etc.)
  - Fantasy (14): 5 subgenres (Epic, Dark, Urban, Fairy Tale, etc.)
  - Romance (10749): 3 subgenres (Period, Tragic, Romantic Drama)
  - War (37), Crime (80), Music (10402), Western (37) - Various subgenres

#### UI Structure:

```typescript
// Genre pills with emoji indicators
<GenreSelector
  selectedGenres={selectedGenres}
  onChange={setSelectedGenres}
  selectedSubgenres={selectedSubgenres}
  onSubgenreChange={setSelectedSubgenres}
  showSubgenres={true}
/>
```

#### Data Structure:

```typescript
export const ALL_GENRES = [
  { id: 28, name: "Action", emoji: "💥" }, // TMDB genre
  { id: 90001, name: "Anime", emoji: "🎌", source: "tuimdb" }, // TuiMDB niche
  // ... 23 more genres
];

// Sub-genre mapping (e.g., Horror subgenres)
SUBGENRES_BY_PARENT[27] = [
  {
    key: "HORROR_SUPERNATURAL",
    name: "Supernatural",
    emoji: "👻",
    parentGenreId: 27,
    keywordIds: [6152],
  },
  {
    key: "HORROR_PSYCHOLOGICAL",
    name: "Psychological",
    emoji: "🧠",
    parentGenreId: 27,
    keywordIds: [295907],
  },
  // ... 11 more
];
```

### 1.2 Genre Suggest Page

**Location**: `src/app/genre-suggest/page.tsx`

#### Workflow (7-stage process):

1. **Initialize** - Setup recommendation engine, clear caches
2. **Library** - Load user's Letterboxd watch history via Supabase
3. **Cache** - Fetch TMDB metadata for all watched films (500-5000+ movies)
4. **Analyze** - Build comprehensive taste profile with ratings, keywords, genres, directors
5. **Discover** - Find movie candidates from multiple sources:
   - Smart candidates (trending, similar, discovered)
   - Genre-specific discovery via TMDB
   - Sub-genre enhanced discovery (fetches 150+ candidates per sort strategy)
   - Multi-decade sampling for diversity
6. **Score** - Rank candidates using overlap scoring, source reliability, freshness
7. **Details** - Fetch full movie metadata (genres, keywords, runtime, streaming)

#### Key State Management:

```typescript
const [selectedGenres, setSelectedGenres] = useState<number[]>([]); // Genre IDs
const [selectedSubgenres, setSelectedSubgenres] = useState<string[]>([]); // Subgenre keys
const [genreSuggestions, setGenreSuggestions] = useState<GenreSuggestions>({}); // genre_id → MovieItem[]
const [subgenreSuggestions, setSubgenreSuggestions] =
  useState<SubgenreSuggestions>({}); // subgenre_key → MovieItem[]
```

#### Data Persistence:

- **LocalStorage Keys**:
  - `lettrsuggest_genre_selection` - Selected genres (JSON array of IDs)
  - `lettrsuggest_subgenre_selection` - Selected sub-genres (JSON array of keys)
  - `lettrsuggest_genre_shown_ids` - Previously shown movies (7-day TTL)

---

## 2. Genre & Sub-genre Data Structures

### 2.1 Main Genre Definitions

**Files**:

- `src/components/GenreSelector.tsx` - UI-facing genre definitions
- `src/lib/genreEnhancement.ts` - Genre mappings and helpers

#### TMDB Standard Genres (19):

- Action (28), Adventure (12), Animation (16), Comedy (35), Crime (80)
- Documentary (99), Drama (18), Family (10751), Fantasy (14), History (36)
- Horror (27), Music (10402), Mystery (9648), Romance (10749), Science Fiction (878)
- Thriller (53), TV Movie (10770), War (10752), Western (37)

#### TuiMDB Niche Genres (uses 90000+ IDs to avoid TMDB collisions):

- ANIME: 90001 ✓ (Unique to TuiMDB)
- FOOD: 90002 ✓ (Unique - for food documentaries)
- TRAVEL: 90003 ✓ (Unique - replaces colliding TMDB Western=37)
- STAND_UP: 90004 ✓ (Comedy specials)
- SPORTS: 90005 ✓ (Sports content)
- KIDS: 90006 ✓ (Similar to Family)
- MUSICAL: 90007 ✓ (No TMDB equivalent)

#### Holiday Genres (90043-90062):

- CHRISTMAS, NEW_YEARS, HALLOWEEN, THANKSGIVING, VALENTINES, EASTER, etc.

### 2.2 Sub-genre Detection

**Files**:

- `src/lib/subgenreData.ts` - Sub-genre metadata and display info
- `src/lib/subgenreDetection.ts` - Detection algorithms and pattern analysis

#### Detection Methods:

1. **TMDB Keyword ID Matching** (Most accurate):
   - Each subgenre mapped to 1-3 keyword IDs
   - Example: HORROR_SUPERNATURAL: [6152], HORROR_BODY: [283085]
   - See `SUBGENRE_TO_KEYWORD_IDS` object

2. **Text-based Detection** (Fallback):
   - 100+ keywords per subgenre stored in `SUBGENRE_KEYWORDS`
   - Example: HORROR_BODY includes: ['body horror', 'transformation', 'cronenberg', 'the fly', 'tetsuo']
   - Uses title, overview, and keyword names

3. **Cross-Genre Pattern Analysis**:
   - Detects combinations like "Action+Thriller" with spy themes
   - Learns user's preferences for specific genre pairs

#### Sub-genre Categories by Parent Genre:

**Horror** (13 subgenres):

- HORROR_SUPERNATURAL, HORROR_PSYCHOLOGICAL, HORROR_SLASHER, HORROR_ZOMBIE, HORROR_BODY
- HORROR_FOLK, HORROR_COSMIC, HORROR_OCCULT, HORROR_GOTHIC, HORROR_FOUND_FOOTAGE
- HORROR_VAMPIRE, HORROR_WEREWOLF, HORROR_COMEDY, HORROR_ELEVATED
- Keywords: supernatural, possession, psychological horror, slasher, zombie, body horror, folk horror, cosmic horror, occult, gothic, found footage, vampire, werewolf, elevated horror, etc.

**Thriller** (9 subgenres):

- THRILLER_PSYCHOLOGICAL, THRILLER_CONSPIRACY, THRILLER_CRIME, THRILLER_NEO_NOIR, THRILLER_LEGAL
- THRILLER_POLITICAL, THRILLER_SPY, THRILLER_REVENGE, THRILLER_ACTION
- Keywords: psychological thriller, conspiracy, crime, neo-noir, legal thriller, political, spy, espionage, revenge

**Science Fiction** (9 subgenres):

- SCIFI_SPACE, SCIFI_CYBERPUNK, SCIFI_TIME_TRAVEL, SCIFI_ALIEN, SCIFI_POST_APOCALYPTIC
- SCIFI_DYSTOPIA, SCIFI_SPACE_OPERA, SCIFI_ROBOT, SCIFI_VIRTUAL_REALITY
- Keywords: outer space, spaceship, spaceman, cyberpunk, neon, time travel, time loop, alien, UFO, post-apocalyptic, dystopia, robot, AI, virtual reality

**Action** (9 subgenres):

- ACTION_SUPERHERO, ACTION_SPY, ACTION_MILITARY, ACTION_MARTIAL_ARTS, ACTION_HEIST
- ACTION_CAR_CHASE, ACTION_DISASTER, ACTION_BUDDY_COP, ACTION_REVENGE
- Keywords: superhero, spy, espionage, military, martial arts, kung fu, heist, robbery, car chase, disaster, buddy cop, revenge

**Animation** (8 subgenres):

- ANIME_SCIFI, ANIME_MECHA, ANIME_SHONEN, ANIME_SEINEN, ANIME_SLICE_OF_LIFE, ANIME_ISEKAI
- ANIMATION_PIXAR, ANIMATION_STOP_MOTION, ANIMATION_ADULT
- Keywords: anime, Japanese animation, mecha, giant robot, shonen, seinen, slice of life, isekai, Pixar, stop motion, claymation

---

## 3. Recommendation Generation Pipeline

### 3.1 Candidate Discovery Phase

**Location**: `src/app/genre-suggest/page.tsx` (runGenreS
