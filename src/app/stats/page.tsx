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
  production_companies?: Array<{ id: number; name: string; logo_path?: string }>;
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
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [filmMappings, setFilmMappings] = useState<Map<string, number>>(new Map());
  const [explorationStats, setExplorationStats] = useState<{
    exploration_rate: number;
    exploratory_films_rated: number;
    exploratory_avg_rating: number;
  } | null>(null);
  const [adjacentPrefs, setAdjacentPrefs] = useState<Array<{
    from_genre_name: string;
    to_genre_name: string;
    success_rate: number;
    rating_count: number;
  }>>([]);

  useEffect(() => {
    async function getUid() {
      if (!supabase) return;
      const { data } = await supabase.auth.getSession();
      setUid(data?.session?.user?.id ?? null);
    }
    getUid();
  }, []);

  // Fetch exploration stats and adjacent preferences
  useEffect(() => {
    async function fetchExplorationStats() {
      if (!supabase || !uid) return;

      try {
        // Fetch exploration stats
        const { data: stats } = await supabase
          .from('user_exploration_stats')
          .select('*')
          .eq('user_id', uid)
          .maybeSingle();

        setExplorationStats(stats);

        // Fetch learned adjacencies
        const { data: prefs } = await supabase
          .from('user_adjacent_preferences')
          .select('from_genre_name, to_genre_name, success_rate, rating_count')
          .eq('user_id', uid)
          .gte('rating_count', 3)
          .gte('success_rate', 0.6)
          .order('success_rate', { ascending: false })
          .limit(10);

        setAdjacentPrefs(prefs || []);
      } catch (e) {
        console.error('[Stats] Error fetching exploration data:', e);
      }
    }

    fetchExplorationStats();
  }, [uid]);


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
    if (!uid || !filteredFilms.length) {
      console.log('[Stats] Skipping TMDB load:', { uid, filmCount: filteredFilms.length });
      return;
    }

    async function loadTmdbDetails() {
      console.log('[Stats] Starting TMDB details load', { uid, filmCount: filteredFilms.length });
      setLoadingDetails(true);
      setDetailsError(null);

      // Add timeout protection (60 seconds for large libraries)
      const timeoutId = setTimeout(() => {
        console.error('[Stats] Load timeout after 60 seconds');
        setDetailsError('Loading took too long. Please try again or reduce your time filter.');
        setLoadingDetails(false);
      }, 60000);

      try {
        // Get ALL mappings for this user instead of using .in() which can hit query limits
        console.log('[Stats] Fetching mappings for user');
        const { data: allMappings, error: mappingError } = await supabase!
          .from('film_tmdb_map')
          .select('uri, tmdb_id')
          .eq('user_id', uid);

        if (mappingError) {
          console.error('[Stats] Error fetching mappings:', mappingError);
          setDetailsError(`Error loading mappings: ${mappingError.message}`);
          clearTimeout(timeoutId);
          setLoadingDetails(false);
          return;
        }

        if (!allMappings || allMappings.length === 0) {
          console.log('[Stats] No mappings found for user');
          clearTimeout(timeoutId);
          setLoadingDetails(false);
          return;
        }

        console.log('[Stats] Mappings loaded:', allMappings.length);

        // Store mappings for preference calculation
        const mappingsMap = new Map<string, number>();
        const filteredUris = new Set(filteredFilms.map(f => f.uri));

        // Filter to only mappings for currently filtered films
        const relevantMappings = allMappings.filter(m => filteredUris.has(m.uri));
        console.log('[Stats] Relevant mappings:', relevantMappings.length);

        relevantMappings.forEach(m => mappingsMap.set(m.uri, m.tmdb_id));
        setFilmMappings(mappingsMap);

        const tmdbIds = relevantMappings.map(m => m.tmdb_id);

        if (tmdbIds.length === 0) {
          console.log('[Stats] No TMDB IDs to fetch');
          clearTimeout(timeoutId);
          setLoadingDetails(false);
          return;
        }

        console.log('[Stats] Fetching cached TMDB details for', tmdbIds.length, 'IDs');

        // Fetch from cache in batches to avoid query size limits
        const batchSize = 500;
        const detailsMap = new Map<number, TMDBDetails>();

        for (let i = 0; i < tmdbIds.length; i += batchSize) {
          const batch = tmdbIds.slice(i, i + batchSize);
          console.log(`[Stats] Fetching batch ${i / batchSize + 1}:`, batch.length, 'IDs');

          const { data: cached, error: cacheError } = await supabase!
            .from('tmdb_movies')
            .select('tmdb_id, data')
            .in('tmdb_id', batch);

          if (cacheError) {
            console.error('[Stats] Error fetching cached movies:', cacheError);
            continue;
          }

          console.log('[Stats] Cached results for batch:', cached?.length ?? 0);

          for (const row of cached ?? []) {
            const data = row.data as any;
            // Accept cached data even if incomplete - we'll use what's available
            // This prevents hundreds of individual API calls
            if (data) {
              detailsMap.set(row.tmdb_id, data);
            }
          }
        }

        console.log('[Stats] Total details loaded:', detailsMap.size);
        setTmdbDetails(detailsMap);
        clearTimeout(timeoutId);
      } catch (e) {
        console.error('[Stats] Error loading TMDB details', e);
        setDetailsError(e instanceof Error ? e.message : 'Unknown error occurred');
        clearTimeout(timeoutId);
      } finally {
        console.log('[Stats] Finished loading TMDB details');
        setLoadingDetails(false);
      }
    }

    loadTmdbDetails();
  }, [uid, filteredFilms]);

  // Helper function to calculate preference weight (same as in enrich.ts)
  const getPreferenceWeight = (rating?: number, isLiked?: boolean): number => {
    const r = rating ?? 3;
    let weight = 0.0;

    if (r >= 4.5) {
      weight = isLiked ? 2.0 : 1.5;
    } else if (r >= 3.5) {
      weight = isLiked ? 1.5 : 1.2;
    } else if (r >= 2.5) {
      weight = isLiked ? 1.0 : 0.3;
    } else if (r >= 1.5) {
      weight = isLiked ? 0.7 : 0.1;
    } else {
      weight = isLiked ? 0.5 : 0.0;
    }

    return weight;
  };

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

    // Genre analysis with weighted preferences
    const genreCounts = new Map<string, number>();
    const genreWeights = new Map<string, number>(); // Weighted by rating + liked
    const actorCounts = new Map<string, { count: number; profile?: string }>();
    const actorWeights = new Map<string, number>();
    const directorCounts = new Map<string, { count: number; profile?: string }>();
    const directorWeights = new Map<string, number>();
    const keywordWeights = new Map<string, number>(); // Sub-genres/themes
    const studioWeights = new Map<string, number>(); // Production companies

    // Track films by preference strength for the "Taste Profile" section
    const absoluteFavorites = filteredFilms.filter(f => (f.rating ?? 0) >= 4.5 && f.liked);
    const highlyRated = filteredFilms.filter(f => (f.rating ?? 0) >= 4);
    const likedFilms = filteredFilms.filter(f => f.liked);
    const lowRatedButLiked = filteredFilms.filter(f => (f.rating ?? 0) < 3 && (f.rating ?? 0) > 0 && f.liked);

    for (const film of filteredFilms) {
      const weight = getPreferenceWeight(film.rating, film.liked);

      // Find TMDB ID for this film
      const tmdbId = filmMappings.get(film.uri);
      const details = tmdbId ? tmdbDetails.get(tmdbId) : undefined;

      if (details) {
        // Count genres (both raw count and weighted)
        details.genres?.forEach(genre => {
          genreCounts.set(genre.name, (genreCounts.get(genre.name) ?? 0) + 1);
          genreWeights.set(genre.name, (genreWeights.get(genre.name) ?? 0) + weight);
        });

        // Count top 5 actors (both raw and weighted)
        details.credits?.cast?.slice(0, 5).forEach(actor => {
          const current = actorCounts.get(actor.name) ?? { count: 0 };
          actorCounts.set(actor.name, {
            count: current.count + 1,
            profile: actor.profile_path ?? current.profile
          });
          actorWeights.set(actor.name, (actorWeights.get(actor.name) ?? 0) + weight);
        });

        // Count directors (both raw and weighted)
        details.credits?.crew?.filter(c => c.job === 'Director').forEach(director => {
          const current = directorCounts.get(director.name) ?? { count: 0 };
          directorCounts.set(director.name, {
            count: current.count + 1,
            profile: director.profile_path ?? current.profile
          });
          directorWeights.set(director.name, (directorWeights.get(director.name) ?? 0) + weight);
        });

        // Extract keywords if available (these are sub-genres/themes)
        const keywords = (details as any).keywords?.keywords || (details as any).keywords?.results || [];
        keywords.forEach((k: { name: string }) => {
          keywordWeights.set(k.name, (keywordWeights.get(k.name) ?? 0) + weight);
        });

        // Extract production companies/studios
        const companies = details.production_companies || [];
        companies.forEach((c: { name: string }) => {
          studioWeights.set(c.name, (studioWeights.get(c.name) ?? 0) + weight);
        });
      }
    }

    const topGenres = Array.from(genreCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const topGenresByWeight = Array.from(genreWeights.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    const topActors = Array.from(actorCounts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);

    const topActorsByWeight = Array.from(actorWeights.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, weight]) => ({ name, weight, ...actorCounts.get(name)! }));

    const topDirectors = Array.from(directorCounts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);

    const topDirectorsByWeight = Array.from(directorWeights.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, weight]) => ({ name, weight, ...directorCounts.get(name)! }));

    const topKeywords = Array.from(keywordWeights.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);

    // Top studios
    const topStudios = Array.from(studioWeights.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    // Categorize studios (indie vs major)
    const indieStudios = ['A24', 'Neon', 'Annapurna Pictures', 'Focus Features', 'Blumhouse Productions',
      'Studio Ghibli', 'Searchlight Pictures', 'Fox Searchlight Pictures', 'IFC Films',
      'Magnolia Pictures', 'Miramax', '24 Frames', 'Plan B Entertainment', 'Participant'];
    const majorStudios = ['Warner Bros.', 'Universal Pictures', 'Paramount Pictures', '20th Century Fox',
      'Columbia Pictures', 'Walt Disney Pictures', 'Sony Pictures', 'Metro-Goldwyn-Mayer',
      'Lionsgate', 'New Line Cinema', 'DreamWorks', 'Legendary Pictures'];

    let indieWeight = 0;
    let majorWeight = 0;

    for (const [studio, weight] of studioWeights.entries()) {
      if (indieStudios.some(indie => studio.includes(indie))) {
        indieWeight += weight;
      } else if (majorStudios.some(major => studio.includes(major))) {
        majorWeight += weight;
      }
    }

    const studioPreference = {
      indie: indieWeight,
      major: majorWeight,
      total: indieWeight + majorWeight
    };

    // Decade preferences (weighted)
    const decadeWeights = new Map<string, number>();
    for (const film of filteredFilms) {
      if (film.year != null) {
        const decade = `${Math.floor(film.year / 10) * 10}s`;
        const weight = getPreferenceWeight(film.rating, film.liked);
        decadeWeights.set(decade, (decadeWeights.get(decade) ?? 0) + weight);
      }
    }
    const topDecades = Array.from(decadeWeights.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Language preferences (weighted)
    const languageWeights = new Map<string, number>();
    for (const film of filteredFilms) {
      const tmdbId = filmMappings.get(film.uri);
      const details = tmdbId ? tmdbDetails.get(tmdbId) : undefined;
      if (details) {
        const lang = (details as any).original_language;
        if (lang) {
          const weight = getPreferenceWeight(film.rating, film.liked);
          languageWeights.set(lang, (languageWeights.get(lang) ?? 0) + weight);
        }
      }
    }
    const topLanguages = Array.from(languageWeights.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Runtime analysis
    const runtimes: number[] = [];
    for (const film of filteredFilms) {
      const tmdbId = filmMappings.get(film.uri);
      const details = tmdbId ? tmdbDetails.get(tmdbId) : undefined;
      if (details) {
        const runtime = (details as any).runtime;
        if (runtime && runtime > 0) {
          runtimes.push(runtime);
        }
      }
    }
    const runtimeStats = runtimes.length > 0 ? {
      min: Math.min(...runtimes),
      max: Math.max(...runtimes),
      avg: runtimes.reduce((sum, r) => sum + r, 0) / runtimes.length
    } : null;

    // Seasonal information
    const now = new Date();
    const month = now.getMonth();
    let currentSeason = 'Winter';
    let seasonalGenres: string[] = [];

    if (month >= 2 && month <= 4) {
      currentSeason = 'Spring';
      seasonalGenres = ['Romance', 'Drama', 'Documentary'];
    } else if (month >= 5 && month <= 7) {
      currentSeason = 'Summer';
      seasonalGenres = ['Action', 'Adventure', 'Comedy'];
    } else if (month >= 8 && month <= 10) {
      currentSeason = 'Fall';
      seasonalGenres = ['Horror', 'Thriller', 'Mystery'];
    } else {
      currentSeason = 'Winter';
      seasonalGenres = ['Drama', 'Family', 'Animation'];
    }

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
      topGenresByWeight,
      topActors,
      topActorsByWeight,
      topDirectors,
      topDirectorsByWeight,
      topKeywords,
      topStudios,
      studioPreference,
      absoluteFavorites: absoluteFavorites.length,
      highlyRatedCount: highlyRated.length,
      lowRatedButLikedCount: lowRatedButLiked.length,
      topDecades,
      topLanguages,
      runtimeStats,
      currentSeason,
      seasonalGenres,
    };
  }, [filteredFilms, tmdbDetails, films, filmMappings]);

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

      {/* Taste Profile - Weighted Preferences (Powers Suggestions) */}
      {!loadingDetails && stats.topKeywords.length > 0 && (
        <>
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900 text-lg">🎯 Your Taste Profile</h2>
              <span className="text-xs text-green-700 bg-green-100 px-2 py-1 rounded">Powers Suggestions</span>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              These weighted preferences drive your movie suggestions. Higher weights mean stronger influence.
            </p>

            {/* Preference Strength Breakdown */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <div className="bg-white rounded-lg p-3 border border-green-200">
                <p className="text-xs text-gray-600 mb-1">Absolute Favorites</p>
                <p className="text-xl font-bold text-gray-900">{stats.absoluteFavorites}</p>
                <p className="text-xs text-gray-500">5★ + Liked (2.0x)</p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-green-200">
                <p className="text-xs text-gray-600 mb-1">Highly Rated</p>
                <p className="text-xl font-bold text-gray-900">{stats.highlyRatedCount}</p>
                <p className="text-xs text-gray-500">4★+ films</p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-green-200">
                <p className="text-xs text-gray-600 mb-1">Liked Films</p>
                <p className="text-xl font-bold text-gray-900">{stats.likedCount}</p>
                <p className="text-xs text-gray-500">All liked</p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-green-200">
                <p className="text-xs text-gray-600 mb-1">Guilty Pleasures</p>
                <p className="text-xl font-bold text-gray-900">{stats.lowRatedButLikedCount}</p>
                <p className="text-xs text-gray-500">&lt;3★ but liked</p>
              </div>
            </div>

            {/* Top Genres by Weight */}
            <div className="mb-4">
              <h3 className="font-medium text-gray-900 mb-2 text-sm">Top Genre Preferences (Weighted)</h3>
              <div className="flex flex-wrap gap-2">
                {stats.topGenresByWeight.slice(0, 8).map(([genre, weight]) => {
                  const strength = weight >= 3.0 ? 'strong' : weight >= 1.5 ? 'moderate' : 'light';
                  const colorClass = strength === 'strong' ? 'bg-green-600 text-white' : strength === 'moderate' ? 'bg-green-400 text-white' : 'bg-green-200 text-green-900';
                  return (
                    <span key={genre} className={`px-3 py-1 rounded-full text-xs font-medium ${colorClass}`}>
                      {genre} ({weight.toFixed(1)})
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Top Keywords/Themes */}
            <div className="mb-4">
              <h3 className="font-medium text-gray-900 mb-2 text-sm">Top Themes & Keywords (Weighted)</h3>
              <div className="flex flex-wrap gap-2">
                {stats.topKeywords.slice(0, 12).map(([keyword, weight]) => {
                  const strength = weight >= 3.0 ? 'strong' : weight >= 1.5 ? 'moderate' : 'light';
                  const colorClass = strength === 'strong' ? 'bg-emerald-600 text-white' : strength === 'moderate' ? 'bg-emerald-400 text-white' : 'bg-emerald-200 text-emerald-900';
                  return (
                    <span key={keyword} className={`px-3 py-1 rounded-full text-xs font-medium ${colorClass}`}>
                      {keyword} ({weight.toFixed(1)})
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Top Directors by Weight */}
            {stats.topDirectorsByWeight.length > 0 && (
              <div className="mb-4">
                <h3 className="font-medium text-gray-900 mb-2 text-sm">Favorite Directors (Weighted by Ratings)</h3>
                <div className="flex flex-wrap gap-2">
                  {stats.topDirectorsByWeight.map(({ name, weight, count }) => (
                    <span key={name} className="px-3 py-1 rounded-full text-xs font-medium bg-blue-500 text-white">
                      {name} ({weight.toFixed(1)} across {count} films)
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Top Actors by Weight */}
            {stats.topActorsByWeight.length > 0 && (
              <div className="mb-4">
                <h3 className="font-medium text-gray-900 mb-2 text-sm">Favorite Actors (Weighted by Ratings)</h3>
                <div className="flex flex-wrap gap-2">
                  {stats.topActorsByWeight.map(({ name, weight, count }) => (
                    <span key={name} className="px-3 py-1 rounded-full text-xs font-medium bg-purple-500 text-white">
                      {name} ({weight.toFixed(1)} across {count} films)
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Studio Preferences */}
            {stats.topStudios.length > 0 && (
              <div>
                <h3 className="font-medium text-gray-900 mb-2 text-sm flex items-center gap-2">
                  <span>🎬</span>
                  <span>Favorite Studios</span>
                </h3>
                <p className="text-xs text-gray-600 mb-2">Production companies whose films resonate with you</p>

                {/* Indie vs Major breakdown */}
                {stats.studioPreference.total > 0 && (
                  <div className="mb-3 bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-medium text-gray-700">Studio Type Preference:</span>
                    </div>
                    <div className="flex gap-2 h-8">
                      <div
                        className="bg-orange-500 flex items-center justify-center text-white text-xs font-medium rounded transition-all"
                        style={{ width: `${(stats.studioPreference.indie / stats.studioPreference.total) * 100}%` }}
                      >
                        {stats.studioPreference.indie > 0 && `Indie ${stats.studioPreference.indie.toFixed(1)}`}
                      </div>
                      <div
                        className="bg-blue-500 flex items-center justify-center text-white text-xs font-medium rounded transition-all"
                        style={{ width: `${(stats.studioPreference.major / stats.studioPreference.total) * 100}%` }}
                      >
                        {stats.studioPreference.major > 0 && `Major ${stats.studioPreference.major.toFixed(1)}`}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {stats.topStudios.slice(0, 10).map(([studio, weight]) => {
                    return (
                      <span key={studio} className="px-3 py-1 rounded-full text-xs font-medium bg-amber-500 text-white">
                        {studio} ({weight.toFixed(1)})
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* User Statistics - Phase 1 Enhancement */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900 text-lg">📊 Your Rating Statistics</h2>
              <span className="text-xs text-blue-700 bg-blue-100 px-2 py-1 rounded">Algorithm Insights</span>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              These statistics help normalize your ratings to your personal scale for better recommendations.
            </p>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white rounded-lg p-3 border border-blue-200">
                <p className="text-xs text-gray-600 mb-1">Average Rating</p>
                <p className="text-2xl font-bold text-gray-900">{stats.avgRating}★</p>
                <p className="text-xs text-gray-500">{stats.rewatchedCount} rewatched</p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-blue-200">
                <p className="text-xs text-gray-600 mb-1">Total Films</p>
                <p className="text-2xl font-bold text-gray-900">{filteredFilms.length}</p>
                <p className="text-xs text-gray-500">In profile</p>
              </div>
            </div>

            <div className="mt-4 bg-white rounded-lg p-3 border border-blue-200">
              <p className="text-xs text-gray-600 mb-2">How this helps:</p>
              <ul className="text-xs text-gray-700 space-y-1">
                <li>• <strong>Normalized ratings</strong>: Your 4★ might be someone else&apos;s 5★ - we account for that</li>
                <li>• <strong>Rewatch signal</strong>: Films you rewatch get 1.8x weight (strong preference indicator)</li>
                <li>• <strong>Recency decay</strong>: Recent watches weighted more (your taste evolves)</li>
              </ul>
            </div>
          </div>

          {/* Additional Taste Insights - Informational Only */}
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            {/* Era Preferences */}
            {stats.topDecades && stats.topDecades.length > 0 && (
              <div className="bg-white border rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <span>📅</span>
                  <span>Preferred Film Eras</span>
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">Info Only</span>
                </h3>
                <p className="text-xs text-gray-600 mb-3">Decades you&apos;ve watched most. Not used to limit suggestions—we&apos;ll recommend great films from any era!</p>
                <div className="space-y-2">
                  {stats.topDecades.map(([decade, weight]) => {
                    const percentage = (weight / stats.topDecades[0][1]) * 100;
                    return (
                      <div key={decade} className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-700 w-16">{decade}</span>
                        <div className="flex-1 bg-gray-200 rounded-full h-6 relative overflow-hidden">
                          <div
                            className="bg-indigo-500 h-full rounded-full transition-all"
                            style={{ width: `${percentage}%` }}
                          />
                          <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-900">
                            {weight.toFixed(1)} weight
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Language Preferences */}
            {stats.topLanguages && stats.topLanguages.length > 0 && (
              <div className="bg-white border rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <span>🌍</span>
                  <span>Language Preferences</span>
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">Info Only</span>
                </h3>
                <p className="text-xs text-gray-600 mb-3">Languages you&apos;ve watched most. Not used to limit suggestions—we&apos;ll recommend films in any language!</p>
                <div className="space-y-2">
                  {stats.topLanguages.map(([lang, weight]) => {
                    const langNames: Record<string, string> = {
                      'en': 'English', 'fr': 'French', 'es': 'Spanish', 'de': 'German',
                      'it': 'Italian', 'ja': 'Japanese', 'ko': 'Korean', 'zh': 'Chinese',
                      'pt': 'Portuguese', 'ru': 'Russian', 'hi': 'Hindi', 'ar': 'Arabic'
                    };
                    const displayName = langNames[lang] || lang.toUpperCase();
                    const percentage = (weight / stats.topLanguages[0][1]) * 100;
                    return (
                      <div key={lang} className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-700 w-20">{displayName}</span>
                        <div className="flex-1 bg-gray-200 rounded-full h-6 relative overflow-hidden">
                          <div
                            className="bg-teal-500 h-full rounded-full transition-all"
                            style={{ width: `${percentage}%` }}
                          />
                          <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-900">
                            {weight.toFixed(1)} weight
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Runtime Preferences */}
            {stats.runtimeStats && stats.runtimeStats.avg > 0 && (
              <div className="bg-white border rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <span>⏱️</span>
                  <span>Runtime Sweet Spot</span>
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">Info Only</span>
                </h3>
                <p className="text-xs text-gray-600 mb-3">Your typical film length. Not used to limit suggestions—we&apos;ll recommend films of any runtime!</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-gray-900">{Math.round(stats.runtimeStats.min)}</p>
                    <p className="text-xs text-gray-500">Min (mins)</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-indigo-600">{Math.round(stats.runtimeStats.avg)}</p>
                    <p className="text-xs text-gray-500">Average</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-gray-900">{Math.round(stats.runtimeStats.max)}</p>
                    <p className="text-xs text-gray-500">Max (mins)</p>
                  </div>
                </div>
              </div>
            )}

            {/* Seasonal Preferences */}
            {stats.currentSeason && (
              <div className="bg-white border rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <span>🍂</span>
                  <span>Seasonal Context</span>
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">Info Only</span>
                </h3>
                <p className="text-xs text-gray-600 mb-3">Current season for context. Not used to limit suggestions—we recommend all types year-round!</p>
                <div className="bg-gradient-to-r from-orange-100 to-amber-100 rounded-lg p-3">
                  <p className="text-lg font-bold text-gray-900 mb-1">{stats.currentSeason}</p>
                  <p className="text-xs text-gray-700 mb-2">Typical seasonal genres (for reference only)</p>
                  {stats.seasonalGenres && stats.seasonalGenres.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {stats.seasonalGenres.map((genre) => (
                        <span key={genre} className="px-2 py-1 bg-amber-200 text-amber-900 rounded text-xs font-medium">
                          {genre}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

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
          <p className="text-xs text-blue-600 mt-1">This may take a moment for large libraries.</p>
        </div>
      ) : detailsError ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-red-800 font-medium">Error loading detailed stats</p>
          <p className="text-xs text-red-600 mt-1">{detailsError}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
          >
            Refresh Page
          </button>
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

        {/* User Statistics Section - Phase 5+ Transparency */}
        {stats && (
          <div className="bg-white border rounded-lg p-4">
            <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
              📊 Algorithm Insights
              <span className="text-xs text-gray-500 font-normal">
                (How your behavior influences recommendations)
              </span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-green-50 rounded p-3">
                <div className="text-sm text-gray-600">Rewatch Rate</div>
                <div className="text-2xl font-bold text-gray-900">
                  {stats.rewatchedCount && stats.totalWatches ?
                    ((stats.rewatchedCount / stats.totalWatches) * 100).toFixed(1) : '0.0'}%
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Rewatched films get 1.8x boost in similar suggestions
                </div>
              </div>

              <div className="bg-purple-50 rounded p-3">
                <div className="text-sm text-gray-600">Liked Films</div>
                <div className="text-2xl font-bold text-gray-900">
                  {stats.likedCount?.toLocaleString()}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Liked films receive 1.5-2.0x weight in taste profile
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Exploration Stats Section - Phase 5+ Adaptive Learning */}
        {explorationStats && (
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-lg p-4">
            <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
              🔍 Your Discovery Preferences
              <span className="text-xs text-indigo-600 font-normal">
                (Adaptive Learning Active)
              </span>
            </h2>

            <div className="space-y-3">
              <div className="bg-white rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-gray-900">Current Exploration Rate</div>
                  <div className="text-lg font-bold text-indigo-600">
                    {(explorationStats.exploration_rate * 100).toFixed(0)}%
                  </div>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-indigo-600 h-2 rounded-full transition-all"
                    style={{ width: `${explorationStats.exploration_rate * 3.33 * 100}%` }}
                  />
                </div>
                <div className="text-xs text-gray-600 mt-2">
                  {explorationStats.exploration_rate !== 0.15 ? (
                    explorationStats.exploration_rate > 0.15 ? (
                      <span className="text-green-700">
                        ✓ Increased because you enjoy exploratory picks (avg {explorationStats.exploratory_avg_rating.toFixed(1)}★)
                      </span>
                    ) : (
                      <span className="text-orange-700">
                        ↓ Decreased to focus on safer recommendations (avg {explorationStats.exploratory_avg_rating.toFixed(1)}★)
                      </span>
                    )
                  ) : (
                    <span>
                      Default rate • Will adjust based on your ratings ({explorationStats.exploratory_films_rated} exploratory films rated so far)
                    </span>
                  )}
                </div>
              </div>

              <div className="text-xs text-gray-600 bg-white rounded p-2">
                <strong>What this means:</strong> {(explorationStats.exploration_rate * 100).toFixed(0)}% of your suggestions
                will be "discovery picks" from adjacent genres or acclaimed films outside your usual taste.
                The other {(100 - explorationStats.exploration_rate * 100).toFixed(0)}% are high-confidence matches.
              </div>

              {/* Learned Adjacencies */}
              {adjacentPrefs.length > 0 && (
                <div className="bg-white rounded p-3">
                  <div className="text-sm font-medium text-gray-900 mb-2">
                    Learned Genre Transitions
                  </div>
                  <div className="space-y-1">
                    {adjacentPrefs.slice(0, 5).map((pref, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs">
                        <span className="text-gray-700">
                          {pref.from_genre_name} → {pref.to_genre_name}
                        </span>
                        <span className="text-green-700 font-medium">
                          {(pref.success_rate * 100).toFixed(0)}% success ({pref.rating_count} films)
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-gray-500 mt-2">
                    Algorithm learned which genre combinations you enjoy!
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AuthGate>
  );
}
