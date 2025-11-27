import { NextResponse } from 'next/server';
import { getStreamingSources } from '@/lib/watchmode';

export async function GET(req: Request) {
    try {
        const url = new URL(req.url);
        const id = url.searchParams.get('id');
        const region = url.searchParams.get('region') || 'US';

        if (!id) {
            return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
        }

        const sources = await getStreamingSources(parseInt(id), { region });

        return NextResponse.json({ ok: true, sources });
    } catch (e: any) {
        console.error('[API] Watchmode sources error:', e);
        return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
    }
}
