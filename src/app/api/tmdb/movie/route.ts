import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'TMDB_API_KEY not configured' }, { status: 500 });

    const tmdbUrl = `https://api.themoviedb.org/3/movie/${encodeURIComponent(id)}?append_to_response=credits,keywords,videos`;
    const r = await fetch(tmdbUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return NextResponse.json({ error: 'TMDB request failed', status: r.status, body: text }, { status: 502 });
    }
    const data = await r.json();
    return NextResponse.json({ ok: true, movie: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}
