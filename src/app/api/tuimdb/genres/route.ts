import { NextResponse } from 'next/server';
import { getTuiMDBGenres } from '@/lib/tuimdb';

export async function GET(req: Request) {
  try {
    const apiKey = process.env.TUIMDB_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'TUIMDB_API_KEY not configured' }, { status: 500 });
    }

    const genres = await getTuiMDBGenres(apiKey);
    
    return NextResponse.json({ ok: true, genres });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}
