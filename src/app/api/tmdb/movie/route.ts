import { NextResponse } from 'next/server';
import { getOMDbByIMDB, mergeTMDBAndOMDb } from '@/lib/omdb';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'TMDB_API_KEY not configured' }, { status: 500 });

    // 1. Fetch from TMDB
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

    const tmdbData = await r.json();
    let finalMovie = tmdbData;

    // 2. Fetch from OMDb if IMDB ID is present
    if (tmdbData.imdb_id) {
      try {
        // Fetch OMDb data (server-side, so process.env.OMDB_API_KEY works)
        const omdbData = await getOMDbByIMDB(tmdbData.imdb_id, { plot: 'full' });

        // 3. Merge data
        if (omdbData) {
          finalMovie = mergeTMDBAndOMDb(tmdbData, omdbData);
        }
      } catch (error) {
        console.error(`[API] Failed to fetch OMDb data for ${tmdbData.imdb_id}:`, error);
        // Continue with just TMDB data
      }
    }

    return NextResponse.json({ ok: true, movie: finalMovie });
  } catch (e: any) {
    console.error('[API] Unexpected error:', e);
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}
