import { NextResponse } from 'next/server';
import { getStreamingSourcesByTMDB } from '@/lib/watchmode';

/**
 * API Route: Get streaming sources by TMDB ID
 * 
 * This route wraps the Watchmode API call so the API key stays server-side.
 * Client code should call this instead of importing from @/lib/watchmode directly.
 */
export async function GET(req: Request) {
    try {
        const url = new URL(req.url);
        const tmdbId = url.searchParams.get('tmdbId');
        const region = url.searchParams.get('region') || 'US';

        if (!tmdbId) {
            return NextResponse.json({ error: 'Missing tmdbId parameter' }, { status: 400 });
        }

        const sources = await getStreamingSourcesByTMDB(parseInt(tmdbId), { region });

        return NextResponse.json({ ok: true, sources });
    } catch (e: any) {
        console.error('[API] Watchmode streaming error:', e);
        return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
    }
}
