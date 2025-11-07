import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const period = url.searchParams.get('period') === 'week' ? 'week' : 'day';
    const limitParam = url.searchParams.get('limit');
    const limit = Math.min(200, Math.max(5, Number(limitParam) || 100));

    if (!supabase) return NextResponse.json({ error: 'Supabase not initialized' }, { status: 500 });
    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'TMDB_API_KEY not configured' }, { status: 500 });

    // Check existing cache freshness (take newest updated_at)
    const { data: existing, error: exErr } = await supabase
      .from('tmdb_trending')
      .select('tmdb_id, rank, updated_at')
      .eq('period', period)
      .order('rank', { ascending: true })
      .limit(limit);
    if (exErr) throw exErr;
    const freshEnough = existing && existing.length > 5 && existing[0].updated_at && (Date.now() - new Date(existing[0].updated_at).getTime()) < ONE_DAY_MS;
    if (freshEnough) {
      return NextResponse.json({ ok: true, ids: existing.map(r => r.tmdb_id), source: 'cache' });
    }

    // Fetch from TMDB trending endpoint
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
      return NextResponse.json({ error: 'TMDB trending request failed', status: r.status, body: txt }, { status: 502 });
    }
    const j = await r.json();
    const results = Array.isArray(j?.results) ? j.results.slice(0, limit) : [];
  const rows: Array<{ period: string; tmdb_id: number; rank: number }> = results.map((m: any, idx: number) => ({ period, tmdb_id: m.id, rank: idx + 1 }));
    if (rows.length) {
      // Upsert cache (ignore duplicates, update rank)
      const { error: upErr } = await supabase
        .from('tmdb_trending')
        .upsert(rows, { onConflict: 'period,tmdb_id' });
      if (upErr) throw upErr;
    }
  return NextResponse.json({ ok: true, ids: rows.map((r) => r.tmdb_id), source: 'refreshed' });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Unexpected error' }, { status: 500 });
  }
}
