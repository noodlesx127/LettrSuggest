import { NextResponse } from 'next/server';
import { searchWatchmode } from '@/lib/watchmode';

export async function GET(req: Request) {
    try {
        const url = new URL(req.url);
        const query = url.searchParams.get('query');
        const searchField = url.searchParams.get('searchField') as 'name' | 'imdb_id' | 'tmdb_id' | null;
        const type = url.searchParams.get('type') as 'movie' | 'tv_series' | null;

        if (!query) {
            return NextResponse.json({ error: 'Missing query parameter' }, { status: 400 });
        }

        const results = await searchWatchmode(query, {
            searchField: searchField || 'name',
            type: type || undefined,
        });

        return NextResponse.json({ ok: true, results });
    } catch (e: any) {
        console.error('[API] Watchmode search error:', e);
        return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
    }
}
