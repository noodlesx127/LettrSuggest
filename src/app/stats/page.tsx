'use client';
import AuthGate from '@/components/AuthGate';
import Chart from '@/components/Chart';
import { useImportData } from '@/lib/importStore';

export default function StatsPage() {
  const { films } = useImportData();

  const ratingsBuckets = [0, 0, 0, 0, 0, 0]; // 0..5
  const byYear = new Map<number, number>();

  for (const f of films ?? []) {
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
