/**
 * TuiMDB Genre Enhancement
 * Maps TuiMDB's 62 genres to TMDB genres and provides enhanced filtering
 */

export type TuiMDBGenre = {
  UID: number;
  Name: string;
};

export type EnhancedGenreProfile = {
  // Core genres with weights
  coreGenres: Array<{ id: number; name: string; weight: number; source: 'tmdb' | 'tuimdb' | 'both' }>;

  // Granular TuiMDB genres
  holidayGenres: Array<{ id: number; name: string; weight: number }>;
  nicheGenres: Array<{ id: number; name: string; weight: number }>; // Anime, Stand Up, Food, Travel

  // Negative filters
  avoidedGenres: Array<{ id: number; name: string; reason: string }>;
  avoidedHolidays: Array<{ id: number; name: string }>;

  // Seasonal recommendations
  currentSeason: string;
  seasonalGenres: Array<{ id: number; name: string; weight: number }>;
};

// TuiMDB Genre Mapping
// NOTE: TMDB genre IDs go up to ~10770, so we use 90000+ for TuiMDB-unique genres
// to avoid ID collisions (e.g., TMDB Western = 37, old TuiMDB Travel = 37)
export const TUIMDB_GENRES = {
  // TuiMDB-unique genres (use 90000+ to avoid collision with TMDB IDs)
  ANIME: 90001,     // Unique to TuiMDB
  FOOD: 90002,      // Unique to TuiMDB
  TRAVEL: 90003,    // Unique to TuiMDB (was 37, collided with TMDB Western!)
  STAND_UP: 90004,  // Unique to TuiMDB
  SPORTS: 90005,    // Unique to TuiMDB
  KIDS: 90006,      // Unique to TuiMDB (similar to Family)
  MUSICAL: 90007,   // Unique to TuiMDB (no direct TMDB equivalent)

  // Holiday genres (unique to TuiMDB)
  CHRISTMAS: 90043,
  NEW_YEARS: 90044,
  HANUKKAH: 90045,
  HALLOWEEN: 90046,
  THANKSGIVING: 90047,
  VALENTINES: 90048,
  EASTER: 90049,
  APRIL_FOOLS: 90050,
  INDEPENDENCE_DAY: 90051,
  VETERANS_DAY: 90052,
  PRESIDENTS_DAY: 90053,
  FOURTH_OF_JULY: 90054,
  LABOR_DAY: 90055,
  DIWALI: 90056,
  RAMADAN: 90057,
  ST_PATRICKS: 90058,
  MARDI_GRAS: 90059,
  GROUNDHOG_DAY: 90060,
  MOTHERS_DAY: 90061,
  FATHERS_DAY: 90062,
} as const;


// Map TMDB genre IDs to names
export const TMDB_GENRE_MAP: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
};

// Map TuiMDB to TMDB where they overlap
// TuiMDB-unique genres (90000+) have no TMDB equivalent
export const TUIMDB_TO_TMDB_MAP: Record<number, number | null> = {
  // TuiMDB-unique genres (no TMDB equivalent)
  [TUIMDB_GENRES.ANIME]: null,
  [TUIMDB_GENRES.FOOD]: null,
  [TUIMDB_GENRES.TRAVEL]: null,
  [TUIMDB_GENRES.STAND_UP]: null,
  [TUIMDB_GENRES.SPORTS]: null,
  [TUIMDB_GENRES.KIDS]: 10751,  // Maps loosely to Family
  [TUIMDB_GENRES.MUSICAL]: null,
  // Holiday genres all have no TMDB equivalent
  [TUIMDB_GENRES.CHRISTMAS]: null,
  [TUIMDB_GENRES.HALLOWEEN]: null,
  [TUIMDB_GENRES.THANKSGIVING]: null,
  [TUIMDB_GENRES.NEW_YEARS]: null,
  [TUIMDB_GENRES.VALENTINES]: null,
  [TUIMDB_GENRES.EASTER]: null,
  [TUIMDB_GENRES.INDEPENDENCE_DAY]: null,
  [TUIMDB_GENRES.FOURTH_OF_JULY]: null,
};

/**
 * Get current season and relevant seasonal genres
 */
export function getCurrentSeasonalGenres(): { season: string; genres: number[]; labels: string[] } {
  const now = new Date();
  const month = now.getMonth(); // 0-11
  const day = now.getDate();

  const seasonalGenres: number[] = [];
  const labels: string[] = [];

  // Halloween season (October)
  if (month === 9) {
    seasonalGenres.push(TUIMDB_GENRES.HALLOWEEN);
    labels.push('Halloween');
  }

  // Thanksgiving (November)
  if (month === 10) {
    seasonalGenres.push(TUIMDB_GENRES.THANKSGIVING);
    labels.push('Thanksgiving');
  }

  // Christmas season (November 20 - December 31)
  if ((month === 10 && day >= 20) || month === 11) {
    seasonalGenres.push(TUIMDB_GENRES.CHRISTMAS);
    labels.push('Christmas');
  }

  // New Year's (late December - early January)
  if ((month === 11 && day >= 26) || (month === 0 && day <= 7)) {
    seasonalGenres.push(TUIMDB_GENRES.NEW_YEARS);
    labels.push("New Year's");
  }

  // Valentine's Day (February)
  if (month === 1) {
    seasonalGenres.push(TUIMDB_GENRES.VALENTINES);
    labels.push("Valentine's Day");
  }

  // St. Patrick's Day (March)
  if (month === 2) {
    seasonalGenres.push(TUIMDB_GENRES.ST_PATRICKS);
    labels.push("St. Patrick's Day");
  }

  // Easter (March-April, approximate)
  if (month === 2 || month === 3) {
    seasonalGenres.push(TUIMDB_GENRES.EASTER);
    labels.push('Easter');
  }

  // Independence Day / Fourth of July (June-July)
  if (month === 5 || month === 6) {
    seasonalGenres.push(TUIMDB_GENRES.INDEPENDENCE_DAY, TUIMDB_GENRES.FOURTH_OF_JULY);
    labels.push('Fourth of July', 'Independence Day');
  }

  const seasonName =
    month >= 2 && month <= 4 ? 'Spring' :
      month >= 5 && month <= 7 ? 'Summer' :
        month >= 8 && month <= 10 ? 'Fall' :
          'Winter';

  return { season: seasonName, genres: seasonalGenres, labels };
}

/**
 * Check if user likes holiday movies based on their history
 */
export function detectHolidayPreferences(userFilms: Array<{
  title: string;
  rating?: number;
  liked?: boolean;
}>): {
  likesHolidayMovies: boolean;
  likedHolidays: string[];
  dislikedHolidays: string[];
} {
  const holidayKeywords: Record<string, string[]> = {
    christmas: ['christmas', 'santa', 'xmas', 'holiday'],
    halloween: ['halloween', 'trick or treat', 'spooky'],
    thanksgiving: ['thanksgiving', 'turkey day'],
    valentines: ['valentine', 'love day'],
    easter: ['easter', 'bunny'],
    'new years': ['new year', 'nye'],
  };

  const holidayLikes: Record<string, number> = {};
  const holidayDislikes: Record<string, number> = {};

  for (const film of userFilms) {
    const titleLower = film.title.toLowerCase();

    for (const [holiday, keywords] of Object.entries(holidayKeywords)) {
      const matches = keywords.some(kw => titleLower.includes(kw));
      if (!matches) continue;

      if ((film.rating ?? 0) >= 4 || film.liked) {
        holidayLikes[holiday] = (holidayLikes[holiday] || 0) + 1;
      } else if ((film.rating ?? 0) < 3) {
        holidayDislikes[holiday] = (holidayDislikes[holiday] || 0) + 1;
      }
    }
  }

  const likedHolidays = Object.entries(holidayLikes)
    .filter(([_, count]) => count >= 2)
    .map(([holiday]) => holiday);

  const dislikedHolidays = Object.entries(holidayDislikes)
    .filter(([holiday, count]) => count >= 2 && (holidayLikes[holiday] || 0) < count)
    .map(([holiday]) => holiday);

  return {
    likesHolidayMovies: likedHolidays.length > 0,
    likedHolidays,
    dislikedHolidays,
  };
}

/**
 * Detect niche genre preferences (Anime, Stand Up, Food/Travel docs)
 */
export function detectNicheGenres(userFilms: Array<{
  title: string;
  genres?: string[];
  rating?: number;
  liked?: boolean;
}>): {
  likesAnime: boolean;
  likesStandUp: boolean;
  likesFoodDocs: boolean;
  likesTravelDocs: boolean;
} {
  let animeCount = 0;
  let standUpCount = 0;
  let foodCount = 0;
  let travelCount = 0;
  let totalCount = 0;

  for (const film of userFilms) {
    if ((film.rating ?? 0) < 3 && !film.liked) continue; // Only count liked/decent films
    totalCount++;

    const titleLower = film.title.toLowerCase();
    const genresLower = (film.genres || []).map(g => g.toLowerCase());

    // Anime detection
    if (genresLower.includes('anime') ||
      titleLower.includes('anime') ||
      /anime|manga|otaku/.test(titleLower)) {
      animeCount++;
    }

    // Stand up detection
    if (titleLower.includes('stand up') ||
      titleLower.includes('stand-up') ||
      titleLower.includes('comedy special')) {
      standUpCount++;
    }

    // Food documentary detection
    if ((genresLower.includes('documentary') &&
      /food|chef|cook|restaurant|cuisine|culinary/.test(titleLower))) {
      foodCount++;
    }

    // Travel documentary detection
    if ((genresLower.includes('documentary') &&
      /travel|journey|adventure|world|expedition/.test(titleLower))) {
      travelCount++;
    }
  }

  const threshold = 0.05; // 5% of library

  return {
    likesAnime: totalCount > 20 && (animeCount / totalCount) >= threshold,
    likesStandUp: totalCount > 20 && (standUpCount / totalCount) >= threshold,
    likesFoodDocs: totalCount > 20 && (foodCount / totalCount) >= threshold,
    likesTravelDocs: totalCount > 20 && (travelCount / totalCount) >= threshold,
  };
}

/**
 * Get seasonal movie recommendations for "Watch This Month" section
 */
export function getSeasonalRecommendationConfig(): {
  title: string;
  description: string;
  genres: number[];
  keywords: string[];
  boost: number;
} {
  const { season, genres, labels } = getCurrentSeasonalGenres();

  if (genres.length === 0) {
    return {
      title: `${season} Favorites`,
      description: `Great movies for ${season.toLowerCase()}`,
      genres: [],
      keywords: [],
      boost: 1.0,
    };
  }

  return {
    title: labels.length === 1 ? `${labels[0]} Movies` : `Watch This Month`,
    description: `Perfect for ${labels.join(' & ')}`,
    genres,
    keywords: labels.map(l => l.toLowerCase()),
    boost: 1.5, // Boost seasonal relevance
  };
}

/**
 * Merge TMDB and TuiMDB genre data to create enhanced genre list
 * Preserves TMDB genres and adds unique TuiMDB genres (like seasonal, anime, etc.)
 */
export function mergeEnhancedGenres(
  tmdbGenres: Array<{ id: number; name: string }>,
  tuimdbGenres: Array<{ id: number; name: string }>
): Array<{ id: number; name: string; source: 'tmdb' | 'tuimdb' }> {
  const enhanced: Array<{ id: number; name: string; source: 'tmdb' | 'tuimdb' }> = [];
  const seenIds = new Set<number>();

  // Add all TMDB genres first
  for (const genre of tmdbGenres) {
    enhanced.push({ ...genre, source: 'tmdb' });
    seenIds.add(genre.id);
  }

  // Add unique TuiMDB genres (those not overlapping with TMDB)
  for (const genre of tuimdbGenres) {
    // Check if this TuiMDB genre maps to an existing TMDB genre
    const tmdbEquivalent = TUIMDB_TO_TMDB_MAP[genre.id];

    if (tmdbEquivalent && seenIds.has(tmdbEquivalent)) {
      // This TuiMDB genre overlaps with existing TMDB genre, skip it
      continue;
    }

    if (!seenIds.has(genre.id)) {
      // This is a unique TuiMDB genre (like seasonal, anime, food, etc.)
      enhanced.push({ ...genre, source: 'tuimdb' });
      seenIds.add(genre.id);
    }
  }

  return enhanced;
}

/**
 * Boost score for movies with seasonal genres matching current season
 */
export function boostSeasonalGenres(
  score: number,
  movieGenreIds: number[],
  boost: number = 1.3
): number {
  const { genres: seasonalGenres } = getCurrentSeasonalGenres();

  if (seasonalGenres.length === 0) {
    return score; // No active seasonal boost
  }

  const hasSeasonalGenre = movieGenreIds.some(id => seasonalGenres.includes(id));

  if (hasSeasonalGenre) {
    return score * boost;
  }

  return score;
}
