export async function fetchTrendingIds(period: 'day' | 'week' = 'day', limit = 100): Promise<number[]> {
  const u = new URL('/api/tmdb/trending', typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  u.searchParams.set('period', period);
  u.searchParams.set('limit', String(limit));
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
    
    const limit = options.limit ?? 20;
    u.searchParams.set('limit', String(limit));
    
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

  // 1. Trending movies (small set for discovery)
  try {
    results.trending = await fetchTrendingIds('week', 100);
  } catch (e) {
    console.error('[SmartCandidates] Trending failed', e);
  }

  // 2. Similar to highly-rated films
  try {
    if (profile.highlyRatedIds.length > 0) {
      results.similar = await fetchSimilarMovieIds(profile.highlyRatedIds.slice(0, 20), 30);
    }
  } catch (e) {
    console.error('[SmartCandidates] Similar failed', e);
  }

  // 3. Discover by top genres + keywords (hidden gems)
  try {
    if (profile.topGenres.length > 0 && profile.topKeywords.length > 0) {
      const genreDiscovered = await discoverMoviesByProfile({
        genres: profile.topGenres.slice(0, 3).map(g => g.id),
        keywords: profile.topKeywords.slice(0, 5).map(k => k.id),
        sortBy: 'vote_average.desc',
        minVotes: 100,
        yearMin: 1980,
        yearMax: 2015, // Hidden gems cutoff
        limit: 100
      });
      results.discovered.push(...genreDiscovered);
    }
  } catch (e) {
    console.error('[SmartCandidates] Genre+keyword discovery failed', e);
  }

  // 4. Discover by favorite directors (recent works)
  try {
    if (profile.topDirectors.length > 0) {
      const directorDiscovered = await discoverMoviesByProfile({
        people: profile.topDirectors.slice(0, 3).map(d => d.id),
        sortBy: 'primary_release_date.desc',
        yearMin: 2010,
        limit: 50
      });
      results.discovered.push(...directorDiscovered);
    }
  } catch (e) {
    console.error('[SmartCandidates] Director discovery failed', e);
  }

  // 5. Discover niche subgenre picks
  try {
    if (profile.topKeywords.length > 2) {
      const nicheDiscovered = await discoverMoviesByProfile({
        keywords: profile.topKeywords.slice(0, 3).map(k => k.id),
        sortBy: 'vote_average.desc',
        minVotes: 50, // Lower threshold for niche films
        limit: 50
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
