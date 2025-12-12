import { NextResponse } from 'next/server';
import { getOMDbByIMDB, mergeTMDBAndOMDb } from '@/lib/omdb';

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

      // Retry on transient statuses (rate limit / upstream issues)
      const retryable = r.status === 429 || r.status === 500 || r.status === 502 || r.status === 503 || r.status === 504;
      if (!retryable || attempt === opts.maxAttempts) {
        return r;
      }

      // Honor Retry-After if present (seconds)
      const ra = r.headers.get('retry-after');
      const retryAfterMs = ra && !Number.isNaN(Number(ra)) ? Math.max(0, Number(ra) * 1000) : 0;
      const backoffMs = Math.min(2000, 200 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 150);
      await sleep(Math.max(retryAfterMs, backoffMs));
    } catch (e) {
      lastError = e;
      // Abort/timeouts/network can be transient
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
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'TMDB_API_KEY not configured' }, { status: 500 });

    // Allow additional append_to_response params from client, merge with defaults
    const clientAppend = url.searchParams.get('append_to_response') || '';
    const defaultAppend = 'credits,keywords,videos,similar,recommendations';
    const appendParts = new Set([...defaultAppend.split(','), ...clientAppend.split(',')].filter(Boolean));
    const appendToResponse = Array.from(appendParts).join(',');

    // 1. Fetch from TMDB. Support both v3 API key (query param) and v4 Bearer token (JWT).
    let tmdbUrl: string;
    const headers: Record<string, string> = { Accept: 'application/json' };

    const looksLikeJwt = typeof apiKey === 'string' && apiKey.includes('.') && apiKey.trim().startsWith('eyJ');
    if (looksLikeJwt) {
      tmdbUrl = `https://api.themoviedb.org/3/movie/${encodeURIComponent(id)}?append_to_response=${appendToResponse}`;
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else {
      tmdbUrl = `https://api.themoviedb.org/3/movie/${encodeURIComponent(id)}?api_key=${apiKey}&append_to_response=${appendToResponse}`;
    }

    const r = await fetchWithRetry(
      tmdbUrl,
      {
        headers,
        cache: 'no-store',
      },
      { timeoutMs: 9000, maxAttempts: 3 }
    );

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      // Keep response status aligned with upstream when possible.
      // (The client treats any non-ok as failure, but this helps debugging.)
      const status = r.status && r.status >= 400 && r.status < 600 ? r.status : 502;
      return NextResponse.json({ error: 'TMDB request failed', status: r.status, body: text }, { status });
    }

    const tmdbData = await r.json();
    let finalMovie = tmdbData;

    // 2. OMDb enrichment - DISABLED (API key issues)
    // To re-enable, uncomment the block below and ensure OMDB_API_KEY is valid
    /*
    if (tmdbData.imdb_id) {
      try {
        console.log(`[API] Attempting OMDb enrichment for ${tmdbData.imdb_id}`);
        const omdbData = await getOMDbByIMDB(tmdbData.imdb_id, { plot: 'full' });
        if (omdbData) {
          console.log(`[API] OMDb data fetched successfully for ${tmdbData.imdb_id}`);
          finalMovie = mergeTMDBAndOMDb(tmdbData, omdbData);
        } else {
          console.log(`[API] OMDb returned no data for ${tmdbData.imdb_id}`);
        }
      } catch (error) {
        console.error(`[API] Failed to fetch OMDb data for ${tmdbData.imdb_id}:`, error);
      }
    }
    */

    return NextResponse.json({ ok: true, movie: finalMovie });
  } catch (e: any) {
    console.error('[API] Unexpected error:', e);
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}
