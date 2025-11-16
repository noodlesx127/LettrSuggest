import { NextResponse } from 'next/server';
import { getTuiMDBMovie, tuiMDBToTMDB } from '@/lib/tuimdb';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const uid = url.searchParams.get('uid');
    
    if (!uid) {
      return NextResponse.json({ error: 'Missing uid parameter' }, { status: 400 });
    }

    const apiKey = process.env.TUIMDB_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'TUIMDB_API_KEY not configured' }, { status: 500 });
    }

    const movie = await getTuiMDBMovie(parseInt(uid), apiKey);
    
    if (!movie) {
      return NextResponse.json({ error: 'Movie not found' }, { status: 404 });
    }
    
    // Convert to TMDB-compatible format for consistency
    const tmdbFormat = tuiMDBToTMDB(movie);
    
    return NextResponse.json({ ok: true, movie: tmdbFormat });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}
