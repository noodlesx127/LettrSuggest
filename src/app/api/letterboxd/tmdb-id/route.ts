import { NextResponse } from 'next/server';

/**
 * Scrape a Letterboxd film page to extract the TMDB ID
 * 
 * Letterboxd pages contain links like:
 *   [TMDB](https://www.themoviedb.org/movie/53094/)
 *   [TMDB](https://www.themoviedb.org/tv/86449/)
 */
export async function GET(req: Request) {
    try {
        const url = new URL(req.url);
        const uri = url.searchParams.get('uri');

        if (!uri) {
            return NextResponse.json({ error: 'Missing uri parameter' }, { status: 400 });
        }

        // Normalize the URI to a full Letterboxd URL
        let letterboxdUrl: string;
        if (uri.startsWith('http')) {
            letterboxdUrl = uri;
        } else if (uri.startsWith('/')) {
            letterboxdUrl = `https://letterboxd.com${uri}`;
        } else {
            letterboxdUrl = `https://letterboxd.com/${uri}`;
        }

        // Ensure it ends with a slash (Letterboxd redirects without it)
        if (!letterboxdUrl.endsWith('/')) {
            letterboxdUrl += '/';
        }

        console.log('[Letterboxd] Fetching TMDB ID from:', letterboxdUrl);

        // Fetch the Letterboxd page
        const response = await fetch(letterboxdUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; LettrSuggest/1.0)',
                'Accept': 'text/html',
            },
            redirect: 'follow',
        });

        if (!response.ok) {
            console.error('[Letterboxd] Failed to fetch page:', response.status);
            return NextResponse.json({
                ok: false,
                error: `Failed to fetch Letterboxd page: ${response.status}`
            }, { status: response.status >= 400 && response.status < 500 ? response.status : 502 });
        }

        const html = await response.text();

        // Look for TMDB link in the HTML
        // Pattern: href="https://www.themoviedb.org/(movie|tv)/(\d+)
        const tmdbPattern = /href="https:\/\/www\.themoviedb\.org\/(movie|tv)\/(\d+)/i;
        const match = html.match(tmdbPattern);

        if (!match) {
            console.log('[Letterboxd] No TMDB link found in page');
            return NextResponse.json({ ok: false, error: 'No TMDB link found on page' });
        }

        const mediaType = match[1].toLowerCase() as 'movie' | 'tv';
        const tmdbId = parseInt(match[2], 10);

        console.log('[Letterboxd] Found TMDB ID:', { mediaType, tmdbId });

        return NextResponse.json({
            ok: true,
            tmdbId,
            mediaType,
            source: 'letterboxd'
        });

    } catch (e: any) {
        console.error('[Letterboxd] Error:', e);
        return NextResponse.json({
            ok: false,
            error: e?.message ?? 'Unexpected error'
        }, { status: 500 });
    }
}
