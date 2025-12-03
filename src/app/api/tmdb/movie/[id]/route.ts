import { NextResponse } from 'next/server';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const movieId = params.id;
    
    if (!movieId) {
      return NextResponse.json({ error: 'Missing movie ID' }, { status: 400 });
    }

    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'TMDB_API_KEY not configured' }, { status: 500 });
    }

    // Fetch movie details with credits, genres, keywords, recommendations, collections, lists, videos, and images
    // Use api_key query parameter for v3 authentication
    const tmdbUrl = `https://api.themoviedb.org/3/movie/${movieId}?api_key=${apiKey}&append_to_response=credits,keywords,similar,recommendations,videos,images,lists`;
    
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

    const data = await r.json();
    return NextResponse.json({ ok: true, movie: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}
