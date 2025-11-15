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
  
  try {
    const u = new URL('/api/tmdb/discover', typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
    
    if (options.genres?.length) u.searchParams.set('with_genres', options.genres.join(','));
    if (options.keywords?.length) u.searchParams.set('with_keywords', options.keywords.slice(0, 5).join('|')); // OR logic
    if (options.people?.length) u.searchParams.set('with_people', options.people.slice(0, 3).join(','));
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
    
    console.log('[TMDB] discover start', options);
    const r = await fetch(u.toString(), { cache: 'no-store' });
    const j = await r.json();
    
    if (j.ok && j.results) {
      j.results.forEach((m: any) => {
        if (m.id) allIds.add(m.id);
      });
      console.log('[TMDB] discover ok', { count: allIds.size });
    }
  } catch (e) {
    console.error('[TMDB] discover exception', e);
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

  // 3. Discover by top genres + keywords (randomize year ranges for variety)
  try {
    if (profile.topGenres.length > 0 && profile.topKeywords.length > 0) {
      // Randomize decade focus on each refresh
      const yearRanges = [
        { min: 1970, max: 1990 },
        { min: 1980, max: 2000 },
        { min: 1990, max: 2010 },
        { min: 2000, max: 2015 },
        { min: 1970, max: 2015 } // Full range
      ];
      const randomRange = yearRanges[Math.floor(Math.random() * yearRanges.length)];
      
      // Shuffle genre/keyword selection
      const shuffledGenres = [...profile.topGenres].sort(() => Math.random() - 0.5);
      const shuffledKeywords = [...profile.topKeywords].sort(() => Math.random() - 0.5);
      
      const genreDiscovered = await discoverMoviesByProfile({
        genres: shuffledGenres.slice(0, 3).map(g => g.id),
        keywords: shuffledKeywords.slice(0, 5).map(k => k.id),
        sortBy: 'vote_average.desc',
        minVotes: 100,
        yearMin: randomRange.min,
        yearMax: randomRange.max,
        limit: 150 // Increased for more variety
      });
      results.discovered.push(...genreDiscovered);
    }
  } catch (e) {
    console.error('[SmartCandidates] Genre+keyword discovery failed', e);
  }

  // 4. Discover by favorite directors (randomize which directors)
  try {
    if (profile.topDirectors.length > 0) {
      // Shuffle director selection for variety
      const shuffledDirectors = [...profile.topDirectors].sort(() => Math.random() - 0.5);
      const directorDiscovered = await discoverMoviesByProfile({
        people: shuffledDirectors.slice(0, 3).map(d => d.id),
        sortBy: 'primary_release_date.desc',
        yearMin: 2010,
        limit: 75 // Increased
      });
      results.discovered.push(...directorDiscovered);
    }
  } catch (e) {
    console.error('[SmartCandidates] Director discovery failed', e);
  }

  // 5. Discover niche subgenre picks (randomize keywords)
  try {
    if (profile.topKeywords.length > 2) {
      // Take random keywords for variety
      const shuffledKeywords = [...profile.topKeywords].sort(() => Math.random() - 0.5);
      const nicheDiscovered = await discoverMoviesByProfile({
        keywords: shuffledKeywords.slice(0, 3).map(k => k.id),
        sortBy: Math.random() > 0.5 ? 'vote_average.desc' : 'popularity.desc', // Randomize sort
        minVotes: 50, // Lower threshold for niche films
        limit: 75 // Increased
      });
      results.discovered.push(...nicheDiscovered);
    }
  } catch (e) {
    console.error('[SmartCandidates] Niche discovery failed', e);
  }

  console.log('[SmartCandidates] Generated', {
    trending: results.trending.length,
    similar: results.similar.length,
    discovered: results.discovered.length,
    total: results.trending.length + results.similar.length + results.discovered.length
  });

  return results;
}
