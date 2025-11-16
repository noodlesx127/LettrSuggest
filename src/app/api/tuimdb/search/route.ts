import { NextResponse } from 'next/server';
import { searchTuiMDB, tuiMDBSearchToTMDB } from '@/lib/tuimdb';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const query = url.searchParams.get('query') || url.searchParams.get('q');
    const year = url.searchParams.get('year');

    if (!query) {
      return NextResponse.json({ error: 'Missing query' }, { status: 400 });
    }

    const apiKey = process.env.TUIMDB_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'TUIMDB_API_KEY not configured' }, { status: 500 });
    }

    const results = await searchTuiMDB(query, year ? parseInt(year) : undefined, apiKey);
    
    // Return raw TuiMDB results to preserve UID
    return NextResponse.json({ ok: true, results });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}
