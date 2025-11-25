import { NextRequest, NextResponse } from 'next/server';

const TRAKT_API_BASE = 'https://api.trakt.tv';
const TRAKT_API_VERSION = '2';

/**
 * Trakt API Route: Get Related Movies
 * 
 * Fetches related movies from Trakt API based on a TMDB movie ID.
 * This endpoint proxies requests to Trakt to keep the Client ID server-side.
 * 
 * Query Parameters:
 * - id: TMDB movie ID (required)
 * - limit: Number of related movies to return (optional, default: 10)
 * 
 * Returns:
 * - ok: boolean
 * - ids: number[] (array of TMDB IDs)
 * - error: string (if error occurred)
 */
export async function GET(req: NextRequest) {
    const tmdbId = req.nextUrl.searchParams.get('id');
    const limit = req.nextUrl.searchParams.get('limit') || '10';

    // Validate required parameters
    if (!tmdbId) {
        return NextResponse.json(
            { ok: false, error: 'Missing required parameter: id' },
            { status: 400 }
        );
    }

    // Validate TMDB ID is a number
    const tmdbIdNum = parseInt(tmdbId, 10);
    if (isNaN(tmdbIdNum) || tmdbIdNum <= 0) {
        return NextResponse.json(
            { ok: false, error: 'Invalid TMDB ID: must be a positive number' },
            { status: 400 }
        );
    }

    // Check for API key
    const clientId = process.env.TRAKT_CLIENT_ID;
    if (!clientId) {
        console.error('[Trakt] TRAKT_CLIENT_ID not configured');
        return NextResponse.json(
            { ok: false, error: 'Trakt API not configured' },
            { status: 500 }
        );
    }

    try {
        console.log(`[Trakt] Fetching related movies for TMDB ID: ${tmdbId}`);

        const response = await fetch(
            `${TRAKT_API_BASE}/movies/${tmdbId}/related?limit=${limit}`,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'trakt-api-version': TRAKT_API_VERSION,
                    'trakt-api-key': clientId,
                },
                next: { revalidate: 3600 }, // Cache for 1 hour
            }
        );

        if (!response.ok) {
            console.error(`[Trakt] API error: ${response.status} ${response.statusText}`);
            return NextResponse.json(
                { ok: false, error: `Trakt API error: ${response.status}` },
                { status: response.status }
            );
        }

        const data = await response.json();

        // Extract TMDB IDs from Trakt response
        // Trakt returns: [{ ids: { tmdb: 123, trakt: 456, ... }, title: "...", ... }, ...]
        const tmdbIds = data
            .map((movie: any) => movie.ids?.tmdb)
            .filter((id: number | undefined) => id != null && id > 0);

        console.log(`[Trakt] Found ${tmdbIds.length} related movies for TMDB ID: ${tmdbId}`);

        return NextResponse.json({
            ok: true,
            ids: tmdbIds,
            count: tmdbIds.length,
        });

    } catch (error) {
        console.error('[Trakt] Exception fetching related movies:', error);
        return NextResponse.json(
            { ok: false, error: 'Failed to fetch related movies from Trakt' },
            { status: 500 }
        );
    }
}
