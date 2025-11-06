'use client';
import AuthGate from '@/components/AuthGate';
import Chart from '@/components/Chart';
import { useImportData } from '@/lib/importStore';
import { useEffect, useState } from 'react';
import { loadAllFilms } from '@/lib/db';
import { supabase } from '@/lib/supabaseClient';

export default function StatsPage() {
  const { films } = useImportData();
  const [fallbackFilms, setFallbackFilms] = useState<typeof films>(null);

  useEffect(() => {
    if (!films) {
      loadAllFilms().then((all) => {
        if (all && all.length) setFallbackFilms(all);
      });
    }
  }, [films]);

  const ratingsBuckets = [0, 0, 0, 0, 0, 0]; // 0..5
  const byYear = new Map<number, number>();

  const source = films ?? fallbackFilms ?? [];
  for (const f of source) {
    const r = typeof f.rating === 'number' ? Math.round(f.rating) : null;
    if (r != null && r >= 0 && r <= 5) ratingsBuckets[r] += 1;
    if (f.year != null) byYear.set(f.year, (byYear.get(f.year) ?? 0) + 1);
  }

  const ratingsOption = {
    tooltip: {},
    xAxis: { type: 'category', data: ['0★', '1★', '2★', '3★', '4★', '5★'] },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: ratingsBuckets }],
  };

  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  const yearCounts = years.map((y) => byYear.get(y));
  const byYearOption = {
    tooltip: {},
    xAxis: { type: 'category', data: years },
    yAxis: { type: 'value' },
    series: [{ type: 'line', data: yearCounts }],
  };

  return (
    <AuthGate>
      <h1 className="text-xl font-semibold mb-4">Stats</h1>
      <div className="mb-4">
        <button
          className="px-3 py-2 bg-emerald-600 text-white rounded"
          onClick={async () => {
            try {
              if (!supabase) throw new Error('Supabase not initialized');
              const { data: sessionRes, error: sErr } = await supabase.auth.getSession();
              if (sErr) throw sErr;
              const uid = sessionRes.session?.user?.id;
              if (!uid) throw new Error('Not signed in');
              const { data, error } = await supabase
                .from('film_events')
                .select('uri,title,year,rating,rewatch,last_date,liked,on_watchlist')
                .eq('user_id', uid)
                .limit(5000);
              if (error) throw error;
              if (data) {
                const mapped = data.map((r) => ({
                  uri: r.uri,
                  title: r.title,
                  year: r.year ?? null,
                  rating: r.rating ?? undefined,
                  rewatch: r.rewatch ?? undefined,
                  lastDate: r.last_date ?? undefined,
                  liked: r.liked ?? undefined,
                  onWatchlist: r.on_watchlist ?? undefined,
                }));
                setFallbackFilms(mapped as any);
              }
            } catch (e) {
              // simple no-op; could add toast later
              console.error(e);
            }
          }}
        >
          Load from Supabase
        </button>
      </div>
      <div className="grid gap-6">
        <div className="bg-white border rounded p-4">
          <h2 className="font-medium mb-2">Ratings distribution</h2>
          <Chart option={ratingsOption} />
        </div>
        <div className="bg-white border rounded p-4">
          <h2 className="font-medium mb-2">Watches by year</h2>
          <Chart option={byYearOption} />
        </div>
      </div>
    </AuthGate>
  );
}
