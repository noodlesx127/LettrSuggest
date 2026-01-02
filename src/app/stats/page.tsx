'use client';
import AuthGate from '@/components/AuthGate';
import Chart from '@/components/Chart';
import { useImportData } from '@/lib/importStore';
import { supabase } from '@/lib/supabaseClient';
import { getRepeatSuggestionStats, buildTasteProfile } from '@/lib/enrich';
import { analyzeSubgenrePatterns } from '@/lib/subgenreDetection';
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
  keywords?: {
    keywords?: Array<{ id: number; name: string }>;
    results?: Array<{ id: number; name: string }>;
  };
  overview?: string; // Added for subgenre detection
};

export default function StatsPage() {
  const { films, loading } = useImportData();
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [tmdbDetails, setTmdbDetails] = useState<Map<number, TMDBDetails>>(new Map());
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [filmMappings, setFilmMappings] = useState<Map<string, number>>(new Map());
  const [mappingCoverage, setMappingCoverage] = useState<{ mapped: number; total: number } | null>(null);
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
  const [tasteProfileData, setTasteProfileData] = useState<Awaited<ReturnType<typeof buildTasteProfile>> | null>(null);
  const [pairwiseStats, setPairwiseStats] = useState<{
    total_comparisons: number;
    recent_30d: number;
    recent_90d: number;
    high_consensus_wins: number;
    medium_consensus_wins: number;
    low_consensus_wins: number;
  } | null>(null);
  const [feedbackSummary, setFeedbackSummary] = useState<{ total: number; positive: number; negative: number; hitRate: number } | null>(null);
  const [sourceReliability, setSourceReliability] = useState<Array<{ source: string; total: number; positive: number; hitRate: number }>>([]);
  const [sourceReliabilityRecent, setSourceReliabilityRecent] = useState<Array<{ source: string; total: number; positive: number; hitRate: number }>>([]);
  const [sourceConsensus, setSourceConsensus] = useState<Array<{ source: string; high: { pos: number; total: number }; medium: { pos: number; total: number }; low: { pos: number; total: number } }>>([]);
  const [reasonAcceptance, setReasonAcceptance] = useState<Array<{ reason: string; total: number; positive: number; hitRate: number }>>([]);
  const [consensusAcceptance, setConsensusAcceptance] = useState<{ high: { pos: number; total: number }; medium: { pos: number; total: number }; low: { pos: number; total: number } } | null>(null);
  const [feedbackRows, setFeedbackRows] = useState<Array<any>>([]);
  const [repeatSuggestionStats, setRepeatSuggestionStats] = useState<{
    totalExposures: number;
    uniqueSuggestions: number;
    repeatRate: number;
    avgTimeBetweenRepeats: number | null;
  } | null>(null);

  useEffect(() => {
    async function getUid() {
      if (!supabase) return;

      const { data } = await supabase.auth.getSession();
      setUid(data?.session?.user?.id ?? null);

      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        setUid(session?.user?.id ?? null);
      });

      return () => subscription.unsubscribe();
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

        // Fetch pairwise comparison stats
        const { data: pairwiseEvents, error: pairwiseError } = await supabase
          .from('pairwise_events')
          .select('created_at, winner_consensus, loser_consensus')
          .eq('user_id', uid);

        if (pairwiseError) {
          console.error('[Stats] Error fetching pairwise events:', pairwiseError);
        } else if (pairwiseEvents && pairwiseEvents.length > 0) {
          const now = Date.now();
          const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
          const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;

          const recent30d = pairwiseEvents.filter(e => {
            const ts = e.created_at ? new Date(e.created_at).getTime() : 0;
            return ts >= thirtyDaysAgo;
          }).length;

          const recent90d = pairwiseEvents.filter(e => {
            const ts = e.created_at ? new Date(e.created_at).getTime() : 0;
            return ts >= ninetyDaysAgo;
          }).length;

          // Count consensus levels for winners
          const highConsensusWins = pairwiseEvents.filter(e => e.winner_consensus === 'high').length;
          const mediumConsensusWins = pairwiseEvents.filter(e => e.winner_consensus === 'medium').length;
          const lowConsensusWins = pairwiseEvents.filter(e => e.winner_consensus === 'low').length;

          setPairwiseStats({
            total_comparisons: pairwiseEvents.length,
            recent_30d: recent30d,
            recent_90d: recent90d,
            high_consensus_wins: highConsensusWins,
            medium_consensus_wins: mediumConsensusWins,
            low_consensus_wins: lowConsensusWins,
          });
        }
      } catch (e) {
        console.error('[Stats] Error fetching exploration data:', e);
      }
    }

    fetchExplorationStats();
  }, [uid]);

  // Fetch repeat-suggestion stats
  useEffect(() => {
    async function fetchRepeatStats() {
      if (!uid) return;
      try {
        const stats = await getRepeatSuggestionStats(uid, 30);
        setRepeatSuggestionStats(stats);
      } catch (e) {
        console.error('[Stats] Error fetching repeat-suggestion stats:', e);
      }
    }
    fetchRepeatStats();
  }, [uid]);

  // Fetch suggestion feedback to derive overall hit-rate and per-source reliability (now that sources are stored)
  // Note: suggestion_feedback has a unique constraint on (user_id, tmdb_id) so no duplicates exist
  useEffect(() => {
    async function fetchFeedbackSummary() {
      if (!supabase || !uid) return;
      try {
        const { data, error } = await supabase
          .from('suggestion_feedback')
          .select('feedback_type, recommendation_sources, consensus_level, reason_types, movie_features, tmdb_id, created_at')
          .eq('user_id', uid);
        if (error) {
          console.error('[Stats] Error fetching feedback summary:', error);
          return;
        }
        const total = data?.length ?? 0;
        const positive = data?.filter(r => r.feedback_type === 'positive').length ?? 0;
        const negative = data?.filter(r => r.feedback_type === 'negative').length ?? 0;
        const hitRate = total > 0 ? positive / total : 0;
        setFeedbackSummary({ total, positive, negative, hitRate });
        setFeedbackRows(data || []);

        // Aggregate reason-type hit rates (acceptance by reason type)
        const byReason = new Map<string, { pos: number; total: number }>();
        data?.forEach(row => {
          const reasons: string[] = Array.isArray((row as any).reason_types) ? (row as any).reason_types : [];
          const isPos = row.feedback_type === 'positive';
          reasons.forEach(r => {
            const key = (r || '').toLowerCase();
            if (!key) return;
            const curr = byReason.get(key) ?? { pos: 0, total: 0 };
            if (isPos) curr.pos += 1;
            curr.total += 1;
            byReason.set(key, curr);
          });
        });

        const reasonEntries = Array.from(byReason.entries())
          .map(([reason, stats]) => ({
            reason,
            total: stats.total,
            positive: stats.pos,
            hitRate: stats.total > 0 ? stats.pos / stats.total : 0,
          }))
          .filter(e => e.total >= 5)
          .sort((a, b) => b.total - a.total);
        setReasonAcceptance(reasonEntries);

        // Aggregate per-source hit rates
        const bySource = new Map<string, { pos: number; total: number }>();
        data?.forEach(row => {
          const sources: string[] = Array.isArray((row as any).recommendation_sources) ? (row as any).recommendation_sources : [];
          const isPos = row.feedback_type === 'positive';
          sources.forEach(src => {
            const key = (src || '').toLowerCase();
            if (!key) return;
            const curr = bySource.get(key) ?? { pos: 0, total: 0 };
            if (isPos) curr.pos += 1;
            curr.total += 1;
            bySource.set(key, curr);
          });
        });

        const entries = Array.from(bySource.entries())
          .map(([source, stats]) => ({
            source,
            total: stats.total,
            positive: stats.pos,
            hitRate: stats.total > 0 ? stats.pos / stats.total : 0,
          }))
          .filter(e => e.total >= 3) // require a few samples to show
          .sort((a, b) => b.total - a.total);
        setSourceReliability(entries);

        // Recent (90d) per-source reliability to catch regressions
        const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
        const bySourceRecent = new Map<string, { pos: number; total: number }>();
        data?.forEach(row => {
          const ts = row.created_at ? new Date(row.created_at).getTime() : 0;
          if (!ts || ts < ninetyDaysAgo) return;
          const sources: string[] = Array.isArray((row as any).recommendation_sources) ? (row as any).recommendation_sources : [];
          const isPos = row.feedback_type === 'positive';
          sources.forEach(src => {
            const key = (src || '').toLowerCase();
            if (!key) return;
            const curr = bySourceRecent.get(key) ?? { pos: 0, total: 0 };
            if (isPos) curr.pos += 1;
            curr.total += 1;
            bySourceRecent.set(key, curr);
          });
        });

        const recentEntries = Array.from(bySourceRecent.entries())
          .map(([source, stats]) => ({
            source,
            total: stats.total,
            positive: stats.pos,
            hitRate: stats.total > 0 ? stats.pos / stats.total : 0,
          }))
          .filter(e => e.total >= 3)
          .sort((a, b) => b.total - a.total);
        setSourceReliabilityRecent(recentEntries);

        // Consensus-level split per source
        const bySourceConsensus = new Map<string, { high: { pos: number; total: number }; medium: { pos: number; total: number }; low: { pos: number; total: number } }>();
        data?.forEach(row => {
          const sources: string[] = Array.isArray((row as any).recommendation_sources) ? (row as any).recommendation_sources : [];
          const level = (row as any).consensus_level as ('high' | 'medium' | 'low' | null);
          const bucket = level === 'high' ? 'high' : level === 'medium' ? 'medium' : 'low';
          const isPos = row.feedback_type === 'positive';
          sources.forEach(src => {
            const key = (src || '').toLowerCase();
            if (!key) return;
            const curr = bySourceConsensus.get(key) ?? { high: { pos: 0, total: 0 }, medium: { pos: 0, total: 0 }, low: { pos: 0, total: 0 } };
            const target = curr[bucket];
            if (isPos) target.pos += 1;
            target.total += 1;
            bySourceConsensus.set(key, curr);
          });
        });

        const consensusEntries = Array.from(bySourceConsensus.entries())
          .map(([source, buckets]) => ({ source, ...buckets }))
          .filter(e => (e.high.total + e.medium.total + e.low.total) >= 5) // need some signal
          .sort((a, b) => (b.high.total + b.medium.total + b.low.total) - (a.high.total + a.medium.total + a.low.total));
        setSourceConsensus(consensusEntries);

        // Aggregate consensus calibration across all sources
        const consensusTotals = data?.reduce((acc, row) => {
          const level = (row as any).consensus_level as ('high' | 'medium' | 'low' | null);
          const bucket = level === 'high' ? 'high' : level === 'medium' ? 'medium' : 'low';
          const isPos = row.feedback_type === 'positive';
          acc[bucket].total += 1;
          if (isPos) acc[bucket].pos += 1;
          return acc;
        }, { high: { pos: 0, total: 0 }, medium: { pos: 0, total: 0 }, low: { pos: 0, total: 0 } }) ?? null;

        setConsensusAcceptance(consensusTotals);
      } catch (e) {
        console.error('[Stats] Exception fetching feedback summary', e);
      }
    }
    fetchFeedbackSummary();
  }, [uid]);


  const filteredFilms = useMemo(() => {
    if (!films) {
      console.log('[Stats] No films in context');
      return [];
    }

    // Relaxed filter: Count as watched if watchCount > 0 OR has rating OR has date (legacy import support)
    const watched = films.filter(f =>
      (f.watchCount ?? 0) > 0 ||
      f.rating != null ||
      !!f.lastDate
    );

    console.log('[Stats] Filtering films:', {
      total: films.length,
      watched: watched.length,
      sampleRaw: films.slice(0, 2),
      sampleWatched: watched.slice(0, 2)
    });

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

  const filmByUri = useMemo(() => {
    const map = new Map<string, any>();
    films?.forEach(f => map.set(f.uri, f));
    return map;
  }, [films]);

  const tmdbToFilm = useMemo(() => {
    const map = new Map<number, any>();
    filmMappings.forEach((tmdbId, uri) => {
      const film = filmByUri.get(uri);
      if (film) map.set(tmdbId, film);
    });
    return map;
  }, [filmMappings, filmByUri]);

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
        // Paginate through all results (PostgREST defaults to 1000 max per request)
        console.log('[Stats] Fetching mappings for user (paginated)');
        const pageSize = 250;
        let from = 0;
        const allMappings: Array<{ uri: string; tmdb_id: number }> = [];

        while (true) {
          const { data: pageData, error: mappingError } = await supabase!
            .from('film_tmdb_map')
            .select('uri, tmdb_id')
            .eq('user_id', uid)
            .order('uri') // Ensure stable ordering for pagination
            .range(from, from + pageSize - 1);

          if (mappingError) {
            console.error('[Stats] Error fetching mappings page:', { from, error: mappingError });
            setDetailsError(`Error loading mappings: ${mappingError.message}`);
            clearTimeout(timeoutId);
            setLoadingDetails(false);
            return;
          }

          const rows = pageData ?? [];
          allMappings.push(...rows);

          // If we got fewer than pageSize, we've fetched all rows
          if (rows.length < pageSize) break;
          from += pageSize;
        }

        console.log(`[Stats] Total mappings fetched: ${allMappings.length}`);

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

        // Also include watchlist URIs so watchlist analysis works
        const watchlistFilms = films?.filter(f => f.onWatchlist) ?? [];
        watchlistFilms.forEach(f => filteredUris.add(f.uri));

        // Filter to only mappings for currently filtered films AND watchlist
        const relevantMappings = allMappings.filter(m => filteredUris.has(m.uri));
        console.log('[Stats] Relevant mappings:', relevantMappings.length, 'of', filteredUris.size, 'films (including', watchlistFilms.length, 'watchlist)');

        // Track mapping coverage for UI feedback
        setMappingCoverage({ mapped: relevantMappings.length, total: filteredUris.size });

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
        const batchSize = 100;
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

        // Debug: check how many have the required fields
        let withGenres = 0, withCredits = 0, withKeywords = 0;
        for (const [, data] of detailsMap) {
          if (data.genres?.length) withGenres++;
          if (data.credits?.cast?.length || data.credits?.crew?.length) withCredits++;
          if (data.keywords?.keywords?.length || data.keywords?.results?.length) withKeywords++;
        }
        console.log('[Stats] Details quality check:', {
          total: detailsMap.size,
          withGenres,
          withCredits,
          withKeywords,
          note: 'If these are 0, enrichment may not have completed'
        });

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, filteredFilms]);

  // Load Taste Profile using shared algorithm
  useEffect(() => {
    // Only build if we have data and aren't mid-load (to avoid thrashing)
    if (!uid || filteredFilms.length === 0 || loadingDetails || tmdbDetails.size === 0) return;

    const runProfile = async () => {
      try {
        console.log('[Stats] Building shared taste profile...');
        const watchlistFilms = films?.filter(f => f.onWatchlist) || [];
        const profile = await buildTasteProfile({
          films: filteredFilms,
          mappings: filmMappings,
          tmdbDetails: tmdbDetails,
          watchlistFilms: watchlistFilms,
          userId: uid
        });
        setTasteProfileData(profile);
      } catch (e) {
        console.error('[Stats] Error building taste profile', e);
      }
    };

    runProfile();
  }, [filteredFilms, filmMappings, tmdbDetails, loadingDetails, films, uid]);


  const stats = useMemo(() => {
    if (!filteredFilms || filteredFilms.length === 0) return null;

    const watchlist = films?.filter(f => f.onWatchlist) ?? [];
    const rated = filteredFilms.filter(f => f.rating != null);
    const rewatched = filteredFilms.filter(f => f.rewatch);
    const liked = filteredFilms.filter(f => f.liked);

    // Ratings distribution (supports half-star ratings: 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5)
    const ratingsBuckets = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // 11 buckets for half-star ratings
    for (const f of rated) {
      // Convert rating to bucket index: 0 -> 0, 0.5 -> 1, 1 -> 2, 1.5 -> 3, etc.
      const bucketIndex = Math.round((f.rating ?? 0) * 2);
      if (bucketIndex >= 0 && bucketIndex <= 10) ratingsBuckets[bucketIndex] += 1;
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

    // Calculate total rewatch entries
    // A film marked as rewatch=true means the user has seen it before (at least once prior to this viewing)
    // - If rewatch=true and watchCount=1: This is a rewatch of a previously-watched film (count as 1 rewatch)
    // - If rewatch=true and watchCount>1: Multiple diary entries, all but first are rewatches
    // - If rewatch=false and watchCount>1: Multiple entries in diary (count watchCount-1 as rewatches)
    const totalRewatchEntries = filteredFilms.reduce((sum, f) => {
      const wc = f.watchCount ?? 0;
      if (f.rewatch) {
        // Film is marked as rewatch - count at least 1 rewatch, or more if multiple diary entries
        return sum + Math.max(1, wc - 1);
      } else if (wc > 1) {
        // Not marked as rewatch but has multiple diary entries - those are rewatches
        return sum + (wc - 1);
      }
      return sum;
    }, 0);


    // Most watched film
    const mostWatched = filteredFilms.reduce((max, f) =>
      (f.watchCount ?? 0) > (max.watchCount ?? 0) ? f : max
      , filteredFilms[0]);

    // === Hybrid Approach ===
    // 1. History & Metadata Stats: Calculated locally (fast, exact)
    // 2. Taste Profile: Taken from shared algorithm (consistent, weighted)

    // Calculate studio types locally (lightweight)
    const studioPreference = { indie: 0, major: 0, total: 0 };
    // Calculate metadata coverage locally (lightweight)
    let withPoster = 0, withBackdrop = 0, withOverview = 0, withTrailer = 0, withVotes = 0, withTmdbRating = 0;
    // Calculate consensus locally
    const consensusStats = { strong: 0, moderate: 0, weak: 0, missing: 0, total: 0, totalVotes: 0 };

    // Watchlist Recency
    const watchlistWithDates = watchlist.filter(f => f.watchlistAddedAt);
    const watchlistRecencyBuckets = { fresh: 0, warm: 0, cool: 0, stale: 0 };
    let totalWatchlistAgeDays = 0;
    const watchlistAges: number[] = [];

    // Helper for metadata stats
    for (const f of filteredFilms) {
      const tmdbId = filmMappings.get(f.uri);
      const details = tmdbId ? tmdbDetails.get(tmdbId) : null;

      // Studio analysis
      if (details?.production_companies) {
        const companies = details.production_companies;
        const isIndie = companies.some(c => ['A24', 'Neon', 'Annapurna', 'Searchlight', 'Focus'].some(n => c.name.includes(n)));
        const isMajor = companies.some(c => ['Universal', 'Warner', 'Disney', 'Paramount', 'Columbia', '20th Century'].some(n => c.name.includes(n)));
        if (isIndie) studioPreference.indie++;
        if (isMajor) studioPreference.major++;
        if (isIndie || isMajor) studioPreference.total++;
      }

      // Metadata stats
      if (details) {
        if (details.poster_path) withPoster++;
        if (details.backdrop_path) withBackdrop++;
        if (details.overview) withOverview++;
        // @ts-ignore
        if (details.videos?.results?.length > 0) withTrailer++;
        if ((details as any).vote_average > 0) withTmdbRating++;

        // Consensus Tracking
        const votes = (details as any).vote_count || 0;
        consensusStats.total++;
        consensusStats.totalVotes += votes;
        if (votes >= 200) consensusStats.strong++;
        else if (votes >= 50) consensusStats.moderate++;
        else if (votes > 0) consensusStats.weak++;
        else consensusStats.missing++;
      }
    }

    // Process watchlist recency
    const now = new Date();
    watchlistWithDates.forEach(f => {
      const date = new Date(f.watchlistAddedAt!);
      const ageDays = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
      totalWatchlistAgeDays += ageDays;
      watchlistAges.push(ageDays);
      if (ageDays < 90) watchlistRecencyBuckets.fresh++;
      else if (ageDays < 180) watchlistRecencyBuckets.warm++;
      else if (ageDays < 365) watchlistRecencyBuckets.cool++;
      else watchlistRecencyBuckets.stale++;
    });

    const metadataCoverage = {
      poster: withPoster / filteredFilms.length,
      backdrop: withBackdrop / filteredFilms.length,
      overview: withOverview / filteredFilms.length,
      trailer: withTrailer / filteredFilms.length,
      voteCount: withVotes / filteredFilms.length,
      tmdbRating: withTmdbRating / filteredFilms.length,
      total: filteredFilms.length
    };

    // If taste profile isn't ready, we can return null or partial
    if (!tasteProfileData) return null;

    // Disliked films count (Logic: <= 1.5 stars and not liked)
    const dislikedFilmsCount = filteredFilms.filter(f =>
      f.rating != null && f.rating <= 1.5 && !f.liked
    ).length;

    // Avoidance Overrides: Items that would be avoided but are on watchlist
    const avoidanceOverrides = {
      genres: tasteProfileData.avoidGenres
        .filter(g => tasteProfileData.watchlistGenres.some(wg => wg.name === g.name))
        .map(g => ({ ...g, watchlistCount: tasteProfileData.watchlistGenres.find(wg => wg.name === g.name)?.count || 0 })),
      keywords: tasteProfileData.avoidKeywords
        .filter(k => tasteProfileData.watchlistKeywords.some(wk => wk.name === k.name))
        .map(k => ({ ...k, watchlistCount: tasteProfileData.watchlistKeywords.find(wk => wk.name === k.name)?.count || 0 })),
      directors: tasteProfileData.avoidDirectors
        .filter(d => tasteProfileData.watchlistDirectors.some(wd => wd.name === d.name))
        .map(d => ({ ...d, watchlistCount: tasteProfileData.watchlistDirectors.find(wd => wd.name === d.name)?.count || 0 })),
    };

    return {
      totalWatches,
      watchHours: Math.round(filteredFilms.reduce((acc, f) => acc + ((f as any).runtime ?? 0), 0) / 60),
      ratingsBuckets,
      yearCounts,
      years,
      decadeCounts,
      decades,
      topYears: Array.from(byYear.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([y, c]) => ({ year: y, count: c })),
      totalRewatchEntries,
      mostWatched,

      // UI Usage Specs
      watchedCount: filteredFilms.length,
      absoluteFavorites: filteredFilms.filter(f => (f.rating === 5) || ((f.rating ?? 0) >= 4.5 && f.liked)).length,
      highlyRatedCount: filteredFilms.filter(f => f.rating != null && f.rating >= 4).length,
      lowRatedButLikedCount: filteredFilms.filter(f => f.rating != null && f.rating < 3 && f.liked).length,
      avgRating,
      rewatchedCount: rewatched.length,
      likedCount: liked.length,
      ratedCount: rated.length,
      watchlistCount: watchlist.length,

      // Mapped from Taste Profile
      topGenres: tasteProfileData.topGenres,
      topDirectors: tasteProfileData.topDirectors,
      topActors: tasteProfileData.topActors,
      topKeywords: tasteProfileData.topKeywords,
      topStudios: tasteProfileData.topStudios.map(s => [s.name, s.weight]),

      studioPreference,
      topDecades: tasteProfileData.topDecades.map(d => [`${d.decade}s`, d.weight]),

      dislikedFilmsCount,
      likedFilmsCount: tasteProfileData.tasteBins.liked,

      avoidedGenres: tasteProfileData.avoidGenres.map(g => g.name),
      avoidedKeywords: tasteProfileData.avoidKeywords.map(k => k.name),
      avoidedDirectors: tasteProfileData.avoidDirectors.map(d => d.name),

      mixedGenres: tasteProfileData.mixedGenres,
      mixedDirectors: tasteProfileData.mixedDirectors,
      mixedKeywords: tasteProfileData.mixedKeywords,

      topSubgenresList: tasteProfileData.topSubgenres,

      watchlistTopGenres: tasteProfileData.watchlistGenres,
      watchlistTopKeywords: tasteProfileData.watchlistKeywords,
      watchlistTopDirectors: tasteProfileData.watchlistDirectors,
      watchlistTopActors: [],

      avoidanceOverrides,

      metadataCoverage,
      consensus: consensusStats,

      watchlistRecencyBuckets,
      watchlistRecencyDays: watchlistAges,
      medianWatchlistAge: watchlistAges.length > 0 ? watchlistAges.sort((a, b) => a - b)[Math.floor(watchlistAges.length / 2)] : 0,
      avgWatchlistAge: watchlistAges.length > 0 ? totalWatchlistAgeDays / watchlistAges.length : 0,
      watchlistWithDatesCount: watchlistWithDates.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredFilms, tmdbDetails, films, filmMappings]);

  const feedbackAnalytics = useMemo(() => {
    if (!feedbackRows || feedbackRows.length === 0) return null;

    const positives = feedbackRows.filter(r => r.feedback_type === 'positive');
    const genreCounts = new Map<string, number>();
    const directorCounts = new Map<string, number>();
    const actorCounts = new Map<string, number>();
    const keywordCounts = new Map<string, number>();

    const addCount = (map: Map<string, number>, key?: string | null) => {
      if (!key) return;
      map.set(key, (map.get(key) ?? 0) + 1);
    };

    positives.forEach(row => {
      const features = (row as any).movie_features || {};
      (features.genres || []).forEach((g: any) => addCount(genreCounts, g?.name ?? g));
      (features.directors || []).forEach((d: any) => addCount(directorCounts, d?.name ?? d));
      (features.actors || []).forEach((a: any) => addCount(actorCounts, a?.name ?? a));
      (features.keywords || []).forEach((k: any) => addCount(keywordCounts, k?.name ?? k));
    });

    const totalGenreCounts = Array.from(genreCounts.values()).reduce((s, v) => s + v, 0);
    const topGenreCount = totalGenreCounts > 0 ? Math.max(...genreCounts.values()) : 0;

    return {
      positiveCount: positives.length,
      uniqueGenres: genreCounts.size,
      uniqueDirectors: directorCounts.size,
      uniqueActors: actorCounts.size,
      uniqueKeywords: keywordCounts.size,
      topGenreShare: totalGenreCounts > 0 ? topGenreCount / totalGenreCounts : 0,
    };
  }, [feedbackRows]);

  const regretStats = useMemo(() => {
    if (!feedbackRows || feedbackRows.length === 0 || tmdbToFilm.size === 0) return null;
    const negatives = feedbackRows.filter(r => r.feedback_type === 'negative');
    const regretCandidates = negatives.filter(r => tmdbToFilm.has(r.tmdb_id));
    const regrets = regretCandidates.filter(r => {
      const film = tmdbToFilm.get(r.tmdb_id);
      if (!film) return false;
      const rating = film.rating ?? 0;
      const liked = Boolean(film.liked);
      return liked || rating >= 3.5;
    });

    const examples = regrets.slice(0, 3).map(r => {
      const film = tmdbToFilm.get(r.tmdb_id);
      return film?.title || `TMDB ${r.tmdb_id}`;
    });

    return {
      regretCount: regrets.length,
      totalCandidates: regretCandidates.length,
      examples,
    };
  }, [feedbackRows, tmdbToFilm]);

  // Log taste profile build details for debugging
  useEffect(() => {
    if (!stats) return;

    console.log('=== TASTE PROFILE BUILD DEBUG ===');
    console.log('[TasteProfile] Input data:', {
      filteredFilmsCount: filteredFilms.length,
      tmdbDetailsCount: tmdbDetails.size,
      filmMappingsCount: filmMappings.size,
      mappingCoverage: mappingCoverage,
    });

    console.log('[TasteProfile] Genre Analysis:', {
      topGenres: stats.topGenres,
    });

    console.log('[TasteProfile] Directors:', {
      topDirectorsByWeight: stats.topDirectors,
      topDirectorsRaw: stats.topDirectors,
    });

    console.log('[TasteProfile] Actors:', {
      topActorsByWeight: stats.topActors,
      topActorsRaw: stats.topActors,
    });

    console.log('[TasteProfile] Keywords/Themes:', {
      topKeywords: stats.topKeywords,
    });

    console.log('[TasteProfile] Studios:', {
      topStudios: stats.topStudios,
      studioPreference: stats.studioPreference,
    });

    console.log('[TasteProfile] Era/Decade Preferences:', {
      topDecades: stats.topDecades,
    });

    console.log('[TasteProfile] Other Stats:', {
      avgRating: stats.avgRating,
      rewatchedCount: stats.rewatchedCount,
      likedCount: stats.likedCount,
      absoluteFavorites: stats.absoluteFavorites,

    });

    // Check if taste profile will show
    const willShowTasteProfile = stats.topGenres.length > 0;
    console.log('[TasteProfile] Will show Taste Profile section:', willShowTasteProfile);
    if (!willShowTasteProfile) {
      console.warn('[TasteProfile] ⚠️ Taste Profile will NOT show - no genre data!');
      console.warn('[TasteProfile] Possible causes:');
      console.warn('  1. TMDB enrichment failed (check for 401 errors)');
      console.warn('  2. No film_tmdb_map entries for user');
      console.warn('  3. tmdb_movies cache is empty');
    }
    console.log('=== END TASTE PROFILE DEBUG ===');
  }, [stats, filteredFilms.length, tmdbDetails.size, filmMappings.size, mappingCoverage]);

  if (loading || loadingDetails || (filteredFilms.length > 0 && !stats)) {
    return (
      <AuthGate>
        <h1 className="text-xl font-semibold mb-4">Stats</h1>
        <p className="text-gray-600">Loading your stats...</p>
      </AuthGate>
    );
  }

  if (detailsError) {
    return (
      <AuthGate>
        <h1 className="text-xl font-semibold mb-4">Stats</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-red-800 font-medium">Error loading data</p>
          <p className="text-xs text-red-600 mt-1">{detailsError}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
          >
            Retry
          </button>
        </div>
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
      data: stats.topGenres.map(({ name, count }) => ({ value: count, name })),
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

      {/* Metadata Quality Coverage (mirrors quality gates) */}
      {stats.metadataCoverage && stats.metadataCoverage.total > 0 && (
        <div className="bg-white border rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium text-gray-900 text-sm">Metadata Coverage</h3>
            <span className="text-xs text-gray-600">{stats.metadataCoverage.total} titles checked (watch history + watchlist)</span>
          </div>
          <p className="text-xs text-gray-600 mb-3">Quality gates downrank missing metadata; higher coverage = higher-confidence picks.</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-gray-700">
            <div className="flex items-center gap-1"><span className="w-24 text-gray-500">Posters</span><strong>{Math.round(stats.metadataCoverage.poster * 100)}%</strong></div>
            <div className="flex items-center gap-1"><span className="w-24 text-gray-500">Backdrops</span><strong>{Math.round(stats.metadataCoverage.backdrop * 100)}%</strong></div>
            <div className="flex items-center gap-1"><span className="w-24 text-gray-500">Overviews</span><strong>{Math.round(stats.metadataCoverage.overview * 100)}%</strong></div>
            <div className="flex items-center gap-1"><span className="w-24 text-gray-500">Trailers</span><strong>{Math.round(stats.metadataCoverage.trailer * 100)}%</strong></div>
            <div className="flex items-center gap-1"><span className="w-24 text-gray-500">Votes ≥50</span><strong>{Math.round(stats.metadataCoverage.voteCount * 100)}%</strong></div>
            <div className="flex items-center gap-1"><span className="w-24 text-gray-500">Rating ≥6.0</span><strong>{Math.round(stats.metadataCoverage.tmdbRating * 100)}%</strong></div>
          </div>
        </div>
      )}

      {/* Consensus Strength (score confidence) */}
      {stats.consensus && stats.consensus.total > 0 && (
        <div className="bg-white border rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium text-gray-900 text-sm">Consensus Strength</h3>
            <span className="text-xs text-gray-600">{stats.consensus.total} titles (watch history + watchlist)</span>
          </div>
          <p className="text-xs text-gray-600 mb-3">Higher vote counts = steadier ratings; we soften quality penalties when consensus is strong.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-700">
            <div className="flex items-center gap-1"><span className="w-28 text-gray-500">Strong (200+ votes)</span><strong>{Math.round(stats.consensus.strong / stats.consensus.total * 100)}%</strong></div>
            <div className="flex items-center gap-1"><span className="w-28 text-gray-500">Moderate (50-199)</span><strong>{Math.round(stats.consensus.moderate / stats.consensus.total * 100)}%</strong></div>
            <div className="flex items-center gap-1"><span className="w-28 text-gray-500">Weak (&lt;50)</span><strong>{Math.round(stats.consensus.weak / stats.consensus.total * 100)}%</strong></div>
            <div className="flex items-center gap-1"><span className="w-28 text-gray-500">Missing</span><strong>{Math.round(stats.consensus.missing / stats.consensus.total * 100)}%</strong></div>
          </div>
          {stats.consensus.totalVotes > 0 && (
            <div className="text-xs text-gray-600 mt-2">Avg vote count: {Math.round(stats.consensus.totalVotes / stats.consensus.total)} </div>
          )}
        </div>
      )}

      {/* Enrichment Warning - show if less than 50% of films are mapped */}
      {mappingCoverage && mappingCoverage.mapped < mappingCoverage.total * 0.5 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <span className="text-xl">⚠️</span>
            <div>
              <h3 className="font-medium text-amber-800">Incomplete Film Enrichment</h3>
              <p className="text-sm text-amber-700 mt-1">
                Only {mappingCoverage.mapped} of {mappingCoverage.total} films ({Math.round(mappingCoverage.mapped / mappingCoverage.total * 100)}%)
                have TMDB data. This affects Taste Profile, Suggestions, and detailed stats.
              </p>
              <p className="text-sm text-amber-700 mt-1">
                <a href="/import" className="underline font-medium">Re-import your data</a> to complete enrichment and unlock full features.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Taste Profile - Weighted Preferences (Powers Suggestions) */}
      {!loadingDetails && stats.topGenres.length > 0 && (
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
                {stats.topGenres.slice(0, 8).map(({ name: genre, weight }) => {
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
            {stats.topKeywords.length > 0 && (
              <div className="mb-4">
                <h3 className="font-medium text-gray-900 mb-2 text-sm">Top Themes & Keywords (Weighted)</h3>
                <div className="flex flex-wrap gap-2">
                  {stats.topKeywords.slice(0, 12).map(({ name: keyword, weight }) => {
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
            )}

            {/* Top Directors by Weight */}
            {stats.topDirectors.length > 0 && (
              <div className="mb-4">
                <h3 className="font-medium text-gray-900 mb-2 text-sm">Favorite Directors (Weighted by Ratings)</h3>
                <div className="flex flex-wrap gap-2">
                  {stats.topDirectors.map(({ name, weight, count }) => (
                    <span key={name} className="px-3 py-1 rounded-full text-xs font-medium bg-blue-500 text-white">
                      {name} ({weight.toFixed(1)} across {count} films)
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Top Actors by Weight */}
            {stats.topActors.length > 0 && (
              <div className="mb-4">
                <h3 className="font-medium text-gray-900 mb-2 text-sm">Favorite Actors (Weighted by Ratings)</h3>
                <div className="flex flex-wrap gap-2">
                  {stats.topActors.map(({ name, weight, count }) => (
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
                  {stats.topStudios.slice(0, 10).map((entry) => {
                    const [studio, weight] = entry as [string, number];
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
                  {stats.topDecades.map((entry) => {
                    const [decade, weight] = entry as [string, number];
                    const percentage = (weight / (stats.topDecades[0][1] as number)) * 100;
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
                {stats.topActors.map(({ name, ...data }) => (
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
                {stats.topDirectors.map(({ name, ...data }) => (
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

          {stats.topSubgenresList && stats.topSubgenresList.length > 0 && (
            <div className="bg-white border rounded-lg p-4 mb-6">
              <h2 className="font-semibold text-gray-900 mb-3">Top Specific Interests (Sub-genres)</h2>
              <p className="text-sm text-gray-500 mb-3">
                Identified from your viewing patterns using TMDB keywords and genres.
              </p>
              <div className="flex flex-wrap gap-2">
                {stats.topSubgenresList.map(item => {
                  const name = item.name.replace(/^[A-Z]+_/, '').replace(/_/g, ' ').toLowerCase();
                  return (
                    <div key={item.name} className="bg-indigo-50 border border-indigo-100 rounded px-3 py-2 flex flex-col min-w-[120px]">
                      <span className="font-medium text-indigo-900 capitalize text-sm">{name}</span>
                      <span className="text-xs text-indigo-600 mt-1">{item.count} watched</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Algorithm Insights Section - Phase 5+ Transparency */}
      {stats && (
        <div className="bg-white border rounded-lg p-4 mb-6">
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
                {stats.totalRewatchEntries && stats.totalWatches ?
                  ((stats.totalRewatchEntries / stats.totalWatches) * 100).toFixed(1) : '0.0'}%
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

            {feedbackSummary && feedbackSummary.total > 0 && (
              <div className="bg-blue-50 rounded p-3">
                <div className="text-sm text-gray-600">Suggestion Hit Rate</div>
                <div className="text-2xl font-bold text-gray-900">
                  {(feedbackSummary.hitRate * 100).toFixed(0)}%
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {feedbackSummary.positive} 👍 vs {feedbackSummary.negative} 👎 ({feedbackSummary.total} feedback)
                  <br />Per-source reliability below once enough samples exist.
                </div>
              </div>
            )}
          </div>

          {consensusAcceptance && (consensusAcceptance.high.total + consensusAcceptance.medium.total + consensusAcceptance.low.total) > 0 && (
            <div className="bg-white border rounded p-3 mt-3">
              <div className="text-sm font-medium text-gray-900 mb-2">Consensus Calibration</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-gray-700">
                {(['high', 'medium', 'low'] as const).map(level => {
                  const bucket = consensusAcceptance[level];
                  const rate = bucket.total > 0 ? (bucket.pos / bucket.total) * 100 : null;
                  const label = level === 'high' ? 'High (3+ sources)' : level === 'medium' ? 'Medium (2 sources)' : 'Low (1 source)';
                  return (
                    <div key={level} className="bg-gray-50 px-2 py-2 rounded">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-800">{label}</span>
                        <span className="text-gray-500">{bucket.total} fb</span>
                      </div>
                      <div className="text-gray-800 mt-1">{rate != null ? `${rate.toFixed(0)}% (${bucket.pos}/${bucket.total})` : '—'}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {sourceReliability.length > 0 && (
            <div className="bg-white border rounded p-3 mt-3">
              <div className="text-sm font-medium text-gray-900 mb-2">Per-Source Reliability (min 3 samples)</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-xs text-gray-700">
                {sourceReliability.map(entry => (
                  <div key={entry.source} className="flex items-center justify-between bg-gray-50 px-2 py-1 rounded">
                    <span className="font-medium text-gray-800">{entry.source}</span>
                    <span className="text-gray-600">{(entry.hitRate * 100).toFixed(0)}% ({entry.positive}/{entry.total})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sourceReliabilityRecent.length > 0 && (
            <div className="bg-white border rounded p-3 mt-3">
              <div className="text-sm font-medium text-gray-900 mb-2">Per-Source Reliability (Last 90d, min 3 samples)</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-xs text-gray-700">
                {sourceReliabilityRecent.map(entry => (
                  <div key={entry.source} className="flex items-center justify-between bg-gray-50 px-2 py-1 rounded">
                    <span className="font-medium text-gray-800">{entry.source}</span>
                    <span className="text-gray-600">{(entry.hitRate * 100).toFixed(0)}% ({entry.positive}/{entry.total})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {reasonAcceptance.length > 0 && (
            <div className="bg-white border rounded p-3 mt-3">
              <div className="text-sm font-medium text-gray-900 mb-2">Acceptance by Reason Type (min 5 samples)</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-xs text-gray-700">
                {reasonAcceptance.map(entry => (
                  <div key={entry.reason} className="flex items-center justify-between bg-gray-50 px-2 py-1 rounded">
                    <span className="font-medium text-gray-800">{entry.reason}</span>
                    <span className="text-gray-600">{(entry.hitRate * 100).toFixed(0)}% ({entry.positive}/{entry.total})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {feedbackAnalytics && feedbackAnalytics.positiveCount >= 3 && (
            <div className="bg-white border rounded p-3 mt-3">
              <div className="text-sm font-medium text-gray-900 mb-2">Diversity of Accepted Suggestions</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-gray-700">
                <div className="bg-gray-50 px-2 py-2 rounded">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-800">Genres</span>
                    <span className="text-gray-500">{feedbackAnalytics.uniqueGenres} unique</span>
                  </div>
                  <div className="text-gray-800 mt-1">Top genre share: {(feedbackAnalytics.topGenreShare * 100).toFixed(0)}%</div>
                </div>
                <div className="bg-gray-50 px-2 py-2 rounded">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-800">Directors</span>
                    <span className="text-gray-500">{feedbackAnalytics.uniqueDirectors} unique</span>
                  </div>
                  <div className="text-gray-800 mt-1">Actors: {feedbackAnalytics.uniqueActors} | Keywords: {feedbackAnalytics.uniqueKeywords}</div>
                </div>
                <div className="bg-gray-50 px-2 py-2 rounded">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-800">Accepted Titles</span>
                    <span className="text-gray-500">{feedbackAnalytics.positiveCount} total</span>
                  </div>
                  <div className="text-gray-800 mt-1">Higher spread = better novelty balance</div>
                </div>
              </div>
            </div>
          )}

          {regretStats && regretStats.totalCandidates > 0 && (
            <div className="bg-white border rounded p-3 mt-3">
              <div className="text-sm font-medium text-gray-900 mb-2">Regret Recovery</div>
              <div className="text-xs text-gray-700">
                <div className="flex items-center justify-between mb-1">
                  <span>Dismissed then later liked/watched</span>
                  <span className="font-medium text-gray-800">{regretStats.regretCount}/{regretStats.totalCandidates}</span>
                </div>
                {regretStats.examples.length > 0 && (
                  <div className="text-gray-600">Examples: {regretStats.examples.join(', ')}</div>
                )}
              </div>
            </div>
          )}

          {sourceConsensus.length > 0 && (
            <div className="bg-white border rounded p-3 mt-3">
              <div className="text-sm font-medium text-gray-900 mb-2">Per-Source by Consensus</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-xs text-gray-700">
                {sourceConsensus.map(entry => {
                  const highRate = entry.high.total > 0 ? entry.high.pos / entry.high.total : null;
                  const medRate = entry.medium.total > 0 ? entry.medium.pos / entry.medium.total : null;
                  const lowRate = entry.low.total > 0 ? entry.low.pos / entry.low.total : null;
                  return (
                    <div key={entry.source} className="bg-gray-50 px-2 py-2 rounded space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-800">{entry.source}</span>
                        <span className="text-gray-500">{entry.high.total + entry.medium.total + entry.low.total} fb</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">High</span>
                        <span className="text-gray-800">{highRate != null ? `${(highRate * 100).toFixed(0)}% (${entry.high.pos}/${entry.high.total})` : '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Medium</span>
                        <span className="text-gray-800">{medRate != null ? `${(medRate * 100).toFixed(0)}% (${entry.medium.pos}/${entry.medium.total})` : '—'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Low</span>
                        <span className="text-gray-800">{lowRate != null ? `${(lowRate * 100).toFixed(0)}% (${entry.low.pos}/${entry.low.total})` : '—'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Watchlist Analysis Section - What the user WANTS to see */}
      {stats && !loadingDetails && stats.watchlistCount > 0 && (stats.watchlistTopGenres?.length > 0 || stats.watchlistTopDirectors?.length > 0) && (
        <div className="bg-gradient-to-r from-cyan-50 to-blue-50 dark:from-cyan-950/30 dark:to-blue-950/30 border border-cyan-200 dark:border-cyan-800 rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-lg">📋 What You Want to Watch</h2>
            <span className="text-xs text-cyan-700 dark:text-cyan-300 bg-cyan-100 dark:bg-cyan-900/40 px-2 py-1 rounded">{stats.watchlistCount} films on watchlist</span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Your watchlist shows what you&apos;re interested in — this signals positive intent to the recommendation algorithm.
          </p>

          {/* Avoidance Overrides - items on watchlist that would otherwise be avoided */}
          {stats.avoidanceOverrides && (stats.avoidanceOverrides.genres.length > 0 || stats.avoidanceOverrides.keywords.length > 0 || stats.avoidanceOverrides.directors.length > 0) && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
              <h3 className="font-medium text-green-900 mb-2 text-sm flex items-center gap-2">
                ✓ Avoidance Overrides
              </h3>
              <p className="text-xs text-green-700 mb-3">
                These would be avoided based on ratings, but your watchlist shows interest — they won&apos;t be filtered out:
              </p>

              {stats.avoidanceOverrides.genres.length > 0 && (
                <div className="mb-2">
                  <span className="text-xs font-medium text-green-800">Genres: </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {stats.avoidanceOverrides.genres.map(({ name, watchlistCount }) => (
                      <span key={name} className="px-2 py-0.5 rounded-full text-xs bg-green-200 text-green-800">
                        {name} <span className="text-green-600">({watchlistCount} on watchlist)</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {stats.avoidanceOverrides.directors.length > 0 && (
                <div className="mb-2">
                  <span className="text-xs font-medium text-green-800">Directors: </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {stats.avoidanceOverrides.directors.map(({ name, watchlistCount }) => (
                      <span key={name} className="px-2 py-0.5 rounded-full text-xs bg-blue-200 text-blue-800">
                        {name} <span className="text-blue-600">({watchlistCount} on watchlist)</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {stats.avoidanceOverrides.keywords.length > 0 && (
                <div>
                  <span className="text-xs font-medium text-green-800">Themes: </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {stats.avoidanceOverrides.keywords.slice(0, 8).map(({ name, watchlistCount }) => (
                      <span key={name} className="px-2 py-0.5 rounded-full text-xs bg-emerald-200 text-emerald-800">
                        {name} ({watchlistCount} on watchlist)
                      </span>
                    ))}
                    {stats.avoidanceOverrides.keywords.length > 8 && (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-gray-200 text-gray-600">
                        +{stats.avoidanceOverrides.keywords.length - 8} more
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Watchlist recency/intent strength */}
            {stats.watchlistWithDatesCount > 0 && (
              <div className="bg-white rounded-lg p-4 border border-cyan-100">
                <h3 className="font-medium text-gray-900 mb-2 text-sm">Watchlist Momentum</h3>
                <p className="text-xs text-gray-600 mb-3">Recency-weighted intent (newer entries boost suggestions more)</p>
                <div className="flex flex-wrap gap-1 mb-2">
                  <span className="px-2 py-1 rounded text-xs bg-emerald-100 text-emerald-700">Fresh ≤90d: {stats.watchlistRecencyBuckets.fresh}</span>
                  <span className="px-2 py-1 rounded text-xs bg-blue-100 text-blue-700">Warm 91-180d: {stats.watchlistRecencyBuckets.warm}</span>
                  <span className="px-2 py-1 rounded text-xs bg-indigo-100 text-indigo-700">Cooling 181-365d: {stats.watchlistRecencyBuckets.cool}</span>
                  <span className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-700">Stale 366d+: {stats.watchlistRecencyBuckets.stale}</span>
                </div>
                {(stats.medianWatchlistAge != null || stats.avgWatchlistAge != null) && (
                  <div className="text-xs text-gray-700 space-y-1">
                    {stats.medianWatchlistAge != null && (
                      <div>Median age: {Math.round(stats.medianWatchlistAge)} days</div>
                    )}
                    {stats.avgWatchlistAge != null && (
                      <div>Average age: {Math.round(stats.avgWatchlistAge)} days</div>
                    )}
                    <div className="text-gray-500">{stats.watchlistWithDatesCount} with saved add dates</div>
                  </div>
                )}
              </div>
            )}

            {/* Watchlist Genres */}
            {stats.watchlistTopGenres && stats.watchlistTopGenres.length > 0 && (
              <div className="bg-white rounded-lg p-4 border border-cyan-100">
                <h3 className="font-medium text-gray-900 mb-2 text-sm">Genres You Want</h3>
                <div className="flex flex-wrap gap-1">
                  {stats.watchlistTopGenres.slice(0, 8).map(({ name, count }) => (
                    <span key={name} className="px-2 py-1 rounded text-xs bg-cyan-100 text-cyan-700">
                      {name} ({count})
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Watchlist Directors */}
            {stats.watchlistTopDirectors && stats.watchlistTopDirectors.length > 0 && (
              <div className="bg-white rounded-lg p-4 border border-cyan-100">
                <h3 className="font-medium text-gray-900 mb-2 text-sm">Directors You Want</h3>
                <div className="space-y-1">
                  {stats.watchlistTopDirectors.slice(0, 6).map(({ name, count }) => (
                    <div key={name} className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">{name}</span>
                      <span className="text-xs text-cyan-600">{count} films</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Watchlist Actors */}
            {stats.watchlistTopActors && stats.watchlistTopActors.length > 0 && (
              <div className="bg-white rounded-lg p-4 border border-cyan-100">
                <h3 className="font-medium text-gray-900 mb-2 text-sm">Actors You Want</h3>
                <div className="space-y-1">
                  {stats.watchlistTopActors.slice(0, 6).map(({ name, count }) => (
                    <div key={name} className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">{name}</span>
                      <span className="text-xs text-cyan-600">{count} films</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Watchlist Keywords */}
            {stats.watchlistTopKeywords && stats.watchlistTopKeywords.length > 0 && (
              <div className="bg-white rounded-lg p-4 border border-cyan-100">
                <h3 className="font-medium text-gray-900 mb-2 text-sm">Themes You Want</h3>
                <div className="flex flex-wrap gap-1">
                  {stats.watchlistTopKeywords.slice(0, 10).map(({ name, count }) => (
                    <span key={name} className="px-2 py-1 rounded text-xs bg-blue-100 text-blue-700">
                      {name} ({count})
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <p className="text-xs text-gray-500 mt-4">
            💡 Your watchlist helps discover what you want — these patterns boost matching recommendations and can override negative signals.
          </p>
        </div>
      )}

      {/* Avoidance Profile Section - What we're filtering out */}
      {stats && !loadingDetails && (stats.avoidedGenres?.length > 0 || stats.avoidedKeywords?.length > 0 || stats.avoidedDirectors?.length > 0 || stats.mixedGenres?.length > 0 || stats.mixedKeywords?.length > 0 || stats.mixedDirectors?.length > 0) && (
        <div className="bg-gradient-to-r from-red-50 to-orange-50 dark:from-red-950/30 dark:to-orange-950/30 border border-red-200 dark:border-red-800 rounded-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-lg">🚫 Avoidance Profile</h2>
            <span className="text-xs text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40 px-2 py-1 rounded">Filters Suggestions</span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            Comparing {stats.likedFilmsCount} liked films (3+ stars or ❤️) vs {stats.dislikedFilmsCount} disliked films (≤1.5 stars).
            <strong> Only avoided if you dislike 60%+ of films with that attribute.</strong>
            <br />
            <span className="text-xs text-gray-500">Note: Films rated 2-2.5 stars are &quot;meh&quot; (neutral) and don&apos;t count as dislikes. Unrated films are also neutral.</span>
          </p>

          {/* Mixed Feelings Section - Things user has mixed feelings about */}
          {((stats.mixedGenres && stats.mixedGenres.length > 0) ||
            (stats.mixedDirectors && stats.mixedDirectors.length > 0) ||
            (stats.mixedKeywords && stats.mixedKeywords.length > 0)) && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                <h3 className="font-medium text-green-900 mb-2 text-sm flex items-center gap-2">
                  ✓ Mixed Feelings (Not Avoided)
                </h3>
                <p className="text-xs text-green-700 mb-3">
                  You&apos;ve disliked some films with these, but you&apos;ve liked MORE — so they&apos;re not avoided:
                </p>

                {/* Mixed Genres */}
                {stats.mixedGenres && stats.mixedGenres.length > 0 && (
                  <div className="mb-2">
                    <span className="text-xs font-medium text-green-800">Genres: </span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {stats.mixedGenres.map(({ name, liked, disliked }) => (
                        <span key={name} className="px-2 py-0.5 rounded-full text-xs bg-green-200 text-green-800">
                          {name} <span className="text-green-600">({liked}👍 vs {disliked}👎)</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Mixed Directors */}
                {stats.mixedDirectors && stats.mixedDirectors.length > 0 && (
                  <div className="mb-2">
                    <span className="text-xs font-medium text-green-800">Directors: </span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {stats.mixedDirectors.map(({ name, liked, disliked }) => (
                        <span key={name} className="px-2 py-0.5 rounded-full text-xs bg-blue-200 text-blue-800">
                          {name} <span className="text-blue-600">({liked}👍 vs {disliked}👎)</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Mixed Keywords */}
                {stats.mixedKeywords && stats.mixedKeywords.length > 0 && (
                  <div>
                    <span className="text-xs font-medium text-green-800">Themes: </span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {stats.mixedKeywords.slice(0, 10).map(({ name, liked, disliked }) => (
                        <span key={name} className="px-2 py-0.5 rounded-full text-xs bg-emerald-200 text-emerald-800">
                          {name} ({liked}👍 vs {disliked}👎)
                        </span>
                      ))}
                      {stats.mixedKeywords.length > 10 && (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-gray-200 text-gray-600">
                          +{stats.mixedKeywords.length - 10} more
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

          <div className="grid md:grid-cols-3 gap-4">
            {/* Avoided Genres */}
            <div className="bg-white rounded-lg p-4 border border-red-100">
              <h3 className="font-medium text-gray-900 mb-2 text-sm">Avoided Genres</h3>
              <p className="text-xs text-gray-500 mb-3">60%+ dislike rate required</p>
              {stats.avoidedGenres && stats.avoidedGenres.length > 0 ? (
                <div className="space-y-2">
                  {stats.avoidedGenres.map((name) => (
                    <div key={name} className="flex items-center justify-between">
                      <span className="text-sm text-red-700">{name}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">No genres being avoided</p>
              )}
            </div>

            {/* Avoided Keywords/Themes */}
            <div className="bg-white rounded-lg p-4 border border-red-100">
              <h3 className="font-medium text-gray-900 mb-2 text-sm">Avoided Themes</h3>
              <p className="text-xs text-gray-500 mb-3">60%+ dislike rate required</p>
              {stats.avoidedKeywords && stats.avoidedKeywords.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {stats.avoidedKeywords.map((name) => (
                    <span key={name} className="px-2 py-1 rounded text-xs bg-red-100 text-red-700">
                      {name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">No themes being avoided</p>
              )}
            </div>

            {/* Avoided Directors */}
            <div className="bg-white rounded-lg p-4 border border-red-100">
              <h3 className="font-medium text-gray-900 mb-2 text-sm">Avoided Directors</h3>
              <p className="text-xs text-gray-500 mb-3">60%+ dislike rate required</p>
              {stats.avoidedDirectors && stats.avoidedDirectors.length > 0 ? (
                <div className="space-y-2">
                  {stats.avoidedDirectors.map((name) => (
                    <div key={name} className="flex items-center justify-between">
                      <span className="text-sm text-red-700">{name}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">No directors being avoided</p>
              )}
            </div>
          </div>

          <p className="text-xs text-gray-500 mt-4">
            💡 &quot;Disliked&quot; = rated ≤1.5 stars. Films rated 2+ stars are not considered dislikes.
            &quot;Guilty pleasures&quot; (low-rated but ❤️ liked) don&apos;t count as dislikes either.
            Films just logged without a rating are neutral.
          </p>
        </div>
      )}

      {/* Discovery Preferences Section - Phase 5+ Adaptive Learning */}
      {explorationStats && (
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/30 border border-indigo-200 dark:border-indigo-800 rounded-lg p-4 mb-6">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
            🔍 Your Discovery Preferences
            <span className="text-xs text-indigo-600 dark:text-indigo-300 font-normal">
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
              will be &quot;discovery picks&quot; from adjacent genres or acclaimed films outside your usual taste.
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

      {/* Pairwise Learning Section */}
      {pairwiseStats && pairwiseStats.total_comparisons > 0 && (
        <div className="bg-gradient-to-r from-violet-50 to-fuchsia-50 dark:from-violet-950/30 dark:to-fuchsia-950/30 border border-violet-200 dark:border-violet-800 rounded-lg p-4 mb-6">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
            ⚖️ Pairwise Learning Stats
            <span className="text-xs text-violet-600 dark:text-violet-300 font-normal">
              (Your Head-to-Head Choices)
            </span>
          </h2>

          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            When you choose between two similar films, the algorithm learns your subtle preferences.
            These comparisons help refine recommendations by understanding which features matter most to you.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <div className="bg-white dark:bg-gray-800 rounded p-3 border border-violet-100 dark:border-violet-900">
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Total Comparisons</div>
              <div className="text-2xl font-bold text-violet-700 dark:text-violet-400">
                {pairwiseStats.total_comparisons}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                All-time choices made
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded p-3 border border-violet-100 dark:border-violet-900">
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Recent Activity</div>
              <div className="text-lg font-bold text-violet-700 dark:text-violet-400">
                {pairwiseStats.recent_30d} <span className="text-sm font-normal text-gray-600 dark:text-gray-400">last 30d</span>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {pairwiseStats.recent_90d} in last 90 days
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded p-3 border border-violet-100 dark:border-violet-900">
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Learning Signal</div>
              <div className="text-xs text-gray-700 dark:text-gray-300 space-y-1">
                <div className="flex items-center justify-between">
                  <span>High consensus wins</span>
                  <span className="font-medium text-green-700 dark:text-green-400">{pairwiseStats.high_consensus_wins}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Medium consensus wins</span>
                  <span className="font-medium text-yellow-700 dark:text-yellow-400">{pairwiseStats.medium_consensus_wins}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Low consensus wins</span>
                  <span className="font-medium text-orange-700 dark:text-orange-400">{pairwiseStats.low_consensus_wins}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded p-3 border border-violet-100 dark:border-violet-900">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
              How Pairwise Learning Works
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
              <div>• <strong>Consensus level</strong> shows how many sources agreed on each film (high = 3+ sources, medium = 2, low = 1)</div>
              <div>• When you pick a film, the algorithm learns that its <strong>specific features</strong> (genre, actors, themes, year) were more appealing</div>
              <div>• These micro-preferences accumulate to fine-tune your taste profile beyond simple ratings</div>
              <div>• Choices between high-consensus films teach the algorithm about quality thresholds</div>
              <div>• Choices between low-consensus films reveal your openness to niche/exploratory picks</div>
            </div>
          </div>

          <div className="text-xs text-gray-500 dark:text-gray-400 bg-violet-50 dark:bg-violet-950/30 rounded p-2 mt-3">
            💡 <strong>Tip:</strong> The more comparisons you make, the better the algorithm understands your nuanced preferences.
            Try the pairwise comparison feature on the Suggestions page to help refine your recommendations!
          </div>
        </div>
      )}

      {/* Repeat-Suggestion Tracking */}
      {repeatSuggestionStats && repeatSuggestionStats.totalExposures > 0 && (
        <div className="bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-950/30 dark:to-cyan-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
            🔄 Suggestion Diversity
            <span className="text-xs text-blue-600 dark:text-blue-300 font-normal">
              (Last 30 Days)
            </span>
          </h2>

          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            This tracks how often you see the same suggestions, helping ensure fresh recommendations.
            Lower repeat rates mean you&apos;re getting more variety.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-white dark:bg-gray-800 rounded p-3 border border-blue-100 dark:border-blue-900">
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Total Exposures</div>
              <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">
                {repeatSuggestionStats.totalExposures}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Suggestions shown
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded p-3 border border-blue-100 dark:border-blue-900">
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Unique Films</div>
              <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">
                {repeatSuggestionStats.uniqueSuggestions}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Different titles
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded p-3 border border-blue-100 dark:border-blue-900">
              <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Repeat Rate</div>
              <div className={`text-2xl font-bold ${repeatSuggestionStats.repeatRate < 0.1 ? 'text-green-700 dark:text-green-400' :
                repeatSuggestionStats.repeatRate < 0.2 ? 'text-yellow-700 dark:text-yellow-400' :
                  'text-orange-700 dark:text-orange-400'
                }`}>
                {(repeatSuggestionStats.repeatRate * 100).toFixed(1)}%
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {repeatSuggestionStats.avgTimeBetweenRepeats !== null && (
                  <>Avg {repeatSuggestionStats.avgTimeBetweenRepeats.toFixed(1)} days between</>
                )}
              </div>
            </div>
          </div>

          <div className="text-xs text-gray-500 dark:text-gray-400 bg-blue-50 dark:bg-blue-950/30 rounded p-2 mt-3">
            💡 <strong>Note:</strong> A repeat rate under 15% is ideal. If you&apos;re seeing the same suggestions too often,
            try adjusting the Discovery slider or exploring different categories.
          </div>
        </div>
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
