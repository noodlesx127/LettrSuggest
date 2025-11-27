import { NextResponse } from 'next/server';
import { getSimilarContent } from '@/lib/tastedive';

export async function GET(req: Request) {
    try {
        const url = new URL(req.url);
        const query = url.searchParams.get('query');
        const type = url.searchParams.get('type') as 'movie' | 'show' | 'book' | 'music' | 'game' | null;
        const info = url.searchParams.get('info') === 'true';
        const limit = parseInt(url.searchParams.get('limit') || '20');

        if (!query) {
            return NextResponse.json({ error: 'Missing query parameter' }, { status: 400 });
        }

        const results = await getSimilarContent(query, {
            type: type || 'movie',
            info,
            limit,
        });

        return NextResponse.json({ ok: true, results });
    } catch (e: any) {
        console.error('[API] TasteDive similar error:', e);
        return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
    }
}
