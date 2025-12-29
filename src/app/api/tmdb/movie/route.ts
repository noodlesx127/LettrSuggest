import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    const mediaType = url.searchParams.get('mediaType') || 'movie';

    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'TMDB_API_KEY not configured' }, { status: 500 });

    // Allow additional append_to_response params from client, merge with defaults
    const clientAppend = url.searchParams.get('append_to_response') || '';
    const defaultAppend = 'credits,keywords,videos,similar,recommendations';
    const appendParts = new Set([...defaultAppend.split(','), ...clientAppend.split(',')].filter(Boolean));
    const appendToResponse = Array.from(appendParts).join(',');

    // Support both movies and TV shows
    const endpoint = mediaType === 'tv'
      ? `https://api.themoviedb.org/3/tv/${encodeURIComponent(id)}`
      : `https://api.themoviedb.org/3/movie/${encodeURIComponent(id)}`;

    const tmdbUrl = `${endpoint}?api_key=${apiKey}&append_to_response=${appendToResponse}`;
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

    let tmdbData = await r.json();

    // Normalize TV show fields to match movie format
    if (mediaType === 'tv') {
      tmdbData = {
        ...tmdbData,
        title: tmdbData.title || tmdbData.name,
        release_date: tmdbData.release_date || tmdbData.first_air_date,
        media_type: 'tv',
      };
    } else {
      tmdbData.media_type = 'movie';
    }

    return NextResponse.json({ ok: true, movie: tmdbData });
  } catch (e: any) {
    console.error('[API] Unexpected error:', e);
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}
