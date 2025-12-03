import { NextResponse } from 'next/server';

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

    const r = await fetch(tmdbUrl.toString(), {
      headers: {
        Accept: 'application/json',
      },
      // Reasonable timeout with AbortController if desired in future
      cache: 'no-store',
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return NextResponse.json({ error: 'TMDB request failed', status: r.status, body: text }, { status: 502 });
    }
    const data = await r.json();
    return NextResponse.json({ ok: true, results: data?.results ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}
