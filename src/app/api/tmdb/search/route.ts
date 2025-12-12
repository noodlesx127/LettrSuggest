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

    const tmdbUrl = new URL('https://api.themoviedb.org/3/search/movie');
    tmdbUrl.searchParams.set('api_key', apiKey);
    tmdbUrl.searchParams.set('query', query);
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
    return NextResponse.json({ ok: true, results: data?.results ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}
