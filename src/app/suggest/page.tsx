'use client';
import AuthGate from '@/components/AuthGate';
import MovieCard from '@/components/MovieCard';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useImportData } from '@/lib/importStore';
import { supabase } from '@/lib/supabaseClient';
import { getFilmMappings, refreshTmdbCacheForIds, suggestByOverlap, buildTasteProfile, findIncompleteCollections, discoverFromLists } from '@/lib/enrich';
import { fetchTrendingIds, fetchSimilarMovieIds, generateSmartCandidates } from '@/lib/trending';
import { usePostersSWR } from '@/lib/usePostersSWR';
import type { FilmEvent } from '@/lib/normalize';

type MovieItem = {
  id: number;
  title: string;
  year?: string;
  reasons: string[];
  poster_path?: string | null;
  score: number;
  trailerKey?: string | null;
  voteCategory?: 'hidden-gem' | 'crowd-pleaser' | 'cult-classic' | 'standard';
  collectionName?: string;
};

export default function SuggestPage() {
  const { films, loading: loadingFilms } = useImportData();
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<MovieItem[] | null>(null);
  const [sourceLabel, setSourceLabel] = useState<string>('');
  const [fallbackFilms, setFallbackFilms] = useState<FilmEvent[] | null>(null);
  const [watchlistTmdbIds, setWatchlistTmdbIds] = useState<Set<number>>(new Set());
  const [excludeGenres, setExcludeGenres] = useState<string>('');
  const [yearMin, setYearMin] = useState<string>('');
  const [yearMax, setYearMax] = useState<string>('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [mode, setMode] = useState<'quick' | 'deep'>('quick');
  const [noCandidatesReason, setNoCandidatesReason] = useState<string | null>(null);

  // Get posters for all suggested movies
  const tmdbIds = useMemo(() => items?.map((it) => it.id) ?? [], [items]);
  const { posters, mutate: refreshPosters } = usePostersSWR(tmdbIds);

  // Categorize suggestions into sections
  const categorizedSuggestions = useMemo(() => {
    if (!items || items.length === 0) return null;

    const currentYear = new Date().getFullYear();
    
    // Helper functions to check reason types
    const hasDirectorMatch = (reasons: string[]) => 
      reasons.some(r => r.toLowerCase().includes('directed by') || r.toLowerCase().includes('director'));
    
    const hasActorMatch = (reasons: string[]) =>
      reasons.some(r => r.toLowerCase().includes('starring') || r.toLowerCase().includes('cast') || r.toLowerCase().includes('actor'));
    
    const hasGenreMatch = (reasons: string[]) =>
      reasons.some(r => r.toLowerCase().includes('genre:') || r.toLowerCase().includes('similar genre'));
    
    const hasDeepCutThemes = (reasons: string[]) =>
      reasons.some(r => r.toLowerCase().includes('themes you') || r.toLowerCase().includes('specific themes') || r.toLowerCase().includes('keyword:'));

    // Sort all by score first
    const sorted = [...items].sort((a, b) => b.score - a.score);
    
    // Track used IDs to prevent duplicates across sections
    const usedIds = new Set<number>();
    
    // Helper to get next N unused items matching a filter
    const getNextItems = (filter: (item: MovieItem) => boolean, count: number): MovieItem[] => {
      const results: MovieItem[] = [];
      for (const item of sorted) {
        if (usedIds.has(item.id)) continue;
        if (filter(item)) {
          results.push(item);
          usedIds.add(item.id);
          if (results.length >= count) break;
        }
      }
      return results;
    };

    // 1. Perfect Matches: Top 6 highest scoring films
    const perfectMatches = getNextItems(() => true, 6);

    // 2. From Directors You Love: Films with director matches
    const directorMatches = getNextItems(item => hasDirectorMatch(item.reasons), 6);

    // 3. From Actors You Love: Films with cast matches
    const actorMatches = getNextItems(item => hasActorMatch(item.reasons), 6);

    // 4. Your Favorite Genres: Films matching preferred genres
    const genreMatches = getNextItems(item => hasGenreMatch(item.reasons), 6);

    // 5. Hidden Gems: Pre-2015 films with high scores but low recognition
    const hiddenGems = getNextItems(item => {
      const year = parseInt(item.year || '0');
      return year > 0 && year < 2015 && item.voteCategory === 'hidden-gem';
    }, 6);

    // 6. Cult Classics: Films with cult following
    const cultClassics = getNextItems(item => {
      return item.voteCategory === 'cult-classic';
    }, 6);

    // 7. Crowd Pleasers: Popular high-rated films
    const crowdPleasers = getNextItems(item => {
      return item.voteCategory === 'crowd-pleaser';
    }, 6);

    // 8. New & Trending: Recent releases (2023+)
    const newReleases = getNextItems(item => {
      const year = parseInt(item.year || '0');
      return year >= 2023;
    }, 6);

    // 9. Recent Classics: Films from 2015-2022
    const recentClassics = getNextItems(item => {
      const year = parseInt(item.year || '0');
      return year >= 2015 && year < 2023;
    }, 6);

    // 10. Deep Cuts: Films with specific theme/keyword matches
    const deepCuts = getNextItems(item => hasDeepCutThemes(item.reasons), 6);

    // 11. From Collections: Films in same collections/franchises
    const fromCollections = getNextItems(item => !!item.collectionName, 6);
    
    // 12. Fallback: More recommendations (any remaining films)
    const moreRecommendations = getNextItems(() => true, 12);

    return {
      perfectMatches,
      directorMatches,
      actorMatches,
      genreMatches,
      hiddenGems,
      cultClassics,
      crowdPleasers,
      newReleases,
      recentClassics,
      deepCuts,
      fromCollections,
      moreRecommendations
    };
  }, [items]);

  useEffect(() => {
    const init = async () => {
      if (!supabase) return;
      const { data } = await supabase.auth.getSession();
      setUid(data.session?.user?.id ?? null);
    };
    void init();
  }, []);

  const sourceFilms = useMemo(() => (films && films.length ? films : (fallbackFilms ?? [])), [films, fallbackFilms]);

  const runSuggest = useCallback(async () => {
    try {
      console.log('[Suggest] runSuggest start', { uid, hasSourceFilms: sourceFilms.length, excludeGenres, yearMin, yearMax, mode });
      setError(null);
      setNoCandidatesReason(null);
      setLoading(true);
      if (!supabase) throw new Error('Supabase not initialized');
      if (!uid) throw new Error('Not signed in');
      // Apply quick filters to source films
      const gExclude = new Set(
        excludeGenres
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      );
      const yMin = Number(yearMin) || undefined;
      const yMax = Number(yearMax) || undefined;
      const filteredFilms = sourceFilms.filter((f) => {
        if (yMin && f.year != null && f.year < yMin) return false;
        if (yMax && f.year != null && f.year > yMax) return false;
        return true; // genre filter will apply on candidates via overlap features
      });
      const uris = filteredFilms.map((f) => f.uri);
      console.log('[Suggest] fetching mappings for', uris.length, 'films');
      const mappings = await getFilmMappings(uid, uris);
      console.log('[Suggest] mappings loaded', { mappingCount: mappings.size });
      
      // Build watched TMDB id set
      const watchedIds = new Set<number>();
      // Build watchlist TMDB id set
      const watchlistIds = new Set<number>();
      
      for (const f of filteredFilms) {
        const mid = mappings.get(f.uri);
        if (mid) {
          watchedIds.add(mid);
          if (f.onWatchlist) {
            watchlistIds.add(mid);
          }
        }
      }
      
      setWatchlistTmdbIds(watchlistIds);
      console.log('[Suggest] watchlist IDs', { count: watchlistIds.size });
      
      // Build taste profile with IDs for smarter discovery
      console.log('[Suggest] Building taste profile for smart discovery');
      const tasteProfile = await buildTasteProfile({
        films: filteredFilms,
        mappings,
        topN: 10
      });
      
      // Get highly-rated film IDs for similar movie recommendations
      const highlyRated = filteredFilms
        .filter(f => (f.rating ?? 0) >= 4 || f.liked)
        .map(f => mappings.get(f.uri))
        .filter((id): id is number => id != null);
      
      // Generate smart candidates using multiple TMDB discovery strategies
      console.log('[Suggest] Generating smart candidates');
      const smartCandidates = await generateSmartCandidates({
        highlyRatedIds: highlyRated,
        topGenres: tasteProfile.topGenres,
        topKeywords: tasteProfile.topKeywords,
        topDirectors: tasteProfile.topDirectors
      });
      
      // Combine all candidate sources
      let candidatesRaw: number[] = [];
      candidatesRaw.push(...smartCandidates.trending);
      candidatesRaw.push(...smartCandidates.similar);
      candidatesRaw.push(...smartCandidates.discovered);
      
      console.log('[Suggest] Smart candidates breakdown', {
        trending: smartCandidates.trending.length,
        similar: smartCandidates.similar.length,
        discovered: smartCandidates.discovered.length,
        totalRaw: candidatesRaw.length
      });
      
      // Filter out already watched films and deduplicate
      const candidates = candidatesRaw
        .filter((id, idx, arr) => arr.indexOf(id) === idx) // dedupe
        .filter((id) => !watchedIds.has(id)) // exclude watched
        .slice(0, mode === 'quick' ? 250 : 400); // Increased pool size for better matching
      
      console.log('[Suggest] candidate pool', { 
        mode, 
        totalCandidates: candidatesRaw.length, 
        afterFilter: candidates.length, 
        watchedCount: watchedIds.size
      });
      
      if (candidates.length === 0) {
        const reason = 'No candidates available. Please check your TMDB API key or try again later.';
        setNoCandidatesReason(reason);
      }
      
      setSourceLabel('Based on your watched & liked films + trending releases');
      const lite = filteredFilms.map((f) => ({ uri: f.uri, title: f.title, year: f.year, rating: f.rating, liked: f.liked }));
      console.log('[Suggest] calling suggestByOverlap', { liteCount: lite.length });
      const suggestions = await suggestByOverlap({
        userId: uid,
        films: lite,
        mappings,
        candidates,
        excludeGenres: gExclude.size ? gExclude : undefined,
        maxCandidates: mode === 'quick' ? 250 : 400,
        concurrency: 6,
        excludeWatchedIds: watchedIds,
        desiredResults: 30, // Increased to have enough for all sections
      });
      // Best-effort: ensure posters/backdrops exist for suggested ids.
      if (suggestions.length) {
        try {
          const idsForCache = suggestions.map((s) => s.tmdbId);
          console.log('[Suggest] refreshing TMDB cache for suggested ids', idsForCache.length);
          await refreshTmdbCacheForIds(idsForCache);
          await refreshPosters();
        } catch {
          // ignore poster refresh errors; core suggestions still work
        }
      }
      
      // Fetch full TMDB data for each suggestion to get videos, collections, etc.
      const detailsPromises = suggestions.map(async (s) => {
        try {
          const u = new URL('/api/tmdb/movie', typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
          u.searchParams.set('id', String(s.tmdbId));
          const r = await fetch(u.toString(), { cache: 'no-store' });
          const j = await r.json();
          
          if (j.ok && j.movie) {
            const movie = j.movie;
            
            // Extract trailer key (first official trailer or first trailer)
            const videos = movie.videos?.results || [];
            const trailer = videos.find((v: any) => 
              v.site === 'YouTube' && v.type === 'Trailer' && v.official
            ) || videos.find((v: any) => 
              v.site === 'YouTube' && v.type === 'Trailer'
            );
            
            // Extract vote category
            const voteAverage = movie.vote_average || 0;
            const voteCount = movie.vote_count || 0;
            let voteCategory: 'hidden-gem' | 'crowd-pleaser' | 'cult-classic' | 'standard' = 'standard';
            
            if (voteAverage >= 7.5 && voteCount < 1000) {
              voteCategory = 'hidden-gem';
            } else if (voteAverage >= 7.0 && voteCount > 10000) {
              voteCategory = 'crowd-pleaser';
            } else if (voteAverage >= 7.0 && voteCount >= 1000 && voteCount <= 5000) {
              voteCategory = 'cult-classic';
            }
            
            // Extract collection name
            const collection = movie.belongs_to_collection;
            const collectionName = collection?.name || undefined;
            
            return {
              id: s.tmdbId,
              title: s.title ?? movie.title ?? `#${s.tmdbId}`,
              year: s.release_date?.slice(0, 4) || movie.release_date?.slice(0, 4),
              reasons: s.reasons,
              poster_path: s.poster_path || movie.poster_path,
              score: s.score,
              trailerKey: trailer?.key || null,
              voteCategory,
              collectionName
            };
          }
        } catch (e) {
          console.error(`[Suggest] Failed to fetch details for ${s.tmdbId}`, e);
        }
        
        // Fallback if fetch fails
        return {
          id: s.tmdbId,
          title: s.title ?? `#${s.tmdbId}`,
          year: s.release_date?.slice(0, 4),
          reasons: s.reasons,
          poster_path: s.poster_path,
          score: s.score,
          trailerKey: null,
          voteCategory: 'standard' as const,
          collectionName: undefined
        };
      });
      
      const details = await Promise.all(detailsPromises);
      console.log('[Suggest] suggestions ready with full details', { count: details.length });
      setItems(details);
    } catch (e: any) {
      console.error('[Suggest] error in runSuggest', e);
      setError(e?.message ?? 'Failed to get suggestions');
    } finally {
      console.log('[Suggest] runSuggest end');
      setLoading(false);
    }
  }, [uid, sourceFilms, excludeGenres, yearMin, yearMax, mode, refreshPosters]);

  // Fallback: if no local films, load from Supabase once
  useEffect(() => {
    const maybeLoad = async () => {
      try {
        if (!supabase || !uid) return;
        if (films && films.length) return;
        const { data, error } = await supabase
          .from('film_events')
          .select('uri,title,year,rating,rewatch,last_date,liked,on_watchlist')
          .eq('user_id', uid)
          .limit(5000);
        if (error) throw error;
        if (data && data.length) {
          const mapped = data.map((r) => ({
            uri: r.uri,
            title: r.title,
            year: r.year ?? null,
            rating: r.rating ?? undefined,
            rewatch: r.rewatch ?? undefined,
            lastDate: r.last_date ?? undefined,
            liked: r.liked ?? undefined,
            onWatchlist: r.on_watchlist ?? undefined,
          })) as FilmEvent[];
          setFallbackFilms(mapped);
        }
      } catch (e) {
        // swallow for now; suggestions can still run with 0 films
      }
    };
    void maybeLoad();
  }, [uid, films]);

  // Auto-run suggestions when we have user and films
  useEffect(() => {
    if (!uid) return;
    if (sourceFilms.length === 0) return;
    if (loading) return;
    if (items !== null) return;
    void runSuggest();
  }, [uid, sourceFilms.length, loading, items, runSuggest]);

  // Recompute when mapping updates are emitted
  useEffect(() => {
    const handler = () => {
      setItems(null);
      void runSuggest();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('lettr:mappings-updated', handler);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('lettr:mappings-updated', handler);
      }
    };
  }, [runSuggest]);

  return (
    <AuthGate>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Suggestions</h1>
          <p className="text-xs text-gray-600 mt-1">Based on your liked and highly rated films.</p>
        </div>
        <div className="flex flex-col items-end gap-1 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-gray-600">Mode:</span>
          <button
            type="button"
            className={`px-2 py-1 rounded border text-xs ${mode === 'quick' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
            onClick={() => { setMode('quick'); setItems(null); setRefreshTick((x) => x + 1); void runSuggest(); }}
          >
            Quick
          </button>
          <button
            type="button"
            className={`px-2 py-1 rounded border text-xs ${mode === 'deep' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
            onClick={() => { setMode('deep'); setItems(null); setRefreshTick((x) => x + 1); void runSuggest(); }}
          >
            Deep dive
          </button>
          </div>
          <p className="text-[10px] text-gray-500">
            Quick is snappy; Deep dive scans more candidates and may take longer.
          </p>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-600">Exclude genres (comma)</label>
          <input
            value={excludeGenres}
            onChange={(e) => setExcludeGenres(e.target.value)}
            placeholder="e.g., horror, musical"
            className="border rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600">Year min</label>
          <input value={yearMin} onChange={(e) => setYearMin(e.target.value)} placeholder="e.g., 1990" className="border rounded px-2 py-1 text-sm w-24" />
        </div>
        <div>
          <label className="block text-xs text-gray-600">Year max</label>
          <input value={yearMax} onChange={(e) => setYearMax(e.target.value)} placeholder="e.g., 2025" className="border rounded px-2 py-1 text-sm w-24" />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            className="px-3 py-2 rounded border text-sm hover:bg-gray-50 flex items-center gap-1"
            title="Recompute with current filters"
            onClick={() => { setItems(null); setRefreshTick((x) => x + 1); void runSuggest(); }}
          >
            <span>🔄</span>
            <span>Refresh</span>
          </button>
        </div>
      </div>
      {loadingFilms && <p className="text-sm text-gray-600">Loading your library from database…</p>}
      {loading && <p className="text-sm text-gray-600">Computing your recommendations…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && !error && noCandidatesReason && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">
          {noCandidatesReason}
        </p>
      )}
      {items && categorizedSuggestions && (
        <div className="space-y-8">
          {sourceLabel && (
            <p className="text-xs text-gray-500 mb-4">Source: {sourceLabel}</p>
          )}

          {/* Perfect Matches Section */}
          {categorizedSuggestions.perfectMatches.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl">🎯</span>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Perfect Matches</h2>
                  <p className="text-xs text-gray-600">These match everything you love</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {categorizedSuggestions.perfectMatches.map((item) => (
                  <MovieCard 
                    key={item.id} 
                    id={item.id}
                    title={item.title}
                    year={item.year}
                    posterPath={posters[item.id]}
                    trailerKey={item.trailerKey}
                    isInWatchlist={watchlistTmdbIds.has(item.id)}
                    reasons={item.reasons}
                    score={item.score}
                    voteCategory={item.voteCategory}
                    collectionName={item.collectionName}
                  />
                ))}
              </div>
            </section>
          )}

          {/* From Directors You Love Section */}
          {categorizedSuggestions.directorMatches.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl">🎬</span>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">From Directors You Love</h2>
                  <p className="text-xs text-gray-600">More from filmmakers you enjoy</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {categorizedSuggestions.directorMatches.map((item) => (
                  <MovieCard 
                    key={item.id} 
                    id={item.id}
                    title={item.title}
                    year={item.year}
                    posterPath={posters[item.id]}
                    trailerKey={item.trailerKey}
                    isInWatchlist={watchlistTmdbIds.has(item.id)}
                    reasons={item.reasons}
                    score={item.score}
                    voteCategory={item.voteCategory}
                    collectionName={item.collectionName}
                  />
                ))}
              </div>
            </section>
          )}

          {/* From Actors You Love Section */}
          {categorizedSuggestions.actorMatches.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl">⭐</span>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">From Actors You Love</h2>
                  <p className="text-xs text-gray-600">More from your favorite performers</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {categorizedSuggestions.actorMatches.map((item) => (
                  <MovieCard 
                    key={item.id} 
                    id={item.id}
                    title={item.title}
                    year={item.year}
                    posterPath={posters[item.id]}
                    trailerKey={item.trailerKey}
                    isInWatchlist={watchlistTmdbIds.has(item.id)}
                    reasons={item.reasons}
                    score={item.score}
                    voteCategory={item.voteCategory}
                    collectionName={item.collectionName}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Your Favorite Genres Section */}
          {categorizedSuggestions.genreMatches.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl">🎭</span>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Your Favorite Genres</h2>
                  <p className="text-xs text-gray-600">Based on genres you watch most</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {categorizedSuggestions.genreMatches.map((item) => (
                  <MovieCard 
                    key={item.id} 
                    id={item.id}
                    title={item.title}
                    year={item.year}
                    posterPath={posters[item.id]}
                    trailerKey={item.trailerKey}
                    isInWatchlist={watchlistTmdbIds.has(item.id)}
                    reasons={item.reasons}
                    score={item.score}
                    voteCategory={item.voteCategory}
                    collectionName={item.collectionName}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Hidden Gems Section */}
          {categorizedSuggestions.hiddenGems.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl">🔍</span>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Hidden Gems</h2>
                  <p className="text-xs text-gray-600">Older films that match your taste</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {categorizedSuggestions.hiddenGems.map((item) => (
                  <MovieCard 
                    key={item.id} 
                    id={item.id}
                    title={item.title}
                    year={item.year}
                    posterPath={posters[item.id]}
                    trailerKey={item.trailerKey}
                    isInWatchlist={watchlistTmdbIds.has(item.id)}
                    reasons={item.reasons}
                    score={item.score}
                    voteCategory={item.voteCategory}
                    collectionName={item.collectionName}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Cult Classics Section */}
          {categorizedSuggestions.cultClassics.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl">🎭</span>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Cult Classics</h2>
                  <p className="text-xs text-gray-600">Films with dedicated followings</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {categorizedSuggestions.cultClassics.map((item) => (
                  <MovieCard 
                    key={item.id} 
                    id={item.id}
                    title={item.title}
                    year={item.year}
                    posterPath={posters[item.id]}
                    trailerKey={item.trailerKey}
                    isInWatchlist={watchlistTmdbIds.has(item.id)}
                    reasons={item.reasons}
                    score={item.score}
                    voteCategory={item.voteCategory}
                    collectionName={item.collectionName}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Crowd Pleasers Section */}
          {categorizedSuggestions.crowdPleasers.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl">🎉</span>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Crowd Pleasers</h2>
                  <p className="text-xs text-gray-600">Widely loved and highly rated</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {categorizedSuggestions.crowdPleasers.map((item) => (
                  <MovieCard 
                    key={item.id} 
                    id={item.id}
                    title={item.title}
                    year={item.year}
                    posterPath={posters[item.id]}
                    trailerKey={item.trailerKey}
                    isInWatchlist={watchlistTmdbIds.has(item.id)}
                    reasons={item.reasons}
                    score={item.score}
                    voteCategory={item.voteCategory}
                    collectionName={item.collectionName}
                  />
                ))}
              </div>
            </section>
          )}

          {/* New & Trending Section */}
          {categorizedSuggestions.newReleases.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl">✨</span>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">New & Trending</h2>
                  <p className="text-xs text-gray-600">Fresh picks based on your taste</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {categorizedSuggestions.newReleases.map((item) => (
                  <MovieCard 
                    key={item.id} 
                    id={item.id}
                    title={item.title}
                    year={item.year}
                    posterPath={posters[item.id]}
                    trailerKey={item.trailerKey}
                    isInWatchlist={watchlistTmdbIds.has(item.id)}
                    reasons={item.reasons}
                    score={item.score}
                    voteCategory={item.voteCategory}
                    collectionName={item.collectionName}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Recent Classics Section */}
          {categorizedSuggestions.recentClassics.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl">🎬</span>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Recent Classics</h2>
                  <p className="text-xs text-gray-600">Great films from 2015-2022</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {categorizedSuggestions.recentClassics.map((item) => (
                  <MovieCard 
                    key={item.id} 
                    id={item.id}
                    title={item.title}
                    year={item.year}
                    posterPath={posters[item.id]}
                    trailerKey={item.trailerKey}
                    isInWatchlist={watchlistTmdbIds.has(item.id)}
                    reasons={item.reasons}
                    score={item.score}
                    voteCategory={item.voteCategory}
                    collectionName={item.collectionName}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Deep Cuts Section */}
          {categorizedSuggestions.deepCuts.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl">🌟</span>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Deep Cuts</h2>
                  <p className="text-xs text-gray-600">Niche matches for your specific taste</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {categorizedSuggestions.deepCuts.map((item) => (
                  <MovieCard 
                    key={item.id} 
                    id={item.id}
                    title={item.title}
                    year={item.year}
                    posterPath={posters[item.id]}
                    trailerKey={item.trailerKey}
                    isInWatchlist={watchlistTmdbIds.has(item.id)}
                    reasons={item.reasons}
                    score={item.score}
                    voteCategory={item.voteCategory}
                    collectionName={item.collectionName}
                  />
                ))}
              </div>
            </section>
          )}

          {/* From Collections Section */}
          {categorizedSuggestions.fromCollections.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl">📚</span>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">From Collections</h2>
                  <p className="text-xs text-gray-600">Complete franchises and series</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {categorizedSuggestions.fromCollections.map((item) => (
                  <MovieCard 
                    key={item.id} 
                    id={item.id}
                    title={item.title}
                    year={item.year}
                    posterPath={posters[item.id]}
                    trailerKey={item.trailerKey}
                    isInWatchlist={watchlistTmdbIds.has(item.id)}
                    reasons={item.reasons}
                    score={item.score}
                    voteCategory={item.voteCategory}
                    collectionName={item.collectionName}
                  />
                ))}
              </div>
            </section>
          )}

          {/* More Recommendations Section - Fallback for remaining suggestions */}
          {categorizedSuggestions.moreRecommendations.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl">🎥</span>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">More Recommendations</h2>
                  <p className="text-xs text-gray-600">Additional films you might enjoy</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {categorizedSuggestions.moreRecommendations.map((item) => (
                  <MovieCard 
                    key={item.id} 
                    id={item.id}
                    title={item.title}
                    year={item.year}
                    posterPath={posters[item.id]}
                    trailerKey={item.trailerKey}
                    isInWatchlist={watchlistTmdbIds.has(item.id)}
                    reasons={item.reasons}
                    score={item.score}
                    voteCategory={item.voteCategory}
                    collectionName={item.collectionName}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      {!items && (
        <p className="text-gray-700">Your personalized recommendations will appear here.</p>
      )}
    </AuthGate>
  );
}
