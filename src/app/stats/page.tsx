'use client';
import AuthGate from '@/components/AuthGate';
import Chart from '@/components/Chart';

export default function StatsPage() {
  const option = {
    tooltip: {},
    xAxis: { type: 'category', data: ['1★', '2★', '3★', '4★', '5★'] },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: [1, 2, 5, 8, 3] }],
  };
  return (
    <AuthGate>
      <h1 className="text-xl font-semibold mb-4">Stats</h1>
      <div className="grid gap-6">
        <div className="bg-white border rounded p-4">
          <h2 className="font-medium mb-2">Ratings distribution (demo)</h2>
          <Chart option={option} />
        </div>
      </div>
    </AuthGate>
  );
}
