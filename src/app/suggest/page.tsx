'use client';
import AuthGate from '@/components/AuthGate';
import MovieCard from '@/components/MovieCard';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useImportData } from '@/lib/importStore';
import { supabase } from '@/lib/supabaseClient';
import { getFilmMappings, getBulkTmdbDetails, refreshTmdbCacheForIds, suggestByOverlap, buildTasteProfile, findIncompleteCollections, discoverFromLists, getBlockedSuggestions, blockSuggestion, unblockSuggestion, addFeedback, getFeedback, getAvoidedFeatures, getMovieFeaturesForPopup, boostExplicitFeedback, fetchSourceReliability, recordPairwiseEvent, applyPairwiseFeatureLearning, type FeedbackLearningInsights } from '@/lib/enrich';
import { fetchTrendingIds, fetchSimilarMovieIds, generateSmartCandidates, getDecadeCandidates, getSmartDiscoveryCandidates, generateExploratoryPicks } from '@/lib/trending';
import { usePostersSWR } from '@/lib/usePostersSWR';
import { getCurrentSeasonalGenres, getSeasonalRecommendationConfig } from '@/lib/genreEnhancement';
import { saveMovie, getSavedMovies } from '@/lib/lists';
import { updateExplorationStats, getAdaptiveExplorationRate, getGenreTransitions, handleNegativeFeedback } from '@/lib/adaptiveLearning';
import type { FilmEvent } from '@/lib/normalize';

/**
 * Helper to get the base URL for internal API calls
 */
function getBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
}

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
  // Multi-source recommendation data
  sources?: string[];
  consensusLevel?: 'high' | 'medium' | 'low';
  reliabilityMultiplier?: number;
  // Additional metadata for new sections
  runtime?: number; // in minutes
  original_language?: string;
  spoken_languages?: string[];
  production_countries?: string[];
};

type CategorizedSuggestions = {
  watchlistPicks: MovieItem[]; // NEW: Picks from user's Letterboxd watchlist
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
  multiSourceConsensus: MovieItem[];
  internationalCinema: MovieItem[];
  animationPicks: MovieItem[];
  quickWatches: MovieItem[];
  epicFilms: MovieItem[];
  criticallyAcclaimed: MovieItem[];
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
  const [discoveryLevel, setDiscoveryLevel] = useState<number>(50); // 0 = safety, 100 = discovery
  const [refreshTick, setRefreshTick] = useState(0);
  const [mode, setMode] = useState<'quick' | 'deep'>('quick');
  const [noCandidatesReason, setNoCandidatesReason] = useState<string | null>(null);
  const [blockedIds, setBlockedIds] = useState<Set<number>>(new Set());
  const [refreshingSections, setRefreshingSections] = useState<Set<string>>(new Set());
  const [shownIds, setShownIds] = useState<Set<number>>(new Set());
  const [cacheKey, setCacheKey] = useState<number>(Date.now());
  const [progress, setProgress] = useState({ current: 0, total: 6, stage: '' });
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [undoToast, setUndoToast] = useState<{ id: number; title: string } | null>(null);
  const [lastFeedback, setLastFeedback] = useState<{ id: number; title: string } | null>(null);
  const [topDecade, setTopDecade] = useState<number | null>(null);
  const [savedMovieIds, setSavedMovieIds] = useState<Set<number>>(new Set());
  const [hasCheckedStorage, setHasCheckedStorage] = useState(false);
  const [mappingCoverage, setMappingCoverage] = useState<{ mapped: number; total: number } | null>(null);
  const [watchlistPicks, setWatchlistPicks] = useState<MovieItem[]>([]); // Picks from user's Letterboxd watchlist
  const [pairHistory, setPairHistory] = useState<Set<string>>(new Set());
  const [pairwisePair, setPairwisePair] = useState<{ a: MovieItem; b: MovieItem } | null>(null);
  const [pairwiseCount, setPairwiseCount] = useState<number>(0);
  const PAIRWISE_SESSION_LIMIT = 3;
  
  // Hybrid feedback popup state - optional "tell us why" after feedback
  const [feedbackPopup, setFeedbackPopup] = useState<{
    tmdbId: number;
    title: string;
    insights: FeedbackLearningInsights;
    leadActors: string[];
    franchise?: string;
    topKeywords: string[];
    genres: string[];
    feedbackType: 'positive' | 'negative'; // NEW: track which type of feedback
    director?: string; // NEW: for positive feedback
  } | null>(null);

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

  // Load pairwise history (to avoid repeating the same comparison)
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('lettrsuggest_pair_history');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setPairHistory(new Set(parsed));
        }
      }
    } catch (e) {
      console.error('[Suggest] Failed to restore pair history', e);
    }
  }, []);

  // Track how many pairwise prompts have been shown this session
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('lettrsuggest_pairwise_count');
      if (stored != null) {
        setPairwiseCount(Number(stored) || 0);
      }
    } catch (e) {
      console.error('[Suggest] Failed to restore pairwise count', e);
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

  useEffect(() => {
    try {
      sessionStorage.setItem('lettrsuggest_pair_history', JSON.stringify(Array.from(pairHistory)));
    } catch (e) {
      console.error('[Suggest] Failed to persist pair history', e);
    }
  }, [pairHistory]);

  useEffect(() => {
    try {
      sessionStorage.setItem('lettrsuggest_pairwise_count', String(pairwiseCount));
    } catch (e) {
      console.error('[Suggest] Failed to persist pairwise count', e);
    }
  }, [pairwiseCount]);

  // Get posters for all suggested movies (including watchlist picks)
  const tmdbIds = useMemo(() => {
    const mainIds = items?.map((it) => it.id) ?? [];
    const watchlistIds = watchlistPicks.map((it) => it.id);
    return [...new Set([...mainIds, ...watchlistIds])]; // Dedupe
  }, [items, watchlistPicks]);
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

    // ============================================
    // PHASE 1: HIGHLY SPECIFIC SECTIONS (extract first to ensure they get items)
    // These sections have very specific criteria that may only match a few items
    // ============================================

    // 0. Seasonal Recommendations (if applicable - time-sensitive)
    const seasonalPicks = seasonalConfig.genres.length > 0 ?
      getNextItems(isSeasonalMatch, 12) : [];

    console.log('[Suggest] Seasonal picks result', {
      configGenres: seasonalConfig.genres,
      configKeywords: seasonalConfig.keywords,
      seasonalPicksCount: seasonalPicks.length
    });

    // 1. Multi-Source Consensus: Films recommended by multiple sources (rare, high-value)
    const multiSourceConsensus = getNextItems(item => {
      return (item.sources?.length ?? 0) >= 2;
    }, 12);

    // 2. Animation Picks: Animated films (specific genre, not many)
    const animationPicks = getNextItems(item => {
      if (!item.genres || item.genres.length === 0) return false;
      const hasAnimation = item.genres.some(g => g === 'Animation');
      const isDocumentary = item.genres.some(g => g === 'Documentary');
      return hasAnimation && !isDocumentary;
    }, 12);

    // 3. Documentaries (specific genre)
    const documentaries = getNextItems(item => {
      if (!item.genres || item.genres.length === 0) return false;
      return item.genres.some(g => g === 'Documentary');
    }, 12);

    // 4. International Cinema: Non-English films (specific language filter)
    const internationalCinema = getNextItems(item => {
      return Boolean(item.original_language && item.original_language !== 'en');
    }, 12);

    // 5. Quick Watches: Films under 100 minutes (specific runtime)
    const quickWatches = getNextItems(item => {
      return Boolean(item.runtime && item.runtime > 0 && item.runtime <= 100);
    }, 12);

    // 6. Epic Films: Films over 150 minutes (specific runtime)
    const epicFilms = getNextItems(item => {
      return Boolean(item.runtime && item.runtime >= 150);
    }, 12);

    // 7. Critically Acclaimed: Very high ratings (specific threshold)
    const criticallyAcclaimed = getNextItems(item => {
      const imdbRating = parseFloat(item.imdb_rating || '0');
      const rtScore = parseInt(item.rotten_tomatoes?.replace('%', '') || '0');
      const metaScore = parseInt(item.metacritic || '0');
      return imdbRating >= 8.0 || rtScore >= 90 || metaScore >= 80;
    }, 12);

    // 8. From Collections: Films in same collections/franchises (specific metadata)
    const fromCollections = getNextItems(item => !!item.collectionName, 12);

    // ============================================
    // PHASE 2: VOTE CATEGORY SECTIONS (moderately specific)
    // ============================================

    // 9. Hidden Gems (Smart Discovery): Films with hidden-gem vote category
    const smartDiscovery = getNextItems(item => {
      return item.voteCategory === 'hidden-gem';
    }, 12);

    // 10. Classic Hidden Gems: Pre-2015 hidden gems
    const hiddenGems = getNextItems(item => {
      const year = parseInt(item.year || '0');
      return year > 0 && year < 2015 && item.voteCategory === 'hidden-gem';
    }, 12);

    // 11. Cult Classics: Films with cult following
    const cultClassics = getNextItems(item => {
      return item.voteCategory === 'cult-classic';
    }, 12);

    // 12. Crowd Pleasers: Popular high-rated films
    const crowdPleasers = getNextItems(item => {
      return item.voteCategory === 'crowd-pleaser';
    }, 12);

    // ============================================
    // PHASE 3: REASON-BASED SECTIONS (medium specificity)
    // ============================================

    // 13. Based on Recent Watches: Films similar to recent favorites
    const recentWatchMatches = getNextItems(item => hasRecentWatchMatch(item.reasons), 12);

    // 14. Inspired by Directors You Love
    const directorMatches = getNextItems(item => hasDirectorMatch(item.reasons), 12);

    // 15. From Studios You Love
    const studioMatches = getNextItems(item => hasStudioMatch(item.reasons), 12);

    // 16. From Actors You Love
    const actorMatches = getNextItems(item => hasActorMatch(item.reasons), 12);

    // 17. Your Favorite Genres
    const genreMatches = getNextItems(item => hasGenreMatch(item.reasons), 12);

    // 18. Deep Cuts: Films with specific theme/keyword matches
    const deepCuts = getNextItems(item => hasDeepCutThemes(item.reasons), 12);

    // ============================================
    // PHASE 4: TIME-BASED SECTIONS (broad filters)
    // ============================================

    // 19. Best of the [Decade]s
    const decadeMatches = topDecade ? getNextItems(item => {
      const year = parseInt(item.year || '0');
      return year >= topDecade && year < topDecade + 10;
    }, 12) : [];

    // 20. New & Trending: Recent releases (2023+)
    const newReleases = getNextItems(item => {
      const year = parseInt(item.year || '0');
      return year >= 2023;
    }, 12);

    // 21. Recent Classics: Films from 2015-2022
    const recentClassics = getNextItems(item => {
      const year = parseInt(item.year || '0');
      return year >= 2015 && year < 2023;
    }, 12);

    // ============================================
    // PHASE 5: CATCH-ALL SECTIONS (least specific, gets remaining items)
    // ============================================

    // 22. Perfect Matches: Top scoring films that haven't been categorized yet
    const perfectMatches = getNextItems(() => true, 12);

    // 23. More Recommendations: Any remaining films
    const moreRecommendations = getNextItems(() => true, 24); // Increased to catch more

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
      multiSourceConsensus: multiSourceConsensus.length,
      internationalCinema: internationalCinema.length,
      animationPicks: animationPicks.length,
      quickWatches: quickWatches.length,
      epicFilms: epicFilms.length,
      criticallyAcclaimed: criticallyAcclaimed.length,
      moreRecommendations: moreRecommendations.length,
      totalUsed: usedIds.size,
      totalAvailable: items.length
    });

    return {
      watchlistPicks: [], // Will be populated separately from watchlistPicks state
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
      multiSourceConsensus: sortByRating(multiSourceConsensus),
      internationalCinema: sortByRating(internationalCinema),
      animationPicks: sortByRating(animationPicks),
      quickWatches: sortByRating(quickWatches),
      epicFilms: sortByRating(epicFilms),
      criticallyAcclaimed: sortByRating(criticallyAcclaimed),
      moreRecommendations: sortByRating(moreRecommendations)
    };
  }, [topDecade]);

  // Update categories when items change
  useEffect(() => {
    if (items && items.length > 0) {
      const categorized = categorizeItems(items);
      if (categorized) {
        // Merge watchlist picks into categorized suggestions
        categorized.watchlistPicks = watchlistPicks;
      }
      setCategorizedSuggestions(categorized);
    } else {
      setCategorizedSuggestions(null);
    }
  }, [items, categorizeItems, watchlistPicks]);

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
      documentaries: (item) => {
        if (!item.genres || item.genres.length === 0) return false;
        return item.genres.some(g => g === 'Documentary');
      },
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
      multiSourceConsensus: (item) => (item.sources?.length ?? 0) >= 2,
      internationalCinema: (item) => Boolean(item.original_language && item.original_language !== 'en'),
      animationPicks: (item) => {
        if (!item.genres || item.genres.length === 0) return false;
        const hasAnimation = item.genres.some(g => g === 'Animation');
        const isDocumentary = item.genres.some(g => g === 'Documentary');
        return hasAnimation && !isDocumentary;
      },
      quickWatches: (item) => Boolean(item.runtime && item.runtime > 0 && item.runtime <= 100),
      epicFilms: (item) => Boolean(item.runtime && item.runtime >= 150),
      criticallyAcclaimed: (item) => {
        const imdbRating = parseFloat(item.imdb_rating || '0');
        const rtScore = parseInt(item.rotten_tomatoes?.replace('%', '') || '0');
        const metaScore = parseInt(item.metacritic || '0');
        return imdbRating >= 8.0 || rtScore >= 90 || metaScore >= 80;
      },
      perfectMatches: () => true,
      moreRecommendations: () => true,
    };

    return filters[sectionName] || (() => true);
  }, [topDecade]);

  const makePairId = useCallback((a: number, b: number) => [a, b].sort((x, y) => x - y).join('-'), []);

  const reasonTypeTags = useCallback((reasons: string[]) => {
    const tags = new Set<string>();
    for (const r of reasons) {
      const lower = r.toLowerCase();
      if (lower.includes('director')) tags.add('director');
      if (lower.includes('star') || lower.includes('cast')) tags.add('actor');
      if (lower.includes('genre') || lower.includes('taste in')) tags.add('genre');
      if (lower.includes('theme') || lower.includes('keyword')) tags.add('theme');
      if (lower.includes('recent')) tags.add('recent');
      if (lower.includes('watchlist')) tags.add('watchlist');
    }
    return tags;
  }, []);

  const findPairwiseCandidate = useCallback(
    (list: MovieItem[], history: Set<string>): { a: MovieItem; b: MovieItem } | null => {
      if (!list || list.length < 2) return null;
      const sorted = [...list].sort((a, b) => b.score - a.score);
      const maxPairsToConsider = Math.min(sorted.length - 1, 12);

      for (let i = 0; i < maxPairsToConsider; i++) {
        const first = sorted[i];
        const second = sorted[i + 1];
        const pairKey = makePairId(first.id, second.id);
        if (history.has(pairKey)) continue;

        const delta = Math.abs(first.score - second.score);
        if (delta > 0.6) continue; // Only prompt on near-ties

        const tagsA = reasonTypeTags(first.reasons);
        const tagsB = reasonTypeTags(second.reasons);
        const shared = Array.from(tagsA).some((t) => tagsB.has(t));
        if (!shared) continue; // Only when reasons overlap (reduces noise)

        return { a: first, b: second };
      }

      // Fallback: none found
      return null;
    },
    [makePairId, reasonTypeTags]
  );

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
      setProgress({ current: 0, total: 6, stage: 'Initializing...' });
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
      setProgress({ current: 1, total: 6, stage: 'Loading your library...' });
      const mappings = await getFilmMappings(uid, uris);
      console.log('[Suggest] mappings loaded', { mappingCount: mappings.size, totalFilms: uris.length });
      
      // Track mapping coverage for UI feedback
      setMappingCoverage({ mapped: mappings.size, total: uris.length });

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

      // Pre-fetch all TMDB details from cache for better taste profile analysis
      console.log('[Suggest] Pre-fetching TMDB details from cache');
      setProgress({ current: 2, total: 6, stage: 'Loading movie details from cache...' });
      const allMappedIds = Array.from(mappings.values());
      const tmdbDetailsMap = await getBulkTmdbDetails(allMappedIds);
      console.log('[Suggest] TMDB details loaded from cache', { 
        requested: allMappedIds.length, 
        found: tmdbDetailsMap.size,
        coverage: `${((tmdbDetailsMap.size / allMappedIds.length) * 100).toFixed(1)}%`
      });

      // Build taste profile with IDs for smarter discovery
      console.log('[Suggest] Building taste profile for smart discovery');
      setProgress({ current: 3, total: 6, stage: 'Analyzing your taste profile...' });

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

      // Fetch feature-level feedback (learned from "Not Interested" / "More Like This" clicks)
      // This identifies specific actors, keywords, franchises user has shown aversion/preference to
      let featureFeedback = null;
      try {
        featureFeedback = await getAvoidedFeatures(uid);
        console.log('[Suggest] Loaded feature feedback', {
          avoidActors: featureFeedback.avoidActors.map(a => a.name).slice(0, 3),
          avoidKeywords: featureFeedback.avoidKeywords.map(k => k.name).slice(0, 5),
          avoidFranchises: featureFeedback.avoidFranchises.map(f => f.name),
          preferActors: featureFeedback.preferActors.map(a => a.name).slice(0, 3),
          preferKeywords: featureFeedback.preferKeywords.map(k => k.name).slice(0, 5)
        });
      } catch (e) {
        console.error('[Suggest] Failed to fetch feature feedback', e);
      }

      // Get watchlist films for intent signals
      const watchlistFilms = sourceFilms.filter(f => f.onWatchlist && mappings.has(f.uri));
      const watchlistEntries = watchlistFilms.map(f => ({
        tmdbId: mappings.get(f.uri)!,
        addedAt: f.watchlistAddedAt ?? null,
      }));
      console.log('[Suggest] Watchlist films for taste profile:', watchlistFilms.length);

      const tasteProfile = await buildTasteProfile({
        films: filteredFilms,
        mappings,
        topN: 10,
        negativeFeedbackIds,
        tmdbDetails: tmdbDetailsMap, // Pass pre-fetched details to analyze ALL movies, not just 100
        watchlistFilms // Pass watchlist for intent signals
      });

      // === GENERATE WATCHLIST PICKS ===
      // Get unwatched watchlist films (onWatchlist=true but not watched)
      const unwatchedWatchlist = sourceFilms.filter(f => 
        f.onWatchlist && 
        (!f.watchCount || f.watchCount === 0) && 
        mappings.has(f.uri)
      );
      console.log('[Suggest] Unwatched watchlist films:', unwatchedWatchlist.length);

      // Get recent watches for similarity scoring (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentWatches = filteredFilms
        .filter(f => f.lastDate && new Date(f.lastDate) >= thirtyDaysAgo && (f.rating ?? 0) >= 3)
        .sort((a, b) => new Date(b.lastDate!).getTime() - new Date(a.lastDate!).getTime())
        .slice(0, 20);
      
      // Get TMDB IDs and details for recent watches
      const recentWatchDetails: Array<{ tmdbId: number; genres: number[]; keywords: number[] }> = [];
      for (const film of recentWatches) {
        const tmdbId = mappings.get(film.uri);
        if (!tmdbId) continue;
        const details = tmdbDetailsMap.get(tmdbId);
        if (details) {
          recentWatchDetails.push({
            tmdbId,
            genres: (details.genres || []).map((g: any) => g.id),
            keywords: (details.keywords?.keywords || []).map((k: any) => k.id).slice(0, 10)
          });
        }
      }

      // Score watchlist films
      const scoredWatchlist: Array<{ film: FilmEvent; tmdbId: number; score: number; reasons: string[] }> = [];
      for (const film of unwatchedWatchlist) {
        const tmdbId = mappings.get(film.uri);
        if (!tmdbId) continue;
        
        const details = tmdbDetailsMap.get(tmdbId);
        if (!details) continue;
        
        const filmGenres = new Set((details.genres || []).map((g: any) => g.id));
        const filmKeywords = new Set((details.keywords?.keywords || []).map((k: any) => k.id));
        
        let similarityScore = 0;
        let genreScore = 0;
        const reasons: string[] = ['From your Letterboxd watchlist'];
        
        // 60%: Similarity to recent watches
        for (const recent of recentWatchDetails) {
          const genreOverlap = recent.genres.filter(g => filmGenres.has(g)).length;
          const keywordOverlap = recent.keywords.filter(k => filmKeywords.has(k)).length;
          similarityScore += (genreOverlap * 3 + keywordOverlap * 2);
        }
        if (recentWatchDetails.length > 0) {
          similarityScore = (similarityScore / recentWatchDetails.length) * 0.6;
          if (similarityScore > 0) {
            reasons.push('Similar to your recent watches');
          }
        }
        
        // 20%: Match with top genres from taste profile
        const topGenreIds = new Set(tasteProfile.topGenres.slice(0, 5).map(g => g.id));
        for (const genreId of filmGenres) {
          if (topGenreIds.has(genreId)) {
            genreScore += 5;
            const genreName = tasteProfile.topGenres.find(g => g.id === genreId)?.name;
            if (genreName && !reasons.some(r => r.includes(genreName))) {
              reasons.push(`Matches your love of ${genreName}`);
            }
          }
        }
        genreScore = genreScore * 0.2;
        
        // 20%: Random factor for variety
        const randomScore = Math.random() * 10 * 0.2;
        
        const totalScore = similarityScore + genreScore + randomScore;
        scoredWatchlist.push({ film, tmdbId, score: totalScore, reasons });
      }

      // Sort by score and take top 5 (keep it short and sweet)
      scoredWatchlist.sort((a, b) => b.score - a.score);
      const topWatchlistPicks = scoredWatchlist.slice(0, 5);
      
      console.log('[Suggest] Top watchlist picks:', topWatchlistPicks.length);

      // Fetch full details for watchlist picks
      const watchlistPicksWithDetails: MovieItem[] = [];
      for (const pick of topWatchlistPicks) {
        try {
          const u = new URL('/api/tmdb/movie', getBaseUrl());
          u.searchParams.set('id', String(pick.tmdbId));
          u.searchParams.set('_t', String(freshCacheKey));
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
            
            watchlistPicksWithDetails.push({
              id: pick.tmdbId,
              title: movie.title || pick.film.title,
              year: movie.release_date?.slice(0, 4) || String(pick.film.year || ''),
              reasons: pick.reasons,
              poster_path: movie.poster_path,
              score: pick.score,
              trailerKey: trailer?.key || null,
              voteCategory: 'standard',
              collectionName: movie.belongs_to_collection?.name,
              genres: (movie.genres || []).map((g: any) => g.name),
              vote_average: movie.vote_average,
              vote_count: movie.vote_count,
              overview: movie.overview,
              runtime: movie.runtime,
              original_language: movie.original_language
            });
          }
        } catch (e) {
          console.error(`[Suggest] Failed to fetch watchlist pick ${pick.tmdbId}`, e);
        }
      }
      
      // Set watchlist picks state
      setWatchlistPicks(watchlistPicksWithDetails);
      console.log('[Suggest] Watchlist picks ready:', watchlistPicksWithDetails.length);
      
      // Refresh poster cache for watchlist picks
      if (watchlistPicksWithDetails.length > 0) {
        try {
          const watchlistIdsForCache = watchlistPicksWithDetails.map(p => p.id);
          await refreshTmdbCacheForIds(watchlistIdsForCache);
        } catch (e) {
          console.error('[Suggest] Failed to refresh watchlist poster cache', e);
        }
      }
      // === END WATCHLIST PICKS ===

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
      setProgress({ current: 4, total: 6, stage: 'Discovering movies...' });
      const smartCandidates = await generateSmartCandidates({
        highlyRatedIds: highlyRated,
        topGenres: tasteProfile.topGenres,
        topKeywords: tasteProfile.topKeywords,
        topDirectors: tasteProfile.topDirectors,
        topActors: tasteProfile.topActors,
        topStudios: tasteProfile.topStudios,
        tmdbDetailsMap // Pass details for TasteDive to use titles
      });

      // Fetch decade candidates
      let decadeCandidates: number[] = [];
      if (tasteProfile.topDecades.length > 0) {
        const topDecade = tasteProfile.topDecades[0].decade;
        decadeCandidates = await getDecadeCandidates(topDecade);
      }

      // Fetch smart discovery candidates (hidden gems)
      const discoveryCandidates = await getSmartDiscoveryCandidates(tasteProfile);

      // Fetch candidates from TMDB lists containing user's favorites
      let listCandidates: number[] = [];
      try {
        // Build seed films with titles for list discovery
        const seedFilmsForLists = highlyRated.slice(0, 10).map(tmdbId => {
          const details = tmdbDetailsMap.get(tmdbId);
          const film = filteredFilms.find(f => mappings.get(f.uri) === tmdbId);
          return {
            tmdbId,
            title: details?.title ?? '',
            rating: film?.rating
          };
        }).filter(s => s.title);

        listCandidates = await discoverFromLists(seedFilmsForLists);
        console.log('[Suggest] List candidates:', listCandidates.length);
      } catch (e) {
        console.error('[Suggest] List discovery failed', e);
      }

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
      candidatesRaw.push(...listCandidates); // Add list-discovered candidates
      candidatesRaw.push(...exploratoryPicks); // Add exploratory picks

      console.log('[Suggest] Smart candidates breakdown', {
        trending: smartCandidates.trending.length,
        similar: smartCandidates.similar.length,
        discovered: smartCandidates.discovered.length,
        decade: decadeCandidates.length,
        discovery: discoveryCandidates.length,
        lists: listCandidates.length,
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

      // Fetch per-source reliability multipliers from past feedback
      const userSourceReliability = await fetchSourceReliability(uid);

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
      setProgress({ current: 5, total: 6, stage: 'Scoring suggestions...' });
      const suggestions = await suggestByOverlap({
        userId: uid,
        films: lite,
        mappings,
        candidates,
        excludeGenres: gExclude.size ? gExclude : undefined,
        maxCandidates: mode === 'quick' ? 400 : 800,
        concurrency: 6,
        excludeWatchedIds: watchedIds,
        desiredResults: 300, // Increased to fill all 24 sections (24 × 12 = 288 potential items)
        sourceMetadata: smartCandidates.sourceMetadata, // Pass multi-source metadata for badge display
        sourceReliability: userSourceReliability,
        mmrLambda: 0.15 + (discoveryLevel / 100) * 0.35, // range ~0.15–0.5
        mmrTopKFactor: 2.5 + (discoveryLevel / 100) * 1.5,
        // Feature-level feedback from explicit user interactions
        featureFeedback: featureFeedback || undefined,
        watchlistEntries,
        enhancedProfile: {
          topActors: tasteProfile.topActors,
          topStudios: tasteProfile.topStudios,
          avoidGenres: tasteProfile.avoidGenres,
          avoidKeywords: tasteProfile.avoidKeywords,
          avoidDirectors: tasteProfile.avoidDirectors,
          adjacentGenres,
          recentGenres: recentGenreNames,
          topDecades: tasteProfile.topDecades,
          watchlistGenres: tasteProfile.watchlistGenres,
          watchlistKeywords: tasteProfile.watchlistKeywords,
          watchlistDirectors: tasteProfile.watchlistDirectors
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
      setProgress({ current: 6, total: 6, stage: 'Fetching movie details...' });
      const detailsPromises = suggestions.map(async (s) => {
        try {
          let movie = null;

          // Fetch from TMDB API
          // Note: TuiMDB integration requires UID mapping which we skip for now
          const u = new URL('/api/tmdb/movie', getBaseUrl());
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

            // Extract additional metadata for new sections
            const runtime = movie.runtime || undefined;
            const original_language = movie.original_language || undefined;
            const spoken_languages = (movie.spoken_languages || []).map((l: any) => l.iso_639_1);
            const production_countries = (movie.production_countries || []).map((c: any) => c.iso_3166_1);

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
              contributingFilms: s.contributingFilms,
              sources: s.sources,
              consensusLevel: s.consensusLevel,
              reliabilityMultiplier: s.reliabilityMultiplier,
              runtime,
              original_language,
              spoken_languages,
              production_countries
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
          genres: [],
          sources: s.sources,
          consensusLevel: s.consensusLevel,
          reliabilityMultiplier: s.reliabilityMultiplier,
          runtime: undefined,
          original_language: undefined,
          spoken_languages: undefined,
          production_countries: undefined
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
            watchlistAddedAt: (r as any).watchlist_added_at ?? undefined,
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

  // Build a pairwise comparison candidate whenever items change
  useEffect(() => {
    if (!items || items.length < 2) {
      setPairwisePair(null);
      return;
    }
    if (pairwiseCount >= PAIRWISE_SESSION_LIMIT) {
      setPairwisePair(null);
      return;
    }
    const candidate = findPairwiseCandidate(items.filter((i) => !i.dismissed), pairHistory);
    setPairwisePair(candidate);
  }, [items, pairHistory, findPairwiseCandidate, pairwiseCount, PAIRWISE_SESSION_LIMIT]);

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

      // Get watchlist films for intent signals
      const watchlistFilmsForMore = sourceFilms.filter(f => f.onWatchlist && mappings.has(f.uri));
      const watchlistEntriesForMore = watchlistFilmsForMore.map(f => ({
        tmdbId: mappings.get(f.uri)!,
        addedAt: f.watchlistAddedAt ?? null,
      }));

      const tasteProfile = await buildTasteProfile({
        films: filteredFilms,
        mappings,
        topN: 10,
        watchlistFilms: watchlistFilmsForMore
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
        watchlistEntries: watchlistEntriesForMore,
        enhancedProfile: {
          topActors: tasteProfile.topActors,
          topStudios: tasteProfile.topStudios,
          avoidGenres: tasteProfile.avoidGenres,
          avoidKeywords: tasteProfile.avoidKeywords,
          avoidDirectors: tasteProfile.avoidDirectors,
          topDecades: tasteProfile.topDecades,
          watchlistGenres: tasteProfile.watchlistGenres,
          watchlistKeywords: tasteProfile.watchlistKeywords,
          watchlistDirectors: tasteProfile.watchlistDirectors
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

      // Get watchlist films for intent signals
      const watchlistFilmsForRefresh = sourceFilms.filter(f => f.onWatchlist && mappings.has(f.uri));
      const watchlistEntriesForRefresh = watchlistFilmsForRefresh.map(f => ({
        tmdbId: mappings.get(f.uri)!,
        addedAt: f.watchlistAddedAt ?? null,
      }));

      const tasteProfile = await buildTasteProfile({
        films: filteredFilms,
        mappings,
        topN: 10,
        negativeFeedbackIds,
        watchlistFilms: watchlistFilmsForRefresh
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
        watchlistEntries: watchlistEntriesForRefresh,
        enhancedProfile: {
          topActors: tasteProfile.topActors,
          topStudios: tasteProfile.topStudios,
          avoidGenres: tasteProfile.avoidGenres,
          avoidKeywords: tasteProfile.avoidKeywords,
          avoidDirectors: tasteProfile.avoidDirectors,
          topDecades: tasteProfile.topDecades,
          watchlistGenres: tasteProfile.watchlistGenres,
          watchlistKeywords: tasteProfile.watchlistKeywords,
          watchlistDirectors: tasteProfile.watchlistDirectors
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

  // Handle explicit reason selection from feedback popup
  const handleExplicitReason = async (reason: string) => {
    if (!feedbackPopup || !uid) return;
    
    const isPositive = feedbackPopup.feedbackType === 'positive';
    console.log('[FeedbackPopup] User selected explicit reason:', reason, 'for movie:', feedbackPopup.title, 'type:', feedbackPopup.feedbackType);
    
    // Close the popup first for responsiveness
    setFeedbackPopup(null);
    
    // Show confirmation based on reason type and SAVE the explicit feedback
    let confirmMessage = feedbackPopup.insights.learningSummary;
    
    // === NEGATIVE FEEDBACK REASONS ===
    if (reason === 'already_seen') {
      confirmMessage = "👍 Got it! We won't count this against the movie's features.";
      // Note: We could potentially UNDO the automatic negative learning here in the future
    } else if (reason === 'not_in_mood') {
      confirmMessage = "👍 No problem! This won't affect your preferences.";
      // Note: Temporary skip - no learning needed
    } else if (reason === 'too_long') {
      confirmMessage = "👎 Noted. We'll suggest more quick watches.";
    } else if (reason === 'dislike_all') {
      // NUCLEAR OPTION: User dislikes EVERYTHING about this movie
      // Apply strong negative boost to ALL features
      confirmMessage = "👎👎 Got it! We'll strongly avoid movies like this.";
      
      // Boost ALL actors
      for (const actor of feedbackPopup.leadActors) {
        await boostExplicitFeedback(uid, 'actor', actor, false, 3);
      }
      // Boost ALL genres
      for (const genre of feedbackPopup.genres) {
        await boostExplicitFeedback(uid, 'genre', genre, false, 3);
      }
      // Boost ALL keywords
      for (const keyword of feedbackPopup.topKeywords || []) {
        await boostExplicitFeedback(uid, 'keyword', keyword, false, 3);
      }
      // Boost franchise if exists
      if (feedbackPopup.franchise) {
        await boostExplicitFeedback(uid, 'collection', feedbackPopup.franchise, false, 3);
      }
    
    // === POSITIVE FEEDBACK REASONS ===
    } else if (reason === 'great_pick') {
      confirmMessage = "👍 Awesome! We'll learn from this to find more like it.";
      // Already learned automatically, no extra boost needed for generic positive
    } else if (reason === 'want_more_director' && feedbackPopup.director) {
      confirmMessage = `👍 Great! More ${feedbackPopup.director} films coming your way.`;
      // Note: Director learning could be added to boostExplicitFeedback in future
    } else if (reason === 'love_all') {
      // SUPER POSITIVE: User loves EVERYTHING about this movie
      confirmMessage = "❤️❤️ Amazing! We'll find more movies just like this!";
      
      // Boost ALL actors
      for (const actor of feedbackPopup.leadActors) {
        await boostExplicitFeedback(uid, 'actor', actor, true, 3);
      }
      // Boost ALL genres
      for (const genre of feedbackPopup.genres) {
        await boostExplicitFeedback(uid, 'genre', genre, true, 3);
      }
      // Boost ALL keywords
      for (const keyword of feedbackPopup.topKeywords || []) {
        await boostExplicitFeedback(uid, 'keyword', keyword, true, 3);
      }
      // Boost franchise if exists
      if (feedbackPopup.franchise) {
        await boostExplicitFeedback(uid, 'collection', feedbackPopup.franchise, true, 3);
      }
    
    // === SHARED REASONS (work for both positive and negative) ===
    } else if (reason.startsWith('actor:')) {
      const actorName = reason.replace('actor:', '');
      if (isPositive) {
        confirmMessage = `👍 Love it! More ${actorName} movies coming up.`;
        await boostExplicitFeedback(uid, 'actor', actorName, true, 2);
      } else {
        confirmMessage = `👎 Got it. ${actorName} movies will appear less often.`;
        await boostExplicitFeedback(uid, 'actor', actorName, false, 2);
      }
    } else if (reason === 'franchise') {
      if (isPositive) {
        confirmMessage = `👍 Love the ${feedbackPopup.franchise}! Showing more from this series.`;
        if (feedbackPopup.franchise) {
          await boostExplicitFeedback(uid, 'collection', feedbackPopup.franchise, true, 2);
        }
      } else {
        confirmMessage = `👎 ${feedbackPopup.franchise} fatigue noted. Showing fewer from this series.`;
        if (feedbackPopup.franchise) {
          await boostExplicitFeedback(uid, 'collection', feedbackPopup.franchise, false, 2);
        }
      }
    } else if (reason.startsWith('genre:')) {
      const genreName = reason.replace('genre:', '');
      if (isPositive) {
        confirmMessage = `👍 Great! More ${genreName} movies for you.`;
        await boostExplicitFeedback(uid, 'genre', genreName, true, 2);
      } else {
        confirmMessage = `👎 Got it. Fewer ${genreName} movies coming up.`;
        await boostExplicitFeedback(uid, 'genre', genreName, false, 2);
      }
    } else if (reason.startsWith('keyword:')) {
      const keywordName = reason.replace('keyword:', '');
      if (isPositive) {
        confirmMessage = `👍 Noted! More "${keywordName}" themed movies coming up.`;
        await boostExplicitFeedback(uid, 'keyword', keywordName, true, 2);
      } else {
        confirmMessage = `👎 Got it. Fewer "${keywordName}" themed movies coming up.`;
        await boostExplicitFeedback(uid, 'keyword', keywordName, false, 2);
      }
    }
    
    setFeedbackMessage(confirmMessage);
    setTimeout(() => setFeedbackMessage(null), 3500);
  };

  // Handle feedback
  const handleFeedback = async (tmdbId: number, type: 'negative' | 'positive', reasons?: string[]) => {
    if (!uid) return;
    
    // Find the movie title for the popup
    const movie = items?.find(i => i.id === tmdbId);
    const movieTitle = movie?.title || 'this movie';
    const feedbackMeta = {
      sources: movie?.sources,
      consensusLevel: movie?.consensusLevel as ('high' | 'medium' | 'low' | undefined),
    };
    
    try {
      if (type === 'negative') {
        // Block the suggestion in the background and get learning insights
        const [insights, movieFeatures] = await Promise.all([
          addFeedback(uid, tmdbId, 'negative', reasons, feedbackMeta),
          blockSuggestion(uid, tmdbId).then(() => getMovieFeaturesForPopup(tmdbId))
        ]);

        setBlockedIds(prev => new Set([...prev, tmdbId]));

        // Store for persistent undo control
        setLastFeedback({ id: tmdbId, title: movieTitle });

        // Offer quick undo toast
        setUndoToast({ id: tmdbId, title: movieTitle });
        setTimeout(() => setUndoToast((curr) => curr && curr.id === tmdbId ? null : curr), 5000);

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
        
        // Show the feedback popup with quick-tap reasons
        // Only show if we have interesting features to ask about
        const hasActors = movieFeatures.leadActors.length > 0;
        const hasFranchise = !!movieFeatures.franchise;
        const hasGenres = movieFeatures.genres.length > 0;
        const hasKeywords = movieFeatures.topKeywords.length > 0;
        
        if (hasActors || hasFranchise || hasGenres || hasKeywords) {
          setFeedbackPopup({
            tmdbId,
            title: movieTitle,
            insights,
            leadActors: movieFeatures.leadActors,
            franchise: movieFeatures.franchise,
            topKeywords: movieFeatures.topKeywords,
            genres: movieFeatures.genres,
            feedbackType: 'negative',
            director: movieFeatures.director
          });
          // No auto-dismiss - let user take their time or close manually
        } else {
          // No interesting features to ask about, just show the learning message
          setFeedbackMessage(insights.learningSummary);
          setTimeout(() => setFeedbackMessage(null), 4000);
        }
      } else {
        // Positive feedback - get learning insights AND show popup for explicit learning
        const [insights, movieFeatures] = await Promise.all([
          addFeedback(uid, tmdbId, 'positive', reasons, feedbackMeta),
          getMovieFeaturesForPopup(tmdbId)
        ]);
        
        // Show popup for positive feedback too - let users tell us what they loved
        const hasActors = movieFeatures.leadActors.length > 0;
        const hasFranchise = !!movieFeatures.franchise;
        const hasGenres = movieFeatures.genres.length > 0;
        const hasKeywords = movieFeatures.topKeywords.length > 0;
        
        if (hasActors || hasFranchise || hasGenres || hasKeywords) {
          setFeedbackPopup({
            tmdbId,
            title: movieTitle,
            insights,
            leadActors: movieFeatures.leadActors,
            franchise: movieFeatures.franchise,
            topKeywords: movieFeatures.topKeywords,
            genres: movieFeatures.genres,
            feedbackType: 'positive',
            director: movieFeatures.director
          });
        } else {
          setFeedbackMessage(insights.learningSummary);
          setTimeout(() => setFeedbackMessage(null), 3000);
        }
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

  const handlePairwiseVote = async (winnerId: number, loserId: number) => {
    if (!uid) return;
    const nextCount = pairwiseCount + 1;
    const nextHistory = new Set(pairHistory);
    nextHistory.add(makePairId(winnerId, loserId));
    setPairHistory(nextHistory);
    setPairwisePair(null);
    setPairwiseCount(nextCount);

    try {
      const winner = items?.find((i) => i.id === winnerId);
      const loser = items?.find((i) => i.id === loserId);

      const sharedTags = (() => {
        const tagsA = winner ? reasonTypeTags(winner.reasons) : new Set<string>();
        const tagsB = loser ? reasonTypeTags(loser.reasons) : new Set<string>();
        return Array.from(tagsA).filter((t) => tagsB.has(t));
      })();

      await Promise.all([
        addFeedback(uid, winnerId, 'positive', winner?.reasons, {
          sources: winner?.sources,
          consensusLevel: winner?.consensusLevel as 'high' | 'medium' | 'low' | undefined,
        }),
        addFeedback(uid, loserId, 'negative', loser?.reasons, {
          sources: loser?.sources,
          consensusLevel: loser?.consensusLevel as 'high' | 'medium' | 'low' | undefined,
        }),
        recordPairwiseEvent(uid, {
          winnerId,
          loserId,
          sharedReasonTags: sharedTags,
          winnerSources: winner?.sources,
          loserSources: loser?.sources,
          winnerConsensus: winner?.consensusLevel as 'high' | 'medium' | 'low' | undefined,
          loserConsensus: loser?.consensusLevel as 'high' | 'medium' | 'low' | undefined,
        }),
      ]);

      await applyPairwiseFeatureLearning(uid, winnerId, loserId);

      setFeedbackMessage('Got it — we will favor your pick.');
      setTimeout(() => setFeedbackMessage(null), 2200);
    } catch (e) {
      console.error('[Pairwise] Failed to record preference', e);
    } finally {
      const next = nextCount >= PAIRWISE_SESSION_LIMIT ? null : findPairwiseCandidate(items ?? [], nextHistory);
      setPairwisePair(next);
    }
  };

  const handlePairwiseSkip = (aId: number, bId: number) => {
    const nextCount = pairwiseCount + 1;
    const nextHistory = new Set(pairHistory);
    nextHistory.add(makePairId(aId, bId));
    setPairHistory(nextHistory);
    setPairwiseCount(nextCount);
    const next = nextCount >= PAIRWISE_SESSION_LIMIT ? null : findPairwiseCandidate(items ?? [], nextHistory);
    setPairwisePair(next);
  };

  const handleUndoDismiss = async (tmdbId: number) => {
    if (!uid) return;
    try {
      await unblockSuggestion(uid, tmdbId);
      setUndoToast(null);
      setLastFeedback((curr) => (curr && curr.id === tmdbId ? null : curr));
      setBlockedIds(prev => {
        const next = new Set(prev);
        next.delete(tmdbId);
        return next;
      });
      setItems(prev => prev?.map(item => item.id === tmdbId ? { ...item, dismissed: false } : item) ?? prev);
      setCategorizedSuggestions((prev: CategorizedSuggestions | null) => {
        if (!prev) return prev;
        const next = { ...prev } as CategorizedSuggestions;
        for (const key in next) {
          // @ts-ignore dynamic access
          const section = next[key];
          if (Array.isArray(section)) {
            const idx = section.findIndex((m: MovieItem) => m.id === tmdbId);
            if (idx !== -1) {
              const copy = [...section];
              copy[idx] = { ...copy[idx], dismissed: false };
              // @ts-ignore dynamic assign
              next[key] = copy;
              break;
            }
          }
        }
        return next;
      });
    } catch (e) {
      console.error('[Suggest] undo dismiss failed', e);
    }
  };

  const handleUndoLastFeedback = async () => {
    if (!lastFeedback) return;
    await handleUndoDismiss(lastFeedback.id);
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

      // Special handling for watchlist picks - they come from a different source
      if (sectionName === 'watchlistPicks') {
        // Re-shuffle watchlist picks by regenerating scores with more randomness
        const currentPicks = categorizedSuggestions.watchlistPicks;
        if (currentPicks.length > 0) {
          // Shuffle and re-score with higher random factor
          const shuffled = [...currentPicks]
            .map(item => ({
              ...item,
              score: item.score * 0.5 + Math.random() * 50 // Add more randomness
            }))
            .sort((a, b) => b.score - a.score);
          
          // Update via setCategorizedSuggestions
          setCategorizedSuggestions(prev => prev ? {
            ...prev,
            watchlistPicks: shuffled
          } : null);
        }
        
        setRefreshingSections(prev => {
          const next = new Set(prev);
          next.delete(sectionName);
          return next;
        });
        return;
      }

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

      {/* Undo Toast for dismissed suggestions */}
      {undoToast && (
        <div className="fixed bottom-4 left-4 bg-white text-gray-900 px-4 py-3 rounded shadow-lg border border-gray-200 z-50 flex items-center gap-3 animate-fade-in-up">
          <div className="text-sm">Removed “{undoToast.title}”.</div>
          <button
            className="text-sm font-semibold text-blue-700 hover:text-blue-900"
            onClick={() => handleUndoDismiss(undoToast.id)}
          >
            Undo
          </button>
        </div>
      )}
      
      {/* Hybrid Feedback Popup - Optional "Tell us why" */}
      {feedbackPopup && (
        <div className="fixed inset-0 z-50 flex items-end justify-center pb-4 sm:items-center sm:pb-0">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setFeedbackPopup(null)}
          />
          
          {/* Popup Card */}
          <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-sm w-full mx-4 p-4 animate-slide-up">
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {feedbackPopup.insights.learningSummary}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Want to tell us more? (optional)
                </p>
              </div>
              <button
                onClick={() => setFeedbackPopup(null)}
                className="text-gray-400 hover:text-gray-600 p-1"
                aria-label="Close"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            {/* Quick-tap reason buttons - Different for positive vs negative feedback */}
            <div className="space-y-3">
              {feedbackPopup.feedbackType === 'negative' ? (
                <>
                  {/* === NEGATIVE FEEDBACK OPTIONS === */}
                  
                  {/* NUCLEAR OPTION - Dislike everything */}
                  <div>
                    <p className="text-xs text-gray-400 mb-1.5">Strong dislike:</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => handleExplicitReason('dislike_all')}
                        className="px-3 py-1.5 text-xs bg-red-200 text-red-800 hover:bg-red-300 rounded-full transition-colors font-medium border border-red-300"
                      >
                        🚫 I don&apos;t like this movie
                      </button>
                    </div>
                  </div>
                  
                  {/* Non-negative reasons (won't learn avoidance) */}
                  <div>
                    <p className="text-xs text-gray-400 mb-1.5">Not a problem with the movie:</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => handleExplicitReason('already_seen')}
                        className="px-3 py-1.5 text-xs bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-full transition-colors"
                      >
                        ✓ Already seen it
                      </button>
                      <button
                        onClick={() => handleExplicitReason('not_in_mood')}
                        className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-full transition-colors"
                      >
                        😴 Not in the mood
                      </button>
                      <button
                        onClick={() => handleExplicitReason('too_long')}
                        className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-full transition-colors"
                      >
                        ⏱️ Too long right now
                      </button>
                    </div>
                  </div>
                  
                  {/* Specific reasons section header */}
                  <div className="border-t border-gray-200 pt-2">
                    <p className="text-xs text-gray-500 mb-2">Or tell us specifically:</p>
                  </div>
                  
                  {/* Actor-specific reasons - show ALL lead actors so user can pick specific ones */}
                  {feedbackPopup.leadActors.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1.5">Not a fan of this actor:</p>
                      <div className="flex flex-wrap gap-2">
                        {feedbackPopup.leadActors.map(actor => (
                          <button
                            key={actor}
                            onClick={() => handleExplicitReason(`actor:${actor}`)}
                            className="px-3 py-1.5 text-xs bg-red-100 text-red-700 hover:bg-red-200 rounded-full transition-colors"
                          >
                            👎 {actor}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Franchise fatigue */}
                  {feedbackPopup.franchise && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1.5">Franchise fatigue:</p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleExplicitReason('franchise')}
                          className="px-3 py-1.5 text-xs bg-orange-100 text-orange-700 hover:bg-orange-200 rounded-full transition-colors"
                        >
                          🔄 Done with {feedbackPopup.franchise.split(':')[0]}
                        </button>
                      </div>
                    </div>
                  )}
                  
                  {/* Genre-specific reasons */}
                  {feedbackPopup.genres.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1.5">Not into this genre:</p>
                      <div className="flex flex-wrap gap-2">
                        {feedbackPopup.genres.slice(0, 3).map(genre => (
                          <button
                            key={genre}
                            onClick={() => handleExplicitReason(`genre:${genre}`)}
                            className="px-3 py-1.5 text-xs bg-purple-100 text-purple-700 hover:bg-purple-200 rounded-full transition-colors"
                          >
                            👎 {genre}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Topic/Theme-specific reasons (keywords) */}
                  {feedbackPopup.topKeywords && feedbackPopup.topKeywords.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1.5">Not interested in this topic:</p>
                      <div className="flex flex-wrap gap-2">
                        {feedbackPopup.topKeywords.slice(0, 5).map(keyword => (
                          <button
                            key={keyword}
                            onClick={() => handleExplicitReason(`keyword:${keyword}`)}
                            className="px-3 py-1.5 text-xs bg-amber-100 text-amber-700 hover:bg-amber-200 rounded-full transition-colors"
                          >
                            🏷️ {keyword}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* === POSITIVE FEEDBACK OPTIONS === */}
                  {/* Generic positive */}
                  <div>
                    <p className="text-xs text-gray-400 mb-1.5">What made this a great pick?</p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => handleExplicitReason('great_pick')}
                        className="px-3 py-1.5 text-xs bg-green-100 text-green-700 hover:bg-green-200 rounded-full transition-colors"
                      >
                        ✨ Just a great pick!
                      </button>
                      <button
                        onClick={() => handleExplicitReason('love_all')}
                        className="px-3 py-1.5 text-xs bg-emerald-200 text-emerald-800 hover:bg-emerald-300 rounded-full transition-colors font-medium border border-emerald-300"
                      >
                        ❤️ I love everything about this!
                      </button>
                    </div>
                  </div>
                  
                  {/* Specific reasons section header */}
                  <div className="border-t border-gray-200 pt-2">
                    <p className="text-xs text-gray-500 mb-2">Or tell us specifically:</p>
                  </div>
                  
                  {/* Actor love */}
                  {feedbackPopup.leadActors.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1.5">Love this actor:</p>
                      <div className="flex flex-wrap gap-2">
                        {feedbackPopup.leadActors.map(actor => (
                          <button
                            key={actor}
                            onClick={() => handleExplicitReason(`actor:${actor}`)}
                            className="px-3 py-1.5 text-xs bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded-full transition-colors"
                          >
                            ❤️ {actor}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Franchise love */}
                  {feedbackPopup.franchise && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1.5">Love this franchise:</p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleExplicitReason('franchise')}
                          className="px-3 py-1.5 text-xs bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded-full transition-colors"
                        >
                          🎬 More {feedbackPopup.franchise.split(':')[0]}!
                        </button>
                      </div>
                    </div>
                  )}
                  
                  {/* Genre love */}
                  {feedbackPopup.genres.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1.5">Love this genre:</p>
                      <div className="flex flex-wrap gap-2">
                        {feedbackPopup.genres.slice(0, 3).map(genre => (
                          <button
                            key={genre}
                            onClick={() => handleExplicitReason(`genre:${genre}`)}
                            className="px-3 py-1.5 text-xs bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded-full transition-colors"
                          >
                            ❤️ {genre}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Topic/Theme love (keywords) */}
                  {feedbackPopup.topKeywords && feedbackPopup.topKeywords.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1.5">Love this theme:</p>
                      <div className="flex flex-wrap gap-2">
                        {feedbackPopup.topKeywords.slice(0, 5).map(keyword => (
                          <button
                            key={keyword}
                            onClick={() => handleExplicitReason(`keyword:${keyword}`)}
                            className="px-3 py-1.5 text-xs bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded-full transition-colors"
                          >
                            ❤️ {keyword}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            
            {/* Skip option */}
            <div className="mt-3 text-center">
              <button
                onClick={() => setFeedbackPopup(null)}
                className="text-xs text-gray-400 hover:text-gray-600"
              >
                Skip — we&apos;ll learn from patterns
              </button>
            </div>
          </div>
        </div>
      )}
      {pairwisePair && (
        <div className="mb-5 rounded-xl border border-gray-200 bg-white shadow-sm p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">Which fits you better right now?</p>
              <p className="text-xs text-gray-500">These two were neck-and-neck; your pick will tune future rankings.</p>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-gray-500">
              <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">Pairwise learning</span>
              <span>{pairwiseCount}/{PAIRWISE_SESSION_LIMIT} this session</span>
              <button
                className="text-xs text-gray-500 hover:text-gray-700"
                onClick={() => handlePairwiseSkip(pairwisePair.a.id, pairwisePair.b.id)}
              >
                Skip
              </button>
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {[pairwisePair.a, pairwisePair.b].map((item, idx) => {
              const other = idx === 0 ? pairwisePair.b : pairwisePair.a;
              return (
                <div key={item.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3 flex flex-col gap-2">
                  <div className="text-xs uppercase text-gray-500">Option {idx === 0 ? 'A' : 'B'}</div>
                  <div className="text-sm font-semibold text-gray-900">
                    {item.title}{item.year ? ` (${item.year})` : ''}
                  </div>
                  <div className="text-xs text-gray-600">{item.reasons.slice(0, 2).join(' • ')}</div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                    {item.consensusLevel && (
                      <span className="px-2 py-0.5 rounded-full bg-gray-200 text-gray-700">Consensus: {item.consensusLevel}</span>
                    )}
                    {item.sources?.length ? (
                      <span className="px-2 py-0.5 rounded-full bg-gray-200 text-gray-700">{item.sources.length} source{item.sources.length === 1 ? '' : 's'}</span>
                    ) : null}
                  </div>
                  <button
                    className="mt-1 inline-flex items-center justify-center rounded-md bg-blue-600 text-white text-sm font-medium px-3 py-2 hover:bg-blue-700"
                    onClick={() => handlePairwiseVote(item.id, other.id)}
                  >
                    Choose this one
                  </button>
                </div>
              );
            })}
          </div>
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

      {/* Enrichment Warning - show if less than 50% of films are mapped */}
      {mappingCoverage && mappingCoverage.mapped < mappingCoverage.total * 0.5 && !loading && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
          <div className="flex items-start gap-3">
            <span className="text-xl">⚠️</span>
            <div>
              <h3 className="font-medium text-amber-800">Limited Film Data</h3>
              <p className="text-sm text-amber-700 mt-1">
                Only {mappingCoverage.mapped} of {mappingCoverage.total} films ({Math.round(mappingCoverage.mapped / mappingCoverage.total * 100)}%) 
                have enriched data. Suggestions are based on partial watch history.
              </p>
              <p className="text-sm text-amber-700 mt-1">
                <a href="/import" className="underline font-medium">Re-import your data</a> to get better recommendations.
              </p>
            </div>
          </div>
        </div>
      )}

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
            <div className="flex items-center justify-between gap-3 text-sm text-gray-700 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-600">Discovery vs Safety</label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={discoveryLevel}
                  onChange={(e) => setDiscoveryLevel(Number(e.target.value))}
                  className="w-40 accent-blue-600"
                />
                <span className="text-xs text-gray-500 w-12 text-right">{discoveryLevel}%</span>
              </div>
              <button
                onClick={handleUndoLastFeedback}
                disabled={!lastFeedback}
                className={`px-3 py-1.5 rounded border text-sm font-medium transition-colors ${lastFeedback ? 'bg-white hover:bg-gray-50 text-gray-800 border-gray-200' : 'bg-gray-50 text-gray-400 border-gray-100 cursor-not-allowed'}`}
                title={lastFeedback ? `Restore "${lastFeedback.title}" and unblock it` : 'No feedback to undo yet'}
              >
                ↩️ Undo last feedback
              </button>
            </div>
            {sourceLabel && (
              <p className="text-xs text-gray-500 mb-4">Source: {sourceLabel}</p>
            )}

            {/* Picks From Your Letterboxd Watchlist - TOP PRIORITY */}
            {categorizedSuggestions.watchlistPicks.length >= 1 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">📋</span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Picks From Your Letterboxd Watchlist</h2>
                      <p className="text-xs text-gray-600">Movies you saved to watch, prioritized by what you&apos;ve been enjoying recently</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('watchlistPicks')}
                    disabled={refreshingSections.has('watchlistPicks')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('watchlistPicks') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categorizedSuggestions.watchlistPicks.map((item) => (
                    <MovieCard
                      key={item.id}
                      id={item.id}
                      title={item.title}
                      year={item.year}
                      posterPath={posters[item.id]}
                      trailerKey={item.trailerKey}
                      isInWatchlist={true}
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
                      genres={item.genres}
                      sources={item.sources}
                      consensusLevel={item.consensusLevel}
                      reliabilityMultiplier={item.reliabilityMultiplier}
                      onUndoDismiss={handleUndoDismiss}
                    />
                  ))}
                </div>
              </section>
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
                      contributingFilms={item.contributingFilms}
                      dismissed={item.dismissed}
                      imdb_rating={item.imdb_rating}
                      rotten_tomatoes={item.rotten_tomatoes}
                      metacritic={item.metacritic}
                      awards={item.awards}
                      genres={item.genres}
                      sources={item.sources}
                      consensusLevel={item.consensusLevel}
                      reliabilityMultiplier={item.reliabilityMultiplier}
                      onUndoDismiss={handleUndoDismiss}
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
                      genres={item.genres}
                      sources={item.sources}
                      consensusLevel={item.consensusLevel}
                      reliabilityMultiplier={item.reliabilityMultiplier}
                      onUndoDismiss={handleUndoDismiss}
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
                      genres={item.genres}
                      sources={item.sources}
                      consensusLevel={item.consensusLevel}
                      reliabilityMultiplier={item.reliabilityMultiplier}
                      onUndoDismiss={handleUndoDismiss}
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
                      genres={item.genres}
                      sources={item.sources}
                      consensusLevel={item.consensusLevel}
                      reliabilityMultiplier={item.reliabilityMultiplier}
                      onUndoDismiss={handleUndoDismiss}
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
                      genres={item.genres}
                      sources={item.sources}
                      consensusLevel={item.consensusLevel}
                      reliabilityMultiplier={item.reliabilityMultiplier}
                      onUndoDismiss={handleUndoDismiss}
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
                      genres={item.genres}
                      sources={item.sources}
                      consensusLevel={item.consensusLevel}
                      reliabilityMultiplier={item.reliabilityMultiplier}
                      onUndoDismiss={handleUndoDismiss}
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
                      genres={item.genres}
                      sources={item.sources}
                      consensusLevel={item.consensusLevel}
                      reliabilityMultiplier={item.reliabilityMultiplier}
                      onUndoDismiss={handleUndoDismiss}
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
                      genres={item.genres}
                      sources={item.sources}
                      consensusLevel={item.consensusLevel}
                      reliabilityMultiplier={item.reliabilityMultiplier}
                      onUndoDismiss={handleUndoDismiss}
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
                      genres={item.genres}
                      sources={item.sources}
                      consensusLevel={item.consensusLevel}
                      reliabilityMultiplier={item.reliabilityMultiplier}
                      onUndoDismiss={handleUndoDismiss}
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
                      genres={item.genres}
                      sources={item.sources}
                      consensusLevel={item.consensusLevel}
                      reliabilityMultiplier={item.reliabilityMultiplier}
                      onUndoDismiss={handleUndoDismiss}
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
                      genres={item.genres}
                      sources={item.sources}
                      consensusLevel={item.consensusLevel}
                      reliabilityMultiplier={item.reliabilityMultiplier}
                      onUndoDismiss={handleUndoDismiss}
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
                      genres={item.genres}
                      sources={item.sources}
                      consensusLevel={item.consensusLevel}
                      reliabilityMultiplier={item.reliabilityMultiplier}
                      onUndoDismiss={handleUndoDismiss}
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
                      genres={item.genres}
                      sources={item.sources}
                      consensusLevel={item.consensusLevel}
                      reliabilityMultiplier={item.reliabilityMultiplier}
                      onUndoDismiss={handleUndoDismiss}
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
                      genres={item.genres}
                      sources={item.sources}
                      consensusLevel={item.consensusLevel}
                      reliabilityMultiplier={item.reliabilityMultiplier}
                      onUndoDismiss={handleUndoDismiss}
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
                      genres={item.genres}
                      sources={item.sources}
                      consensusLevel={item.consensusLevel}
                      reliabilityMultiplier={item.reliabilityMultiplier}
                      onUndoDismiss={handleUndoDismiss}
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
                      genres={item.genres}
                      sources={item.sources}
                      consensusLevel={item.consensusLevel}
                      reliabilityMultiplier={item.reliabilityMultiplier}
                      onUndoDismiss={handleUndoDismiss}
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
                      genres={item.genres}
                      sources={item.sources}
                      consensusLevel={item.consensusLevel}
                      reliabilityMultiplier={item.reliabilityMultiplier}
                      onUndoDismiss={handleUndoDismiss}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Multi-Source Consensus Section - Films recommended by multiple sources */}
            {categorizedSuggestions.multiSourceConsensus.length >= 1 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🎯</span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Multi-Source Consensus</h2>
                      <p className="text-xs text-gray-600">Recommended by multiple sources (TMDB, TasteDive, Trakt)</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('multiSourceConsensus')}
                    disabled={refreshingSections.has('multiSourceConsensus')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('multiSourceConsensus') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categorizedSuggestions.multiSourceConsensus.map((item) => (
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
                      genres={item.genres}
                      sources={item.sources}
                      consensusLevel={item.consensusLevel}
                      reliabilityMultiplier={item.reliabilityMultiplier}
                      onUndoDismiss={handleUndoDismiss}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* International Cinema Section - Non-English films */}
            {categorizedSuggestions.internationalCinema.length >= 1 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🌍</span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">International Cinema</h2>
                      <p className="text-xs text-gray-600">World cinema that matches your taste</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('internationalCinema')}
                    disabled={refreshingSections.has('internationalCinema')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('internationalCinema') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categorizedSuggestions.internationalCinema.map((item) => (
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
                      genres={item.genres}
                      sources={item.sources}
                      consensusLevel={item.consensusLevel}
                      reliabilityMultiplier={item.reliabilityMultiplier}
                      onUndoDismiss={handleUndoDismiss}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Animation Picks Section */}
            {categorizedSuggestions.animationPicks.length >= 1 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🎨</span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Animation Picks</h2>
                      <p className="text-xs text-gray-600">Animated films for you</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('animationPicks')}
                    disabled={refreshingSections.has('animationPicks')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('animationPicks') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categorizedSuggestions.animationPicks.map((item) => (
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
                      genres={item.genres}
                      sources={item.sources}
                      consensusLevel={item.consensusLevel}
                      reliabilityMultiplier={item.reliabilityMultiplier}
                      onUndoDismiss={handleUndoDismiss}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Quick Watches Section - Under 100 minutes */}
            {categorizedSuggestions.quickWatches.length >= 1 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">⚡</span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Quick Watches</h2>
                      <p className="text-xs text-gray-600">Great films under 100 minutes</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('quickWatches')}
                    disabled={refreshingSections.has('quickWatches')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('quickWatches') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categorizedSuggestions.quickWatches.map((item) => (
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
                      genres={item.genres}
                      sources={item.sources}
                      consensusLevel={item.consensusLevel}
                      reliabilityMultiplier={item.reliabilityMultiplier}
                      onUndoDismiss={handleUndoDismiss}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Epic Films Section - Over 150 minutes */}
            {categorizedSuggestions.epicFilms.length >= 1 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🎬</span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Epic Films</h2>
                      <p className="text-xs text-gray-600">Immersive experiences over 2.5 hours</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('epicFilms')}
                    disabled={refreshingSections.has('epicFilms')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('epicFilms') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categorizedSuggestions.epicFilms.map((item) => (
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
                      genres={item.genres}
                      sources={item.sources}
                      consensusLevel={item.consensusLevel}
                      reliabilityMultiplier={item.reliabilityMultiplier}
                      onUndoDismiss={handleUndoDismiss}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Critically Acclaimed Section */}
            {categorizedSuggestions.criticallyAcclaimed.length >= 1 && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🏆</span>
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Critically Acclaimed</h2>
                      <p className="text-xs text-gray-600">Top-rated by critics (IMDB 8+, RT 90%+)</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRefreshSection('criticallyAcclaimed')}
                    disabled={refreshingSections.has('criticallyAcclaimed')}
                    className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                    title="Refresh this section"
                  >
                    <svg className={`w-3 h-3 ${refreshingSections.has('criticallyAcclaimed') ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Refresh</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categorizedSuggestions.criticallyAcclaimed.map((item) => (
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
                      genres={item.genres}
                      sources={item.sources}
                      consensusLevel={item.consensusLevel}
                      reliabilityMultiplier={item.reliabilityMultiplier}
                      onUndoDismiss={handleUndoDismiss}
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




