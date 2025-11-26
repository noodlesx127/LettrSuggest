/**
 * OMDb API Route: Search by Title
 * 
 * GET /api/omdb/search?title=Inception&year=2010&plot=full
 */

import { NextRequest, NextResponse } from 'next/server';
import { searchOMDb } from '@/lib/omdb';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const title = searchParams.get('title');
    const year = searchParams.get('year');
    const plot = searchParams.get('plot') as 'short' | 'full' | null;

    if (!title) {
        return NextResponse.json(
            { error: 'Missing required parameter: title' },
            { status: 400 }
        );
    }

    const result = await searchOMDb(title, {
        year: year ? parseInt(year) : undefined,
        plot: plot || 'short'
    });

    if (!result) {
        return NextResponse.json(
            { error: 'Movie not found or API error' },
            { status: 404 }
        );
    }

    return NextResponse.json(result);
}
