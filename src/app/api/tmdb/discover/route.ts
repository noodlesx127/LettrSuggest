import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    
    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'TMDB_API_KEY not configured' }, { status: 500 });
    }

    // Build TMDB discover URL with filters (using api_key for v3 auth)
    const tmdbUrl = new URL('https://api.themoviedb.org/3/discover/movie');
    tmdbUrl.searchParams.set('api_key', apiKey);
    
    // Pass through all query parameters
    const allowedParams = [
      'with_genres',
      'with_keywords',
      'with_people',
      'primary_release_date.gte',
      'primary_release_date.lte',
      'sort_by',
      'vote_count.gte',
      'vote_average.gte',
      'with_runtime.gte',
      'with_runtime.lte',
      'with_original_language'
    ];
    
    allowedParams.forEach(param => {
      const value = searchParams.get(param);
      if (value) tmdbUrl.searchParams.set(param, value);
    });
    
    // Default sort and quality filters
    if (!searchParams.has('sort_by')) {
      tmdbUrl.searchParams.set('sort_by', 'vote_average.desc');
    }
    if (!searchParams.has('vote_count.gte')) {
      tmdbUrl.searchParams.set('vote_count.gte', '50');
    }
    
    const limit = parseInt(searchParams.get('limit') || '20');
    const startPage = parseInt(searchParams.get('page') || '1'); // Support custom start page
    const pages = Math.min(Math.ceil(limit / 20), 3); // Max 3 pages = 60 results
    
    const allResults: any[] = [];
    
    // Fetch multiple pages if needed, starting from startPage
    for (let page = startPage; page < startPage + pages; page++) {
      tmdbUrl.searchParams.set('page', String(page));
      
      const r = await fetch(tmdbUrl.toString(), {
        headers: {
          Accept: 'application/json',
        },
        cache: 'no-store',
      });

      if (!r.ok) {
        console.error('[TMDB Discover] Request failed', { status: r.status, page });
        break;
      }

      const data = await r.json();
      allResults.push(...(data.results || []));
      
      if (allResults.length >= limit) break;
      if (page >= data.total_pages) break;
    }
    
    return NextResponse.json({ 
      ok: true, 
      results: allResults.slice(0, limit)
    });
  } catch (e: any) {
    console.error('[TMDB Discover] Exception', e);
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}
