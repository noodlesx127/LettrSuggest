import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const period = url.searchParams.get('period') === 'week' ? 'week' : 'day';
    const limitParam = url.searchParams.get('limit');
    const limit = Math.min(200, Math.max(5, Number(limitParam) || 100));

    console.log('[TrendingAPI] Start', { period, limit });

    if (!supabase) {
      console.error('[TrendingAPI] Supabase not initialized');
      return NextResponse.json({ error: 'Supabase not initialized' }, { status: 500 });
    }
    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) {
      console.error('[TrendingAPI] TMDB_API_KEY not configured');
      return NextResponse.json({ error: 'TMDB_API_KEY not configured' }, { status: 500 });
    }

    // Check existing cache freshness (take newest updated_at)
    const { data: existing, error: exErr } = await supabase
      .from('tmdb_trending')
      .select('tmdb_id, rank, updated_at')
      .eq('period', period)
      .order('rank', { ascending: true })
      .limit(limit);
    if (exErr) {
      console.error('[TrendingAPI] Error fetching cache', exErr);
      throw exErr;
    }
    console.log('[TrendingAPI] Cache check', { existingCount: existing?.length || 0 });
    const freshEnough = existing && existing.length > 5 && existing[0].updated_at && (Date.now() - new Date(existing[0].updated_at).getTime()) < ONE_DAY_MS;
    if (freshEnough) {
      console.log('[TrendingAPI] Using cache');
      return NextResponse.json({ ok: true, ids: existing.map(r => r.tmdb_id), source: 'cache' });
    }

    // Fetch from TMDB trending endpoint
    console.log('[TrendingAPI] Fetching from TMDB');
    const tmdbUrl = `https://api.themoviedb.org/3/trending/movie/${period}`;
    const r = await fetch(tmdbUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json'
      },
      cache: 'no-store'
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      console.error('[TrendingAPI] TMDB request failed', { status: r.status, body: txt });
      return NextResponse.json({ error: 'TMDB trending request failed', status: r.status, body: txt }, { status: 502 });
    }
    const j = await r.json();
    const results = Array.isArray(j?.results) ? j.results.slice(0, limit) : [];
    console.log('[TrendingAPI] Got results from TMDB', { count: results.length });
    const rows: Array<{ period: string; tmdb_id: number; rank: number }> = results.map((m: any, idx: number) => ({ period, tmdb_id: m.id, rank: idx + 1 }));
    if (rows.length) {
      // Upsert cache (ignore duplicates, update rank)
      const { error: upErr } = await supabase
        .from('tmdb_trending')
        .upsert(rows, { onConflict: 'period,tmdb_id' });
      if (upErr) {
        console.error('[TrendingAPI] Error upserting cache', upErr);
        throw upErr;
      }
      console.log('[TrendingAPI] Cached results');
    }
    console.log('[TrendingAPI] Success', { idCount: rows.length });
    return NextResponse.json({ ok: true, ids: rows.map((r) => r.tmdb_id), source: 'refreshed' });
  } catch (e: any) {
    console.error('[TrendingAPI] Error', e);
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}
