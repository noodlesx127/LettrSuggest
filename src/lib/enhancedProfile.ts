/**
 * Enhanced Taste Profile Builder
 * Integrates TuiMDB genres, multi-source validation, and seasonal preferences
 */

import { type TMDBMovie } from './enrich';
import {
  getCurrentSeasonalGenres,
  detectHolidayPreferences,
  detectNicheGenres,
  type EnhancedGenreProfile,
  TUIMDB_GENRES,
  TMDB_GENRE_MAP
} from './genreEnhancement';
import { getTuiMDBGenres, getTuiMDBMovie } from './tuimdb';
import {
  analyzeSubgenrePatterns,
  analyzeCrossGenrePatterns,
  type SubgenrePattern,
  type CrossGenrePattern
} from './subgenreDetection';

export type EnhancedTasteProfile = {
  // Core preferences with weights
  topGenres: Array<{ id: number; name: string; weight: number; source: 'tmdb' | 'tuimdb' | 'both' }>;
  topKeywords: Array<{ id: number; name: string; weight: number }>;
  topDirectors: Array<{ id: number; name: string; weight: number }>;
  topCast: Array<{ id: number; name: string; weight: number }>;

  // Enhanced genre understanding
  genreProfile: EnhancedGenreProfile;

  // User behavior patterns
  preferredEras: Array<{ decade: string; weight: number }>;
  runtimePreferences: { min: number; max: number; avg: number };
  languagePreferences: Array<{ language: string; weight: number }>;

  // Negative signals (things to avoid)
  avoidedGenres: Set<string>;
  avoidedKeywords: Set<string>;
  avoidedGenreCombos: Set<string>;

  // Contextual preferences
  seasonalBoost: { genres: number[]; weight: number };
  holidayPreferences: {
    likesHolidays: boolean;
    likedHolidays: string[];
    avoidHolidays: string[];
  };
  nichePreferences: {
    likesAnime: boolean;
    likesStandUp: boolean;
    likesFoodDocs: boolean;
    likesTravelDocs: boolean;
  };

  // Watchlist integration
  watchlistGenres: Array<{ name: string; count: number }>;
  watchlistDirectors: Array<{ name: string; count: number }>;

  // Subgenre intelligence (NEW: prevents recommending unwanted subgenres)
  subgenrePatterns: Map<string, SubgenrePattern>;
  crossGenrePatterns: Map<string, CrossGenrePattern>;

  // Statistics
  totalWatched: number;
  totalRated: number;
  totalLiked: number;
  avgRating: number;
  highlyRatedCount: number; // 4+ stars
  absoluteFavorites: number; // 5 stars + liked
};

/**
 * Build comprehensive taste profile from user's complete history
 */
export async function buildEnhancedTasteProfile(params: {
  watchedFilms: Array<{
    uri: string;
    title: string;
    year?: number;
    rating?: number;
    liked?: boolean;
    tmdbId?: number;
  }>;
  watchlistFilms: Array<{
    title: string;
    year?: number;
    tmdbId?: number;
  }>;
  tmdbCache: Map<number, TMDBMovie>;
  fetchMovie: (id: number) => Promise<TMDBMovie | null>;
}): Promise<EnhancedTasteProfile> {

  console.log('[EnhancedProfile] Building comprehensive taste profile', {
    watchedCount: params.watchedFilms.length,
    watchlistCount: params.watchlistFilms.length,
    cacheSize: params.tmdbCache.size
  });

  // Initialize accumulators
  const genreWeights = new Map<number, { name: string; weight: number; sources: Set<'tmdb' | 'tuimdb'> }>();
  const keywordWeights = new Map<number, { name: string; weight: number }>();
  const directorWeights = new Map<number, { name: string; weight: number }>();
  const castWeights = new Map<number, { name: string; weight: number }>();
  const decadeWeights = new Map<string, number>();
  const languageWeights = new Map<string, number>();
  const runtimes: number[] = [];

  const avoidedGenres = new Set<string>();
  const avoidedKeywords = new Set<string>();
  const avoidedGenreCombos = new Set<string>();

  const watchlistGenres = new Map<string, number>();
  const watchlistDirectors = new Map<string, number>();

  // P2.4: Increased weight differentiation for "liked" films
  // "Liked" status is a strong positive signal - should have significantly more impact
  const getWeight = (rating?: number, isLiked?: boolean): number => {
    const r = rating ?? 3;
    // Liked films get a significant boost (1.5x-2x) compared to just rated
    if (r >= 4.5) return isLiked ? 2.5 : 1.5;  // +1.0 gap (was +0.5)
    if (r >= 4.0) return isLiked ? 2.0 : 1.2;  // +0.8 gap (new tier)
    if (r >= 3.5) return isLiked ? 1.5 : 0.9;  // +0.6 gap (was +0.3)
    if (r >= 2.5) return isLiked ? 1.0 : 0.3;  // +0.7 gap (was +0.7)
    if (r >= 1.5) return isLiked ? 0.7 : 0.1;  // +0.6 gap unchanged
    return isLiked ? 0.5 : 0.0;               // Liked but 1-star is still some signal
  };

  // Statistics
  let totalRated = 0;
  let totalLiked = 0;
  let totalRating = 0;
  let highlyRatedCount = 0;
  let absoluteFavorites = 0;

  // Process watched films
  const watchedWithData = params.watchedFilms.filter(f => f.tmdbId);

  for (const film of watchedWithData) {
    if (!film.tmdbId) continue;

    const weight = getWeight(film.rating, film.liked);
    if (weight === 0) continue; // Skip if no positive signal

    // Statistics
    if (film.rating) {
      totalRated++;
      totalRating += film.rating;
      if (film.rating >= 4) highlyRatedCount++;
      if (film.rating >= 4.5 && film.liked) absoluteFavorites++;
    }
    if (film.liked) totalLiked++;

    // Try to get from cache first
    let movie: TMDBMovie | null | undefined = params.tmdbCache.get(film.tmdbId);
    if (!movie) {
      const fetched = await params.fetchMovie(film.tmdbId);
      if (fetched) {
        params.tmdbCache.set(film.tmdbId, fetched);
        movie = fetched;
      }
    }

    if (!movie) continue;

    // Multi-source genre validation: try TuiMDB as well
    let tuimdbMovie = null;
    try {
      tuimdbMovie = await getTuiMDBMovie(film.tmdbId);
    } catch (e) {
      // TuiMDB not available or failed, continue with TMDB only
    }

    // Extract genres from both sources
    const tmdbGenres = movie.genres || [];
    const tuimdbGenres = tuimdbMovie?.genres || [];

    // Merge genres from both sources
    const allGenreIds = new Set<number>();
    const genreIdToName = new Map<number, string>();

    // Add TMDB genres
    for (const genre of tmdbGenres) {
      if (genre.id && genre.name) {
        allGenreIds.add(genre.id);
        genreIdToName.set(genre.id, genre.name);
      }
    }

    // Add TuiMDB genres
    for (const genre of tuimdbGenres) {
      if (genre.id && genre.name) {
        allGenreIds.add(genre.id);
        if (!genreIdToName.has(genre.id)) {
          genreIdToName.set(genre.id, genre.name);
        }
      }
    }

    // Accumulate genre weights
    for (const genreId of allGenreIds) {
      const genreName = genreIdToName.get(genreId)!;
      const current = genreWeights.get(genreId) || {
        name: genreName,
        weight: 0,
        sources: new Set<'tmdb' | 'tuimdb'>()
      };

      current.weight += weight;
      if (tmdbGenres.some(g => g.id === genreId)) current.sources.add('tmdb');
      if (tuimdbGenres.some(g => g.id === genreId)) current.sources.add('tuimdb');

      genreWeights.set(genreId, current);
    }

    // Extract other features
    const credits = movie.credits || { cast: [], crew: [] };
    const directors = (credits.crew || [])
      .filter(c => c.job === 'Director')
      .slice(0, 3);

    for (const director of directors) {
      if (director.id && director.name) {
        const current = directorWeights.get(director.id) || { name: director.name, weight: 0 };
        current.weight += weight;
        directorWeights.set(director.id, current);
      }
    }

    const cast = (credits.cast || [])
      .sort((a, b) => (a.order || 999) - (b.order || 999))
      .slice(0, 10);

    for (const actor of cast) {
      if (actor.id && actor.name) {
        const current = castWeights.get(actor.id) || { name: actor.name, weight: 0 };
        current.weight += weight * 0.5; // Cast weight is lower than director
        castWeights.set(actor.id, current);
      }
    }

    // Keywords
    const keywords = movie.keywords?.keywords || movie.keywords?.results || [];
    for (const kw of keywords) {
      if (kw.id && kw.name) {
        const current = keywordWeights.get(kw.id) || { name: kw.name, weight: 0 };
        current.weight += weight;
        keywordWeights.set(kw.id, current);
      }
    }

    // Era/decade preferences
    if (movie.release_date || film.year) {
      const year = movie.release_date ? parseInt(movie.release_date.split('-')[0]) : film.year;
      if (year) {
        const decade = `${Math.floor(year / 10) * 10}s`;
        decadeWeights.set(decade, (decadeWeights.get(decade) || 0) + weight);
      }
    }

    // Language preferences
    const originalLang = (movie as any).original_language;
    if (originalLang) {
      languageWeights.set(
        originalLang,
        (languageWeights.get(originalLang) || 0) + weight
      );
    }

    // Runtime preferences
    const runtime = (movie as any).runtime;
    if (runtime && runtime > 0) {
      runtimes.push(runtime);
    }
  }

  // Process low-rated/disliked films for negative signals
  const dislikedFilms = params.watchedFilms.filter(f =>
    f.tmdbId && !f.liked && (f.rating ?? 0) < 3
  );

  for (const film of dislikedFilms.slice(0, 200)) { // Cap to avoid too many fetches
    if (!film.tmdbId) continue;

    let movie: TMDBMovie | null | undefined = params.tmdbCache.get(film.tmdbId);
    if (!movie) {
      const fetched = await params.fetchMovie(film.tmdbId);
      if (fetched) {
        params.tmdbCache.set(film.tmdbId, fetched);
        movie = fetched;
      }
    }

    if (!movie) continue;

    // Track avoided genres
    const genres = movie.genres || [];
    const genreCombo = genres.map(g => g.name).sort().join('+');
    if (genreCombo) avoidedGenreCombos.add(genreCombo);

    for (const genre of genres) {
      if (genre.name) avoidedGenres.add(genre.name.toLowerCase());
    }

    // Track avoided keywords
    const keywords = movie.keywords?.keywords || movie.keywords?.results || [];
    for (const kw of keywords) {
      if (kw.name) avoidedKeywords.add(kw.name.toLowerCase());
    }
  }

  // Process watchlist for intent signals
  for (const film of params.watchlistFilms) {
    if (!film.tmdbId) continue;

    let movie: TMDBMovie | null | undefined = params.tmdbCache.get(film.tmdbId);
    if (!movie) {
      const fetched = await params.fetchMovie(film.tmdbId);
      if (fetched) {
        params.tmdbCache.set(film.tmdbId, fetched);
        movie = fetched;
      }
    }

    if (!movie) continue;

    // Track watchlist genres
    const genres = movie.genres || [];
    for (const genre of genres) {
      if (genre.name) {
        watchlistGenres.set(genre.name, (watchlistGenres.get(genre.name) || 0) + 1);
      }
    }

    // Track watchlist directors
    const credits = movie.credits || { crew: [] };
    const directors = (credits.crew || []).filter(c => c.job === 'Director');
    for (const director of directors) {
      if (director.name) {
        watchlistDirectors.set(director.name, (watchlistDirectors.get(director.name) || 0) + 1);
      }
    }
  }

  // Detect holiday and niche preferences
  const holidayPrefs = detectHolidayPreferences(params.watchedFilms);
  const nichePrefs = detectNicheGenres(params.watchedFilms.map(f => ({
    title: f.title,
    genres: [], // Would need to fetch this
    rating: f.rating,
    liked: f.liked
  })));

  // Get seasonal boost
  const seasonalInfo = getCurrentSeasonalGenres();

  // Build enhanced genre profile
  const genreProfile: EnhancedGenreProfile = {
    coreGenres: Array.from(genreWeights.entries())
      .sort((a, b) => b[1].weight - a[1].weight)
      .slice(0, 15)
      .map(([id, data]) => ({
        id,
        name: data.name,
        weight: data.weight,
        source: data.sources.size === 2 ? 'both' :
          data.sources.has('tmdb') ? 'tmdb' : 'tuimdb'
      })),

    holidayGenres: [], // Would be populated from user's holiday watching
    nicheGenres: [],   // Would be populated from niche detection

    avoidedGenres: Array.from(avoidedGenres).map(name => ({
      id: 0, // Would need lookup
      name,
      reason: 'Low ratings in user history'
    })),

    avoidedHolidays: holidayPrefs.dislikedHolidays.map(name => ({
      id: 0, // Would need lookup
      name
    })),

    currentSeason: seasonalInfo.season,
    seasonalGenres: seasonalInfo.genres.map(id => ({
      id,
      name: seasonalInfo.labels[seasonalInfo.genres.indexOf(id)] || '',
      weight: 1.0
    }))
  };

  // Calculate runtime preferences
  const runtimeStats = runtimes.length > 0 ? {
    min: Math.min(...runtimes),
    max: Math.max(...runtimes),
    avg: runtimes.reduce((sum, r) => sum + r, 0) / runtimes.length
  } : { min: 0, max: 0, avg: 0 };

  const avgRating = totalRated > 0 ? totalRating / totalRated : 0;

  // Analyze subgenre patterns to detect nuanced preferences
  // E.g., "likes action but avoids superhero action"
  const filmsForSubgenreAnalysis = params.watchedFilms.map(f => {
    const cached = f.tmdbId ? params.tmdbCache.get(f.tmdbId) : null;
    const keywordsRaw = cached?.keywords?.keywords || cached?.keywords?.results || [];

    return {
      title: f.title,
      genres: cached?.genres?.map(g => g.name) || [],
      keywords: keywordsRaw.map(k => k.name),
      keywordIds: keywordsRaw.map(k => k.id),
      rating: f.rating,
      liked: f.liked
    };
  });

  const subgenrePatterns = analyzeSubgenrePatterns(filmsForSubgenreAnalysis);
  const crossGenrePatterns = analyzeCrossGenrePatterns(filmsForSubgenreAnalysis);

  console.log('[EnhancedProfile] Subgenre analysis complete', {
    patternsDetected: subgenrePatterns.size,
    crossPatternsDetected: crossGenrePatterns.size,
    exampleAvoidances: Array.from(subgenrePatterns.entries()).slice(0, 3).map(([genre, p]) =>
      `${genre}: avoids ${Array.from(p.avoidedSubgenres).join(', ')}`
    )
  });

  const profile: EnhancedTasteProfile = {
    topGenres: Array.from(genreWeights.entries())
      .sort((a, b) => b[1].weight - a[1].weight)
      .slice(0, 12)
      .map(([id, data]) => ({
        id,
        name: data.name,
        weight: data.weight,
        source: data.sources.size === 2 ? 'both' :
          data.sources.has('tmdb') ? 'tmdb' : 'tuimdb'
      })),

    topKeywords: Array.from(keywordWeights.entries())
      .sort((a, b) => b[1].weight - a[1].weight)
      .slice(0, 15)
      .map(([id, data]) => ({ id, name: data.name, weight: data.weight })),

    topDirectors: Array.from(directorWeights.entries())
      .sort((a, b) => b[1].weight - a[1].weight)
      .slice(0, 12)
      .map(([id, data]) => ({ id, name: data.name, weight: data.weight })),

    topCast: Array.from(castWeights.entries())
      .sort((a, b) => b[1].weight - a[1].weight)
      .slice(0, 15)
      .map(([id, data]) => ({ id, name: data.name, weight: data.weight })),

    genreProfile,

    preferredEras: Array.from(decadeWeights.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([decade, weight]) => ({ decade, weight })),

    runtimePreferences: runtimeStats,

    languagePreferences: Array.from(languageWeights.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([language, weight]) => ({ language, weight })),

    avoidedGenres,
    avoidedKeywords,
    avoidedGenreCombos,

    seasonalBoost: {
      genres: seasonalInfo.genres,
      weight: 1.5
    },

    holidayPreferences: {
      likesHolidays: holidayPrefs.likesHolidayMovies,
      likedHolidays: holidayPrefs.likedHolidays,
      avoidHolidays: holidayPrefs.dislikedHolidays
    },

    nichePreferences: nichePrefs,

    watchlistGenres: Array.from(watchlistGenres.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count })),

    watchlistDirectors: Array.from(watchlistDirectors.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count })),

    subgenrePatterns,
    crossGenrePatterns,

    totalWatched: params.watchedFilms.length,
    totalRated,
    totalLiked,
    avgRating,
    highlyRatedCount,
    absoluteFavorites
  };

  console.log('[EnhancedProfile] Profile complete', {
    topGenres: profile.topGenres.slice(0, 3).map(g => `${g.name}(${g.weight.toFixed(1)}, ${g.source})`),
    topKeywords: profile.topKeywords.slice(0, 3).map(k => `${k.name}(${k.weight.toFixed(1)})`),
    avgRating: avgRating.toFixed(2),
    seasonalBoost: seasonalInfo.labels.join(', '),
    holidayLikes: profile.holidayPreferences.likedHolidays.join(', ') || 'none',
    nicheGenres: Object.entries(nichePrefs).filter(([_, v]) => v).map(([k]) => k).join(', ') || 'none'
  });

  return profile;
}
