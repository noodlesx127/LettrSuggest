export async function fetchTrendingIds(period: 'day' | 'week' = 'day', limit = 100): Promise<number[]> {
  const u = new URL('/api/tmdb/trending', typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  u.searchParams.set('period', period);
  u.searchParams.set('limit', String(limit));
  u.searchParams.set('_t', String(Date.now())); // Cache buster
  try {
    console.log('[TMDB] trending start', { period, limit });
    const r = await fetch(u.toString(), { cache: 'no-store' });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      console.error('[TMDB] trending error', { status: r.status, body: j });
      return [];
    }
    console.log('[TMDB] trending ok', { count: (j.ids ?? []).length });
    return (j.ids as number[]) || [];
  } catch (e) {
    console.error('[TMDB] trending exception', e);
    return [];
  }
}

/**
 * Fetch similar/recommended movies for a set of seed movie IDs
 * This provides more personalized candidates based on specific films the user liked
 */
export async function fetchSimilarMovieIds(seedIds: number[], limitPerSeed = 10): Promise<number[]> {
  const allIds = new Set<number>();
  
  // Limit seeds to avoid too many API calls
  const limitedSeeds = seedIds.slice(0, 10);
  
  for (const seedId of limitedSeeds) {
    try {
      // Fetch similar movies for this seed
      const u = new URL('/api/tmdb/movie', typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
      u.searchParams.set('id', String(seedId));
      u.searchParams.set('_t', String(Date.now())); // Cache buster
      
      const r = await fetch(u.toString(), { cache: 'no-store' });
      const j = await r.json();
      
      if (j.ok && j.movie) {
        // Get similar movies from the movie's recommendations
        const similar = (j.movie as any).similar?.results || [];
        const recommendations = (j.movie as any).recommendations?.results || [];
        
        [...similar, ...recommendations]
          .slice(0, limitPerSeed)
          .forEach((m: any) => {
            if (m.id) allIds.add(m.id);
          });
      }
    } catch (e) {
      console.error(`[TMDB] Failed to fetch similar for ${seedId}`, e);
    }
  }
  
  return Array.from(allIds);
}

/**
 * Discover movies using TMDB's discover API with specific filters
 * This generates highly personalized candidates based on user's taste profile
 */
export async function discoverMoviesByProfile(options: {
  genres?: number[];
  keywords?: number[];
  people?: number[]; // director/actor IDs
  yearMin?: number;
  yearMax?: number;
  sortBy?: 'vote_average.desc' | 'popularity.desc' | 'primary_release_date.desc';
  minVotes?: number;
  limit?: number;
  randomizePage?: boolean; // Add random page offset for variety
}): Promise<number[]> {
  const allIds = new Set<number>();
  
  // Validate IDs are reasonable
  const validGenres = options.genres?.filter(id => id > 0 && id < 100000) ?? [];
  const validKeywords = options.keywords?.filter(id => id > 0 && id < 1000000) ?? [];
  const validPeople = options.people?.filter(id => id > 0 && id < 10000000) ?? [];
  
  // Log what we're actually sending
  const filterSummary = {
    genres: validGenres,
    keywords: validKeywords.slice(0, 5),
    people: validPeople.slice(0, 3),
    yearMin: options.yearMin,
    yearMax: options.yearMax,
    sortBy: options.sortBy,
    minVotes: options.minVotes,
    limit: options.limit ?? 20
  };
  
  try {
    const u = new URL('/api/tmdb/discover', typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
    
    if (validGenres.length) u.searchParams.set('with_genres', validGenres.join(','));
    if (validKeywords.length) u.searchParams.set('with_keywords', validKeywords.slice(0, 5).join('|')); // OR logic
    if (validPeople.length) u.searchParams.set('with_people', validPeople.slice(0, 3).join(','));
    if (options.yearMin) u.searchParams.set('primary_release_date.gte', `${options.yearMin}-01-01`);
    if (options.yearMax) u.searchParams.set('primary_release_date.lte', `${options.yearMax}-12-31`);
    if (options.sortBy) u.searchParams.set('sort_by', options.sortBy);
    if (options.minVotes) u.searchParams.set('vote_count.gte', String(options.minVotes));
    
    // Randomize starting page for variety (pages 1-5)
    if (options.randomizePage !== false) {
      const randomPage = Math.floor(Math.random() * 5) + 1;
      u.searchParams.set('page', String(randomPage));
    }
    
    const limit = options.limit ?? 20;
    u.searchParams.set('limit', String(limit));
    u.searchParams.set('_t', String(Date.now())); // Cache buster
    
    console.log('[TMDB] discover start', filterSummary);
    const r = await fetch(u.toString(), { cache: 'no-store' });
    const j = await r.json();
    
    if (j.ok && j.results) {
      j.results.forEach((m: any) => {
        if (m.id) allIds.add(m.id);
      });
      console.log('[TMDB] discover ok', { count: allIds.size, filters: filterSummary });
    } else {
      console.warn('[TMDB] discover returned 0 results', { filters: filterSummary, response: j });
    }
  } catch (e) {
    console.error('[TMDB] discover exception', { filters: filterSummary, error: e });
  }
  
  return Array.from(allIds);
}

/**
 * Generate diverse candidates using multiple TMDB discovery strategies
 * This combines trending, similar, and discover APIs for comprehensive coverage
 */
export async function generateSmartCandidates(profile: {
  highlyRatedIds: number[];
  topGenres: Array<{ id: number; weight: number }>;
  topKeywords: Array<{ id: number; name: string; weight: number }>;
  topDirectors: Array<{ id: number; name: string; weight: number }>;
  excludeYearRange?: { min?: number; max?: number };
}): Promise<{ trending: number[]; similar: number[]; discovered: number[] }> {
  console.log('[SmartCandidates] Generating with profile', {
    highlyRatedCount: profile.highlyRatedIds.length,
    topGenresCount: profile.topGenres.length,
    topKeywordsCount: profile.topKeywords.length,
    topDirectorsCount: profile.topDirectors.length
  });

  const results = {
    trending: [] as number[],
    similar: [] as number[],
    discovered: [] as number[]
  };

  // 1. Trending movies (randomize between day/week for variety)
  try {
    const period = Math.random() > 0.5 ? 'day' : 'week';
    results.trending = await fetchTrendingIds(period, 100);
  } catch (e) {
    console.error('[SmartCandidates] Trending failed', e);
  }

  // 2. Similar to highly-rated films (randomize seed selection)
  try {
    if (profile.highlyRatedIds.length > 0) {
      // Shuffle and take random subset for variety on each refresh
      const shuffled = [...profile.highlyRatedIds].sort(() => Math.random() - 0.5);
      results.similar = await fetchSimilarMovieIds(shuffled.slice(0, 20), 30);
    }
  } catch (e) {
    console.error('[SmartCandidates] Similar failed', e);
  }

  // 3. Discover by top genres + keywords (with progressive fallbacks)
  try {
    if (profile.topGenres.length > 0) {
      // Shuffle genre/keyword selection
      const shuffledGenres = [...profile.topGenres].sort(() => Math.random() - 0.5);
      const shuffledKeywords = [...profile.topKeywords].sort(() => Math.random() - 0.5);
      
      // Try 1: Genres + keywords, no year restriction, high quality
      let genreDiscovered = await discoverMoviesByProfile({
        genres: shuffledGenres.slice(0, 2).map(g => g.id),
        keywords: shuffledKeywords.slice(0, 3).map(k => k.id),
        sortBy: 'vote_average.desc',
        minVotes: 100,
        limit: 150
      });
      results.discovered.push(...genreDiscovered);
      console.log('[SmartCandidates] Genre+keyword discovery', { count: genreDiscovered.length });
      
      // Fallback 1: Just genres, no keywords
      if (genreDiscovered.length < 30) {
        const genreOnlyDiscovered = await discoverMoviesByProfile({
          genres: shuffledGenres.slice(0, 2).map(g => g.id),
          sortBy: 'vote_average.desc',
          minVotes: 50,
          limit: 150
        });
        results.discovered.push(...genreOnlyDiscovered);
        console.log('[SmartCandidates] Genre-only fallback', { count: genreOnlyDiscovered.length });
      }
      
      // Fallback 2: Popular in genres (lower vote threshold)
      if (results.discovered.length < 100) {
        const popularDiscovered = await discoverMoviesByProfile({
          genres: shuffledGenres.slice(0, 2).map(g => g.id),
          sortBy: 'popularity.desc',
          minVotes: 20,
          limit: 150
        });
        results.discovered.push(...popularDiscovered);
        console.log('[SmartCandidates] Popular fallback', { count: popularDiscovered.length });
      }
    }
  } catch (e) {
    console.error('[SmartCandidates] Genre+keyword discovery failed', e);
  }

  // 4. Discover by favorite directors (no year restrictions)
  try {
    if (profile.topDirectors.length > 0) {
      // Shuffle director selection for variety
      const shuffledDirectors = [...profile.topDirectors].sort(() => Math.random() - 0.5);
      
      // Try with top directors, no year filter
      const directorDiscovered = await discoverMoviesByProfile({
        people: shuffledDirectors.slice(0, 2).map(d => d.id),
        sortBy: 'vote_average.desc',
        limit: 100
      });
      results.discovered.push(...directorDiscovered);
      console.log('[SmartCandidates] Director discovery', { 
        count: directorDiscovered.length, 
        directors: shuffledDirectors.slice(0, 2).map(d => ({ id: d.id, name: d.name })) 
      });
      
      // Fallback: Try with single director if multiple directors returned nothing
      if (directorDiscovered.length === 0 && shuffledDirectors.length > 0) {
        const singleDirector = await discoverMoviesByProfile({
          people: [shuffledDirectors[0].id],
          sortBy: 'popularity.desc',
          limit: 50
        });
        results.discovered.push(...singleDirector);
        console.log('[SmartCandidates] Single director fallback', { count: singleDirector.length });
      }
    }
  } catch (e) {
    console.error('[SmartCandidates] Director discovery failed', e);
  }

  // 5. Discover niche subgenre picks by keywords (no year restrictions)
  try {
    if (profile.topKeywords.length > 2 && results.discovered.length < 200) {
      // Take random keywords for variety
      const shuffledKeywords = [...profile.topKeywords].sort(() => Math.random() - 0.5);
      const nicheDiscovered = await discoverMoviesByProfile({
        keywords: shuffledKeywords.slice(0, 2).map(k => k.id),
        sortBy: 'popularity.desc',
        minVotes: 30,
        limit: 100
      });
      results.discovered.push(...nicheDiscovered);
      console.log('[SmartCandidates] Niche keyword discovery', { 
        count: nicheDiscovered.length,
        keywords: shuffledKeywords.slice(0, 2).map(k => ({ id: k.id, name: k.name }))
      });
    }
  } catch (e) {
    console.error('[SmartCandidates] Niche discovery failed', e);
  }

  // 6. Add pure genre-based discovery (no restrictions) for more variety
  try {
    if (profile.topGenres.length > 0 && results.discovered.length < 200) {
      const shuffledGenres = [...profile.topGenres].sort(() => Math.random() - 0.5);
      const pureGenreDiscovered = await discoverMoviesByProfile({
        genres: shuffledGenres.slice(0, 2).map(g => g.id),
        sortBy: Math.random() > 0.5 ? 'vote_average.desc' : 'popularity.desc',
        minVotes: 100,
        limit: 100
      });
      results.discovered.push(...pureGenreDiscovered);
    }
  } catch (e) {
    console.error('[SmartCandidates] Pure genre discovery failed', e);
  }

  // 7. Add diverse picks with single genre (no year restriction)
  try {
    if (profile.topGenres.length > 0 && results.discovered.length < 300) {
      // Try with just the top genre to cast wider net
      const topGenre = profile.topGenres[0];
      const singleGenreDiscovered = await discoverMoviesByProfile({
        genres: [topGenre.id],
        sortBy: 'popularity.desc',
        minVotes: 100,
        limit: 100
      });
      results.discovered.push(...singleGenreDiscovered);
      console.log('[SmartCandidates] Single genre discovery', { 
        count: singleGenreDiscovered.length,
        genreId: topGenre.id
      });
    }
  } catch (e) {
    console.error('[SmartCandidates] Single genre discovery failed', e);
  }

  console.log('[SmartCandidates] Generated', {
    trending: results.trending.length,
    similar: results.similar.length,
    discovered: results.discovered.length,
    total: results.trending.length + results.similar.length + results.discovered.length
  });

  return results;
}
