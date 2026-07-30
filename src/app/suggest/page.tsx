"use client";
import Image from "next/image";
import { generateCanonicalWebRecommendations } from "@/app/actions/recommendations";
import AuthGate from "@/components/AuthGate";
import MovieCard, { FeatureEvidenceContext } from "@/components/MovieCard";
import ProgressIndicator from "@/components/ProgressIndicator";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useImportData } from "@/lib/importStore";
import { supabase } from "@/lib/supabaseClient";
import {
  getFilmMappings,
  getBulkTmdbDetails,
  buildTasteProfile,
  findIncompleteCollections,
  getBlockedSuggestions,
  blockSuggestion,
  unblockSuggestion,
  addFeedback,
  getMovieFeaturesForPopup,
  boostExplicitFeedback,
  recordPairwiseEvent,
  applyPairwiseFeatureLearning,
  getFeatureEvidenceSummary,
  neutralizeFeedback,
  findPairwiseCandidate,
  makePairId,
  reasonTypeTags,
  type FeedbackLearningInsights,
  type FeatureEvidenceSummary,
  type FeatureType,
} from "@/lib/enrich";
import { usePostersSWR } from "@/lib/usePostersSWR";
import {
  getCurrentSeasonalGenres,
  getSeasonalRecommendationConfig,
} from "@/lib/genreEnhancement";
import { saveMovie, getSavedMovies } from "@/lib/lists";
import {
  selectCanonicalPalateCleanser,
  selectCanonicalWatchlistPicks,
} from "@/lib/recommendationAdapters";
import { parseCanonicalWebItems } from "@/lib/canonicalWebResponse";
import {
  detectGenreFatigue,
  type FatigueDetection,
} from "@/lib/counterProgramming";
import { handleNegativeFeedback } from "@/lib/adaptiveLearning";
import UserQuiz from "@/components/UserQuiz";
import type { FilmEvent } from "@/lib/normalize";

// Global config for suggestions
const SECTION_ITEM_LIMIT = 24;
const MIN_SCORE_FOR_OVERFLOW = 0.5;

/**
 * Helper to get the base URL for internal API calls
 */
function getBaseUrl(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
}

type MovieItem = {
  id: number;
  title: string;
  year?: string;
  reasons: string[];
  poster_path?: string | null;
  score: number;
  trailerKey?: string | null;
  voteCategory?: "hidden-gem" | "crowd-pleaser" | "cult-classic" | "standard";
  collectionName?: string;
  genres?: string[];
  vote_average?: number;
  vote_count?: number;
  overview?: string;
  contributingFilms?: Record<string, Array<{ id: number; title: string }>>;
  dismissed?: boolean;
  imdb_rating?: string;
  imdb_source?: "omdb" | "tmdb" | "watchmode" | "tuimdb"; // Which API provided the rating
  rotten_tomatoes?: string;
  metacritic?: string;
  awards?: string;
  // Multi-source recommendation data
  sources?: string[];
  consensusLevel?: "high" | "medium" | "low";
  reliabilityMultiplier?: number;
  // Additional metadata for new sections
  runtime?: number; // in minutes
  original_language?: string;
  critic_score?: number;
  explanation?: string;
  spoken_languages?: string[];
  production_countries?: string[];
  streamingSources?: Array<{
    name: string;
    type: "sub" | "buy" | "rent" | "free";
    url?: string;
  }>;
  keyword_names?: string[]; // NEW: Added for exact subgenre matching
};

async function requestCanonicalWebItems(
  params: Parameters<typeof generateCanonicalWebRecommendations>[0],
) {
  return generateCanonicalWebRecommendations(params);
}

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
  nicheMatches: MovieItem[];
  moreRecommendations: MovieItem[];
};

type SectionKey = Exclude<keyof CategorizedSuggestions, "seasonalConfig">;

type TasteProfile = Awaited<ReturnType<typeof buildTasteProfile>>;

const ALL_SECTION_KEYS: SectionKey[] = [
  "watchlistPicks",
  "seasonalPicks",
  "perfectMatches",
  "recentWatchMatches",
  "studioMatches",
  "directorMatches",
  "actorMatches",
  "genreMatches",
  "documentaries",
  "decadeMatches",
  "smartDiscovery",
  "hiddenGems",
  "cultClassics",
  "crowdPleasers",
  "newReleases",
  "recentClassics",
  "deepCuts",
  "fromCollections",
  "multiSourceConsensus",
  "internationalCinema",
  "animationPicks",
  "quickWatches",
  "epicFilms",
  "criticallyAcclaimed",
  "nicheMatches",
  "moreRecommendations",
];

const ALWAYS_VISIBLE_SECTIONS: SectionKey[] = [
  "watchlistPicks",
  "perfectMatches",
  "nicheMatches",
  "recentWatchMatches",
  "seasonalPicks",
  "multiSourceConsensus",
];

const SECONDARY_SECTIONS: SectionKey[] = [
  "directorMatches",
  "actorMatches",
  "studioMatches",
  "genreMatches",
  "smartDiscovery",
  "hiddenGems",
];

const EXPLORE_SECTIONS: SectionKey[] = [
  "animationPicks",
  "documentaries",
  "internationalCinema",
  "quickWatches",
  "epicFilms",
  "criticallyAcclaimed",
  "fromCollections",
  "cultClassics",
  "crowdPleasers",
  "deepCuts",
  "decadeMatches",
  "newReleases",
  "recentClassics",
  "moreRecommendations",
];

// Progress stage definitions
const PROGRESS_STAGES = [
  {
    key: "init",
    label: "Initialize",
    description: "Setting up recommendation engine",
  },
  {
    key: "library",
    label: "Library",
    description: "Loading your watch history",
  },
  { key: "cache", label: "Cache", description: "Fetching movie metadata" },
  {
    key: "taste",
    label: "Analyze",
    description: "Building your taste profile",
  },
  {
    key: "discover",
    label: "Discover",
    description: "Finding candidates from multiple sources",
  },
  { key: "score", label: "Score", description: "Ranking suggestions" },
  {
    key: "details",
    label: "Details",
    description: "Loading full movie information",
  },
];

export default function SuggestPage() {
  const { films, loading: loadingFilms } = useImportData();
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<MovieItem[] | null>(null);
  const [tasteProfile, setTasteProfile] = useState<TasteProfile | null>(null);
  const [sourceLabel, setSourceLabel] = useState<string>("");
  const [fallbackFilms, setFallbackFilms] = useState<FilmEvent[] | null>(null);
  const [watchlistTmdbIds, setWatchlistTmdbIds] = useState<Set<number>>(
    new Set(),
  );
  const [presentationHydrationEnabled, setPresentationHydrationEnabled] =
    useState(false);
  const [excludeGenres, setExcludeGenres] = useState<string>("");
  const [yearMin, setYearMin] = useState<string>("");
  const [yearMax, setYearMax] = useState<string>("");
  const [discoveryLevel, setDiscoveryLevel] = useState<number>(50); // 0 = safety, 100 = discovery
  const [refreshTick, setRefreshTick] = useState(0);
  const [mode, setMode] = useState<"quick" | "deep">("quick");
  const [noCandidatesReason, setNoCandidatesReason] = useState<string | null>(
    null,
  );
  const [blockedIds, setBlockedIds] = useState<Set<number>>(new Set());
  const [refreshingSections, setRefreshingSections] = useState<Set<string>>(
    new Set(),
  );
  const [shownIds, setShownIds] = useState<Set<number>>(new Set());
  const [cacheKey, setCacheKey] = useState<number>(Date.now());
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    stage: string;
    details?: string;
  }>({
    current: 0,
    total: 7,
    stage: "",
    details: undefined,
  });
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [undoToast, setUndoToast] = useState<{
    id: number;
    title: string;
  } | null>(null);
  const [lastFeedback, setLastFeedback] = useState<{
    id: number;
    title: string;
  } | null>(null);
  const [topDecade, setTopDecade] = useState<number | null>(null);
  const [savedMovieIds, setSavedMovieIds] = useState<Set<number>>(new Set());
  const [hasCheckedStorage, setHasCheckedStorage] = useState(false);
  const [mappingCoverage, setMappingCoverage] = useState<{
    mapped: number;
    total: number;
  } | null>(null);
  const [watchlistPicks, setWatchlistPicks] = useState<MovieItem[]>([]); // Picks from user's Letterboxd watchlist
  const [palateCleanser, setPalateCleanser] = useState<MovieItem[]>([]);
  const [fatigueDetection, setFatigueDetection] =
    useState<FatigueDetection | null>(null);
  const [pairHistory, setPairHistory] = useState<Set<string>>(new Set());
  const [pairwisePair, setPairwisePair] = useState<{
    a: MovieItem;
    b: MovieItem;
  } | null>(null);
  const [pairwiseCount, setPairwiseCount] = useState<number>(0);
  const PAIRWISE_SESSION_LIMIT = 5;
  const [contextMode, setContextMode] = useState<
    "auto" | "weeknight" | "short" | "immersive" | "family" | "background"
  >("auto");
  const [localHour, setLocalHour] = useState<number | null>(null);
  const [featureEvidence, setFeatureEvidence] = useState<
    Record<string, FeatureEvidenceSummary>
  >({});
  const [microSurveyCount, setMicroSurveyCount] = useState<number>(0);
  const [pairwiseVideoId, setPairwiseVideoId] = useState<number | null>(null); // Track which pairwise option is showing video
  const [quizOpen, setQuizOpen] = useState(false); // Taste quiz modal state
  const [showAllSections, setShowAllSections] = useState(false);
  const [showCollapsedSmallSections, setShowCollapsedSmallSections] =
    useState(false);

  // Hybrid feedback popup state - optional "tell us why" after feedback
  const [feedbackPopup, setFeedbackPopup] = useState<{
    tmdbId: number;
    title: string;
    insights: FeedbackLearningInsights;
    leadActors: string[];
    franchise?: string;
    topKeywords: string[];
    genres: string[];
    feedbackType: "positive" | "negative"; // NEW: track which type of feedback
    director?: string; // NEW: for positive feedback
    showMicroSurvey?: boolean;
  } | null>(null);
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);

  // Ref for focus trap in feedback popup modal (A11y Issue 2)
  const feedbackModalRef = useRef<HTMLDivElement>(null);
  const runGenerationRef = useRef(0);

  // Focus trap effect for feedback popup modal (A11y Issue 2)
  useEffect(() => {
    if (!feedbackPopup) return;

    // Focus first focusable element in modal
    const firstButton = feedbackModalRef.current?.querySelector("button");
    firstButton?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFeedbackPopup(null);
        return;
      }

      if (e.key === "Tab") {
        const focusableElements = feedbackModalRef.current?.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusableElements || focusableElements.length === 0) return;

        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[
          focusableElements.length - 1
        ] as HTMLElement;

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    if (process.env.NODE_ENV === "development") {
      console.log("[A11y] Focus trap activated for feedback popup modal");
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (process.env.NODE_ENV === "development") {
        console.log("[A11y] Focus trap deactivated for feedback popup modal");
      }
    };
  }, [feedbackPopup]);

  // Load from session storage on mount
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("lettrsuggest_items");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          if (process.env.NODE_ENV === "development") {
            console.log(
              "[Suggest] Restored items from session storage",
              parsed.length,
            );
          }
          setItems(parsed);
        }
      }
    } catch (e) {
      console.error("[Suggest] Failed to restore from session storage", e);
    } finally {
      setHasCheckedStorage(true);
    }
  }, []);

  // Load pairwise history (to avoid repeating the same comparison)
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("lettrsuggest_pair_history");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setPairHistory(new Set(parsed));
        }
      }
    } catch (e) {
      console.error("[Suggest] Failed to restore pair history", e);
    }
  }, []);

  // Track how many pairwise prompts have been shown this session
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("lettrsuggest_pairwise_count");
      if (stored != null) {
        setPairwiseCount(Number(stored) || 0);
      }
    } catch (e) {
      console.error("[Suggest] Failed to restore pairwise count", e);
    }
  }, []);

  // P1.4: Load shownIds from localStorage on mount (7-day TTL to prevent stale data)
  useEffect(() => {
    try {
      const stored = localStorage.getItem("lettrsuggest_shown_ids");
      if (stored) {
        const { ids, timestamp } = JSON.parse(stored);
        const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
        const isValid = timestamp && Date.now() - timestamp < SEVEN_DAYS_MS;

        if (isValid && Array.isArray(ids) && ids.length > 0) {
          if (process.env.NODE_ENV === "development") {
            console.log(
              "[Suggest] Restored shown IDs from localStorage",
              ids.length,
            );
          }
          setShownIds(new Set(ids));
        } else if (!isValid) {
          // Clear expired data
          if (process.env.NODE_ENV === "development") {
            console.log("[Suggest] Cleared expired shown IDs data");
          }
          localStorage.removeItem("lettrsuggest_shown_ids");
        }
      }
    } catch (e) {
      console.error("[Suggest] Failed to restore shown IDs", e);
    }
  }, []);

  // P1.4: Save shownIds to localStorage when they change (debounced)
  useEffect(() => {
    if (shownIds.size > 0) {
      const timeoutId = setTimeout(() => {
        try {
          const data = {
            ids: Array.from(shownIds),
            timestamp: Date.now(),
          };
          localStorage.setItem("lettrsuggest_shown_ids", JSON.stringify(data));
          if (process.env.NODE_ENV === "development") {
            console.log(
              "[Suggest] Saved shown IDs to localStorage",
              shownIds.size,
            );
          }
        } catch (e) {
          console.error("[Suggest] Failed to save shown IDs", e);
        }
      }, 500); // Debounce to avoid excessive writes

      return () => clearTimeout(timeoutId);
    }
  }, [shownIds]);

  // Save to session storage when items change
  useEffect(() => {
    if (items && items.length > 0) {
      try {
        sessionStorage.setItem("lettrsuggest_items", JSON.stringify(items));
      } catch (e) {
        console.error("[Suggest] Failed to save to session storage", e);
      }
    }
  }, [items]);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        "lettrsuggest_pair_history",
        JSON.stringify(Array.from(pairHistory)),
      );
    } catch (e) {
      console.error("[Suggest] Failed to persist pair history", e);
    }
  }, [pairHistory]);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        "lettrsuggest_pairwise_count",
        String(pairwiseCount),
      );
    } catch (e) {
      console.error("[Suggest] Failed to persist pairwise count", e);
    }
  }, [pairwiseCount]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const now = new Date();
    setLocalHour(now.getHours());
  }, []);

  // Clear selected reasons when popup closes
  useEffect(() => {
    if (!feedbackPopup) {
      setSelectedReasons([]);
    }
  }, [feedbackPopup]);

  // Get posters for all suggested movies (including watchlist picks)
  const tmdbIds = useMemo(() => {
    const mainIds = items?.map((it) => it.id) ?? [];
    const watchlistIds = watchlistPicks.map((it) => it.id);
    const palateIds = palateCleanser.map((it) => it.id);
    return [...new Set([...mainIds, ...watchlistIds, ...palateIds])]; // Dedupe
  }, [items, watchlistPicks, palateCleanser]);
  const { posters, mutate: refreshPosters } = usePostersSWR(tmdbIds);

  // Categorize suggestions into sections
  const [categorizedSuggestions, setCategorizedSuggestions] =
    useState<CategorizedSuggestions | null>(null);

  const categorizeItems = useCallback(
    (items: MovieItem[]): CategorizedSuggestions | null => {
      if (!items || items.length === 0) return null;

      const currentYear = new Date().getFullYear();
      const seasonalConfig = getSeasonalRecommendationConfig();

      // Helper functions to check reason types
      const hasDirectorMatch = (reasons: string[]) =>
        reasons.some((r) => {
          const lower = r.toLowerCase();
          return (
            lower.includes("directed by") ||
            lower.includes("director") ||
            lower.includes("similar to") ||
            lower.includes("inspired by") ||
            lower.includes("in the style of")
          );
        });

      const hasActorMatch = (reasons: string[]) =>
        reasons.some((r) => {
          const lower = r.toLowerCase();
          return (
            lower.includes("stars ") ||
            lower.includes("starring") ||
            lower.includes("cast member") ||
            lower.includes("cast members") ||
            lower.includes("actor") ||
            (lower.includes("similar to") && lower.includes("enjoy")) ||
            lower.includes("works in")
          );
        });

      const hasGenreMatch = (reasons: string[]) =>
        reasons.some((r) => {
          const lower = r.toLowerCase();
          return (
            lower.includes("matches your taste in") ||
            lower.includes("matches your specific taste in") ||
            lower.includes("genre:") ||
            lower.includes("similar genre")
          );
        });

      const hasRecentWatchMatch = (reasons: string[]) =>
        reasons.some(
          (r) =>
            r.toLowerCase().includes("recent") &&
            (r.toLowerCase().includes("watch") ||
              r.toLowerCase().includes("favorite")),
        );

      const hasStudioMatch = (reasons: string[]) =>
        reasons.some((r) => {
          const lower = r.toLowerCase();
          return (
            (lower.includes("from ") &&
              (lower.includes("studio") || lower.includes("—"))) ||
            lower.includes("studios you enjoy") ||
            lower.includes("a24") ||
            lower.includes("neon") ||
            lower.includes("annapurna") ||
            lower.includes("blumhouse") ||
            lower.includes("ghibli") ||
            lower.includes("searchlight")
          );
        });

      const hasDeepCutThemes = (reasons: string[]) =>
        reasons.some((r) => {
          const lower = r.toLowerCase();
          return (
            lower.includes("themes you") ||
            lower.includes("specific themes") ||
            lower.includes("keyword:") ||
            lower.includes("matches specific themes")
          );
        });

      const isSeasonalMatch = (item: MovieItem): boolean => {
        // Check if movie title, genres, or reasons match current seasonal themes
        const titleLower = item.title.toLowerCase();
        const titleMatch = seasonalConfig.keywords.some((kw) =>
          titleLower.includes(kw.toLowerCase()),
        );

        // Check genres if available
        const genreMatch = item.genres
          ? seasonalConfig.keywords.some((kw) =>
              item.genres!.some((g) =>
                g.toLowerCase().includes(kw.toLowerCase()),
              ),
            )
          : false;

        // Also check reasons for genre mentions that match seasonal config
        const reasonsMatch = item.reasons.some((r) => {
          const lower = r.toLowerCase();
          return seasonalConfig.keywords.some((kw) =>
            lower.includes(kw.toLowerCase()),
          );
        });

        return titleMatch || genreMatch || reasonsMatch;
      };

      // Preserve canonical order while partitioning items into UI sections.
      const sorted = [...items];

      // Track used IDs to prevent duplicates across sections
      const usedIds = new Set<number>();

      // Helper to get next N unused items matching a filter
      const getNextItems = (
        filter: (item: MovieItem) => boolean,
        count: number,
      ): MovieItem[] => {
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
      const seasonalPicks =
        seasonalConfig.genres.length > 0
          ? getNextItems(isSeasonalMatch, SECTION_ITEM_LIMIT)
          : [];

      if (process.env.NODE_ENV === "development") {
        if (process.env.NODE_ENV === "development") {
          console.log("[Suggest] Seasonal picks result", {
            configGenres: seasonalConfig.genres,
            configKeywords: seasonalConfig.keywords,
            seasonalPicksCount: seasonalPicks.length,
          });
        }
      }

      // 1. Multi-Source Consensus: Films recommended by multiple sources (rare, high-value)
      const multiSourceConsensus = getNextItems((item) => {
        return (item.sources?.length ?? 0) >= 2;
      }, SECTION_ITEM_LIMIT);

      // 2. Animation Picks: Animated films (specific genre, not many)
      const animationPicks = getNextItems((item) => {
        if (!item.genres || item.genres.length === 0) return false;
        const hasAnimation = item.genres.some((g) => g === "Animation");
        const isDocumentary = item.genres.some((g) => g === "Documentary");
        return hasAnimation && !isDocumentary;
      }, SECTION_ITEM_LIMIT);

      // 3. Documentaries (specific genre)
      const documentaries = getNextItems((item) => {
        if (!item.genres || item.genres.length === 0) return false;
        return item.genres.some((g) => g === "Documentary");
      }, SECTION_ITEM_LIMIT);

      // 4. International Cinema: Non-English films (specific language filter)
      const internationalCinema = getNextItems((item) => {
        return Boolean(
          item.original_language && item.original_language !== "en",
        );
      }, SECTION_ITEM_LIMIT);

      // 5. Quick Watches: Films under 100 minutes (specific runtime)
      const quickWatches = getNextItems((item) => {
        return Boolean(item.runtime && item.runtime > 0 && item.runtime <= 100);
      }, SECTION_ITEM_LIMIT);

      // 6. Epic Films: Films over 150 minutes (specific runtime)
      const epicFilms = getNextItems((item) => {
        return Boolean(item.runtime && item.runtime >= 150);
      }, SECTION_ITEM_LIMIT);

      // 7. Critically Acclaimed: Very high ratings (specific threshold)
      const criticallyAcclaimed = getNextItems((item) => {
        const imdbRating = parseFloat(item.imdb_rating || "0");
        const rtScore = parseInt(item.rotten_tomatoes?.replace("%", "") || "0");
        const metaScore = parseInt(item.metacritic || "0");
        return imdbRating >= 8.0 || rtScore >= 90 || metaScore >= 80;
      }, SECTION_ITEM_LIMIT);

      // 8. From Collections: Films in same collections/franchises (specific metadata)
      const fromCollections = getNextItems(
        (item) => !!item.collectionName,
        SECTION_ITEM_LIMIT,
      );

      // ============================================
      // PHASE 2: VOTE CATEGORY SECTIONS (moderately specific)
      // ============================================

      // 9. Hidden Gems (Smart Discovery): Films with hidden-gem vote category
      const smartDiscovery = getNextItems((item) => {
        return item.voteCategory === "hidden-gem";
      }, SECTION_ITEM_LIMIT);

      // 10. Classic Hidden Gems: Pre-2015 hidden gems
      const hiddenGems = getNextItems((item) => {
        const year = parseInt(item.year || "0");
        return year > 0 && year < 2015 && item.voteCategory === "hidden-gem";
      }, SECTION_ITEM_LIMIT);

      // 11. Cult Classics: Films with cult following
      const cultClassics = getNextItems((item) => {
        return item.voteCategory === "cult-classic";
      }, SECTION_ITEM_LIMIT);

      // 12. Crowd Pleasers: Popular high-rated films
      const crowdPleasers = getNextItems((item) => {
        return item.voteCategory === "crowd-pleaser";
      }, SECTION_ITEM_LIMIT);

      // ============================================
      // PHASE 3: REASON-BASED SECTIONS (medium specificity)
      // ============================================

      // 13. Based on Recent Watches: Films similar to recent favorites
      const recentWatchMatches = getNextItems(
        (item) => hasRecentWatchMatch(item.reasons),
        SECTION_ITEM_LIMIT,
      );

      // 14. Inspired by Directors You Love
      const directorMatches = getNextItems(
        (item) => hasDirectorMatch(item.reasons),
        SECTION_ITEM_LIMIT,
      );

      // 15. From Studios You Love
      const studioMatches = getNextItems(
        (item) => hasStudioMatch(item.reasons),
        SECTION_ITEM_LIMIT,
      );

      // 16. From Actors You Love
      const actorMatches = getNextItems(
        (item) => hasActorMatch(item.reasons),
        SECTION_ITEM_LIMIT,
      );

      // 17. Your Favorite Genres
      const genreMatches = getNextItems(
        (item) => hasGenreMatch(item.reasons),
        SECTION_ITEM_LIMIT,
      );

      // 17.5. Niche Matches (Subgenres)
      const nicheMatches = getNextItems(
        (item) =>
          item.reasons.some(
            (r) =>
              r.toLowerCase().includes("niche") ||
              r.toLowerCase().includes("subgenre"),
          ),
        SECTION_ITEM_LIMIT,
      );

      // 18. Deep Cuts: Films with specific theme/keyword matches
      const deepCuts = getNextItems(
        (item) => hasDeepCutThemes(item.reasons),
        SECTION_ITEM_LIMIT,
      );

      // ============================================
      // PHASE 4: TIME-BASED SECTIONS (broad filters)
      // ============================================

      // 19. Best of the [Decade]s
      const decadeMatches = topDecade
        ? getNextItems((item) => {
            const year = parseInt(item.year || "0");
            return year >= topDecade && year < topDecade + 10;
          }, SECTION_ITEM_LIMIT)
        : [];

      // 20. New & Trending: Recent releases (2023+)
      const newReleases = getNextItems((item) => {
        const year = parseInt(item.year || "0");
        return year >= 2023;
      }, SECTION_ITEM_LIMIT);

      // 21. Recent Classics: Films from 2015-2022
      const recentClassics = getNextItems((item) => {
        const year = parseInt(item.year || "0");
        return year >= 2015 && year < 2023;
      }, SECTION_ITEM_LIMIT);

      // ============================================
      // PHASE 5: CATCH-ALL SECTIONS (least specific, gets remaining items)
      // ============================================

      // 22. Perfect Matches: Top scoring films that haven't been categorized yet
      const perfectMatches = getNextItems(
        (item) => item.score >= MIN_SCORE_FOR_OVERFLOW,
        SECTION_ITEM_LIMIT,
      );

      // 23. More Recommendations: Any remaining films with some taste signal
      const moreRecommendations = getNextItems(
        (item) => item.score >= MIN_SCORE_FOR_OVERFLOW * 0.5,
        SECTION_ITEM_LIMIT * 2,
      ); // Increased to catch more

      if (process.env.NODE_ENV === "development") {
        if (process.env.NODE_ENV === "development") {
          console.log("[Suggest] Categorization complete", {
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
            totalAvailable: items.length,
          });
        }
      }

      return {
        watchlistPicks: [], // Will be populated separately from watchlistPicks state
        seasonalPicks,
        seasonalConfig,
        perfectMatches,
        recentWatchMatches,
        studioMatches,
        directorMatches,
        actorMatches,
        genreMatches,
        documentaries,
        decadeMatches,
        smartDiscovery,
        hiddenGems,
        cultClassics,
        crowdPleasers,
        newReleases,
        recentClassics,
        deepCuts,
        fromCollections,
        multiSourceConsensus,
        internationalCinema,
        animationPicks,
        quickWatches,
        epicFilms,
        criticallyAcclaimed,
        nicheMatches,
        moreRecommendations,
      };
    },
    [topDecade],
  );

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
  const getSectionFilter = useCallback(
    (sectionName: string, seasonalConfig: any) => {
      const currentYear = new Date().getFullYear();

      // Helper functions for checking reasons
      const hasDirectorMatch = (reasons: string[]) =>
        reasons.some((r) => {
          const lower = r.toLowerCase();
          return (
            lower.includes("directed by") ||
            lower.includes("director") ||
            lower.includes("similar to") ||
            lower.includes("inspired by") ||
            lower.includes("in the style of")
          );
        });

      const hasActorMatch = (reasons: string[]) =>
        reasons.some((r) => {
          const lower = r.toLowerCase();
          return (
            lower.includes("stars ") ||
            lower.includes("starring") ||
            lower.includes("cast member") ||
            lower.includes("cast members") ||
            lower.includes("actor") ||
            (lower.includes("similar to") && lower.includes("enjoy")) ||
            lower.includes("works in")
          );
        });

      const hasGenreMatch = (reasons: string[]) =>
        reasons.some((r) => {
          const lower = r.toLowerCase();
          return (
            lower.includes("matches your taste in") ||
            lower.includes("matches your specific taste in") ||
            lower.includes("genre:") ||
            lower.includes("similar genre")
          );
        });

      const hasRecentWatchMatch = (reasons: string[]) =>
        reasons.some(
          (r) =>
            r.toLowerCase().includes("recent") &&
            (r.toLowerCase().includes("watch") ||
              r.toLowerCase().includes("favorite")),
        );

      const hasStudioMatch = (reasons: string[]) =>
        reasons.some((r) => {
          const lower = r.toLowerCase();
          return (
            (lower.includes("from ") &&
              (lower.includes("studio") || lower.includes("—"))) ||
            lower.includes("studios you enjoy") ||
            lower.includes("a24") ||
            lower.includes("neon") ||
            lower.includes("annapurna") ||
            lower.includes("blumhouse") ||
            lower.includes("ghibli") ||
            lower.includes("searchlight")
          );
        });

      const hasDeepCutThemes = (reasons: string[]) =>
        reasons.some((r) => {
          const lower = r.toLowerCase();
          return (
            lower.includes("themes you") ||
            lower.includes("specific themes") ||
            lower.includes("keyword:") ||
            lower.includes("matches specific themes")
          );
        });

      const isSeasonalMatch = (item: MovieItem): boolean => {
        const titleLower = item.title.toLowerCase();
        const titleMatch = seasonalConfig.keywords.some((kw: string) =>
          titleLower.includes(kw.toLowerCase()),
        );
        const genreMatch = item.genres
          ? seasonalConfig.keywords.some((kw: string) =>
              item.genres!.some((g) =>
                g.toLowerCase().includes(kw.toLowerCase()),
              ),
            )
          : false;
        const reasonsMatch = item.reasons.some((r) => {
          const lower = r.toLowerCase();
          return seasonalConfig.keywords.some((kw: string) =>
            lower.includes(kw.toLowerCase()),
          );
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
          return item.genres.some((g) => g === "Documentary");
        },
        decadeMatches: (item) => {
          if (!topDecade) return false;
          const year = parseInt(item.year || "0");
          return year >= topDecade && year < topDecade + 10;
        },
        smartDiscovery: (item) => item.voteCategory === "hidden-gem",
        hiddenGems: (item) => {
          const year = parseInt(item.year || "0");
          return year > 0 && year < 2015 && item.voteCategory === "hidden-gem";
        },
        cultClassics: (item) => item.voteCategory === "cult-classic",
        crowdPleasers: (item) => item.voteCategory === "crowd-pleaser",
        newReleases: (item) => {
          const year = parseInt(item.year || "0");
          return year >= 2023;
        },
        recentClassics: (item) => {
          const year = parseInt(item.year || "0");
          return year >= 2015 && year < 2023;
        },
        deepCuts: (item) => hasDeepCutThemes(item.reasons),
        fromCollections: (item) => !!item.collectionName,
        multiSourceConsensus: (item) => (item.sources?.length ?? 0) >= 2,
        internationalCinema: (item) =>
          Boolean(item.original_language && item.original_language !== "en"),
        animationPicks: (item) => {
          if (!item.genres || item.genres.length === 0) return false;
          const hasAnimation = item.genres.some((g) => g === "Animation");
          const isDocumentary = item.genres.some((g) => g === "Documentary");
          return hasAnimation && !isDocumentary;
        },
        quickWatches: (item) =>
          Boolean(item.runtime && item.runtime > 0 && item.runtime <= 100),
        epicFilms: (item) => Boolean(item.runtime && item.runtime >= 150),
        criticallyAcclaimed: (item) => {
          const imdbRating = parseFloat(item.imdb_rating || "0");
          const rtScore = parseInt(
            item.rotten_tomatoes?.replace("%", "") || "0",
          );
          const metaScore = parseInt(item.metacritic || "0");
          return imdbRating >= 8.0 || rtScore >= 90 || metaScore >= 80;
        },
        perfectMatches: (item) => item.score >= MIN_SCORE_FOR_OVERFLOW,
        moreRecommendations: (item) =>
          item.score >= MIN_SCORE_FOR_OVERFLOW * 0.5,
      };

      return filters[sectionName] || (() => true);
    },
    [topDecade],
  );

  const extractFeaturesFromReason = useCallback(
    (reason: string): Array<{ type: FeatureType; name: string }> => {
      const features: Array<{ type: FeatureType; name: string }> = [];

      const genreMatch = reason.match(
        /Matches your (?:specific )?taste in ([^(]+)/i,
      );
      if (genreMatch) {
        const names = genreMatch[1]
          .split(/,| \+ /)
          .map((s) => s.trim())
          .filter(Boolean);
        names.forEach((name) => features.push({ type: "genre", name }));
      }

      const directorMatch = reason.match(/Directed by ([^—]+)/i);
      if (directorMatch) {
        directorMatch[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((name) => features.push({ type: "director", name }));
      }

      const keywordMatch = reason.match(
        /(?:Matches specific themes|explores) (?:you )?(?:especially love|enjoy)[^:]*: ([^(]+)/i,
      );
      if (keywordMatch) {
        keywordMatch[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((name) => features.push({ type: "keyword", name }));
      }

      const studioMatch = reason.match(/From ([^—]+)/i);
      if (studioMatch) {
        studioMatch[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((name) => features.push({ type: "collection", name }));
      }

      const castMatch = reason.match(/Stars ([^—]+)/i);
      if (castMatch) {
        castMatch[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((name) => features.push({ type: "actor", name }));
      }

      return features;
    },
    [],
  );

  const collectFeatureRequests = useCallback(
    (movies: MovieItem[]): Array<{ type: FeatureType; name: string }> => {
      const seen = new Set<string>();
      const requests: Array<{ type: FeatureType; name: string }> = [];

      movies.forEach((item) => {
        item.reasons?.forEach((reason) => {
          const feats = extractFeaturesFromReason(reason);
          feats.forEach((f) => {
            const key = `${f.type}:${f.name.toLowerCase()}`;
            if (seen.has(key)) return;
            seen.add(key);
            requests.push(f);
          });
        });
      });

      return requests;
    },
    [extractFeaturesFromReason],
  );

  const mergeFeatureEvidence = useCallback(
    (map: Map<string, FeatureEvidenceSummary>) => {
      setFeatureEvidence((prev) => {
        const next = { ...prev } as Record<string, FeatureEvidenceSummary>;
        map.forEach((value, key) => {
          next[key] = value;
        });
        return next;
      });
    },
    [],
  );

  const fetchEvidenceForFeatures = useCallback(
    async (featureList: Array<{ type: FeatureType; name: string }>) => {
      if (!uid || featureList.length === 0) return;
      try {
        const map = await getFeatureEvidenceSummary(uid, featureList);
        mergeFeatureEvidence(map);
      } catch (e) {
        console.error("[FeatureEvidence] Failed to fetch evidence", e);
      }
    },
    [uid, mergeFeatureEvidence],
  );

  const computeContext = useCallback(() => {
    const hour = localHour ?? new Date().getHours();
    if (contextMode !== "auto")
      return { mode: contextMode, localHour: hour } as const;

    if (hour >= 22 || hour <= 6)
      return { mode: "short", localHour: hour } as const;
    if (hour >= 17 && hour <= 21)
      return { mode: "weeknight", localHour: hour } as const;
    if (hour >= 7 && hour <= 9)
      return { mode: "short", localHour: hour } as const;
    return { mode: "background", localHour: hour } as const;
  }, [contextMode, localHour]);

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
          console.error("Failed to fetch blocked suggestions:", e);
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
      setSavedMovieIds(new Set(movies.map((m) => m.tmdb_id)));
    };
    void loadSavedMovies();
  }, [uid]);

  const sourceFilms = useMemo(
    () => (films && films.length ? films : (fallbackFilms ?? [])),
    [films, fallbackFilms],
  );

  // Presentation-only hydration for headers, watchlist badges, and section text.
  useEffect(() => {
    let active = true;
    const loadPresentationState = async (): Promise<Set<number>> => {
      if (
        !presentationHydrationEnabled ||
        !uid ||
        sourceFilms.length === 0
      ) {
        return new Set<number>();
      }

      try {
        const mappings = await getFilmMappings(
          uid,
          sourceFilms.map((film) => film.uri),
        );
        if (!active) return new Set<number>();

        const watchlistIds = new Set<number>();
        const watchlistFilms = sourceFilms.filter((film) => {
          const tmdbId = mappings.get(film.uri);
          if (film.onWatchlist && tmdbId) watchlistIds.add(tmdbId);
          return Boolean(film.onWatchlist && tmdbId);
        });
        setMappingCoverage({ mapped: mappings.size, total: sourceFilms.length });
        setWatchlistTmdbIds(watchlistIds);

        const presentationTmdbIds = [
          ...new Set(
            sourceFilms
              .map((film) => mappings.get(film.uri))
              .filter(
                (tmdbId): tmdbId is number =>
                  typeof tmdbId === "number" &&
                  Number.isFinite(tmdbId) &&
                  tmdbId > 0,
              ),
          ),
        ].slice(0, 300);
        const details = await getBulkTmdbDetails(presentationTmdbIds);
        const profile = await buildTasteProfile({
          films: sourceFilms,
          mappings,
          topN: 40,
          tmdbDetails: details,
          watchlistFilms,
          userId: uid,
        });
        if (!active) return new Set<number>();

        setTasteProfile(profile);
        setTopDecade(profile.topDecades[0]?.decade ?? null);
        return watchlistIds;
      } catch (error) {
        console.error("[Suggest] Failed to load presentation profile", error);
        return new Set<number>();
      }
    };

    void loadPresentationState();
    return () => {
      active = false;
    };
  }, [presentationHydrationEnabled, sourceFilms, uid]);

  useEffect(() => {
    if (!items) return;
    setWatchlistPicks(
      selectCanonicalWatchlistPicks(items, watchlistTmdbIds),
    );
  }, [items, watchlistTmdbIds]);

  const recentFilmTitle = useMemo(() => {
    if (!sourceFilms.length) return undefined;
    const recentFilm = sourceFilms
      .filter((film) => film.lastDate)
      .sort(
        (a, b) =>
          (b.lastDate ? new Date(b.lastDate).getTime() : 0) -
          (a.lastDate ? new Date(a.lastDate).getTime() : 0),
      )[0];
    return recentFilm?.title;
  }, [sourceFilms]);

  const getPersonalizedHeader = useCallback(
    (
      sectionKey: string,
      profile?: TasteProfile | null,
      sectionItems?: MovieItem[],
    ): string => {
      const truncateName = (name: string) =>
        name.length > 25 ? `${name.slice(0, 22)}...` : name;
      const topDirector = profile?.topDirectors?.[0]?.name;
      const topActor = profile?.topActors?.[0]?.name;
      const topGenre = profile?.topGenres?.[0]?.name;
      const topStudio = profile?.topStudios?.[0]?.name;
      const nicheSignals = profile?.nichePreferences
        ? Object.values(profile.nichePreferences).filter(Boolean).length / 4
        : 0;
      const { season } = getCurrentSeasonalGenres();
      const currentYear = new Date().getFullYear();

      switch (sectionKey) {
        case "directorMatches":
          if (topDirector) return `More from ${truncateName(topDirector)}`;
          if ((profile?.topDirectors?.length ?? 0) > 1) {
            return "Films by Directors You Love";
          }
          return "Director Matches";
        case "actorMatches":
          if (topActor) return `More with ${truncateName(topActor)}`;
          if ((profile?.topActors?.length ?? 0) > 1) {
            return "Films Starring Your Favorites";
          }
          return "Actor Matches";
        case "genreMatches":
          if (topGenre) return `More ${truncateName(topGenre)} Films`;
          if ((profile?.topGenres?.length ?? 0) > 1) {
            return "Films in Your Favorite Genres";
          }
          return "Genre Matches";
        case "studioMatches":
          if (topStudio) return `More from ${truncateName(topStudio)}`;
          return "Studio Matches";
        case "hiddenGems":
          return nicheSignals > 0.6
            ? "Hidden Gems (Just for You)"
            : "Hidden Gems You Might Love";
        case "recentWatchMatches":
          return recentFilmTitle
            ? `Because You Recently Watched ${truncateName(recentFilmTitle)}`
            : "Based on Your Recent Watches";
        case "perfectMatches":
          return "Your Perfect Matches ✨";
        case "seasonalPicks":
          return `Your ${season} Picks ${currentYear}`;
        default: {
          if (sectionItems && sectionItems.length === 0) {
            return sectionKey;
          }
          return sectionKey;
        }
      }
    },
    [recentFilmTitle],
  );

  const palateHeader = useMemo(() => {
    if (!fatigueDetection) return null;
    if (fatigueDetection.type === "mono-genre" && fatigueDetection.genre) {
      return `Take a Break from ${fatigueDetection.genre}`;
    }
    if (fatigueDetection.type === "intensity") return "Lighten the Mood";
    return "Something Uplifting";
  }, [fatigueDetection]);

  const palateDescription = useMemo(() => {
    if (!fatigueDetection) return null;
    return fatigueDetection.message;
  }, [fatigueDetection]);

  const personalizedHeaderCount = useMemo(() => {
    if (!categorizedSuggestions) return 0;
    let count = 0;
    const keys = ALL_SECTION_KEYS.filter(
      (key) => categorizedSuggestions[key]?.length,
    );
    keys.forEach((key) => {
      const header = getPersonalizedHeader(
        key,
        tasteProfile,
        categorizedSuggestions[key],
      );
      if (header && !header.includes(key)) {
        count += 1;
      }
    });
    return count;
  }, [categorizedSuggestions, getPersonalizedHeader, tasteProfile]);

  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[Suggest] Generated ${personalizedHeaderCount} personalized headers`,
      );
    }
  }, [personalizedHeaderCount]);

  const runSuggest = useCallback(async () => {
    const generation = runGenerationRef.current + 1;
    runGenerationRef.current = generation;

    try {
      setPresentationHydrationEnabled(false);
      setCacheKey(Date.now());
      setItems(null);
      setError(null);
      setNoCandidatesReason(null);
      setLoading(true);
      setPairwisePair(null);
      setPairwiseCount(0);
      setPairHistory(new Set());
      setWatchlistPicks([]);
      setPalateCleanser([]);
      setFatigueDetection(null);
      setProgress({
        current: 1,
        total: 3,
        stage: "library",
        details: "Authenticating your recommendation request...",
      });

      if (!supabase || !uid) throw new Error("Not signed in");
      const { data, error } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (error || !accessToken) throw new Error("Authentication required");

      setProgress({
        current: 2,
        total: 3,
        stage: "score",
        details: "Generating canonical recommendations...",
      });
      const canonical = await requestCanonicalWebItems({
        accessToken,
        count: 100,
        excludeTmdbIds: [...new Set([...blockedIds, ...shownIds])],
        requestSeed: `web-${refreshTick}-${mode}`,
      });
      const excludedGenres = new Set(
        excludeGenres
          .split(",")
          .map((genre) => genre.trim().toLowerCase())
          .filter(Boolean),
      );
      const minimumYear = Number(yearMin) || null;
      const maximumYear = Number(yearMax) || null;
      const canonicalItems = parseCanonicalWebItems(canonical) as MovieItem[];
      const details = canonicalItems.filter((item) => {
        const itemYear = item.year ? Number(item.year) : null;
        if (minimumYear && itemYear !== null && itemYear < minimumYear) {
          return false;
        }
        if (maximumYear && itemYear !== null && itemYear > maximumYear) {
          return false;
        }
        return !item.genres?.some((genre) =>
          excludedGenres.has(genre.toLowerCase()),
        );
      });
      setWatchlistPicks(selectCanonicalWatchlistPicks(details, watchlistTmdbIds));
      setSourceLabel("Canonical recommendations from your taste profile");
      setNoCandidatesReason(
        details.length === 0
          ? "No eligible recommendations are currently available."
          : null,
      );
      setShownIds((previous) => {
        const updated = new Set(previous);
        details.forEach((item) => updated.add(item.id));
        return updated;
      });
      setItems(details);
      setProgress({
        current: 3,
        total: 3,
        stage: "details",
        details: `Loaded ${details.length} canonical recommendations!`,
      });

      void detectGenreFatigue(uid)
        .then((fatigue) => {
          if (runGenerationRef.current !== generation) return;
          setFatigueDetection(fatigue);
          setPalateCleanser(selectCanonicalPalateCleanser(details, fatigue));
        })
        .catch((fatigueError) => {
          console.error(
            "[Suggest] Failed to load palate presentation state",
            fatigueError,
          );
          if (runGenerationRef.current !== generation) return;
          setFatigueDetection(null);
          setPalateCleanser([]);
        });
    } catch (error) {
      console.error("[Suggest] error in runSuggest", error);
      setError(
        error instanceof Error ? error.message : "Failed to get suggestions",
      );
    } finally {
      setLoading(false);
      setPresentationHydrationEnabled(true);
      setRefreshingSections(new Set());
    }
  }, [
    blockedIds,
    excludeGenres,
    mode,
    refreshTick,
    shownIds,
    uid,
    watchlistTmdbIds,
    yearMax,
    yearMin,
  ]);
  // Fallback: if no local films, load from Supabase once
  useEffect(() => {
    const maybeLoad = async () => {
      try {
        if (!supabase || !uid) return;
        if (films && films.length) return;
        const { data, error } = await supabase
          .from("film_events")
          .select("uri,title,year,rating,rewatch,last_date,liked,on_watchlist")
          .eq("user_id", uid)
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

  // Build a pairwise comparison candidate whenever items change (but only on initial load)
  useEffect(() => {
    // Resume pairwise session if limit not reached, even if reloaded
    if (pairwisePair !== null) return;
    if (pairwiseCount >= PAIRWISE_SESSION_LIMIT) {
      return;
    }
    if (!items || items.length < 2) {
      setPairwisePair(null);
      return;
    }

    const candidate = findPairwiseCandidate(
      items.filter((i) => !i.dismissed),
      pairHistory,
    );
    // TypeScript check: specific casting might be needed if generic inference fails, but MovieItem matches PairwiseCandidate structure
    setPairwisePair(candidate as { a: MovieItem; b: MovieItem } | null);
  }, [items, pairHistory, pairwiseCount, pairwisePair, PAIRWISE_SESSION_LIMIT]);

  useEffect(() => {
    const loadEvidence = async () => {
      if (!uid || !items || items.length === 0) return;
      const requests = collectFeatureRequests(items);
      if (requests.length === 0) return;
      await fetchEvidenceForFeatures(requests);
    };
    void loadEvidence();
  }, [uid, items, collectFeatureRequests, fetchEvidenceForFeatures]);

  // Recompute when mapping updates are emitted
  useEffect(() => {
    const handler = () => {
      setItems(null);
    };
    const blockedHandler = async () => {
      if (uid) {
        const blocked = await getBlockedSuggestions(uid);
        setBlockedIds(blocked);
        setItems(null);
      }
    };
    const feedbackHandler = () => {
      setItems(null);
    };
    if (typeof window !== "undefined") {
      window.addEventListener("lettr:mappings-updated", handler);
      window.addEventListener("lettr:blocked-updated", blockedHandler);
      window.addEventListener("lettr:feedback-updated", feedbackHandler);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("lettr:mappings-updated", handler);
        window.removeEventListener("lettr:blocked-updated", blockedHandler);
        window.removeEventListener("lettr:feedback-updated", feedbackHandler);
      }
    };
  }, [runSuggest, uid]);

  // Apply a single explicit reason (shared helper so multi-select can submit all)
  const applyExplicitReason = async (
    reason: string,
    popup: NonNullable<typeof feedbackPopup>,
  ) => {
    if (!uid) return popup.insights.learningSummary;
    const isPositive = popup.feedbackType === "positive";
    let confirmMessage = popup.insights.learningSummary;

    // === NEGATIVE FEEDBACK REASONS ===
    if (reason === "already_seen") {
      confirmMessage =
        "👍 Got it! We won't count this against the movie's features.";
    } else if (reason === "not_in_mood") {
      confirmMessage = "👍 No problem! This won't affect your preferences.";
    } else if (reason === "too_long") {
      confirmMessage = "👎 Noted. We'll suggest more quick watches.";
    } else if (reason === "dislike_all") {
      confirmMessage = "👎👎 Got it! We'll strongly avoid movies like this.";
      for (const actor of popup.leadActors) {
        await boostExplicitFeedback(uid, "actor", actor, false, 3);
      }
      for (const genre of popup.genres) {
        await boostExplicitFeedback(uid, "genre", genre, false, 3);
      }
      for (const keyword of popup.topKeywords || []) {
        await boostExplicitFeedback(uid, "keyword", keyword, false, 3);
      }
      if (popup.franchise) {
        await boostExplicitFeedback(
          uid,
          "collection",
          popup.franchise,
          false,
          3,
        );
      }

      // === POSITIVE FEEDBACK REASONS ===
    } else if (reason === "great_pick") {
      confirmMessage =
        "👍 Awesome! We'll learn from this to find more like it.";
    } else if (reason === "want_more_director" && popup.director) {
      confirmMessage = `👍 Great! More ${popup.director} films coming your way.`;
    } else if (reason === "love_all") {
      confirmMessage = "❤️❤️ Amazing! We'll find more movies just like this!";
      for (const actor of popup.leadActors) {
        await boostExplicitFeedback(uid, "actor", actor, true, 3);
      }
      for (const genre of popup.genres) {
        await boostExplicitFeedback(uid, "genre", genre, true, 3);
      }
      for (const keyword of popup.topKeywords || []) {
        await boostExplicitFeedback(uid, "keyword", keyword, true, 3);
      }
      if (popup.franchise) {
        await boostExplicitFeedback(
          uid,
          "collection",
          popup.franchise,
          true,
          3,
        );
      }

      // === SHARED REASONS (work for both positive and negative) ===
    } else if (reason.startsWith("actor:")) {
      const actorName = reason.replace("actor:", "");
      if (isPositive) {
        confirmMessage = `👍 Love it! More ${actorName} movies coming up.`;
        await boostExplicitFeedback(uid, "actor", actorName, true, 2);
      } else {
        confirmMessage = `👎 Got it. ${actorName} movies will appear less often.`;
        await boostExplicitFeedback(uid, "actor", actorName, false, 2);
      }
    } else if (reason === "franchise") {
      if (isPositive) {
        confirmMessage = `👍 Love the ${popup.franchise}! Showing more from this series.`;
        if (popup.franchise) {
          await boostExplicitFeedback(
            uid,
            "collection",
            popup.franchise,
            true,
            2,
          );
        }
      } else {
        confirmMessage = `👎 ${popup.franchise} fatigue noted. Showing fewer from this series.`;
        if (popup.franchise) {
          await boostExplicitFeedback(
            uid,
            "collection",
            popup.franchise,
            false,
            2,
          );
        }
      }
    } else if (reason.startsWith("genre:")) {
      const genreName = reason.replace("genre:", "");
      if (isPositive) {
        confirmMessage = `👍 Great! More ${genreName} movies for you.`;
        await boostExplicitFeedback(uid, "genre", genreName, true, 2);
      } else {
        confirmMessage = `👎 Got it. Fewer ${genreName} movies coming up.`;
        await boostExplicitFeedback(uid, "genre", genreName, false, 2);
      }
    } else if (reason.startsWith("keyword:")) {
      const keywordName = reason.replace("keyword:", "");
      if (isPositive) {
        confirmMessage = `👍 Noted! More "${keywordName}" themed movies coming up.`;
        await boostExplicitFeedback(uid, "keyword", keywordName, true, 2);
      } else {
        confirmMessage = `👎 Got it. Fewer "${keywordName}" themed movies coming up.`;
        await boostExplicitFeedback(uid, "keyword", keywordName, false, 2);
      }
    }

    return confirmMessage;
  };

  // Quick single-reason submit (still supported)
  const handleExplicitReason = async (reason: string) => {
    if (!feedbackPopup) return;
    const popupData = feedbackPopup;
    if (process.env.NODE_ENV === "development") {
      if (process.env.NODE_ENV === "development") {
        console.log(
          "[FeedbackPopup] User selected explicit reason:",
          reason,
          "for movie:",
          popupData.title,
          "type:",
          popupData.feedbackType,
        );
      }
    }
    const confirmMessage = await applyExplicitReason(reason, popupData);
    setFeedbackPopup(null);
    setSelectedReasons([]);
    setFeedbackMessage(confirmMessage);
    setTimeout(() => setFeedbackMessage(null), 3500);
  };

  const toggleReasonSelection = (reason: string) => {
    setSelectedReasons((prev) =>
      prev.includes(reason)
        ? prev.filter((r) => r !== reason)
        : [...prev, reason],
    );
  };

  const getReasonButtonClasses = (baseClasses: string, selected: boolean) =>
    selected
      ? `${baseClasses} ring-2 ring-offset-1 ring-blue-500 ring-offset-white dark:ring-offset-gray-800`
      : baseClasses;

  const getFeatureEvidenceBadge = (type: FeatureType, name: string) => {
    const key = `${type}:${name.toLowerCase()}`;
    const data = featureEvidence[key];
    if (!data) return null;
    const effective = data.totalCount * data.decayMultiplier;
    const label =
      effective >= 6 ? "Strong" : effective >= 3 ? "Solid" : "Light";
    const days = data.lastUpdated
      ? Math.max(
          0,
          Math.round(
            (Date.now() - new Date(data.lastUpdated).getTime()) /
              (1000 * 60 * 60 * 24),
          ),
        )
      : null;
    const recency = days === null ? "stale" : days === 0 ? "<1d" : `${days}d`;
    return {
      text: `${label} • ${data.totalCount} signals • ${recency}`,
      title: `${label} evidence for ${name}${days === null ? "" : ` • last updated ${recency}`}`,
    };
  };
  const handleSubmitSelectedReasons = async () => {
    if (!feedbackPopup || selectedReasons.length === 0) {
      setFeedbackPopup(null);
      setSelectedReasons([]);
      return;
    }
    const popupData = feedbackPopup;
    let lastMessage = popupData.insights.learningSummary;
    for (const reason of selectedReasons) {
      lastMessage = await applyExplicitReason(reason, popupData);
    }
    setFeedbackPopup(null);
    setSelectedReasons([]);
    setFeedbackMessage(lastMessage);
    setTimeout(() => setFeedbackMessage(null), 3500);
  };

  const handleFastNeutralize = async () => {
    if (!feedbackPopup || !uid) return;
    try {
      await neutralizeFeedback(uid, feedbackPopup.tmdbId);
      await handleUndoDismiss(feedbackPopup.tmdbId);
      setFeedbackMessage(
        "Marked as neutral. We will stop penalizing this pick.",
      );
      setTimeout(() => setFeedbackMessage(null), 3500);
    } catch (e) {
      console.error("[FeedbackPopup] Fast neutralize failed", e);
      setFeedbackMessage("Could not reset feedback right now.");
      setTimeout(() => setFeedbackMessage(null), 3500);
    } finally {
      setFeedbackPopup(null);
    }
  };

  const handleMicroSurveyChoice = async (
    choice: "cast" | "tone" | "runtime",
  ) => {
    if (!feedbackPopup) return;
    if (choice === "runtime") {
      await handleExplicitReason("too_long");
      return;
    }
    if (choice === "cast" && feedbackPopup.leadActors.length > 0) {
      await handleExplicitReason(`actor:${feedbackPopup.leadActors[0]}`);
      return;
    }
    if (choice === "tone" && feedbackPopup.topKeywords.length > 0) {
      await handleExplicitReason(`keyword:${feedbackPopup.topKeywords[0]}`);
      return;
    }
    await handleExplicitReason("not_in_mood");
  };

  // Handle feedback
  const handleFeedback = async (
    tmdbId: number,
    type: "negative" | "positive",
    reasons?: string[],
  ) => {
    if (!uid) return;

    // Find the movie title for the popup
    const movie = items?.find((i) => i.id === tmdbId);
    const movieTitle = movie?.title || "this movie";
    const feedbackMeta = {
      sources: movie?.sources,
      consensusLevel: movie?.consensusLevel ?? "low",
    };

    try {
      if (type === "negative") {
        // Block the suggestion in the background and get learning insights
        const [insights, movieFeatures] = await Promise.all([
          addFeedback(uid, tmdbId, "negative", reasons, feedbackMeta),
          blockSuggestion(uid, tmdbId).then(() =>
            getMovieFeaturesForPopup(tmdbId),
          ),
        ]);

        await fetchEvidenceForFeatures([
          ...movieFeatures.leadActors.map((name) => ({
            type: "actor" as FeatureType,
            name,
          })),
          ...movieFeatures.genres.map((name) => ({
            type: "genre" as FeatureType,
            name,
          })),
          ...movieFeatures.topKeywords.map((name) => ({
            type: "keyword" as FeatureType,
            name,
          })),
          ...(movieFeatures.franchise
            ? [
                {
                  type: "collection" as FeatureType,
                  name: movieFeatures.franchise,
                },
              ]
            : []),
          ...(movieFeatures.director
            ? [
                {
                  type: "director" as FeatureType,
                  name: movieFeatures.director,
                },
              ]
            : []),
        ]);

        setBlockedIds((prev) => new Set([...prev, tmdbId]));

        // Store for persistent undo control
        setLastFeedback({ id: tmdbId, title: movieTitle });

        // Offer quick undo toast
        setUndoToast({ id: tmdbId, title: movieTitle });
        setTimeout(
          () =>
            setUndoToast((curr) => (curr && curr.id === tmdbId ? null : curr)),
          5000,
        );

        // Mark the item as dismissed in items (source of truth for storage)
        setItems((prev) => {
          if (!prev) return prev;
          return prev.map((item) =>
            item.id === tmdbId ? { ...item, dismissed: true } : item,
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
              const idx = section.findIndex(
                (item: MovieItem) => item.id === tmdbId,
              );
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
        const shouldShowMicroSurvey =
          type === "negative" &&
          microSurveyCount < 2 &&
          (insights.strengthenedAvoidance.length > 0 ||
            insights.newAvoidance.length > 0) &&
          (tmdbId + microSurveyCount) % 3 === 0;

        if (hasActors || hasFranchise || hasGenres || hasKeywords) {
          setFeedbackPopup({
            tmdbId,
            title: movieTitle,
            insights,
            leadActors: movieFeatures.leadActors,
            franchise: movieFeatures.franchise,
            topKeywords: movieFeatures.topKeywords,
            genres: movieFeatures.genres,
            feedbackType: "negative",
            director: movieFeatures.director,
            showMicroSurvey: shouldShowMicroSurvey,
          });
          if (shouldShowMicroSurvey) {
            setMicroSurveyCount((c) => c + 1);
          }
          // No auto-dismiss - let user take their time or close manually
        } else {
          // No interesting features to ask about, just show the learning message
          setFeedbackMessage(insights.learningSummary);
          setTimeout(() => setFeedbackMessage(null), 4000);
        }
      } else {
        // Positive feedback - get learning insights AND show popup for explicit learning
        const [insights, movieFeatures] = await Promise.all([
          addFeedback(uid, tmdbId, "positive", reasons, feedbackMeta),
          getMovieFeaturesForPopup(tmdbId),
        ]);

        await fetchEvidenceForFeatures([
          ...movieFeatures.leadActors.map((name) => ({
            type: "actor" as FeatureType,
            name,
          })),
          ...movieFeatures.genres.map((name) => ({
            type: "genre" as FeatureType,
            name,
          })),
          ...movieFeatures.topKeywords.map((name) => ({
            type: "keyword" as FeatureType,
            name,
          })),
          ...(movieFeatures.franchise
            ? [
                {
                  type: "collection" as FeatureType,
                  name: movieFeatures.franchise,
                },
              ]
            : []),
          ...(movieFeatures.director
            ? [
                {
                  type: "director" as FeatureType,
                  name: movieFeatures.director,
                },
              ]
            : []),
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
            feedbackType: "positive",
            director: movieFeatures.director,
          });
        } else {
          setFeedbackMessage(insights.learningSummary);
          setTimeout(() => setFeedbackMessage(null), 3000);
        }
      }
    } catch (e) {
      console.error("Failed to submit feedback:", e);
      // On error for negative feedback, just remove the item from categories
      if (type === "negative") {
        setCategorizedSuggestions((prev: CategorizedSuggestions | null) => {
          if (!prev) return prev;
          const next = { ...prev };
          for (const key in next) {
            // @ts-ignore - dynamic key access
            const section = next[key as keyof CategorizedSuggestions];
            if (Array.isArray(section)) {
              // @ts-ignore - dynamic key assignment
              next[key as keyof CategorizedSuggestions] = section.filter(
                (item: MovieItem) => item.id !== tmdbId,
              );
            }
          }
          return next;
        });
      }
    }
  };

  const handlePairwiseVote = async (winnerId: number, loserId: number) => {
    if (!uid) return;

    if (process.env.NODE_ENV === "development") {
      if (process.env.NODE_ENV === "development") {
        console.log("[Pairwise] Vote received:", {
          winnerId,
          loserId,
          currentCount: pairwiseCount,
        });
      }
    }

    const nextCount = pairwiseCount + 1;
    const nextHistory = new Set(pairHistory);
    nextHistory.add(makePairId(winnerId, loserId));
    setPairHistory(nextHistory);
    setPairwiseCount(nextCount);

    // Hide both movies from the suggestions grid (winner goes to watchlist, loser is dismissed)
    const nextBlockedIds = new Set(blockedIds);
    nextBlockedIds.add(winnerId);
    nextBlockedIds.add(loserId);
    setBlockedIds(nextBlockedIds);

    try {
      const winner = items?.find((i) => i.id === winnerId);
      const loser = items?.find((i) => i.id === loserId);

      const sharedTags = (() => {
        const tagsA = winner
          ? reasonTypeTags(winner.reasons)
          : new Set<string>();
        const tagsB = loser ? reasonTypeTags(loser.reasons) : new Set<string>();
        return Array.from(tagsA).filter((t) => tagsB.has(t));
      })();

      await Promise.all([
        addFeedback(uid, winnerId, "positive", winner?.reasons, {
          sources: winner?.sources,
          consensusLevel: winner?.consensusLevel ?? "low",
        }),
        addFeedback(uid, loserId, "negative", loser?.reasons, {
          sources: loser?.sources,
          consensusLevel: loser?.consensusLevel ?? "low",
        }),
        recordPairwiseEvent(uid, {
          winnerId,
          loserId,
          sharedReasonTags: sharedTags,
          winnerSources: winner?.sources,
          loserSources: loser?.sources,
          winnerConsensus: winner?.consensusLevel ?? "low",
          loserConsensus: loser?.consensusLevel ?? "low",
        }),
      ]);

      await applyPairwiseFeatureLearning(uid, winnerId, loserId);

      setFeedbackMessage("Got it — we will favor your pick.");
      setTimeout(() => setFeedbackMessage(null), 2200);
    } catch (e) {
      console.error("[Pairwise] Failed to record preference", e);
    } finally {
      // Find next pair from items that aren't blocked, or close modal if limit reached
      if (nextCount >= PAIRWISE_SESSION_LIMIT) {
        setPairwisePair(null);
      } else {
        const availableItems = (items ?? []).filter(
          (i) => !nextBlockedIds.has(i.id) && !i.dismissed,
        );
        const next = findPairwiseCandidate(availableItems, nextHistory);
        if (process.env.NODE_ENV === "development") {
          if (process.env.NODE_ENV === "development") {
            console.log("[Pairwise] Finding next pair:", {
              availableCount: availableItems.length,
              found: !!next,
              nextCount,
              limit: PAIRWISE_SESSION_LIMIT,
            });
          }
        }
        setPairwisePair(next);
      }
    }
  };

  const handlePairwiseSkip = (aId: number, bId: number) => {
    const nextCount = pairwiseCount + 1;
    const nextHistory = new Set(pairHistory);
    nextHistory.add(makePairId(aId, bId));
    setPairHistory(nextHistory);
    setPairwiseCount(nextCount);

    if (process.env.NODE_ENV === "development") {
      if (process.env.NODE_ENV === "development") {
        console.log("[Pairwise] Skipping pair:", {
          aId,
          bId,
          nextCount,
          limit: PAIRWISE_SESSION_LIMIT,
        });
      }
    }

    // Find next pair, or close modal if limit reached
    if (nextCount >= PAIRWISE_SESSION_LIMIT) {
      setPairwisePair(null);
    } else {
      const next = findPairwiseCandidate(items ?? [], nextHistory);
      if (process.env.NODE_ENV === "development") {
        if (process.env.NODE_ENV === "development") {
          console.log("[Pairwise] Finding next after skip:", {
            availableCount: items?.length ?? 0,
            found: !!next,
          });
        }
      }
      setPairwisePair(next);
    }
  };

  const handleUndoDismiss = async (tmdbId: number) => {
    if (!uid) return;
    try {
      await unblockSuggestion(uid, tmdbId);
      setUndoToast(null);
      setLastFeedback((curr) => (curr && curr.id === tmdbId ? null : curr));
      setBlockedIds((prev) => {
        const next = new Set(prev);
        next.delete(tmdbId);
        return next;
      });
      setItems(
        (prev) =>
          prev?.map((item) =>
            item.id === tmdbId ? { ...item, dismissed: false } : item,
          ) ?? prev,
      );
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
      console.error("[Suggest] undo dismiss failed", e);
    }
  };

  const handleUndoLastFeedback = async () => {
    if (!lastFeedback) return;
    await handleUndoDismiss(lastFeedback.id);
  };

  // Handle saving a movie to the list
  const handleSave = async (
    tmdbId: number,
    title: string,
    year?: string,
    posterPath?: string | null,
  ) => {
    if (!uid) return;
    try {
      const result = await saveMovie(uid, {
        tmdb_id: tmdbId,
        title,
        year: year || null,
        poster_path: posterPath || null,
      });

      if (result.success) {
        setSavedMovieIds((prev) => new Set([...prev, tmdbId]));
        setFeedbackMessage("Saved to your list!");
        setTimeout(() => setFeedbackMessage(null), 3000);
      } else {
        console.error("Failed to save movie:", result.error);
        // Check if it's a duplicate error
        if (
          result.error?.includes("duplicate") ||
          result.error?.includes("unique")
        ) {
          setFeedbackMessage("Already in your list!");
        } else {
          setFeedbackMessage("Failed to save movie");
        }
        setTimeout(() => setFeedbackMessage(null), 3000);
      }
    } catch (e) {
      console.error("Error saving movie:", e);
      setFeedbackMessage("Failed to save movie");
      setTimeout(() => setFeedbackMessage(null), 3000);
    }
  };

  // Section refreshes request a complete canonical rerun so section composition
  // cannot reorder or merge independently generated recommendation batches.
  const handleRefreshSection = (sectionName: string) => {
    if (!uid || !categorizedSuggestions || loading) {
      setRefreshingSections(new Set());
      return;
    }
    setRefreshingSections(new Set([sectionName]));
    setRefreshTick((tick) => tick + 1);
    setItems(null);
  };

  return (
    <AuthGate>
      <FeatureEvidenceContext.Provider value={featureEvidence}>
        {/* Feedback Toast */}
        {feedbackMessage && (
          <div className="fixed bottom-4 right-4 bg-gray-900 text-white px-4 py-2 rounded shadow-lg z-50 animate-fade-in-up">
            {feedbackMessage}
          </div>
        )}

        {/* Undo Toast for dismissed suggestions */}
        {undoToast && (
          <div className="fixed bottom-4 left-4 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-4 py-3 rounded shadow-lg border border-gray-200 dark:border-gray-700 z-50 flex items-center gap-3 animate-fade-in-up">
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
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-popup-title"
          >
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/30 backdrop-blur-sm"
              onClick={() => setFeedbackPopup(null)}
            />

            {/* Popup Card - Redesigned with scrollable content */}
            <div
              ref={feedbackModalRef}
              tabIndex={-1}
              className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
            >
              {/* Fixed Header */}
              <div className="flex-shrink-0 p-4 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <p
                      id="feedback-popup-title"
                      className="text-sm font-medium text-gray-900 dark:text-white"
                    >
                      {feedbackPopup.insights.learningSummary}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Want to tell us more? (optional)
                    </p>
                  </div>
                  <button
                    onClick={() => setFeedbackPopup(null)}
                    className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
                    aria-label="Close"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {feedbackPopup.feedbackType === "negative" ? (
                  <>
                    {/* === NEGATIVE FEEDBACK OPTIONS === */}

                    {/* NUCLEAR OPTION - Dislike everything */}
                    <div>
                      <p className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
                        Strong dislike:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {(() => {
                          const isSelected =
                            selectedReasons.includes("dislike_all");
                          return (
                            <button
                              onClick={() =>
                                toggleReasonSelection("dislike_all")
                              }
                              className={getReasonButtonClasses(
                                "px-3 py-1.5 text-xs bg-red-200 dark:bg-red-900/60 text-red-800 dark:text-red-200 hover:bg-red-300 dark:hover:bg-red-900/80 rounded-full transition-colors font-medium border border-red-300 dark:border-red-800",
                                isSelected,
                              )}
                            >
                              🚫 I don&apos;t like this movie
                            </button>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Non-negative reasons (won't learn avoidance) */}
                    <div>
                      <p className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
                        Not a problem with the movie:
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {[
                          {
                            key: "already_seen",
                            label: "✓ Already seen it",
                            color:
                              "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-900/60",
                          },
                          {
                            key: "not_in_mood",
                            label: "😴 Not in the mood",
                            color:
                              "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600",
                          },
                          {
                            key: "too_long",
                            label: "⏱️ Too long right now",
                            color:
                              "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600",
                          },
                        ].map(({ key, label, color }) => {
                          const isSelected = selectedReasons.includes(key);
                          return (
                            <button
                              key={key}
                              onClick={() => toggleReasonSelection(key)}
                              className={getReasonButtonClasses(
                                `px-3 py-1.5 text-xs rounded-full transition-colors ${color}`,
                                isSelected,
                              )}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {feedbackPopup.showMicroSurvey && (
                      <div className="border border-dashed border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-gray-50 dark:bg-gray-900">
                        <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                          Quick check: what missed?
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => handleMicroSurveyChoice("cast")}
                            className="px-3 py-1.5 text-xs bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                          >
                            🎭 Cast/tone off
                          </button>
                          <button
                            onClick={() => handleMicroSurveyChoice("tone")}
                            className="px-3 py-1.5 text-xs bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                          >
                            🎨 Theme mismatch
                          </button>
                          <button
                            onClick={() => handleMicroSurveyChoice("runtime")}
                            className="px-3 py-1.5 text-xs bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                          >
                            ⏱️ Too long/slow
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Specific reasons section header */}
                    <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        Or tell us specifically:
                      </p>
                    </div>

                    {/* Actor-specific reasons - show ALL lead actors so user can pick specific ones */}
                    {feedbackPopup.leadActors.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
                          Not a fan of this actor:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {feedbackPopup.leadActors.map((actor) => {
                            const reason = `actor:${actor}`;
                            const isSelected = selectedReasons.includes(reason);
                            const badge = getFeatureEvidenceBadge(
                              "actor",
                              actor,
                            );
                            return (
                              <button
                                key={actor}
                                onClick={() => toggleReasonSelection(reason)}
                                className={getReasonButtonClasses(
                                  "px-3 py-1.5 text-xs bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-200 hover:bg-red-200 dark:hover:bg-red-900/60 rounded-full transition-colors flex items-center gap-1",
                                  isSelected,
                                )}
                              >
                                <span>👎 {actor}</span>
                                {badge && (
                                  <span
                                    className="px-1.5 py-0.5 text-[10px] bg-white/70 dark:bg-gray-800/70 text-gray-700 dark:text-gray-300 rounded-full border border-gray-200 dark:border-gray-600"
                                    title={badge.title}
                                  >
                                    {badge.text}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Franchise fatigue */}
                    {feedbackPopup.franchise && (
                      <div>
                        <p className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
                          Franchise fatigue:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {(() => {
                            const reason = "franchise";
                            const isSelected = selectedReasons.includes(reason);
                            const badge = getFeatureEvidenceBadge(
                              "collection",
                              feedbackPopup.franchise,
                            );
                            return (
                              <button
                                onClick={() => toggleReasonSelection(reason)}
                                className={getReasonButtonClasses(
                                  "px-3 py-1.5 text-xs bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-200 hover:bg-orange-200 dark:hover:bg-orange-900/60 rounded-full transition-colors flex items-center gap-1",
                                  isSelected,
                                )}
                              >
                                <span>
                                  🔄 Done with{" "}
                                  {feedbackPopup.franchise.split(":")[0]}
                                </span>
                                {badge && (
                                  <span
                                    className="px-1.5 py-0.5 text-[10px] bg-white/70 dark:bg-gray-800/70 text-gray-700 dark:text-gray-300 rounded-full border border-gray-200 dark:border-gray-600"
                                    title={badge.title}
                                  >
                                    {badge.text}
                                  </span>
                                )}
                              </button>
                            );
                          })()}
                        </div>
                      </div>
                    )}

                    {/* Genre-specific reasons */}
                    {feedbackPopup.genres.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
                          Not into this genre:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {feedbackPopup.genres.slice(0, 3).map((genre) => {
                            const reason = `genre:${genre}`;
                            const isSelected = selectedReasons.includes(reason);
                            const badge = getFeatureEvidenceBadge(
                              "genre",
                              genre,
                            );
                            return (
                              <button
                                key={genre}
                                onClick={() => toggleReasonSelection(reason)}
                                className={getReasonButtonClasses(
                                  "px-3 py-1.5 text-xs bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-200 hover:bg-purple-200 dark:hover:bg-purple-900/60 rounded-full transition-colors flex items-center gap-1",
                                  isSelected,
                                )}
                              >
                                <span>👎 {genre}</span>
                                {badge && (
                                  <span
                                    className="px-1.5 py-0.5 text-[10px] bg-white/70 dark:bg-gray-800/70 text-gray-700 dark:text-gray-300 rounded-full border border-gray-200 dark:border-gray-600"
                                    title={badge.title}
                                  >
                                    {badge.text}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Topic/Theme-specific reasons (keywords) */}
                    {feedbackPopup.topKeywords &&
                      feedbackPopup.topKeywords.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
                            Not interested in this topic:
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {feedbackPopup.topKeywords
                              .slice(0, 5)
                              .map((keyword) => {
                                const reason = `keyword:${keyword}`;
                                const isSelected =
                                  selectedReasons.includes(reason);
                                const badge = getFeatureEvidenceBadge(
                                  "keyword",
                                  keyword,
                                );
                                return (
                                  <button
                                    key={keyword}
                                    onClick={() =>
                                      toggleReasonSelection(reason)
                                    }
                                    className={getReasonButtonClasses(
                                      "px-3 py-1.5 text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-900/60 rounded-full transition-colors flex items-center gap-1",
                                      isSelected,
                                    )}
                                  >
                                    <span>🏷️ {keyword}</span>
                                    {badge && (
                                      <span
                                        className="px-1.5 py-0.5 text-[10px] bg-white/70 dark:bg-gray-800/70 text-gray-700 dark:text-gray-300 rounded-full border border-gray-200 dark:border-gray-600"
                                        title={badge.title}
                                      >
                                        {badge.text}
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                          </div>
                        </div>
                      )}

                    <div className="flex justify-end pt-2">
                      <button
                        onClick={handleFastNeutralize}
                        className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline decoration-dashed"
                      >
                        👍 This is fine (reset)
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* === POSITIVE FEEDBACK OPTIONS === */}
                    {/* Generic positive */}
                    <div>
                      <p className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
                        What made this a great pick?
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {[
                          {
                            key: "great_pick",
                            label: "✨ Just a great pick!",
                            color:
                              "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-200 hover:bg-green-200 dark:hover:bg-green-900/60",
                          },
                          {
                            key: "love_all",
                            label: "❤️ I love everything about this!",
                            color:
                              "bg-emerald-200 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-300 dark:hover:bg-emerald-900/80 border border-emerald-300 dark:border-emerald-800 font-medium",
                          },
                        ].map(({ key, label, color }) => {
                          const isSelected = selectedReasons.includes(key);
                          return (
                            <button
                              key={key}
                              onClick={() => toggleReasonSelection(key)}
                              className={getReasonButtonClasses(
                                `px-3 py-1.5 text-xs rounded-full transition-colors ${color}`,
                                isSelected,
                              )}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Specific reasons section header */}
                    <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
                        Or tell us specifically:
                      </p>
                    </div>

                    {/* Actor love */}
                    {feedbackPopup.leadActors.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
                          Love this actor:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {feedbackPopup.leadActors.map((actor) => {
                            const reason = `actor:${actor}`;
                            const isSelected = selectedReasons.includes(reason);
                            const badge = getFeatureEvidenceBadge(
                              "actor",
                              actor,
                            );
                            return (
                              <button
                                key={actor}
                                onClick={() => toggleReasonSelection(reason)}
                                className={getReasonButtonClasses(
                                  "px-3 py-1.5 text-xs bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-200 hover:bg-emerald-200 dark:hover:bg-emerald-900/60 rounded-full transition-colors flex items-center gap-1",
                                  isSelected,
                                )}
                              >
                                <span>❤️ {actor}</span>
                                {badge && (
                                  <span
                                    className="px-1.5 py-0.5 text-[10px] bg-white/70 dark:bg-gray-800/70 text-gray-700 dark:text-gray-300 rounded-full border border-gray-200 dark:border-gray-600"
                                    title={badge.title}
                                  >
                                    {badge.text}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Franchise love */}
                    {feedbackPopup.franchise && (
                      <div>
                        <p className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
                          Love this franchise:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {(() => {
                            const reason = "franchise";
                            const isSelected = selectedReasons.includes(reason);
                            const badge = getFeatureEvidenceBadge(
                              "collection",
                              feedbackPopup.franchise,
                            );
                            return (
                              <button
                                onClick={() => toggleReasonSelection(reason)}
                                className={getReasonButtonClasses(
                                  "px-3 py-1.5 text-xs bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-200 hover:bg-emerald-200 dark:hover:bg-emerald-900/60 rounded-full transition-colors flex items-center gap-1",
                                  isSelected,
                                )}
                              >
                                <span>
                                  🎬 More{" "}
                                  {feedbackPopup.franchise.split(":")[0]}!
                                </span>
                                {badge && (
                                  <span
                                    className="px-1.5 py-0.5 text-[10px] bg-white/70 dark:bg-gray-800/70 text-gray-700 dark:text-gray-300 rounded-full border border-gray-200 dark:border-gray-600"
                                    title={badge.title}
                                  >
                                    {badge.text}
                                  </span>
                                )}
                              </button>
                            );
                          })()}
                        </div>
                      </div>
                    )}

                    {/* Genre love */}
                    {feedbackPopup.genres.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
                          Love this genre:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {feedbackPopup.genres.slice(0, 3).map((genre) => {
                            const reason = `genre:${genre}`;
                            const isSelected = selectedReasons.includes(reason);
                            const badge = getFeatureEvidenceBadge(
                              "genre",
                              genre,
                            );
                            return (
                              <button
                                key={genre}
                                onClick={() => toggleReasonSelection(reason)}
                                className={getReasonButtonClasses(
                                  "px-3 py-1.5 text-xs bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-200 hover:bg-emerald-200 dark:hover:bg-emerald-900/60 rounded-full transition-colors flex items-center gap-1",
                                  isSelected,
                                )}
                              >
                                <span>❤️ {genre}</span>
                                {badge && (
                                  <span
                                    className="px-1.5 py-0.5 text-[10px] bg-white/70 dark:bg-gray-800/70 text-gray-700 dark:text-gray-300 rounded-full border border-gray-200 dark:border-gray-600"
                                    title={badge.title}
                                  >
                                    {badge.text}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Topic/Theme love (keywords) */}
                    {feedbackPopup.topKeywords &&
                      feedbackPopup.topKeywords.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
                            Love this theme:
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {feedbackPopup.topKeywords
                              .slice(0, 5)
                              .map((keyword) => {
                                const reason = `keyword:${keyword}`;
                                const isSelected =
                                  selectedReasons.includes(reason);
                                const badge = getFeatureEvidenceBadge(
                                  "keyword",
                                  keyword,
                                );
                                return (
                                  <button
                                    key={keyword}
                                    onClick={() =>
                                      toggleReasonSelection(reason)
                                    }
                                    className={getReasonButtonClasses(
                                      "px-3 py-1.5 text-xs bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-200 hover:bg-emerald-200 dark:hover:bg-emerald-900/60 rounded-full transition-colors flex items-center gap-1",
                                      isSelected,
                                    )}
                                  >
                                    <span>❤️ {keyword}</span>
                                    {badge && (
                                      <span
                                        className="px-1.5 py-0.5 text-[10px] bg-white/70 dark:bg-gray-800/70 text-gray-700 dark:text-gray-300 rounded-full border border-gray-200 dark:border-gray-600"
                                        title={badge.title}
                                      >
                                        {badge.text}
                                      </span>
                                    )}
                                  </button>
                                );
                              })}
                          </div>
                        </div>
                      )}
                  </>
                )}
              </div>

              {/* Fixed Footer with Actions */}
              <div className="flex-shrink-0 p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                <div className="text-xs text-center text-gray-500 dark:text-gray-400 mb-2">
                  {selectedReasons.length > 0
                    ? `${selectedReasons.length} reason${selectedReasons.length === 1 ? "" : "s"} selected`
                    : "Pick one or more reasons, then submit"}
                </div>
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={handleSubmitSelectedReasons}
                    disabled={selectedReasons.length === 0}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${selectedReasons.length === 0 ? "bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed" : "bg-blue-600 dark:bg-blue-700 text-white hover:bg-blue-700 dark:hover:bg-blue-600"}`}
                  >
                    Submit selected
                  </button>
                  <button
                    onClick={() => setFeedbackPopup(null)}
                    className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline"
                  >
                    Skip
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {pairwisePair && (
          <>
            {/* Fullscreen Trailer Modal for Pairwise */}
            {pairwiseVideoId !== null && (
              <div
                className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
                onClick={() => setPairwiseVideoId(null)}
              >
                <div
                  className="relative w-full max-w-4xl aspect-video"
                  onClick={(e) => e.stopPropagation()}
                >
                  {(() => {
                    const videoItem =
                      pairwiseVideoId === pairwisePair.a.id
                        ? pairwisePair.a
                        : pairwisePair.b;
                    return videoItem.trailerKey ? (
                      <iframe
                        src={`https://www.youtube.com/embed/${videoItem.trailerKey}?autoplay=1`}
                        title={`${videoItem.title} trailer`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="absolute inset-0 w-full h-full rounded-lg"
                      />
                    ) : null;
                  })()}
                  <button
                    onClick={() => setPairwiseVideoId(null)}
                    className="absolute -top-10 right-0 w-8 h-8 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-full flex items-center justify-center text-white text-lg transition-all"
                    aria-label="Close trailer"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            <div className="mb-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Which fits you better right now?
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    These two were neck-and-neck; your pick will tune future
                    rankings.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-gray-500">
                  <span className="px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200">
                    Pairwise learning
                  </span>
                  <span>
                    {pairwiseCount + 1}/{PAIRWISE_SESSION_LIMIT} this session
                  </span>
                  <button
                    className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                    onClick={() =>
                      handlePairwiseSkip(pairwisePair.a.id, pairwisePair.b.id)
                    }
                  >
                    Skip
                  </button>
                </div>
              </div>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                {[pairwisePair.a, pairwisePair.b].map((item, idx) => {
                  const other = idx === 0 ? pairwisePair.b : pairwisePair.a;
                  return (
                    <div
                      key={item.id}
                      className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col"
                    >
                      {/* Header badge */}
                      <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                        <div className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400">
                          Option {idx === 0 ? "A" : "B"}
                        </div>
                      </div>

                      {/* Movie content */}
                      <div className="flex gap-3 p-3">
                        {/* Poster */}
                        {item.poster_path ? (
                          <div className="w-20 h-28 flex-shrink-0 bg-gray-700 rounded overflow-hidden">
                            <Image
                              src={`https://image.tmdb.org/t/p/w185${item.poster_path}`}
                              alt={item.title}
                              width={80}
                              height={112}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              sizes="80px"
                            />
                          </div>
                        ) : (
                          <div className="w-20 h-28 flex-shrink-0 bg-gray-700 dark:bg-gray-600 rounded flex items-center justify-center text-gray-400 dark:text-gray-500 text-xs text-center p-1">
                            No poster
                          </div>
                        )}

                        {/* Info */}
                        <div className="flex-1 min-w-0 flex flex-col">
                          <div className="font-semibold text-base text-gray-900 dark:text-gray-100 mb-1">
                            {item.title}
                          </div>
                          {item.year && (
                            <div className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                              {item.year}
                            </div>
                          )}

                          {/* Genres */}
                          {item.genres && item.genres.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-2">
                              {item.genres.slice(0, 3).map((genre, i) => (
                                <span
                                  key={i}
                                  className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full"
                                >
                                  {genre}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Rating */}
                          {item.vote_average && (
                            <div className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 mb-2">
                              <span className="text-yellow-500">⭐</span>
                              <span className="font-medium">
                                {item.vote_average.toFixed(1)}
                              </span>
                              <span className="text-gray-400 dark:text-gray-500 text-xs">
                                /10
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Description */}
                      {item.overview && (
                        <div className="px-3 pb-3">
                          <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-3 leading-relaxed">
                            {item.overview}
                          </p>
                        </div>
                      )}

                      {/* Trailer button */}
                      {item.trailerKey && (
                        <div className="px-3 pb-2">
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              setPairwiseVideoId(item.id);
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-100 hover:bg-red-200 dark:hover:bg-red-900/60 rounded-md transition-colors font-medium"
                          >
                            <svg
                              className="w-3.5 h-3.5"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" />
                            </svg>
                            Watch Trailer
                          </button>
                        </div>
                      )}

                      {/* Reasons */}
                      <div className="px-3 pb-3 border-t border-gray-100 dark:border-gray-700 pt-3">
                        <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Why this matches you:
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
                          {item.reasons.slice(0, 2).map((reason, i) => (
                            <div key={i} className="flex items-start gap-1.5">
                              <span className="text-blue-500 mt-0.5">•</span>
                              <span>{reason}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Badges */}
                      <div className="px-3 pb-3">
                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                          {item.consensusLevel && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800">
                              Consensus: {item.consensusLevel}
                            </span>
                          )}
                          {item.sources?.length ? (
                            <span className="px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-200 border border-blue-200 dark:border-blue-800">
                              {item.sources.length} source
                              {item.sources.length === 1 ? "" : "s"}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {/* Action button */}
                      <div className="px-3 pb-3 mt-auto">
                        <button
                          className="w-full inline-flex items-center justify-center rounded-md bg-blue-600 dark:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors"
                          onClick={() => handlePairwiseVote(item.id, other.id)}
                        >
                          Choose this one
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                Suggestions
              </h1>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                Based on your liked and highly rated films.
              </p>
            </div>
            <button
              onClick={() => setQuizOpen(true)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gradient-to-r from-blue-500 to-purple-500 text-white hover:from-blue-600 hover:to-purple-600 transition-all shadow-sm flex items-center gap-1.5"
              title="Take a quick quiz to improve your suggestions"
            >
              <span aria-hidden="true">🎯</span>
              <span>Improve Suggestions Quiz</span>
            </button>
          </div>
          <div className="flex flex-col items-end gap-1 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-gray-600 dark:text-gray-400">Mode:</span>
              <button
                type="button"
                className={`px-2 py-1 rounded border text-xs ${mode === "quick" ? "bg-gray-900 text-white border-gray-900" : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 border-gray-300 dark:border-gray-600"}`}
                onClick={() => {
                  setMode("quick");
                  setItems(null);
                  setShownIds(new Set());
                  setRefreshTick((x) => x + 1);
                }}
              >
                Quick
              </button>
              <button
                type="button"
                className={`px-2 py-1 rounded border text-xs ${mode === "deep" ? "bg-gray-900 text-white border-gray-900" : "bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 border-gray-300 dark:border-gray-600"}`}
                onClick={() => {
                  setMode("deep");
                  setItems(null);
                  setShownIds(new Set());
                  setRefreshTick((x) => x + 1);
                }}
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
            <label
              htmlFor="exclude-genres"
              className="block text-xs text-gray-600 dark:text-gray-400"
            >
              Exclude genres (comma)
            </label>
            <input
              id="exclude-genres"
              value={excludeGenres}
              onChange={(e) => setExcludeGenres(e.target.value)}
              placeholder="e.g., horror, musical"
              className="border rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label
              htmlFor="year-min"
              className="block text-xs text-gray-600 dark:text-gray-400"
            >
              Year min
            </label>
            <input
              id="year-min"
              type="number"
              value={yearMin}
              onChange={(e) => setYearMin(e.target.value)}
              placeholder="e.g., 1990"
              className="border rounded px-2 py-1 text-sm w-24"
            />
          </div>
          <div>
            <label
              htmlFor="year-max"
              className="block text-xs text-gray-600 dark:text-gray-400"
            >
              Year max
            </label>
            <input
              id="year-max"
              type="number"
              value={yearMax}
              onChange={(e) => setYearMax(e.target.value)}
              placeholder="e.g., 2025"
              className="border rounded px-2 py-1 text-sm w-24"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              className="px-3 py-2 rounded border text-sm hover:bg-gray-50 flex items-center gap-1"
              title="Get completely fresh suggestions (clears history)"
              onClick={() => {
                setItems(null);
                setShownIds(new Set());
                setRefreshTick((x) => x + 1);
              }}
            >
              <span>🔄</span>
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Enrichment Warning - show if less than 50% of films are mapped */}
        {mappingCoverage &&
          mappingCoverage.mapped < mappingCoverage.total * 0.5 &&
          !loading && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 flex gap-3">
              <span className="text-lg">⚠️</span>
              <div className="text-sm text-amber-900">
                <p>
                  Only {mappingCoverage.mapped} of {mappingCoverage.total} films
                  are mapped to TMDB. Recommendations may miss items.
                </p>
                <p className="text-xs text-amber-800 mt-1">
                  Import more data or refresh mappings to improve coverage.
                </p>
              </div>
            </div>
          )}

        {loading && (
          <div className="mb-6">
            <ProgressIndicator
              current={progress.current}
              total={progress.total}
              stage={progress.stage}
              stages={PROGRESS_STAGES}
              details={progress.details}
            />
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!loading && !error && noCandidatesReason && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-3">
            {noCandidatesReason}
          </p>
        )}
        {items && categorizedSuggestions && (
          <div className="space-y-8">
            <div className="flex items-center justify-between gap-3 text-sm text-gray-700 flex-wrap">
              <div className="flex items-center gap-2">
                <label
                  htmlFor="discovery-level"
                  className="text-xs text-gray-600 dark:text-gray-400"
                  title="Lower = safer, familiar picks. Higher = more exploratory, diverse picks."
                >
                  Discovery vs Safety: {discoveryLevel}%
                </label>
                <input
                  id="discovery-level"
                  type="range"
                  min={0}
                  max={100}
                  value={discoveryLevel}
                  aria-label="Discovery vs Safety level"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={discoveryLevel}
                  aria-valuetext={`${discoveryLevel}% - ${discoveryLevel < 30 ? "Safe picks" : discoveryLevel > 70 ? "Exploratory picks" : "Balanced"}`}
                  onChange={(e) => {
                    const newValue = Number(e.target.value);
                    setDiscoveryLevel(newValue);
                    // Debounced auto-refresh when slider changes
                    if ((window as any).__discoverySliderTimeout) {
                      clearTimeout((window as any).__discoverySliderTimeout);
                    }
                    (window as any).__discoverySliderTimeout = setTimeout(
                      () => {
                        setItems(null);
                        setShownIds(new Set());
                        setRefreshTick((x) => x + 1);
                      },
                      800,
                    );
                  }}
                  className="w-40 accent-blue-600"
                  title="Drag to adjust. Changes apply automatically after a brief pause."
                />
                <span
                  className="text-xs text-gray-500 w-8 text-right"
                  aria-hidden="true"
                >
                  {discoveryLevel}%
                </span>
                {discoveryLevel !== 50 && (
                  <button
                    onClick={() => {
                      setDiscoveryLevel(50);
                      setItems(null);
                      setShownIds(new Set());
                      setRefreshTick((x) => x + 1);
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800 hover:underline whitespace-nowrap"
                    title="Reset to default (50%)"
                  >
                    Reset
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <label
                  htmlFor="context-mode"
                  className="text-xs text-gray-600 dark:text-gray-400"
                >
                  Context
                </label>
                <select
                  id="context-mode"
                  value={contextMode}
                  onChange={(e) =>
                    setContextMode(e.target.value as typeof contextMode)
                  }
                  className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-800"
                >
                  <option value="auto">Auto (time-based)</option>
                  <option value="weeknight">Weeknight wind-down</option>
                  <option value="short">Short session</option>
                  <option value="immersive">Immersive/long-form</option>
                  <option value="family">Family/group friendly</option>
                  <option value="background">Easy-background</option>
                </select>
              </div>
              <button
                onClick={handleUndoLastFeedback}
                disabled={!lastFeedback}
                className={`px-3 py-1.5 rounded border text-sm font-medium transition-colors ${lastFeedback ? "bg-white hover:bg-gray-50 text-gray-800 border-gray-200" : "bg-gray-50 text-gray-400 border-gray-100 cursor-not-allowed"}`}
                title={
                  lastFeedback
                    ? `Restore "${lastFeedback.title}" and unblock it`
                    : "No feedback to undo yet"
                }
              >
                ↩️ Undo last feedback
              </button>
            </div>
            {sourceLabel && (
              <p className="text-xs text-gray-500 mb-4">
                Source: {sourceLabel}
              </p>
            )}

            {(() => {
              const sectionCounts = ALL_SECTION_KEYS.reduce(
                (acc, key) => {
                  acc[key] = categorizedSuggestions[key]?.length ?? 0;
                  return acc;
                },
                {} as Record<SectionKey, number>,
              );

              const prioritySections = ALWAYS_VISIBLE_SECTIONS.filter(
                (key) => sectionCounts[key] > 0,
              );
              const prioritySet = new Set(prioritySections);

              const secondarySections = SECONDARY_SECTIONS.filter(
                (key) => !prioritySet.has(key) && sectionCounts[key] >= 3,
              );
              const visibleSectionKeys = [
                ...prioritySections,
                ...secondarySections,
              ];
              const visibleSet = new Set(visibleSectionKeys);

              const collapsedSmallSections = ALL_SECTION_KEYS.filter(
                (key) =>
                  !visibleSet.has(key) &&
                  sectionCounts[key] > 0 &&
                  sectionCounts[key] < 3,
              );
              const collapsedSmallSet = new Set(collapsedSmallSections);

              const exploreSections = EXPLORE_SECTIONS.filter(
                (key) => !collapsedSmallSet.has(key) && sectionCounts[key] > 0,
              );

              const collapsedExploreSections = exploreSections.filter(
                (key) => !showAllSections && !visibleSet.has(key),
              );
              const collapsedExploreSet = new Set(collapsedExploreSections);

              const collapsedSmallCount = showCollapsedSmallSections
                ? 0
                : collapsedSmallSections.length;
              const collapsedCount = showAllSections
                ? collapsedSmallCount
                : collapsedSmallCount + collapsedExploreSections.length;

              const visibleCount = ALL_SECTION_KEYS.filter((key) => {
                if (sectionCounts[key] === 0) return false;
                if (!showAllSections && collapsedExploreSet.has(key))
                  return false;
                if (!showCollapsedSmallSections && collapsedSmallSet.has(key))
                  return false;
                return true;
              }).length;

              if (process.env.NODE_ENV === "development") {
                console.log(
                  `[Suggest] Showing ${visibleCount} sections, ${collapsedCount} collapsed`,
                );
              }

              const shouldRenderSection = (key: SectionKey) => {
                if (sectionCounts[key] === 0) return false;
                if (!showAllSections && collapsedExploreSet.has(key))
                  return false;
                if (!showCollapsedSmallSections && collapsedSmallSet.has(key))
                  return false;
                return true;
              };

              const exploreButtonCount = showAllSections
                ? 0
                : collapsedExploreSections.length;
              const smallSectionsButtonCount = showCollapsedSmallSections
                ? 0
                : collapsedSmallSections.length;

              return (
                <>
                  {/* Picks From Your Letterboxd Watchlist - TOP PRIORITY */}
                  {shouldRenderSection("watchlistPicks") && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">📋</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              Picks From Your Letterboxd Watchlist
                            </h2>
                            <p className="text-xs text-gray-600">
                              Movies you saved to watch, prioritized by what
                              you&apos;ve been enjoying recently
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRefreshSection("watchlistPicks")}
                          disabled={refreshingSections.has("watchlistPicks")}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("watchlistPicks") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
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
                  {shouldRenderSection("seasonalPicks") && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">
                            {categorizedSuggestions.seasonalConfig.title.includes(
                              "Christmas",
                            )
                              ? "🎄"
                              : categorizedSuggestions.seasonalConfig.title.includes(
                                    "Halloween",
                                  )
                                ? "🎃"
                                : categorizedSuggestions.seasonalConfig.title.includes(
                                      "Thanksgiving",
                                    )
                                  ? "🦃"
                                  : categorizedSuggestions.seasonalConfig.title.includes(
                                        "Valentine",
                                      )
                                    ? "💝"
                                    : categorizedSuggestions.seasonalConfig.title.includes(
                                          "Fourth",
                                        ) ||
                                        categorizedSuggestions.seasonalConfig.title.includes(
                                          "Independence",
                                        )
                                      ? "🎆"
                                      : categorizedSuggestions.seasonalConfig.title.includes(
                                            "Easter",
                                          )
                                        ? "🐰"
                                        : "📅"}
                          </span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              {getPersonalizedHeader(
                                "seasonalPicks",
                                tasteProfile,
                                categorizedSuggestions.seasonalPicks,
                              )}
                            </h2>
                            <p className="text-xs text-gray-600">
                              {
                                categorizedSuggestions.seasonalConfig
                                  .description
                              }
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRefreshSection("seasonalPicks")}
                          disabled={refreshingSections.has("seasonalPicks")}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("seasonalPicks") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
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
                  {shouldRenderSection("perfectMatches") && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">🎯</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              {getPersonalizedHeader(
                                "perfectMatches",
                                tasteProfile,
                                categorizedSuggestions.perfectMatches,
                              )}
                            </h2>
                            <p className="text-xs text-gray-600">
                              These match everything you love
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRefreshSection("perfectMatches")}
                          disabled={refreshingSections.has("perfectMatches")}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("perfectMatches") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
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
                  {shouldRenderSection("recentWatchMatches") && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">⏱️</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              {getPersonalizedHeader(
                                "recentWatchMatches",
                                tasteProfile,
                                categorizedSuggestions.recentWatchMatches,
                              )}
                            </h2>
                            <p className="text-xs text-gray-600">
                              Similar to films you&apos;ve enjoyed recently
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            handleRefreshSection("recentWatchMatches")
                          }
                          disabled={refreshingSections.has(
                            "recentWatchMatches",
                          )}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("recentWatchMatches") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
                        {categorizedSuggestions.recentWatchMatches.map(
                          (item) => (
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
                          ),
                        )}
                      </div>
                    </section>
                  )}

                  {/* Inspired by Directors You Love Section */}
                  {shouldRenderSection("directorMatches") && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">🎬</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              {getPersonalizedHeader(
                                "directorMatches",
                                tasteProfile,
                                categorizedSuggestions.directorMatches,
                              )}
                            </h2>
                            <p className="text-xs text-gray-600">
                              From filmmakers you enjoy and directors with
                              similar styles
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            handleRefreshSection("directorMatches")
                          }
                          disabled={refreshingSections.has("directorMatches")}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("directorMatches") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
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
                  {shouldRenderSection("studioMatches") && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">🎞️</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              {getPersonalizedHeader(
                                "studioMatches",
                                tasteProfile,
                                categorizedSuggestions.studioMatches,
                              )}
                            </h2>
                            <p className="text-xs text-gray-600">
                              More from production companies whose style you
                              enjoy
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRefreshSection("studioMatches")}
                          disabled={refreshingSections.has("studioMatches")}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("studioMatches") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
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
                  {shouldRenderSection("actorMatches") && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">⭐</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              {getPersonalizedHeader(
                                "actorMatches",
                                tasteProfile,
                                categorizedSuggestions.actorMatches,
                              )}
                            </h2>
                            <p className="text-xs text-gray-600">
                              More from your favorite performers
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRefreshSection("actorMatches")}
                          disabled={refreshingSections.has("actorMatches")}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("actorMatches") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
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
                  {shouldRenderSection("genreMatches") && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">🎭</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              {getPersonalizedHeader(
                                "genreMatches",
                                tasteProfile,
                                categorizedSuggestions.genreMatches,
                              )}
                            </h2>
                            <p className="text-xs text-gray-600">
                              Based on genres you watch most
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRefreshSection("genreMatches")}
                          disabled={refreshingSections.has("genreMatches")}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("genreMatches") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
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

                  {(exploreButtonCount > 0 || smallSectionsButtonCount > 0) && (
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {exploreButtonCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowAllSections((prev) => !prev)}
                          className="px-4 py-2 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                          {showAllSections
                            ? "Hide extra categories"
                            : `Explore ${exploreButtonCount} More Categories`}
                        </button>
                      )}
                      {smallSectionsButtonCount > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setShowCollapsedSmallSections((prev) => !prev)
                          }
                          className="px-4 py-2 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                          {showCollapsedSmallSections
                            ? "Hide small sections"
                            : `Show ${smallSectionsButtonCount} more sections`}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Documentaries Section */}
                  {shouldRenderSection("documentaries") && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">📹</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              Documentaries
                            </h2>
                            <p className="text-xs text-gray-600">
                              Real stories and factual films
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRefreshSection("documentaries")}
                          disabled={refreshingSections.has("documentaries")}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("documentaries") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
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
                  {shouldRenderSection("decadeMatches") && topDecade && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">📅</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              Best of the {topDecade}s
                            </h2>
                            <p className="text-xs text-gray-600">
                              Top picks from your favorite era
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRefreshSection("decadeMatches")}
                          disabled={refreshingSections.has("decadeMatches")}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("decadeMatches") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
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
                  {shouldRenderSection("smartDiscovery") && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">💎</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              Hidden Gems for You
                            </h2>
                            <p className="text-xs text-gray-600">
                              Highly rated films you might have missed
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRefreshSection("smartDiscovery")}
                          disabled={refreshingSections.has("smartDiscovery")}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("smartDiscovery") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
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
                  {shouldRenderSection("hiddenGems") && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">🔍</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              {getPersonalizedHeader(
                                "hiddenGems",
                                tasteProfile,
                                categorizedSuggestions.hiddenGems,
                              )}
                            </h2>
                            <p className="text-xs text-gray-600">
                              Older films that match your taste
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRefreshSection("hiddenGems")}
                          disabled={refreshingSections.has("hiddenGems")}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("hiddenGems") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
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
                  {shouldRenderSection("cultClassics") && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">🎭</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              Cult Classics
                            </h2>
                            <p className="text-xs text-gray-600">
                              Films with dedicated followings
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRefreshSection("cultClassics")}
                          disabled={refreshingSections.has("cultClassics")}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("cultClassics") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
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
                  {shouldRenderSection("crowdPleasers") && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">🎉</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              Crowd Pleasers
                            </h2>
                            <p className="text-xs text-gray-600">
                              Widely loved and highly rated
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRefreshSection("crowdPleasers")}
                          disabled={refreshingSections.has("crowdPleasers")}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("crowdPleasers") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
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

                  {/* Palate Cleanser Section */}
                  {palateCleanser.length > 0 && fatigueDetection && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">🍿</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              {palateHeader}
                            </h2>
                            <p className="text-xs text-gray-600">
                              {palateDescription}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
                        {palateCleanser.map((item) => (
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
                  {shouldRenderSection("newReleases") && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">✨</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              New & Trending
                            </h2>
                            <p className="text-xs text-gray-600">
                              Fresh picks based on your taste
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRefreshSection("newReleases")}
                          disabled={refreshingSections.has("newReleases")}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("newReleases") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
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
                  {shouldRenderSection("recentClassics") && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">🎬</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              Recent Classics
                            </h2>
                            <p className="text-xs text-gray-600">
                              Great films from 2015-2022
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRefreshSection("recentClassics")}
                          disabled={refreshingSections.has("recentClassics")}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("recentClassics") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
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
                            <h2 className="text-lg font-semibold text-gray-900">
                              Deep Cuts
                            </h2>
                            <p className="text-xs text-gray-600">
                              Niche matches for your specific taste
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRefreshSection("deepCuts")}
                          disabled={refreshingSections.has("deepCuts")}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("deepCuts") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
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
                  {shouldRenderSection("fromCollections") && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">📚</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              From Collections
                            </h2>
                            <p className="text-xs text-gray-600">
                              Complete franchises and series
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            handleRefreshSection("fromCollections")
                          }
                          disabled={refreshingSections.has("fromCollections")}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("fromCollections") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
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
                  {shouldRenderSection("multiSourceConsensus") && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">🎯</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              Multi-Source Consensus
                            </h2>
                            <p className="text-xs text-gray-600">
                              Recommended by multiple sources (TMDB, TasteDive,
                              TuiMDB)
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            handleRefreshSection("multiSourceConsensus")
                          }
                          disabled={refreshingSections.has(
                            "multiSourceConsensus",
                          )}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("multiSourceConsensus") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
                        {categorizedSuggestions.multiSourceConsensus.map(
                          (item) => (
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
                          ),
                        )}
                      </div>
                    </section>
                  )}

                  {/* International Cinema Section - Non-English films */}
                  {shouldRenderSection("internationalCinema") && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">🌍</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              International Cinema
                            </h2>
                            <p className="text-xs text-gray-600">
                              World cinema that matches your taste
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            handleRefreshSection("internationalCinema")
                          }
                          disabled={refreshingSections.has(
                            "internationalCinema",
                          )}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("internationalCinema") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
                        {categorizedSuggestions.internationalCinema.map(
                          (item) => (
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
                          ),
                        )}
                      </div>
                    </section>
                  )}

                  {/* Animation Picks Section */}
                  {shouldRenderSection("animationPicks") && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">🎨</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              Animation Picks
                            </h2>
                            <p className="text-xs text-gray-600">
                              Animated films for you
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRefreshSection("animationPicks")}
                          disabled={refreshingSections.has("animationPicks")}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("animationPicks") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
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
                  {shouldRenderSection("quickWatches") && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">⚡</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              Quick Watches
                            </h2>
                            <p className="text-xs text-gray-600">
                              Great films under 100 minutes
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRefreshSection("quickWatches")}
                          disabled={refreshingSections.has("quickWatches")}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("quickWatches") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
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
                  {shouldRenderSection("epicFilms") && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">🎬</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              Epic Films
                            </h2>
                            <p className="text-xs text-gray-600">
                              Immersive experiences over 2.5 hours
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRefreshSection("epicFilms")}
                          disabled={refreshingSections.has("epicFilms")}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("epicFilms") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
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
                  {shouldRenderSection("criticallyAcclaimed") && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">🏆</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              Critically Acclaimed
                            </h2>
                            <p className="text-xs text-gray-600">
                              Top-rated by critics (IMDB 8+, RT 90%+)
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            handleRefreshSection("criticallyAcclaimed")
                          }
                          disabled={refreshingSections.has(
                            "criticallyAcclaimed",
                          )}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("criticallyAcclaimed") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
                        {categorizedSuggestions.criticallyAcclaimed.map(
                          (item) => (
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
                          ),
                        )}
                      </div>
                    </section>
                  )}

                  {/* More Recommendations Section - Fallback for remaining suggestions */}
                  {shouldRenderSection("moreRecommendations") && (
                    <section>
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">🎥</span>
                          <div>
                            <h2 className="text-lg font-semibold text-gray-900">
                              More Recommendations
                            </h2>
                            <p className="text-xs text-gray-600">
                              Additional films you might enjoy
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            handleRefreshSection("moreRecommendations")
                          }
                          disabled={refreshingSections.has(
                            "moreRecommendations",
                          )}
                          className="text-xs text-gray-600 hover:text-gray-900 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-50"
                          title="Refresh this section"
                        >
                          <svg
                            className={`w-3 h-3 ${refreshingSections.has("moreRecommendations") ? "animate-spin" : ""}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                          <span>Refresh</span>
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
                        {categorizedSuggestions.moreRecommendations.map(
                          (item) => (
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
                          ),
                        )}
                      </div>
                    </section>
                  )}
                </>
              );
            })()}
          </div>
        )}
        {!items && (
          <p className="text-gray-700">
            Your personalized recommendations will appear here.
          </p>
        )}

        {/* Taste Quiz Modal */}
        {uid && (
          <UserQuiz
            userId={uid}
            isOpen={quizOpen}
            onClose={() => setQuizOpen(false)}
          />
        )}
      </FeatureEvidenceContext.Provider>
    </AuthGate>
  );
}
