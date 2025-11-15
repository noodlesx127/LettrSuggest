'use client';
import AuthGate from '@/components/AuthGate';
import Chart from '@/components/Chart';
import { useImportData } from '@/lib/importStore';
import { supabase } from '@/lib/supabaseClient';
import { useMemo, useState, useEffect } from 'react';
import Image from 'next/image';

type TimeFilter = 'all' | 'year' | 'month';

type TMDBDetails = {
  id: number;
  title: string;
  poster_path?: string;
  backdrop_path?: string;
  genres?: Array<{ id: number; name: string }>;
  credits?: {
    cast?: Array<{ id: number; name: string; profile_path?: string; order?: number }>;
    crew?: Array<{ id: number; name: string; job?: string; profile_path?: string }>;
  };
};

export default function StatsPage() {
  const { films, loading } = useImportData();
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [tmdbDetails, setTmdbDetails] = useState<Map<number, TMDBDetails>>(new Map());
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    async function getUid() {
      if (!supabase) return;
      const { data } = await supabase.auth.getSession();
      setUid(data?.session?.user?.id ?? null);
    }
    getUid();
  }, []);

  const filteredFilms = useMemo(() => {
    if (!films) return [];
    
    const watched = films.filter(f => (f.watchCount ?? 0) > 0);
    
    if (timeFilter === 'all') return watched;
    
    const now = new Date();
    const cutoff = timeFilter === 'year' 
      ? new Date(now.getFullYear(), 0, 1)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    
    return watched.filter(f => {
      if (!f.lastDate) return false;
      const filmDate = new Date(f.lastDate);
      return filmDate >= cutoff;
    });
  }, [films, timeFilter]);

  // Load TMDB details for mapped films
  useEffect(() => {
    if (!uid || !filteredFilms.length) return;
    
    async function loadTmdbDetails() {
      setLoadingDetails(true);
      try {
        // Get mappings for filtered films
        const { data: mappings } = await supabase!
          .from('film_tmdb_map')
          .select('uri, tmdb_id')
          .eq('user_id', uid)
          .in('uri', filteredFilms.map(f => f.uri));
        
        if (!mappings) return;
        
        const tmdbIds = mappings.map(m => m.tmdb_id);
        
        // Fetch from cache first
        const { data: cached } = await supabase!
          .from('tmdb_movies')
          .select('tmdb_id, data')
          .in('tmdb_id', tmdbIds);
        
        const detailsMap = new Map<number, TMDBDetails>();
        
        for (const row of cached ?? []) {
          const data = row.data as any;
          // Check if we have full details (genres and credits)
          if (data.genres && data.credits) {
            detailsMap.set(row.tmdb_id, data);
          } else {
            // Fetch full details from API
            try {
              const res = await fetch(`/api/tmdb/movie/${row.tmdb_id}`);
              const json = await res.json();
              if (json.ok && json.movie) {
                detailsMap.set(row.tmdb_id, json.movie);
                // Update cache
                await supabase!.from('tmdb_movies').upsert({
                  tmdb_id: row.tmdb_id,
                  data: json.movie
                }, { onConflict: 'tmdb_id' });
              }
            } catch (e) {
              console.error(`Failed to fetch details for ${row.tmdb_id}`, e);
            }
          }
        }
        
        setTmdbDetails(detailsMap);
      } catch (e) {
        console.error('Error loading TMDB details', e);
      } finally {
        setLoadingDetails(false);
      }
    }
    
    loadTmdbDetails();
  }, [uid, filteredFilms]);

  const stats = useMemo(() => {
    if (!filteredFilms || filteredFilms.length === 0) return null;

    const watchlist = films?.filter(f => f.onWatchlist) ?? [];
    const rated = filteredFilms.filter(f => f.rating != null);
    const rewatched = filteredFilms.filter(f => f.rewatch);
    const liked = filteredFilms.filter(f => f.liked);

    // Ratings distribution
    const ratingsBuckets = [0, 0, 0, 0, 0, 0];
    for (const f of rated) {
      const r = Math.round(f.rating!);
      if (r >= 0 && r <= 5) ratingsBuckets[r] += 1;
    }

    const avgRating = rated.length > 0 
      ? (rated.reduce((sum, f) => sum + (f.rating ?? 0), 0) / rated.length).toFixed(2)
      : '0.00';

    // Watches by year
    const byYear = new Map<number, number>();
    for (const f of filteredFilms) {
      if (f.year != null) byYear.set(f.year, (byYear.get(f.year) ?? 0) + 1);
    }
    const years = Array.from(byYear.keys()).sort((a, b) => a - b);
    const yearCounts = years.map(y => byYear.get(y)!);

    // Decade distribution
    const byDecade = new Map<string, number>();
    for (const f of filteredFilms) {
      if (f.year != null) {
        const decade = `${Math.floor(f.year / 10) * 10}s`;
        byDecade.set(decade, (byDecade.get(decade) ?? 0) + 1);
      }
    }
    const decades = Array.from(byDecade.keys()).sort();
    const decadeCounts = decades.map(d => byDecade.get(d)!);

    const totalWatches = filteredFilms.reduce((sum, f) => sum + (f.watchCount ?? 0), 0);

    // Most watched film
    const mostWatched = filteredFilms.reduce((max, f) => 
      (f.watchCount ?? 0) > (max.watchCount ?? 0) ? f : max
    , filteredFilms[0]);

    // Genre analysis
    const genreCounts = new Map<string, number>();
    const actorCounts = new Map<string, { count: number; profile?: string }>();
    const directorCounts = new Map<string, { count: number; profile?: string }>();
    
    for (const film of filteredFilms) {
      // Find TMDB ID for this film
      const mapping = Array.from(tmdbDetails.entries()).find(([id, details]) => 
        film.title === details.title
      );
      
      if (mapping) {
        const [tmdbId, details] = mapping;
        
        // Count genres
        details.genres?.forEach(genre => {
          genreCounts.set(genre.name, (genreCounts.get(genre.name) ?? 0) + 1);
        });
        
        // Count top 5 actors
        details.credits?.cast?.slice(0, 5).forEach(actor => {
          const current = actorCounts.get(actor.name) ?? { count: 0 };
          actorCounts.set(actor.name, {
            count: current.count + 1,
            profile: actor.profile_path ?? current.profile
          });
        });
        
        // Count directors
        details.credits?.crew?.filter(c => c.job === 'Director').forEach(director => {
          const current = directorCounts.get(director.name) ?? { count: 0 };
          directorCounts.set(director.name, {
            count: current.count + 1,
            profile: director.profile_path ?? current.profile
          });
        });
      }
    }

    const topGenres = Array.from(genreCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    const topActors = Array.from(actorCounts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);
    
    const topDirectors = Array.from(directorCounts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);

    return {
      totalFilms: films?.length ?? 0,
      watchedCount: filteredFilms.length,
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
      topGenres,
      topActors,
      topDirectors,
    };
  }, [filteredFilms, tmdbDetails, films]);

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

  const genreOption = {
    tooltip: { trigger: 'item' },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      data: stats.topGenres.map(([name, count]) => ({ value: count, name })),
      label: { show: true },
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowOffsetX: 0,
          shadowColor: 'rgba(0, 0, 0, 0.5)'
        }
      }
    }]
  };

  return (
    <AuthGate>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Your Movie Stats</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setTimeFilter('all')}
            className={`px-3 py-1 text-sm rounded ${timeFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            All Time
          </button>
          <button
            onClick={() => setTimeFilter('year')}
            className={`px-3 py-1 text-sm rounded ${timeFilter === 'year' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            This Year
          </button>
          <button
            onClick={() => setTimeFilter('month')}
            className={`px-3 py-1 text-sm rounded ${timeFilter === 'month' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            This Month
          </button>
        </div>
      </div>

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

      {/* Top People & Genres */}
      {loadingDetails ? (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-blue-800">Loading detailed stats (actors, directors, genres)...</p>
        </div>
      ) : (
        <>
          {stats.topActors.length > 0 && (
            <div className="bg-white border rounded-lg p-4 mb-6">
              <h2 className="font-semibold text-gray-900 mb-3">Top Actors</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
                {stats.topActors.map(([name, data]) => (
                  <div key={name} className="text-center">
                    <div className="w-20 h-20 mx-auto mb-2 rounded-full overflow-hidden bg-gray-200">
                      {data.profile ? (
                        <Image
                          src={`https://image.tmdb.org/t/p/w185${data.profile}`}
                          alt={name}
                          width={80}
                          height={80}
                          className="object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                          No photo
                        </div>
                      )}
                    </div>
                    <p className="text-sm font-medium text-gray-900">{name}</p>
                    <p className="text-xs text-gray-500">{data.count} films</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {stats.topDirectors.length > 0 && (
            <div className="bg-white border rounded-lg p-4 mb-6">
              <h2 className="font-semibold text-gray-900 mb-3">Top Directors</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
                {stats.topDirectors.map(([name, data]) => (
                  <div key={name} className="text-center">
                    <div className="w-20 h-20 mx-auto mb-2 rounded-full overflow-hidden bg-gray-200">
                      {data.profile ? (
                        <Image
                          src={`https://image.tmdb.org/t/p/w185${data.profile}`}
                          alt={name}
                          width={80}
                          height={80}
                          className="object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                          No photo
                        </div>
                      )}
                    </div>
                    <p className="text-sm font-medium text-gray-900">{name}</p>
                    <p className="text-xs text-gray-500">{data.count} films</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Charts */}
      <div className="grid gap-6">
        {stats.topGenres.length > 0 && (
          <div className="bg-white border rounded-lg p-4">
            <h2 className="font-semibold text-gray-900 mb-3">Top Genres</h2>
            <Chart option={genreOption} />
          </div>
        )}

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
