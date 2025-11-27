'use client';
import AuthGate from '@/components/AuthGate';
import MovieCard from '@/components/MovieCard';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useImportData } from '@/lib/importStore';
import { supabase } from '@/lib/supabaseClient';
import { getFilmMappings, refreshTmdbCacheForIds, suggestByOverlap, buildTasteProfile, findIncompleteCollections, discoverFromLists, getBlockedSuggestions, blockSuggestion, addFeedback, getFeedback } from '@/lib/enrich';
import { fetchTrendingIds, fetchSimilarMovieIds, generateSmartCandidates, getDecadeCandidates, getSmartDiscoveryCandidates, generateExploratoryPicks } from '@/lib/trending';
import { usePostersSWR } from '@/lib/usePostersSWR';
import { getCurrentSeasonalGenres, getSeasonalRecommendationConfig } from '@/lib/genreEnhancement';
import { saveMovie, getSavedMovies } from '@/lib/lists';
import { updateExplorationStats, getAdaptiveExplorationRate, getGenreTransitions, handleNegativeFeedback } from '@/lib/adaptiveLearning';
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
  genres?: string[];
  vote_average?: number;
  vote_count?: number;
  overview?: string;
  contributingFilms?: Record<string, Array<{ id: number; title: string }>>;
  dismissed?: boolean;
  imdb_rating?: string;
  imdb_source?: 'omdb' | 'tmdb' | 'watchmode' | 'tuimdb'; // Which API provided the rating
  rotten_tomatoes?: string;
  metacritic?: string;
  awards?: string;
};

type CategorizedSuggestions = {
  seasonalPicks: MovieItem[];
  seasonalConfig: any;
  perfectMatches: MovieItem[];
  recentWatchMatches: MovieItem[];
  studioMatches: MovieItem[];
  directorMatches: MovieItem[];
  actorMatches: MovieItem[];
  genreMatches: MovieItem[];
  documentaries: MovieItem[];
  decadeMatches: MovieItem[];
  smartDiscovery: MovieItem[];
  hiddenGems: MovieItem[];
  cultClassics: MovieItem[];
  crowdPleasers: MovieItem[];
  newReleases: MovieItem[];
  recentClassics: MovieItem[];
  deepCuts: MovieItem[];
  fromCollections: MovieItem[];
  moreRecommendations: MovieItem[];
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
  const [blockedIds, setBlockedIds] = useState<Set<number>>(new Set());
  const [refreshingSections, setRefreshingSections] = useState<Set<string>>(new Set());
  const [shownIds, setShownIds] = useState<Set<number>>(new Set());
  const [cacheKey, setCacheKey] = useState<number>(Date.now());
  const [progress, setProgress] = useState({ current: 0, total: 5, stage: '' });
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [topDecade, setTopDecade] = useState<number | null>(null);
  const [savedMovieIds, setSavedMovieIds] = useState<Set<number>>(new Set());
  const [hasCheckedStorage, setHasCheckedStorage] = useState(false);

  // Load from session storage on mount
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('lettrsuggest_items');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          console.log('[Suggest] Restored items from session storage', parsed.length);
          setItems(parsed);
        }
      }
    } catch (e) {
      console.error('[Suggest] Failed to restore from session storage', e);
    } finally {
      setHasCheckedStorage(true);
    }
  }, []);

  // Save to session storage when items change
  useEffect(() => {
    if (items && items.length > 0) {
      try {
        sessionStorage.setItem('lettrsuggest_items', JSON.stringify(items));
      } catch (e) {
        console.error('[Suggest] Failed to save to session storage', e);
      }
    }
  }, [items]);

  // Get posters for all suggested movies
  const tmdbIds = useMemo(() => items?.map((it) => it.id) ?? [], [items]);
  const { posters, mutate: refreshPosters } = usePostersSWR(tmdbIds);

  // Categorize suggestions into sections
  const [categorizedSuggestions, setCategorizedSuggestions] = useState<CategorizedSuggestions | null>(null);

  const categorizeItems = useCallback((items: MovieItem[]): CategorizedSuggestions | null => {
    if (!items || items.length === 0) return null;

    const currentYear = new Date().getFullYear();
    const seasonalConfig = getSeasonalRecommendationConfig();

    // Helper functions to check reason types
    const hasDirectorMatch = (reasons: string[]) =>
      reasons.some(r => {
        const lower = r.toLowerCase();
        return lower.includes('directed by') ||
          lower.includes('director') ||
          lower.includes('similar to') ||
          lower.includes('inspired by') ||
          lower.includes('in the style of');
      });

    const hasActorMatch = (reasons: string[]) =>
      reasons.some(r => {
        const lower = r.toLowerCase();
        return lower.includes('stars ') ||
          lower.includes('starring') ||
          lower.includes('cast member') ||
          lower.includes('cast members') ||
          lower.includes('actor') ||
          (lower.includes('similar to') && lower.includes('enjoy')) ||
          lower.includes('works in');
      });

    const hasGenreMatch = (reasons: string[]) =>
      reasons.some(r => {
        const lower = r.toLowerCase();
        return lower.includes('matches your taste in') ||
          lower.includes('matches your specific taste in') ||
          lower.includes('genre:') ||
          lower.includes('similar genre');
      });

    const hasRecentWatchMatch = (reasons: string[]) =>
      reasons.some(r => r.toLowerCase().includes('recent') && (r.toLowerCase().includes('watch') || r.toLowerCase().includes('favorite')));

    const hasStudioMatch = (reasons: string[]) =>
      reasons.some(r => {
        const lower = r.toLowerCase();
        return (lower.includes('from ') && (lower.includes('studio') || lower.includes('—'))) ||
          lower.includes('studios you enjoy') ||
          lower.includes('a24') ||
          lower.includes('neon') ||
          lower.includes('annapurna') ||
          lower.includes('blumhouse') ||
          lower.includes('ghibli') ||
          lower.includes('searchlight');
      });

    const hasDeepCutThemes = (reasons: string[]) =>
      reasons.some(r => {
        const lower = r.toLowerCase();
        return lower.includes('themes you') ||
          lower.includes('specific themes') ||
          lower.includes('keyword:') ||
          lower.includes('matches specific themes');
      });

    const isSeasonalMatch = (item: MovieItem): boolean => {
      // Check if movie title, genres, or reasons match current seasonal themes
      const titleLower = item.title.toLowerCase();
      const titleMatch = seasonalConfig.keywords.some(kw => titleLower.includes(kw.toLowerCase()));

      // Check genres if available
      const genreMatch = item.genres ? seasonalConfig.keywords.some(kw =>
        item.genres!.some(g => g.toLowerCase().includes(kw.toLowerCase()))
      ) : false;

      // Also check reasons for genre mentions that match seasonal config
      const reasonsMatch = item.reasons.some(r => {
        const lower = r.toLowerCase();
        return seasonalConfig.keywords.some(kw => lower.includes(kw.toLowerCase()));
      });

      return titleMatch || genreMatch || reasonsMatch;
    };

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

    // 0. Seasonal Recommendations (if applicable)
    const seasonalPicks = seasonalConfig.genres.length > 0 ?
      getNextItems(isSeasonalMatch, 12) : [];

    console.log('[Suggest] Seasonal picks result', {
      configGenres: seasonalConfig.genres,
      configKeywords: seasonalConfig.keywords,
      seasonalPicksCount: seasonalPicks.length
    });

    // 1. Based on Recent Watches: Films similar to recent favorites
    const recentWatchMatches = getNextItems(item => hasRecentWatchMatch(item.reasons), 12);

    // 2. From Studios You Love: Films from studios whose style you enjoy
    const studioMatches = getNextItems(item => hasStudioMatch(item.reasons), 12);

    // 3. Inspired by Directors You Love: Films from or similar to directors you enjoy
    const directorMatches = getNextItems(item => hasDirectorMatch(item.reasons), 12);

    // 4. From Actors You Love: Films with cast matches or similar actors
    const actorMatches = getNextItems(item => hasActorMatch(item.reasons), 12);

    // 5. Your Favorite Genres: Films matching preferred genres
    const genreMatches = getNextItems(item => hasGenreMatch(item.reasons), 12);

    // 5b. Documentaries
    const documentaries = getNextItems(item => item.genres?.includes('Documentary') ?? false, 12);

    // 6. Best of the [Decade]s
    const decadeMatches = topDecade ? getNextItems(item => {
      const year = parseInt(item.year || '0');
      return year >= topDecade && year < topDecade + 10;
    }, 12) : [];

    // 7. Hidden Gems for You (Smart Discovery)
    const smartDiscovery = getNextItems(item => {
      return item.voteCategory === 'hidden-gem';
    }, 12);

    // 8. Classic Hidden Gems: Pre-2015 films with high scores but low recognition (fallback)
    const hiddenGems = getNextItems(item => {
      const year = parseInt(item.year || '0');
      return year > 0 && year < 2015 && item.voteCategory === 'hidden-gem';
    }, 12);

    // 7. Cult Classics: Films with cult following
    const cultClassics = getNextItems(item => {
      return item.voteCategory === 'cult-classic';
    }, 12);

    // 8. Crowd Pleasers: Popular high-rated films
    const crowdPleasers = getNextItems(item => {
      return item.voteCategory === 'crowd-pleaser';
    }, 12);

    // 9. New & Trending: Recent releases (2023+)
    const newReleases = getNextItems(item => {
      const year = parseInt(item.year || '0');
      return year >= 2023;
    }, 12);

    // 10. Recent Classics: Films from 2015-2022
    const recentClassics = getNextItems(item => {
      const year = parseInt(item.year || '0');
      return year >= 2015 && year < 2023;
    }, 12);

    // 11. Deep Cuts: Films with specific theme/keyword matches
    const deepCuts = getNextItems(item => hasDeepCutThemes(item.reasons), 12);

    // 12. From Collections: Films in same collections/franchises
    const fromCollections = getNextItems(item => !!item.collectionName, 12);

    // 13. Perfect Matches: Top highest scoring films that don't fit other categories
    const perfectMatches = getNextItems(() => true, 12);

    // 14. Fallback: More recommendations (any remaining films)
    const moreRecommendations = getNextItems(() => true, 20);

    // Helper to sort by rating
    const sortByRating = (items: MovieItem[]) => {
      return [...items].sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
    };

    console.log('[Suggest] Categorization complete', {
      seasonalPicks: seasonalPicks.length,
      perfectMatches: perfectMatches.length,
      recentWatchMatches: recentWatchMatches.length,
      studioMatches: studioMatches.length,
      directorMatches: directorMatches.length,
      actorMatches: actorMatches.length,
      genreMatches: genreMatches.length,
      documentaries: documentaries.length,
      hiddenGems: hiddenGems.length,
      cultClassics: cultClassics.length,
      crowdPleasers: crowdPleasers.length,
      newReleases: newReleases.length,
      recentClassics: recentClassics.length,
      deepCuts: deepCuts.length,
      fromCollections: fromCollections.length,
      moreRecommendations: moreRecommendations.length,
      totalUsed: usedIds.size,
      totalAvailable: items.length
    });

    return {
      seasonalPicks: sortByRating(seasonalPicks),
      seasonalConfig,
      perfectMatches: sortByRating(perfectMatches),
      recentWatchMatches: sortByRating(recentWatchMatches),
      studioMatches: sortByRating(studioMatches),
      directorMatches: sortByRating(directorMatches),
      actorMatches: sortByRating(actorMatches),
      genreMatches: sortByRating(genreMatches),
      documentaries: sortByRating(documentaries),
      decadeMatches: sortByRating(decadeMatches),
      smartDiscovery: sortByRating(smartDiscovery),
      hiddenGems: sortByRating(hiddenGems),
      cultClassics: sortByRating(cultClassics),
      crowdPleasers: sortByRating(crowdPleasers),
      newReleases: sortByRating(newReleases),
      recentClassics: sortByRating(recentClassics),
      deepCuts: sortByRating(deepCuts),
      fromCollections: sortByRating(fromCollections),
      moreRecommendations: sortByRating(moreRecommendations)
    };
  }, [topDecade]);

  // Update categories when items change
  useEffect(() => {
    if (items && items.length > 0) {
      setCategorizedSuggestions(categorizeItems(items));
    } else {
      setCategorizedSuggestions(null);
    }
  }, [items, categorizeItems]);

  // Section filter mapping for individual section refresh
  const getSectionFilter = useCallback((sectionName: string, seasonalConfig: any) => {
    const currentYear = new Date().getFullYear();

    // Helper functions for checking reasons
    const hasDirectorMatch = (reasons: string[]) =>
      reasons.some(r => {
        const lower = r.toLowerCase();
        return lower.includes('directed by') ||
          lower.includes('director') ||
          lower.includes('similar to') ||
          lower.includes('inspired by') ||
          lower.includes('in the style of');
      });

    const hasActorMatch = (reasons: string[]) =>
      reasons.some(r => {
        const lower = r.toLowerCase();
        return lower.includes('stars ') ||
          lower.includes('starring') ||
          lower.includes('cast member') ||
          lower.includes('cast members') ||
          lower.includes('actor') ||
          (lower.includes('similar to') && lower.includes('enjoy')) ||
          lower.includes('works in');
      });

    const hasGenreMatch = (reasons: string[]) =>
      reasons.some(r => {
        const lower = r.toLowerCase();
        return lower.includes('matches your taste in') ||
          lower.includes('matches your specific taste in') ||
          lower.includes('genre:') ||
          lower.includes('similar genre');
      });

    const hasRecentWatchMatch = (reasons: string[]) =>
      reasons.some(r => r.toLowerCase().includes('recent') && (r.toLowerCase().includes('watch') || r.toLowerCase().includes('favorite')));

    const hasStudioMatch = (reasons: string[]) =>
      reasons.some(r => {
        const lower = r.toLowerCase();
        return (lower.includes('from ') && (lower.includes('studio') || lower.includes('—'))) ||
          lower.includes('studios you enjoy') ||
          lower.includes('a24') ||
          lower.includes('neon') ||
          lower.includes('annapurna') ||
          lower.includes('blumhouse') ||
          lower.includes('ghibli') ||
          lower.includes('searchlight');
      });

    const hasDeepCutThemes = (reasons: string[]) =>
      reasons.some(r => {
        const lower = r.toLowerCase();
        return lower.includes('themes you') ||
          lower.includes('specific themes') ||
          lower.includes('keyword:') ||
          lower.includes('matches specific themes');
      });

    const isSeasonalMatch = (item: MovieItem): boolean => {
      const titleLower = item.title.toLowerCase();
      const titleMatch = seasonalConfig.keywords.some((kw: string) => titleLower.includes(kw.toLowerCase()));
      const genreMatch = item.genres ? seasonalConfig.keywords.some((kw: string) =>
        item.genres!.some(g => g.toLowerCase().includes(kw.toLowerCase()))
      ) : false;
      const reasonsMatch = item.reasons.some(r => {
        const lower = r.toLowerCase();
        return seasonalConfig.keywords.some((kw: string) => lower.includes(kw.toLowerCase()));
      });
      return titleMatch || genreMatch || reasonsMatch;
    };

    // Return the appropriate filter function
    const filters: Record<string, (item: MovieItem) => boolean> = {
      seasonalPicks: isSeasonalMatch,
      recentWatchMatches: (item) => hasRecentWatchMatch(item.reasons),
      studioMatches: (item) => hasStudioMatch(item.reasons),
      directorMatches: (item) => hasDirectorMatch(item.reasons),
      actorMatches: (item) => hasActorMatch(item.reasons),
      genreMatches: (item) => hasGenreMatch(item.reasons),
      documentaries: (item) => item.genres?.includes('Documentary') ?? false,
      decadeMatches: (item) => {
        if (!topDecade) return false;
        const year = parseInt(item.year || '0');
        return year >= topDecade && year < topDecade + 10;
      },
      smartDiscovery: (item) => item.voteCategory === 'hidden-gem',
      hiddenGems: (item) => {
        const year = parseInt(item.year || '0');
        return year > 0 && year < 2015 && item.voteCategory === 'hidden-gem';
      },
      cultClassics: (item) => item.voteCategory === 'cult-classic',
      crowdPleasers: (item) => item.voteCategory === 'crowd-pleaser',
      newReleases: (item) => {
        const year = parseInt(item.year || '0');
        return year >= 2023;
      },
      recentClassics: (item) => {
        const year = parseInt(item.year || '0');
        return year >= 2015 && year < 2023;
      },
      deepCuts: (item) => hasDeepCutThemes(item.reasons),
      fromCollections: (item) => !!item.collectionName,
      perfectMatches: () => true,
      moreRecommendations: () => true,
    };

    return filters[sectionName] || (() => true);
  }, [topDecade]);

  useEffect(() => {
    const init = async () => {
      if (!supabase) return;
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id ?? null;
      setUid(userId);

      // Fetch blocked suggestions
      if (userId) {
        try {
          const blocked = await getBlockedSuggestions(userId);
          setBlockedIds(blocked);
        } catch (e) {
          console.error('Failed to fetch blocked suggestions:', e);
        }
      }
    };
    void init();
  }, []);

  // Load saved movies
  useEffect(() => {
    const loadSavedMovies = async () => {
      if (!uid) return;
      const { movies } = await getSavedMovies(uid);
      setSavedMovieIds(new Set(movies.map(m => m.tmdb_id)));
    };
    void loadSavedMovies();
  }, [uid]);

  const sourceFilms = useMemo(() => (films && films.length ? films : (fallbackFilms ?? [])), [films, fallbackFilms]);

  const runSuggest = useCallback(async () => {
    try {
      // Generate new cache key to bust browser and API caches
      const freshCacheKey = Date.now();
      setCacheKey(freshCacheKey);
      console.log('[Suggest] runSuggest start', { uid, hasSourceFilms: sourceFilms.length, excludeGenres, yearMin, yearMax, mode, cacheKey: freshCacheKey });

      // Clear previous state completely
      setItems(null);
      setError(null);
      setNoCandidatesReason(null);
      setLoading(true);
      setProgress({ current: 0, total: 5, stage: 'Initializing...' });
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
      setProgress({ current: 1, total: 5, stage: 'Loading your library...' });
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
      setProgress({ current: 2, total: 5, stage: 'Analyzing your taste profile...' });

      // Fetch negative feedback to learn from dislikes
      let negativeFeedbackIds: number[] = [];
      try {
        const feedbackMap = await getFeedback(uid);
        negativeFeedbackIds = Array.from(feedbackMap.entries())
          .filter((entry): entry is [number, 'negative' | 'positive'] => entry[1] === 'negative')
          .map((entry) => entry[0]);
        console.log('[Suggest] Found negative feedback', { count: negativeFeedbackIds.length });
      } catch (e) {
        console.error('[Suggest] Failed to fetch feedback', e);
      }

      const tasteProfile = await buildTasteProfile({
        films: filteredFilms,
        mappings,
        topN: 10,
        negativeFeedbackIds
      });

      // Set top decade for UI
      if (tasteProfile.topDecades.length > 0) {
        setTopDecade(tasteProfile.topDecades[0].decade);
      }

      // Update adaptive learning stats (fire and forget)
      if (uid) {
        updateExplorationStats(
          uid,
          filteredFilms,
          tasteProfile.topGenres.map(g => g.name)
        ).catch(e => console.error('[Suggest] Failed to update exploration stats', e));
      }

      // Get highly-rated film IDs for similar movie recommendations
      const highlyRated = filteredFilms
        .filter(f => (f.rating ?? 0) >= 4 || f.liked)
        .map(f => mappings.get(f.uri))
        .filter((id): id is number => id != null);

      // Generate smart candidates using multiple TMDB discovery strategies
      console.log('[Suggest] Generating smart candidates');
      setProgress({ current: 3, total: 5, stage: 'Discovering movies...' });
      const smartCandidates = await generateSmartCandidates({
        highlyRatedIds: highlyRated,
        topGenres: tasteProfile.topGenres,
        topKeywords: tasteProfile.topKeywords,
        topDirectors: tasteProfile.topDirectors,
        topActors: tasteProfile.topActors,
        topStudios: tasteProfile.topStudios
      });

      // Fetch decade candidates
      let decadeCandidates: number[] = [];
      if (tasteProfile.topDecades.length > 0) {
        const topDecade = tasteProfile.topDecades[0].decade;
        decadeCandidates = await getDecadeCandidates(topDecade);
      }

      // Fetch smart discovery candidates (hidden gems)
      const discoveryCandidates = await getSmartDiscoveryCandidates(tasteProfile);

      // Phase 5+: Adaptive exploration rate (5-30% based on user feedback)
      const explorationRate = await getAdaptiveExplorationRate(uid);
      const exploratoryCount = Math.floor(150 * explorationRate);
      console.log('[Suggest][Phase5+] Using adaptive exploration', {
        rate: explorationRate,
        count: exploratoryCount,
        message: explorationRate !== 0.15 ? 'Rate adjusted based on your feedback!' : 'Using default rate (will adjust after rating exploratory picks)'
      });

      const exploratoryPicks = await generateExploratoryPicks(
        {
          topGenres: tasteProfile.topGenres,
          avoidGenres: tasteProfile.avoidGenres
        },
        {
          count: exploratoryCount,
          minVoteAverage: 7.0,
          minVoteCount: 500
        }
      );

      // Combine all candidate sources
      let candidatesRaw: number[] = [];
      candidatesRaw.push(...smartCandidates.trending);
      candidatesRaw.push(...smartCandidates.similar);
      candidatesRaw.push(...smartCandidates.discovered);
      candidatesRaw.push(...decadeCandidates);
      candidatesRaw.push(...discoveryCandidates);
      candidatesRaw.push(...exploratoryPicks); // Add exploratory picks

      console.log('[Suggest] Smart candidates breakdown', {
        trending: smartCandidates.trending.length,
        similar: smartCandidates.similar.length,
        discovered: smartCandidates.discovered.length,
        decade: decadeCandidates.length,
        discovery: discoveryCandidates.length,
        exploratory: exploratoryPicks.length,
        totalRaw: candidatesRaw.length
      });

      // Filter out already watched films, blocked suggestions, and deduplicate
      const candidatesFiltered = candidatesRaw
        .filter((id, idx, arr) => arr.indexOf(id) === idx) // dedupe
        .filter((id) => !watchedIds.has(id)) // exclude watched
        .filter((id) => !blockedIds.has(id)) // exclude blocked
        .filter((id) => !shownIds.has(id)); // exclude previously shown on refresh

      // Shuffle candidates aggressively using crypto-quality randomness
      const shuffled = [...candidatesFiltered].sort(() => {
        // Use crypto random for better distribution
        return Math.random() - 0.5;
      });
      const candidates = shuffled.slice(0, mode === 'quick' ? 500 : 800); // Much larger pool for variety

      console.log('[Suggest] candidate pool', {
        blockedCount: blockedIds.size,
        mode,
        totalCandidates: candidatesRaw.length,
        afterFilter: candidates.length,
        watchedCount: watchedIds.size
      });

      if (candidates.length === 0) {
        const reason = 'No candidates available. Please check your TMDB API key or try again later.';
        setNoCandidatesReason(reason);
      }

      // Fetch learned genre transitions
      const adjacentGenres = await getGenreTransitions(uid);
      console.log('[Suggest] Loaded genre transitions', { count: adjacentGenres.size });

      // Get recent genres from taste profile (already calculated in buildTasteProfile but not returned explicitly as list)
      // We can extract them from topGenres or we might need to look at recent films again.
      // `tasteProfile` has `topGenres` but those are overall.
      // Let's use the `filteredFilms` (source films) to find recent genres.
      const recentFilms = filteredFilms
        .sort((a, b) => (b.lastDate ? new Date(b.lastDate).getTime() : 0) - (a.lastDate ? new Date(a.lastDate).getTime() : 0))
        .slice(0, 5);

      // We need genres for these. We have mappings but not genres in `filteredFilms`.
      // `buildTasteProfile` does this internally.
      // Ideally `buildTasteProfile` should return `recentGenres`.
      // Let's assume for now we pass `topGenres` as a proxy for "active" interest if we can't get recent easily,
      // OR we modify `buildTasteProfile` to return `recentGenres`.
      // Actually, `enrich.ts` has `recentGenres` in `pref` object but it's not returned.

      // Let's just pass `tasteProfile.topGenres` names as "recent" for now? No, that's wrong.
      // Transitions are "From X -> To Y". If I like X generally, I might like Y.
      // So passing top genres as "recent" is a decent approximation of "current state".
      const recentGenreNames = tasteProfile.topGenres.slice(0, 5).map(g => g.name);

      setSourceLabel('Based on your watched & liked films + trending releases');
      const lite = filteredFilms.map((f) => ({ uri: f.uri, title: f.title, year: f.year, rating: f.rating, liked: f.liked }));
      console.log('[Suggest] calling suggestByOverlap', { liteCount: lite.length, candidatesCount: candidates.length });
      setProgress({ current: 4, total: 5, stage: 'Scoring suggestions...' });
      const suggestions = await suggestByOverlap({
        userId: uid,
        films: lite,
        mappings,
        candidates,
        excludeGenres: gExclude.size ? gExclude : undefined,
        maxCandidates: mode === 'quick' ? 250 : 600,
        concurrency: 6,
        excludeWatchedIds: watchedIds,
        desiredResults: 150, // Request more suggestions to fill all 15 sections with variety
        enhancedProfile: {
          topActors: tasteProfile.topActors,
          topStudios: tasteProfile.topStudios,
          avoidGenres: tasteProfile.avoidGenres,
          avoidKeywords: tasteProfile.avoidKeywords,
          avoidDirectors: tasteProfile.avoidDirectors,
          adjacentGenres,
          recentGenres: recentGenreNames
        }
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

      // Track these IDs as shown for next refresh, but limit to last 200 to prevent indefinite accumulation
      const newShownIds = new Set([...shownIds, ...suggestions.map(s => s.tmdbId)]);
      // Keep only the most recent 200 shown IDs for variety
      const recentShownIds = Array.from(newShownIds).slice(-200);
      setShownIds(new Set(recentShownIds));
      console.log('[Suggest] Tracking shown IDs', { total: recentShownIds.length, newThisRound: suggestions.length, limited: newShownIds.size > 200 });

      // Fetch full movie data for each suggestion to get videos, collections, etc.
      setProgress({ current: 5, total: 5, stage: 'Fetching movie details...' });
      const detailsPromises = suggestions.map(async (s) => {
        try {
          let movie = null;

          // Fetch from TMDB API
          // Note: TuiMDB integration requires UID mapping which we skip for now
          const u = new URL('/api/tmdb/movie', typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
          u.searchParams.set('id', String(s.tmdbId));
          u.searchParams.set('_t', String(freshCacheKey)); // Cache buster
          const r = await fetch(u.toString(), { cache: 'no-store' });
          const j = await r.json();

          if (j.ok && j.movie) {
            movie = j.movie;
          }

          if (movie) {

            // Extract trailer key (first official trailer or first trailer)
            const videos = movie.videos?.results || [];
            const trailer = videos.find((v: any) =>
              v.site === 'YouTube' && v.type === 'Trailer' && v.official
            ) || videos.find((v: any) =>
              v.site === 'YouTube' && v.type === 'Trailer'
            );

            // Use voteCategory from suggestByOverlap result (already calculated there)
            const voteCategory = s.voteCategory || 'standard';

            // Extract collection name
            const collection = movie.belongs_to_collection;
            const collectionName = collection?.name || undefined;

            // Extract genres
            const genres = (movie.genres || []).map((g: any) => g.name);

            return {
              id: s.tmdbId,
              title: s.title ?? movie.title ?? `#${s.tmdbId}`,
              year: s.release_date?.slice(0, 4) || movie.release_date?.slice(0, 4),
              reasons: s.reasons,
              poster_path: s.poster_path || movie.poster_path,
              score: s.score,
              trailerKey: trailer?.key || null,
              voteCategory,
              collectionName,
              genres,
              vote_average: movie.vote_average,
              vote_count: movie.vote_count,
              overview: movie.overview,
              contributingFilms: s.contributingFilms
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
          collectionName: undefined,
          genres: []
        };
      });

      const details = await Promise.all(detailsPromises);
      console.log('[Suggest] suggestions ready with full details', { count: details.length });

      // Track shown IDs for future refreshes
      setShownIds(prev => {
        const updated = new Set(prev);
        details.forEach(d => updated.add(d.id));
        return updated;
      });

      setItems(details);
    } catch (e: any) {
      console.error('[Suggest] error in runSuggest', e);
      setError(e?.message ?? 'Failed to get suggestions');
    } finally {
      console.log('[Suggest] runSuggest end');
      setLoading(false);
    }
  }, [uid, sourceFilms, excludeGenres, yearMin, yearMax, mode, refreshPosters, blockedIds, shownIds]);

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
    if (!hasCheckedStorage) return; // Wait for storage check
    void runSuggest();
  }, [uid, sourceFilms.length, loading, items, runSuggest, hasCheckedStorage]);

  // Recompute when mapping updates are emitted
  useEffect(() => {
    const handler = () => {
      setItems(null);
      void runSuggest();
    };
    const blockedHandler = async () => {
      if (uid) {
        const blocked = await getBlockedSuggestions(uid);
        setBlockedIds(blocked);
        setItems(null);
        void runSuggest();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('lettr:mappings-updated', handler);
      window.addEventListener('lettr:blocked-updated', blockedHandler);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('lettr:mappings-updated', handler);
        window.removeEventListener('lettr:blocked-updated', blockedHandler);
      }
    };
  }, [runSuggest, uid]);

  // Fetch a single replacement suggestion
  const fetchReplacementSuggestion = useCallback(async (): Promise<MovieItem | null> => {
    if (!uid || !sourceFilms) return null;

    try {
      const filteredFilms = sourceFilms;
      const uris = filteredFilms.map((f) => f.uri);
      const mappings = await getFilmMappings(uid, uris);

      // Build sets of watched and blocked IDs
      const watchedIds = new Set<number>();
      for (const f of filteredFilms) {
        const mid = mappings.get(f.uri);
        if (mid) watchedIds.add(mid);
      }

      // Get all currently shown IDs
      const currentShownIds = new Set([...shownIds, ...(items?.map(i => i.id) ?? [])]);

      // Generate candidates
      const highlyRated = filteredFilms
        .filter(f => (f.rating ?? 0) >= 4 || f.liked)
        .map(f => mappings.get(f.uri))
        .filter((id): id is number => id != null);

      const tasteProfile = await buildTasteProfile({
        films: filteredFilms,
        mappings,
        topN: 10
      });

      const smartCandidates = await generateSmartCandidates({
        highlyRatedIds: highlyRated,
        topGenres: tasteProfile.topGenres,
        topKeywords: tasteProfile.topKeywords,
        topDirectors: tasteProfile.topDirectors
      });

      let candidatesRaw: number[] = [];
      candidatesRaw.push(...smartCandidates.trending);
      candidatesRaw.push(...smartCandidates.similar);
      candidatesRaw.push(...smartCandidates.discovered);

      // Filter candidates
      const candidatesFiltered = candidatesRaw
        .filter((id, idx, arr) => arr.indexOf(id) === idx)
        .filter((id) => !watchedIds.has(id))
        .filter((id) => !blockedIds.has(id))
        .filter((id) => !currentShownIds.has(id));

      if (candidatesFiltered.length === 0) return null;

      // Shuffle and take one
      const shuffled = [...candidatesFiltered].sort(() => Math.random() - 0.5);
      const candidateId = shuffled[0];

      // Get suggestion details
      const lite = filteredFilms.map((f) => ({ uri: f.uri, title: f.title, year: f.year, rating: f.rating, liked: f.liked }));
      const suggestions = await suggestByOverlap({
        userId: uid,
        films: lite,
        mappings,
        candidates: [candidateId],
        excludeGenres: undefined,
        maxCandidates: 1,
        concurrency: 1,
        excludeWatchedIds: watchedIds,
        desiredResults: 1,
        enhancedProfile: {
          topActors: tasteProfile.topActors,
          topStudios: tasteProfile.topStudios,
          avoidGenres: tasteProfile.avoidGenres,
          avoidKeywords: tasteProfile.avoidKeywords,
          avoidDirectors: tasteProfile.avoidDirectors
        }
      });

      if (suggestions.length === 0) return null;

      const s = suggestions[0];

      // Fetch full movie details from TMDB
      let movie = null;

      try {
        const u = new URL('/api/tmdb/movie', window.location.origin);
        u.searchParams.set('id', String(s.tmdbId));
        u.searchParams.set('_t', String(Date.now())); // Cache buster
        const r = await fetch(u.toString(), { cache: 'no-store' });
        const j = await r.json();

        if (j.ok && j.movie) {
          movie = j.movie;
        }
      } catch (e) {
        console.error('[Suggest] Failed to fetch movie details', e);
      }

      if (movie) {
        const videos = movie.videos?.results || [];
        const trailer = videos.find((v: any) =>
          v.site === 'YouTube' && v.type === 'Trailer' && v.official
        ) || videos.find((v: any) =>
          v.site === 'YouTube' && v.type === 'Trailer'
        );

        // Use voteCategory from suggestByOverlap result (already calculated there)
        const voteCategory = s.voteCategory || 'standard';

        const collection = movie.belongs_to_collection;
        const collectionName = collection?.name || undefined;

        const genres = (movie.genres || []).map((g: any) => g.name);

        return {
          id: s.tmdbId,
          title: s.title ?? movie.title ?? `#${s.tmdbId}`,
          year: s.release_date?.slice(0, 4) || movie.release_date?.slice(0, 4),
          reasons: s.reasons,
          poster_path: s.poster_path || movie.poster_path,
          score: s.score,
          trailerKey: trailer?.key || null,
          voteCategory,
          collectionName,
          genres,
          vote_average: movie.vote_average,
          vote_count: movie.vote_count,
          overview: movie.overview,
          contributingFilms: s.contributingFilms
        };
      }

      return null;
    } catch (e) {
      console.error('[Suggest] Failed to fetch replacement:', e);
      return null;
    }
  }, [uid, sourceFilms, blockedIds, shownIds, items]);

  // Fetch replacement suggestions for a specific section
  const fetchSectionReplacements = useCallback(async (sectionName: string, count: number = 12): Promise<MovieItem[]> => {
    if (!uid || !sourceFilms || !items) return [];

    try {
      console.log(`[SectionRefresh] Fetching replacements for ${sectionName}`);

      const filteredFilms = sourceFilms;
      const uris = filteredFilms.map((f) => f.uri);
      const mappings = await getFilmMappings(uid, uris);

      // Build sets of watched and blocked IDs
      const watchedIds = new Set<number>();
      for (const f of filteredFilms) {
        const mid = mappings.get(f.uri);
        if (mid) watchedIds.add(mid);
      }

      // Get all currently shown IDs
      const currentShownIds = new Set([...shownIds, ...(items?.map(i => i.id) ?? [])]);

      // Generate candidates (smaller batch for section refresh)
      const highlyRated = filteredFilms
        .filter(f => (f.rating ?? 0) >= 4 || f.liked)
        .map(f => mappings.get(f.uri))
        .filter((id): id is number => id != null);

      // Fetch negative feedback to learn from dislikes
      let negativeFeedbackIds: number[] = [];
      try {
        const feedbackMap = await getFeedback(uid);
        negativeFeedbackIds = Array.from(feedbackMap.entries())
          .filter((entry): entry is [number, 'negative' | 'positive'] => entry[1] === 'negative')
          .map((entry) => entry[0]);
      } catch (e) {
        console.error('[SectionRefresh] Failed to fetch feedback', e);
      }

      const tasteProfile = await buildTasteProfile({
        films: filteredFilms,
        mappings,
        topN: 10,
        negativeFeedbackIds
      });

      const smartCandidates = await generateSmartCandidates({
        highlyRatedIds: highlyRated,
        topGenres: tasteProfile.topGenres,
        topKeywords: tasteProfile.topKeywords,
        topDirectors: tasteProfile.topDirectors
      });

      let candidatesRaw: number[] = [];
      candidatesRaw.push(...smartCandidates.trending);
      candidatesRaw.push(...smartCandidates.similar);
      candidatesRaw.push(...smartCandidates.discovered);

      // Filter candidates
      const candidatesFiltered = candidatesRaw
        .filter((id, idx, arr) => arr.indexOf(id) === idx)
        .filter((id) => !watchedIds.has(id))
        .filter((id) => !blockedIds.has(id))
        .filter((id) => !currentShownIds.has(id));

      // Shuffle and take a batch
      const shuffled = [...candidatesFiltered].sort(() => Math.random() - 0.5);
      const candidates = shuffled.slice(0, 100); // Smaller batch for section refresh

      if (candidates.length === 0) {
        console.log(`[SectionRefresh] No candidates available for ${sectionName}`);
        return [];
      }

      // Score the candidates
      const lite = filteredFilms.map((f) => ({ uri: f.uri, title: f.title, year: f.year, rating: f.rating, liked: f.liked }));
      const suggestions = await suggestByOverlap({
        userId: uid,
        films: lite,
        mappings,
        candidates,
        excludeGenres: undefined,
        maxCandidates: 100,
        concurrency: 3,
        excludeWatchedIds: watchedIds,
        desiredResults: count * 3, // Request more than needed to ensure enough after filtering
        enhancedProfile: {
          topActors: tasteProfile.topActors,
          topStudios: tasteProfile.topStudios,
          avoidGenres: tasteProfile.avoidGenres,
          avoidKeywords: tasteProfile.avoidKeywords,
          avoidDirectors: tasteProfile.avoidDirectors
        }
      });

      if (suggestions.length === 0) return [];

      // Fetch full movie details
      const detailsPromises = suggestions.map(async (s): Promise<MovieItem | null> => {
        try {
          const u = new URL('/api/tmdb/movie', window.location.origin);
          u.searchParams.set('id', String(s.tmdbId));
          u.searchParams.set('_t', String(Date.now()));
          const r = await fetch(u.toString(), { cache: 'no-store' });
          const j = await r.json();

          if (j.ok && j.movie) {
            const movie = j.movie;
            const videos = movie.videos?.results || [];
            const trailer = videos.find((v: any) =>
              v.site === 'YouTube' && v.type === 'Trailer' && v.official
            ) || videos.find((v: any) =>
              v.site === 'YouTube' && v.type === 'Trailer'
            );

            const voteCategory = s.voteCategory || 'standard';
            const collection = movie.belongs_to_collection;
            const collectionName = collection?.name || undefined;
            const genres = (movie.genres || []).map((g: any) => g.name);

            const movieItem: MovieItem = {
              id: s.tmdbId,
              title: s.title ?? movie.title ?? `#${s.tmdbId}`,
              year: s.release_date?.slice(0, 4) || movie.release_date?.slice(0, 4),
              reasons: s.reasons,
              poster_path: s.poster_path || movie.poster_path,
              score: s.score,
              trailerKey: trailer?.key || null,
              voteCategory,
              collectionName,
              genres,
              vote_average: movie.vote_average,
              vote_count: movie.vote_count,
              overview: movie.overview,
              contributingFilms: s.contributingFilms
            };
            return movieItem;
          }
        } catch (e) {
          console.error(`[SectionRefresh] Failed to fetch details for ${s.tmdbId}`, e);
        }
        return null;
      });

      const allDetails = await Promise.all(detailsPromises);
      const details: MovieItem[] = allDetails.filter((d): d is MovieItem => d !== null);

      // Filter by section criteria
      const seasonalConfig = getSeasonalRecommendationConfig();
      const sectionFilter = getSectionFilter(sectionName, seasonalConfig);
      const filtered = details.filter(sectionFilter) as MovieItem[];

      // Sort by score and take top N
      const sorted = filtered.sort((a, b) => b.score - a.score);
      const result = sorted.slice(0, count);

      console.log(`[SectionRefresh] Found ${result.length} replacements for ${sectionName}`);
      return result;
    } catch (e) {
      console.error(`[SectionRefresh] Failed to fetch replacements for ${sectionName}:`, e);
      return [];
    }
  }, [uid, sourceFilms, blockedIds, shownIds, items, getSectionFilter]);

  // Handle feedback
  const handleFeedback = async (tmdbId: number, type: 'negative' | 'positive') => {
    if (!uid) return;
    try {
      if (type === 'negative') {
        // Block the suggestion in the background
        await Promise.all([
          addFeedback(uid, tmdbId, 'negative'),
          blockSuggestion(uid, tmdbId)
        ]);

        setBlockedIds(prev => new Set([...prev, tmdbId]));
        setFeedbackMessage("Got it, we won't show this movie again.");
        setTimeout(() => setFeedbackMessage(null), 3000);

        // Mark the item as dismissed in items (source of truth for storage)
        setItems(prev => {
          if (!prev) return prev;
          return prev.map(item =>
            item.id === tmdbId ? { ...item, dismissed: true } : item
          );
        });

        // Mark the item as dismissed in categorizedSuggestions
        setCategorizedSuggestions((prev: CategorizedSuggestions | null) => {
          if (!prev) return prev;
          const next = { ...prev };

          // Find which section contains the item and mark it as dismissed
          for (const key in next) {
            // @ts-ignore - dynamic key access
            const section = next[key as keyof CategorizedSuggestions];
            if (Array.isArray(section)) {
              const idx = section.findIndex((item: MovieItem) => item.id === tmdbId);
              if (idx !== -1) {
                // Mark as dismissed
                const newArray = [...section];
                newArray[idx] = { ...newArray[idx], dismissed: true };
                // @ts-ignore - dynamic key assignment
                next[key as keyof CategorizedSuggestions] = newArray;
                break;
              }
            }
          }

          return next;
        });
      } else {
        // Positive feedback
        await addFeedback(uid, tmdbId, 'positive');
        setFeedbackMessage("Thanks! We'll show more movies like this.");
        setTimeout(() => setFeedbackMessage(null), 3000);
      }
    } catch (e) {
      console.error('Failed to submit feedback:', e);
      // On error for negative feedback, just remove the item from categories
      if (type === 'negative') {
        setCategorizedSuggestions((prev: CategorizedSuggestions | null) => {
          if (!prev) return prev;
          const next = { ...prev };
          for (const key in next) {
            // @ts-ignore - dynamic key access
            const section = next[key as keyof CategorizedSuggestions];
            if (Array.isArray(section)) {
              // @ts-ignore - dynamic key assignment
              next[key as keyof CategorizedSuggestions] = section.filter((item: MovieItem) => item.id !== tmdbId);
            }
          }
          return next;
        });
      }
    }
  };

  // Handle saving a movie to the list
  const handleSave = async (tmdbId: number, title: string, year?: string, posterPath?: string | null) => {
    if (!uid) return;
    try {
      const result = await saveMovie(uid, {
        tmdb_id: tmdbId,
        title,
        year: year || null,
        poster_path: posterPath || null
      });

      if (result.success) {
        setSavedMovieIds(prev => new Set([...prev, tmdbId]));
        setFeedbackMessage('Saved to your list!');
        setTimeout(() => setFeedbackMessage(null), 3000);
      } else {
        console.error('Failed to save movie:', result.error);
        // Check if it's a duplicate error
        if (result.error?.includes('duplicate') || result.error?.includes('unique')) {
          setFeedbackMessage('Already in your list!');
        } else {
          setFeedbackMessage('Failed to save movie');
        }
        setTimeout(() => setFeedbackMessage(null), 3000);
      }
    } catch (e) {
      console.error('Error saving movie:', e);
      setFeedbackMessage('Failed to save movie');
      setTimeout(() => setFeedbackMessage(null), 3000);
    }
  };

  // Handle refreshing a specific section
  const handleRefreshSection = async (sectionName: string) => {
    if (!uid || !categorizedSuggestions) return;

    setRefreshingSections(prev => new Set([...prev, sectionName]));

    try {
      console.log(`[SectionRefresh] Refreshing section: ${sectionName}`);

      // Get the movie IDs currently in this section (excluding dismissed ones)
      const currentSectionMovies = (categorizedSuggestions as any)[sectionName] || [];
      const nonDismissedMovies = currentSectionMovies.filter((m: MovieItem) => !m.dismissed);
      const dismissedMovies = currentSectionMovies.filter((m: MovieItem) => m.dismissed);
      const currentSectionIds = new Set(currentSectionMovies.map((m: MovieItem) => m.id));
      const dismissedIds = new Set(dismissedMovies.map((m: MovieItem) => m.id));

      console.log(`[SectionRefresh] Current section has ${currentSectionIds.size} movies (${dismissedIds.size} dismissed)`);

      // Fetch replacement movies for this section (replace both non-dismissed and dismissed)
      const replacements = await fetchSectionReplacements(sectionName, currentSectionIds.size || 12);

      if (replacements.length === 0) {
        console.log(`[SectionRefresh] No replacements found for ${sectionName}`);
        setRefreshingSections(prev => {
          const next = new Set(prev);
          next.delete(sectionName);
          return next;
        });
        return;
      }

      //Remove old section movies and add new ones
      setItems(prev => {
        if (!prev) return prev;

        // Filter out the old section movies
        const filtered = prev.filter(item => !currentSectionIds.has(item.id));

        // Add the new replacement movies
        const updated = [...filtered, ...replacements];

        console.log(`[SectionRefresh] Updated items: removed ${currentSectionIds.size}, added ${replacements.length}, total now ${updated.length}`);

        return updated;
      });

      // Track the new movies as shown
      setShownIds(prev => {
        const updated = new Set(prev);
        replacements.forEach(m => updated.add(m.id));
        // Keep only last 200
        const recentShownIds = Array.from(updated).slice(-200);
        return new Set(recentShownIds);
      });

    } catch (e) {
      console.error('Failed to refresh section:', e);
    } finally {
      setRefreshingSections(prev => {
        const next = new Set(prev);
        next.delete(sectionName);
        return next;
      });
    }
  };

  return (
    <AuthGate>
      {/* Feedback Toast */}
      {feedbackMessage && (
        <div className="fixed bottom-4 right-4 bg-gray-900 text-white px-4 py-2 rounded shadow-lg z-50 animate-fade-in-up">
          {feedbackMessage}
        </div>
      )}
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
              onClick={() => { setMode('quick'); setItems(null); setShownIds(new Set()); setRefreshTick((x) => x + 1); void runSuggest(); }}
            >
              Quick
            </button>
            <button
              type="button"
              className={`px-2 py-1 rounded border text-xs ${mode === 'deep' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
              onClick={() => { setMode('deep'); setItems(null); setShownIds(new Set()); setRefreshTick((x) => x + 1); void runSuggest(); }}
            >
              Deep dive
            </button>
          </div>
          <p className="text-[10px] text-gray-500">
            Quick is snappy; Deep dive scans more candidates.
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
            title="Get completely fresh suggestions (clears history)"
            onClick={() => { setItems(null); setShownIds(new Set()); setRefreshTick((x) => x + 1); void runSuggest(); }}
          >
            <span>🔄</span>
            <span>Refresh</span>
          </button>
        </div>
      </div>
      {loadingFilms && <p className="text-sm text-gray-600">Loading your library from database…</p>}
      {
        loading && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>Computing your recommendations…</span>
              <span className="text-xs">{Math.round((progress.current / progress.total) * 100)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-500 ease-out"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
            <p className="text-xs text-gray-500">{progress.stage}</p>
          </div>
        )
      }
      {error && <p className="text-sm text-red-600">{error}</p>}
      {
        !loading && !error && noCandidatesReason && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">
            {noCandidatesReason}
          </p>
        )
      }
      {
        items && categorizedSuggestions && (
          <div className="space-y-8">
            {sourceLabel && (
              <p className="text-xs text-gray-500 mb-4">Source: {sourceLabel}</p>
            )}

            {/* Seasonal/Holiday Recommendations Section */}
            {categorizedSuggestions.seasonalPicks.length >= 1 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">
                      {categorizedSuggestions.seasonalConfig.title.includes('Christmas') ? '🎄' :
                        categorizedSuggestions.seasonalConfig.title.includes('Halloween') ? '🎃' :
                          categorizedSuggestions.seasonalConfig.title.includes('Thanksgiving') ? '🦃' :
                            categorizedSuggestions.seasonalConfig.title.includes('Valentine') ? '💝' :
                              categorizedSuggestions.seasonalConfig.title.includes('Fourth') || categorizedSuggestions.seasonalConfig.title.includes('Independence') ? '🎆' :
                                categorizedSuggestions.seasonalConfig.title.includes('Easter') ? '🐰' : '📅'}
                    </span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">{categorizedSuggestions.seasonalConfig.title}</h2>
                      <p className="text-xs text-gray-600">{categorizedSuggestions.seasonalConfig.description}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('seasonalPicks')}
                    disabled={refreshingSections.has('seasonalPicks')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('seasonalPicks') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categorizedSuggestions.seasonalPicks.map((item) => (
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
                      onFeedback={handleFeedback}
                      onSave={handleSave}
                      isSaved={savedMovieIds.has(item.id)}
                      vote_average={item.vote_average}
                      vote_count={item.vote_count}
                      overview={item.overview}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Perfect Matches Section */}
            {categorizedSuggestions.perfectMatches.length >= 1 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🎯</span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Perfect Matches</h2>
                      <p className="text-xs text-gray-600">These match everything you love</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('perfectMatches')}
                    disabled={refreshingSections.has('perfectMatches')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('perfectMatches') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
                      onFeedback={handleFeedback}
                      onSave={handleSave}
                      isSaved={savedMovieIds.has(item.id)}
                      vote_average={item.vote_average}
                      vote_count={item.vote_count}
                      overview={item.overview}
                      contributingFilms={item.contributingFilms}
                      dismissed={item.dismissed}
                      imdb_rating={item.imdb_rating}
                      rotten_tomatoes={item.rotten_tomatoes}
                      metacritic={item.metacritic}
                      awards={item.awards}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Based on Recent Watches Section */}
            {categorizedSuggestions.recentWatchMatches.length >= 1 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">⏱️</span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Based on Recent Watches</h2>
                      <p className="text-xs text-gray-600">Similar to films you&apos;ve enjoyed recently</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('recentWatchMatches')}
                    disabled={refreshingSections.has('recentWatchMatches')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('recentWatchMatches') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categorizedSuggestions.recentWatchMatches.map((item) => (
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
                      onFeedback={handleFeedback}
                      onSave={handleSave}
                      isSaved={savedMovieIds.has(item.id)}
                      vote_average={item.vote_average}
                      vote_count={item.vote_count}
                      overview={item.overview}
                      contributingFilms={item.contributingFilms}
                      dismissed={item.dismissed}
                      imdb_rating={item.imdb_rating}
                      rotten_tomatoes={item.rotten_tomatoes}
                      metacritic={item.metacritic}
                      awards={item.awards}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Inspired by Directors You Love Section */}
            {categorizedSuggestions.directorMatches.length >= 1 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🎬</span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Inspired by Directors You Love</h2>
                      <p className="text-xs text-gray-600">From filmmakers you enjoy and directors with similar styles</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('directorMatches')}
                    disabled={refreshingSections.has('directorMatches')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('directorMatches') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
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
                      onFeedback={handleFeedback}
                      onSave={handleSave}
                      isSaved={savedMovieIds.has(item.id)}
                      vote_average={item.vote_average}
                      vote_count={item.vote_count}
                      overview={item.overview}
                      contributingFilms={item.contributingFilms}
                      dismissed={item.dismissed}
                      imdb_rating={item.imdb_rating}
                      rotten_tomatoes={item.rotten_tomatoes}
                      metacritic={item.metacritic}
                      awards={item.awards}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* From Studios You Love Section */}
            {categorizedSuggestions.studioMatches.length >= 1 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🎞️</span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">From Studios You Love</h2>
                      <p className="text-xs text-gray-600">More from production companies whose style you enjoy</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('studioMatches')}
                    disabled={refreshingSections.has('studioMatches')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('studioMatches') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categorizedSuggestions.studioMatches.map((item) => (
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
                      onFeedback={handleFeedback}
                      onSave={handleSave}
                      isSaved={savedMovieIds.has(item.id)}
                      vote_average={item.vote_average}
                      vote_count={item.vote_count}
                      overview={item.overview}
                      contributingFilms={item.contributingFilms}
                      dismissed={item.dismissed}
                      imdb_rating={item.imdb_rating}
                      rotten_tomatoes={item.rotten_tomatoes}
                      metacritic={item.metacritic}
                      awards={item.awards}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* From Actors You Love Section */}
            {categorizedSuggestions.actorMatches.length >= 1 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">⭐</span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">From Actors You Love</h2>
                      <p className="text-xs text-gray-600">More from your favorite performers</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('actorMatches')}
                    disabled={refreshingSections.has('actorMatches')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('actorMatches') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
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
                      onFeedback={handleFeedback}
                      onSave={handleSave}
                      isSaved={savedMovieIds.has(item.id)}
                      vote_average={item.vote_average}
                      vote_count={item.vote_count}
                      overview={item.overview}
                      contributingFilms={item.contributingFilms}
                      dismissed={item.dismissed}
                      imdb_rating={item.imdb_rating}
                      rotten_tomatoes={item.rotten_tomatoes}
                      metacritic={item.metacritic}
                      awards={item.awards}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Your Favorite Genres Section */}
            {categorizedSuggestions.genreMatches.length >= 1 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🎭</span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Your Favorite Genres</h2>
                      <p className="text-xs text-gray-600">Based on genres you watch most</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('genreMatches')}
                    disabled={refreshingSections.has('genreMatches')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('genreMatches') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
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
                      onFeedback={handleFeedback}
                      onSave={handleSave}
                      isSaved={savedMovieIds.has(item.id)}
                      vote_average={item.vote_average}
                      vote_count={item.vote_count}
                      overview={item.overview}
                      contributingFilms={item.contributingFilms}
                      dismissed={item.dismissed}
                      imdb_rating={item.imdb_rating}
                      rotten_tomatoes={item.rotten_tomatoes}
                      metacritic={item.metacritic}
                      awards={item.awards}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Documentaries Section */}
            {categorizedSuggestions.documentaries.length >= 1 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">📹</span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Documentaries</h2>
                      <p className="text-xs text-gray-600">Real stories and factual films</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('documentaries')}
                    disabled={refreshingSections.has('documentaries')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('documentaries') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categorizedSuggestions.documentaries.map((item) => (
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
                      onFeedback={handleFeedback}
                      onSave={handleSave}
                      isSaved={savedMovieIds.has(item.id)}
                      vote_average={item.vote_average}
                      vote_count={item.vote_count}
                      overview={item.overview}
                      contributingFilms={item.contributingFilms}
                      dismissed={item.dismissed}
                      imdb_rating={item.imdb_rating}
                      rotten_tomatoes={item.rotten_tomatoes}
                      metacritic={item.metacritic}
                      awards={item.awards}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Best of the [Decade]s Section */}
            {categorizedSuggestions.decadeMatches.length >= 1 && topDecade && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">📅</span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Best of the {topDecade}s</h2>
                      <p className="text-xs text-gray-600">Top picks from your favorite era</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('decadeMatches')}
                    disabled={refreshingSections.has('decadeMatches')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('decadeMatches') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categorizedSuggestions.decadeMatches.map((item) => (
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
                      onFeedback={handleFeedback}
                      onSave={handleSave}
                      isSaved={savedMovieIds.has(item.id)}
                      vote_average={item.vote_average}
                      vote_count={item.vote_count}
                      overview={item.overview}
                      contributingFilms={item.contributingFilms}
                      dismissed={item.dismissed}
                      imdb_rating={item.imdb_rating}
                      rotten_tomatoes={item.rotten_tomatoes}
                      metacritic={item.metacritic}
                      awards={item.awards}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Smart Discovery (Hidden Gems) Section */}
            {categorizedSuggestions.smartDiscovery.length >= 1 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">💎</span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Hidden Gems for You</h2>
                      <p className="text-xs text-gray-600">Highly rated films you might have missed</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('smartDiscovery')}
                    disabled={refreshingSections.has('smartDiscovery')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('smartDiscovery') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categorizedSuggestions.smartDiscovery.map((item) => (
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
                      onFeedback={handleFeedback}
                      onSave={handleSave}
                      isSaved={savedMovieIds.has(item.id)}
                      vote_average={item.vote_average}
                      vote_count={item.vote_count}
                      overview={item.overview}
                      contributingFilms={item.contributingFilms}
                      dismissed={item.dismissed}
                      imdb_rating={item.imdb_rating}
                      rotten_tomatoes={item.rotten_tomatoes}
                      metacritic={item.metacritic}
                      awards={item.awards}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Hidden Gems Section */}
            {categorizedSuggestions.hiddenGems.length >= 1 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🔍</span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Hidden Gems</h2>
                      <p className="text-xs text-gray-600">Older films that match your taste</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('hiddenGems')}
                    disabled={refreshingSections.has('hiddenGems')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('hiddenGems') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
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
                      onFeedback={handleFeedback}
                      onSave={handleSave}
                      isSaved={savedMovieIds.has(item.id)}
                      vote_average={item.vote_average}
                      vote_count={item.vote_count}
                      overview={item.overview}
                      contributingFilms={item.contributingFilms}
                      dismissed={item.dismissed}
                      imdb_rating={item.imdb_rating}
                      rotten_tomatoes={item.rotten_tomatoes}
                      metacritic={item.metacritic}
                      awards={item.awards}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Cult Classics Section */}
            {categorizedSuggestions.cultClassics.length >= 1 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🎭</span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Cult Classics</h2>
                      <p className="text-xs text-gray-600">Films with dedicated followings</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('cultClassics')}
                    disabled={refreshingSections.has('cultClassics')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('cultClassics') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
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
                      onFeedback={handleFeedback}
                      onSave={handleSave}
                      isSaved={savedMovieIds.has(item.id)}
                      vote_average={item.vote_average}
                      vote_count={item.vote_count}
                      overview={item.overview}
                      contributingFilms={item.contributingFilms}
                      dismissed={item.dismissed}
                      imdb_rating={item.imdb_rating}
                      rotten_tomatoes={item.rotten_tomatoes}
                      metacritic={item.metacritic}
                      awards={item.awards}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Crowd Pleasers Section */}
            {categorizedSuggestions.crowdPleasers.length >= 1 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🎉</span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Crowd Pleasers</h2>
                      <p className="text-xs text-gray-600">Widely loved and highly rated</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('crowdPleasers')}
                    disabled={refreshingSections.has('crowdPleasers')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('crowdPleasers') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
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
                      onFeedback={handleFeedback}
                      onSave={handleSave}
                      isSaved={savedMovieIds.has(item.id)}
                      vote_average={item.vote_average}
                      vote_count={item.vote_count}
                      overview={item.overview}
                      contributingFilms={item.contributingFilms}
                      dismissed={item.dismissed}
                      imdb_rating={item.imdb_rating}
                      rotten_tomatoes={item.rotten_tomatoes}
                      metacritic={item.metacritic}
                      awards={item.awards}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* New & Trending Section */}
            {categorizedSuggestions.newReleases.length >= 1 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">✨</span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">New & Trending</h2>
                      <p className="text-xs text-gray-600">Fresh picks based on your taste</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('newReleases')}
                    disabled={refreshingSections.has('newReleases')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('newReleases') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
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
                      onFeedback={handleFeedback}
                      onSave={handleSave}
                      isSaved={savedMovieIds.has(item.id)}
                      vote_average={item.vote_average}
                      vote_count={item.vote_count}
                      overview={item.overview}
                      contributingFilms={item.contributingFilms}
                      dismissed={item.dismissed}
                      imdb_rating={item.imdb_rating}
                      rotten_tomatoes={item.rotten_tomatoes}
                      metacritic={item.metacritic}
                      awards={item.awards}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Recent Classics Section */}
            {categorizedSuggestions.recentClassics.length >= 1 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🎬</span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Recent Classics</h2>
                      <p className="text-xs text-gray-600">Great films from 2015-2022</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('recentClassics')}
                    disabled={refreshingSections.has('recentClassics')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('recentClassics') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
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
                      onFeedback={handleFeedback}
                      onSave={handleSave}
                      isSaved={savedMovieIds.has(item.id)}
                      vote_average={item.vote_average}
                      vote_count={item.vote_count}
                      overview={item.overview}
                      contributingFilms={item.contributingFilms}
                      dismissed={item.dismissed}
                      imdb_rating={item.imdb_rating}
                      rotten_tomatoes={item.rotten_tomatoes}
                      metacritic={item.metacritic}
                      awards={item.awards}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Deep Cuts Section */}
            {categorizedSuggestions.deepCuts.length >= 1 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🌟</span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Deep Cuts</h2>
                      <p className="text-xs text-gray-600">Niche matches for your specific taste</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('deepCuts')}
                    disabled={refreshingSections.has('deepCuts')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('deepCuts') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
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
                      onFeedback={handleFeedback}
                      onSave={handleSave}
                      isSaved={savedMovieIds.has(item.id)}
                      vote_average={item.vote_average}
                      vote_count={item.vote_count}
                      overview={item.overview}
                      contributingFilms={item.contributingFilms}
                      dismissed={item.dismissed}
                      imdb_rating={item.imdb_rating}
                      rotten_tomatoes={item.rotten_tomatoes}
                      metacritic={item.metacritic}
                      awards={item.awards}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* From Collections Section */}
            {categorizedSuggestions.fromCollections.length >= 1 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">📚</span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">From Collections</h2>
                      <p className="text-xs text-gray-600">Complete franchises and series</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('fromCollections')}
                    disabled={refreshingSections.has('fromCollections')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('fromCollections') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
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
                      onFeedback={handleFeedback}
                      onSave={handleSave}
                      isSaved={savedMovieIds.has(item.id)}
                      vote_average={item.vote_average}
                      vote_count={item.vote_count}
                      overview={item.overview}
                      contributingFilms={item.contributingFilms}
                      dismissed={item.dismissed}
                      imdb_rating={item.imdb_rating}
                      rotten_tomatoes={item.rotten_tomatoes}
                      metacritic={item.metacritic}
                      awards={item.awards}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* More Recommendations Section - Fallback for remaining suggestions */}
            {categorizedSuggestions.moreRecommendations.length >= 1 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🎥</span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">More Recommendations</h2>
                      <p className="text-xs text-gray-600">Additional films you might enjoy</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('moreRecommendations')}
                    disabled={refreshingSections.has('moreRecommendations')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('moreRecommendations') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
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
                      onFeedback={handleFeedback}
                      onSave={handleSave}
                      isSaved={savedMovieIds.has(item.id)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )
      }
      {
        !items && (
          <p className="text-gray-700">Your personalized recommendations will appear here.</p>
        )
      }
    </AuthGate >
  );
}


