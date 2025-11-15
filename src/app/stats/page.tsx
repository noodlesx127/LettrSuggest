'use client';
import AuthGate from '@/components/AuthGate';
import Chart from '@/components/Chart';
import { useImportData } from '@/lib/importStore';
import { useMemo } from 'react';

export default function StatsPage() {
  const { films, loading } = useImportData();

  const stats = useMemo(() => {
    if (!films || films.length === 0) return null;

    const watched = films.filter(f => (f.watchCount ?? 0) > 0);
    const watchlist = films.filter(f => f.onWatchlist);
    const rated = films.filter(f => f.rating != null);
    const rewatched = films.filter(f => f.rewatch);
    const liked = films.filter(f => f.liked);

    // Ratings distribution
    const ratingsBuckets = [0, 0, 0, 0, 0, 0]; // 0..5
    for (const f of rated) {
      const r = Math.round(f.rating!);
      if (r >= 0 && r <= 5) ratingsBuckets[r] += 1;
    }

    // Average rating
    const avgRating = rated.length > 0 
      ? (rated.reduce((sum, f) => sum + (f.rating ?? 0), 0) / rated.length).toFixed(2)
      : '0.00';

    // Watches by year (release year)
    const byYear = new Map<number, number>();
    for (const f of watched) {
      if (f.year != null) byYear.set(f.year, (byYear.get(f.year) ?? 0) + 1);
    }
    const years = Array.from(byYear.keys()).sort((a, b) => a - b);
    const yearCounts = years.map(y => byYear.get(y)!);

    // Decade distribution
    const byDecade = new Map<string, number>();
    for (const f of watched) {
      if (f.year != null) {
        const decade = `${Math.floor(f.year / 10) * 10}s`;
        byDecade.set(decade, (byDecade.get(decade) ?? 0) + 1);
      }
    }
    const decades = Array.from(byDecade.keys()).sort();
    const decadeCounts = decades.map(d => byDecade.get(d)!);

    // Total watch count (including rewatches)
    const totalWatches = watched.reduce((sum, f) => sum + (f.watchCount ?? 0), 0);

    // Most watched film
    const mostWatched = watched.reduce((max, f) => 
      (f.watchCount ?? 0) > (max.watchCount ?? 0) ? f : max
    , watched[0]);

    return {
      totalFilms: films.length,
      watchedCount: watched.length,
      watchlistCount: watchlist.length,
      ratedCount: rated.length,
      rewatchedCount: rewatched.length,
      likedCount: liked.length,
      avgRating,
      totalWatches,
      mostWatched,
      ratingsBuckets,
      years,
      yearCounts,
      decades,
      decadeCounts,
    };
  }, [films]);

  if (loading) {
    return (
      <AuthGate>
        <h1 className="text-xl font-semibold mb-4">Stats</h1>
        <p className="text-gray-600">Loading your stats...</p>
      </AuthGate>
    );
  }

  if (!stats) {
    return (
      <AuthGate>
        <h1 className="text-xl font-semibold mb-4">Stats</h1>
        <p className="text-gray-600">No data yet. Import your Letterboxd data to see stats.</p>
      </AuthGate>
    );
  }

  const ratingsOption = {
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: ['0★', '½★', '1★', '1½★', '2★', '2½★', '3★', '3½★', '4★', '4½★', '5★'] },
    yAxis: { type: 'value' },
    series: [{
      type: 'bar',
      data: stats.ratingsBuckets,
      itemStyle: { color: '#10b981' }
    }],
  };

  const byYearOption = {
    tooltip: { trigger: 'axis' },
    xAxis: { 
      type: 'category', 
      data: stats.years,
      axisLabel: { interval: Math.floor(stats.years.length / 10) || 0 }
    },
    yAxis: { type: 'value' },
    series: [{
      type: 'line',
      data: stats.yearCounts,
      smooth: true,
      itemStyle: { color: '#3b82f6' },
      areaStyle: { opacity: 0.3 }
    }],
  };

  const byDecadeOption = {
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: stats.decades },
    yAxis: { type: 'value' },
    series: [{
      type: 'bar',
      data: stats.decadeCounts,
      itemStyle: { color: '#8b5cf6' }
    }],
  };

  return (
    <AuthGate>
      <h1 className="text-xl font-semibold mb-6">Your Movie Stats</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border rounded-lg p-4">
          <p className="text-sm text-gray-600">Films Watched</p>
          <p className="text-2xl font-bold text-gray-900">{stats.watchedCount}</p>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <p className="text-sm text-gray-600">Total Watches</p>
          <p className="text-2xl font-bold text-gray-900">{stats.totalWatches}</p>
          {stats.rewatchedCount > 0 && (
            <p className="text-xs text-gray-500 mt-1">{stats.rewatchedCount} rewatched</p>
          )}
        </div>
        <div className="bg-white border rounded-lg p-4">
          <p className="text-sm text-gray-600">Average Rating</p>
          <p className="text-2xl font-bold text-gray-900">{stats.avgRating}★</p>
          <p className="text-xs text-gray-500 mt-1">{stats.ratedCount} rated</p>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <p className="text-sm text-gray-600">On Watchlist</p>
          <p className="text-2xl font-bold text-gray-900">{stats.watchlistCount}</p>
        </div>
      </div>

      {/* Most Watched Film */}
      {stats.mostWatched && (stats.mostWatched.watchCount ?? 0) > 1 && (
        <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-4 mb-6">
          <p className="text-sm font-medium text-purple-900 mb-1">Most Watched Film</p>
          <p className="text-lg font-bold text-purple-900">
            {stats.mostWatched.title} {stats.mostWatched.year && `(${stats.mostWatched.year})`}
          </p>
          <p className="text-sm text-purple-700">Watched {stats.mostWatched.watchCount} times</p>
        </div>
      )}

      {/* Charts */}
      <div className="grid gap-6">
        <div className="bg-white border rounded-lg p-4">
          <h2 className="font-semibold text-gray-900 mb-3">Ratings Distribution</h2>
          <Chart option={ratingsOption} />
        </div>

        <div className="bg-white border rounded-lg p-4">
          <h2 className="font-semibold text-gray-900 mb-3">Films by Release Year</h2>
          <Chart option={byYearOption} />
        </div>

        <div className="bg-white border rounded-lg p-4">
          <h2 className="font-semibold text-gray-900 mb-3">Films by Decade</h2>
          <Chart option={byDecadeOption} />
        </div>
      </div>
    </AuthGate>
  );
}
