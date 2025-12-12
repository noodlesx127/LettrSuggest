import { NextResponse } from 'next/server';
import { getOMDbByIMDB, mergeTMDBAndOMDb } from '@/lib/omdb';

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

    // 1. Fetch from TMDB (using api_key for v3 auth)
    const tmdbUrl = `https://api.themoviedb.org/3/movie/${encodeURIComponent(id)}?api_key=${apiKey}&append_to_response=${appendToResponse}`;
    const r = await fetch(tmdbUrl, {
      headers: {
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
