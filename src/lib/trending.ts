export async function fetchTrendingIds(period: 'day' | 'week' = 'day', limit = 100): Promise<number[]> {
  const u = new URL('/api/tmdb/trending', typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  u.searchParams.set('period', period);
  u.searchParams.set('limit', String(limit));
  const r = await fetch(u.toString(), { cache: 'no-store' });
  const j = await r.json();
  if (!r.ok || !j.ok) return [];
  return (j.ids as number[]) || [];
}
