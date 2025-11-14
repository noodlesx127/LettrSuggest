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
