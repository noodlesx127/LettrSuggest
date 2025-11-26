/**
 * OMDb API Route: Fetch by IMDB ID
 * 
 * GET /api/omdb/imdb?id=tt0111161&plot=full
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOMDbByIMDB } from '@/lib/omdb';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const imdbId = searchParams.get('id');
    const plot = searchParams.get('plot') as 'short' | 'full' | null;

    if (!imdbId) {
        return NextResponse.json(
            { error: 'Missing required parameter: id (IMDB ID)' },
            { status: 400 }
        );
    }

    const result = await getOMDbByIMDB(imdbId, {
        plot: plot || 'short'
    });

    if (!result) {
        return NextResponse.json(
            { error: 'IMDB ID not found or API error' },
            { status: 404 }
        );
    }

    return NextResponse.json(result);
}
