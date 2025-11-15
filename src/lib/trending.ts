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
