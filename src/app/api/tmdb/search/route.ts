import { NextResponse } from 'next/server';

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, init: RequestInit, opts: { timeoutMs: number; maxAttempts: number }) {
  let lastStatus: number | undefined;
  let lastBody = '';
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);

    try {
      const r = await fetch(url, { ...init, signal: controller.signal });
      lastStatus = r.status;
      if (r.ok) return r;

      lastBody = await r.text().catch(() => '');

      const retryable = r.status === 429 || r.status === 500 || r.status === 502 || r.status === 503 || r.status === 504;
      if (!retryable || attempt === opts.maxAttempts) {
        return r;
      }

      const ra = r.headers.get('retry-after');
      const retryAfterMs = ra && !Number.isNaN(Number(ra)) ? Math.max(0, Number(ra) * 1000) : 0;
      const backoffMs = Math.min(2000, 200 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 150);
      await sleep(Math.max(retryAfterMs, backoffMs));
    } catch (e) {
      lastError = e;
      if (attempt === opts.maxAttempts) break;
      const backoffMs = Math.min(2000, 200 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 150);
      await sleep(backoffMs);
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    ok: false,
    status: lastStatus ?? 502,
    text: async () => lastBody,
    json: async () => ({ error: 'TMDB request failed', status: lastStatus ?? 502, body: lastBody, exception: String((lastError as any)?.message ?? lastError ?? '') }),
    headers: new Headers(),
  } as unknown as Response;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const query = url.searchParams.get('query') || url.searchParams.get('q');
    const year = url.searchParams.get('year');

    if (!query) {
      return NextResponse.json({ error: 'Missing query' }, { status: 400 });
    }

    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'TMDB_API_KEY not configured' }, { status: 500 });
    }

    // Use multi-search to get both movies AND TV shows
    // This fixes the issue where TV shows like "Archangel (2005)" or "The American Revolution (2025)" 
    // were not being found because /search/movie only returns movies
    const tmdbUrl = new URL('https://api.themoviedb.org/3/search/multi');
    tmdbUrl.searchParams.set('api_key', apiKey);
    tmdbUrl.searchParams.set('query', query);
    // Note: /search/multi uses "year" for movies but doesn't filter TV by year in the same way
    // We'll filter by year client-side after getting results
    if (year) tmdbUrl.searchParams.set('year', year);

    const r = await fetchWithRetry(tmdbUrl.toString(), {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    }, { timeoutMs: 9000, maxAttempts: 3 });

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      const status = r.status && r.status >= 400 && r.status < 600 ? r.status : 502;
      return NextResponse.json({ error: 'TMDB request failed', status: r.status, body: text }, { status });
    }

    const data = await r.json();

    // Filter to only movies and TV shows (exclude person results)
    // Normalize TV show fields to match movie format for consistent handling
    const results = (data?.results ?? [])
      .filter((item: any) => item.media_type === 'movie' || item.media_type === 'tv')
      .map((item: any) => {
        if (item.media_type === 'tv') {
          // Normalize TV fields to match movie format
          return {
            ...item,
            // TV uses 'name' instead of 'title'
            title: item.title || item.name,
            // TV uses 'first_air_date' instead of 'release_date'
            release_date: item.release_date || item.first_air_date,
            // Keep both for debugging/display purposes
            original_name: item.original_name,
            first_air_date: item.first_air_date,
          };
        }
        return item;
      });

    // If a year was specified, also filter TV shows by first_air_date year
    // (since /search/multi only filters movies by year)
    const yearNum = year ? parseInt(year, 10) : null;
    const filteredResults = yearNum
      ? results.filter((item: any) => {
        const itemYear = item.release_date ? new Date(item.release_date).getFullYear() : null;
        // If we have a year, allow matches within 1 year tolerance (for edge cases)
        return !itemYear || Math.abs(itemYear - yearNum) <= 1;
      })
      : results;

    return NextResponse.json({ ok: true, results: filteredResults });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}
