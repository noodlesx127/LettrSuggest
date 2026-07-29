"use client";
import { generateCanonicalWebRecommendations } from "@/app/actions/recommendations";
import AuthGate from "@/components/AuthGate";
import MovieCard, { FeatureEvidenceContext } from "@/components/MovieCard";
import ProgressIndicator from "@/components/ProgressIndicator";
import GenreSelector, { ALL_GENRES } from "@/components/GenreSelector";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useImportData } from "@/lib/importStore";
import { supabase } from "@/lib/supabaseClient";
import {
  getFilmMappings,
  getBlockedSuggestions,
  blockSuggestion,
  unblockSuggestion,
  addFeedback,
  getMovieFeaturesForPopup,
  getFeatureEvidenceSummary,
  type FeedbackLearningInsights,
  type FeatureEvidenceSummary,
  type FeatureType,
} from "@/lib/enrich";
import { usePostersSWR } from "@/lib/usePostersSWR";
import { TMDB_GENRE_MAP } from "@/lib/genreEnhancement";
import { saveMovie, getSavedMovies } from "@/lib/lists";
import { SUBGENRES_BY_PARENT } from "@/lib/subgenreData";
import { detectSubgenres } from "@/lib/subgenreDetection";
import { matchesNicheGenrePresentation } from "@/lib/recommendationAdapters";
import type { FilmEvent } from "@/lib/normalize";

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
  rotten_tomatoes?: string;
  metacritic?: string;
  awards?: string;
  sources?: string[];
  consensusLevel?: "high" | "medium" | "low";
  reliabilityMultiplier?: number;
  runtime?: number;
  original_language?: string;
  critic_score?: number;
  explanation?: string;
  streamingSources?: Array<{
    name: string;
    type: "sub" | "buy" | "rent" | "free";
    url?: string;
  }>;
  keyword_ids?: number[]; // TMDB keyword IDs for sub-genre filtering
  keyword_names?: string[]; // TMDB keyword names for exact sub-genre matching
};

type GenreSuggestions = {
  [genreId: number]: MovieItem[];
};

// Sub-genre suggestions keyed by subgenre key (e.g., 'THRILLER_SPY')
type SubgenreSuggestions = {
  [subgenreKey: string]: MovieItem[];
};

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

const STORAGE_KEY = "lettrsuggest_genre_selection";
const SUBGENRE_STORAGE_KEY = "lettrsuggest_subgenre_selection";

export default function GenreSuggestPage() {
  const { films, loading: loadingFilms } = useImportData();
  const [uid, setUid] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [genreSuggestions, setGenreSuggestions] = useState<GenreSuggestions>(
    {},
  );
  const [subgenreSuggestions, setSubgenreSuggestions] =
    useState<SubgenreSuggestions>({});
  const [fallbackFilms, setFallbackFilms] = useState<FilmEvent[] | null>(null);
  const [watchlistTmdbIds, setWatchlistTmdbIds] = useState<Set<number>>(
    new Set(),
  );
  const [blockedIds, setBlockedIds] = useState<Set<number>>(new Set());
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
  const [savedMovieIds, setSavedMovieIds] = useState<Set<number>>(new Set());
  const [selectedGenres, setSelectedGenres] = useState<number[]>([]);
  const [selectedSubgenres, setSelectedSubgenres] = useState<string[]>([]);
  const [featureEvidence, setFeatureEvidence] = useState<
    Record<string, FeatureEvidenceSummary>
  >({});

  // Load selected genres from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSelectedGenres(parsed);
        }
      }
    } catch (e) {
      console.error("[GenreSuggest] Failed to restore genre selection", e);
    }
  }, []);

  // Save selected genres to localStorage
  useEffect(() => {
    if (selectedGenres.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedGenres));
      } catch (e) {
        console.error("[GenreSuggest] Failed to save genre selection", e);
      }
    }
  }, [selectedGenres]);

  // Load selected subgenres from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SUBGENRE_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setSelectedSubgenres(parsed);
        }
      }
    } catch (e) {
      console.error("[GenreSuggest] Failed to restore subgenre selection", e);
    }
  }, []);

  // Save selected subgenres to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        SUBGENRE_STORAGE_KEY,
        JSON.stringify(selectedSubgenres),
      );
    } catch (e) {
      console.error("[GenreSuggest] Failed to save subgenre selection", e);
    }
  }, [selectedSubgenres]);

  // Load shownIds from localStorage on mount (7-day TTL)
  useEffect(() => {
    try {
      const stored = localStorage.getItem("lettrsuggest_genre_shown_ids");
      if (stored) {
        const { ids, timestamp } = JSON.parse(stored);
        const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
        const isValid = timestamp && Date.now() - timestamp < SEVEN_DAYS_MS;
        if (isValid && Array.isArray(ids) && ids.length > 0) {
          setShownIds(new Set(ids));
        } else if (!isValid) {
          localStorage.removeItem("lettrsuggest_genre_shown_ids");
        }
      }
    } catch (e) {
      console.error("[GenreSuggest] Failed to restore shown IDs", e);
    }
  }, []);

  // Save shownIds to localStorage when they change
  useEffect(() => {
    if (shownIds.size > 0) {
      const timeoutId = setTimeout(() => {
        try {
          const data = { ids: Array.from(shownIds), timestamp: Date.now() };
          localStorage.setItem(
            "lettrsuggest_genre_shown_ids",
            JSON.stringify(data),
          );
        } catch (e) {
          console.error("[GenreSuggest] Failed to save shown IDs", e);
        }
      }, 500);
      return () => clearTimeout(timeoutId);
    }
  }, [shownIds]);

  // Get all movie IDs for poster fetching
  const allMovieIds = useMemo(() => {
    const ids: number[] = [];
    // Include movies from genre suggestions
    Object.values(genreSuggestions).forEach((movies) => {
      movies.forEach((m) => ids.push(m.id));
    });
    // Include movies from subgenre suggestions
    Object.values(subgenreSuggestions).forEach((movies) => {
      movies.forEach((m) => ids.push(m.id));
    });
    return [...new Set(ids)];
  }, [genreSuggestions, subgenreSuggestions]);

  const { posters } = usePostersSWR(allMovieIds);

  useEffect(() => {
    const init = async () => {
      if (!supabase) return;
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id ?? null;
      setUid(userId);

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

  // Watchlist membership is presentation state; canonical generation remains server-side.
  useEffect(() => {
    let active = true;
    const loadWatchlistState = async () => {
      if (!uid || sourceFilms.length === 0) return;

      try {
        const mappings = await getFilmMappings(
          uid,
          sourceFilms.map((film) => film.uri),
        );
        if (!active) return;

        const watchlistIds = new Set<number>();
        for (const film of sourceFilms) {
          const tmdbId = mappings.get(film.uri);
          if (film.onWatchlist && tmdbId) watchlistIds.add(tmdbId);
        }
        setWatchlistTmdbIds(watchlistIds);
      } catch (error) {
        console.error("[GenreSuggest] Failed to load watchlist state", error);
      }
    };

    void loadWatchlistState();
    return () => {
      active = false;
    };
  }, [sourceFilms, uid]);

  const runGenreSuggest = useCallback(async () => {
    if (selectedGenres.length === 0) {
      setError("Please select at least one genre");
      return;
    }

    try {
      setCacheKey(Date.now());
      setGenreSuggestions({});
      setSubgenreSuggestions({});
      setError(null);
      setLoading(true);
      setProgress({
        current: 1,
        total: 3,
        stage: "library",
        details: "Authenticating your genre recommendation request...",
      });

      if (!supabase || !uid) throw new Error("Not signed in");
      const { data, error: sessionError } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (sessionError || !accessToken) {
        throw new Error("Authentication required");
      }

      const selectedGenreNames = selectedGenres
        .map((genreId) => ALL_GENRES.find((genre) => genre.id === genreId)?.name)
        .filter((name): name is string => Boolean(name));

      setProgress({
        current: 2,
        total: 3,
        stage: "discover",
        details: "Generating canonical genre recommendations...",
      });

      const canonical = await generateCanonicalWebRecommendations({
        accessToken,
        count: 100,
        genreNames: selectedGenreNames,
        excludeTmdbIds: [...new Set([...blockedIds, ...shownIds])],
        requestSeed: `web-genre-${selectedGenres.join("-")}-${selectedSubgenres.join("-")}-${shownIds.size}`,
      });
      const validMovies = canonical.items as MovieItem[];
      if (validMovies.length === 0) {
        setError("No eligible recommendations were found for these genres.");
        return;
      }

      setProgress({
        current: 3,
        total: 3,
        stage: "details",
        details: "Organizing canonical results by genre and sub-genre...",
      });

      const genreMap: GenreSuggestions = {};
      const subgenreMap: SubgenreSuggestions = {};
      const assignedIds = new Set<number>();

      for (const subgenreKey of selectedSubgenres) {
        const parentGenreName =
          subgenreKey.split("_")[0].charAt(0) +
          subgenreKey.split("_")[0].slice(1).toLowerCase();
        const matchingMovies = validMovies.filter((movie) => {
          if (assignedIds.has(movie.id)) return false;
          const movieKeywordNames = movie.keyword_names ?? [];
          const detected = detectSubgenres(
            parentGenreName,
            `${movie.title} ${movie.overview ?? ""}`.toLowerCase(),
            movieKeywordNames,
            movie.keyword_ids ?? [],
          );
          return detected.has(subgenreKey);
        });
        const topMatches = matchingMovies.slice(0, 36);
        if (topMatches.length > 0) {
          subgenreMap[subgenreKey] = topMatches;
          topMatches.forEach((movie) => assignedIds.add(movie.id));
        }
      }

      for (const genreId of selectedGenres) {
        const genreInfo = ALL_GENRES.find((genre) => genre.id === genreId);
        if (!genreInfo) continue;
        const genreName = genreInfo.name.toLowerCase();
        const matchingMovies = validMovies.filter((movie) => {
          if (assignedIds.has(movie.id)) return false;
          const genres = movie.genres?.map((genre) => genre.toLowerCase()) ?? [];
          return (
            genres.some(
              (genre) =>
                genre === genreName ||
                (genreInfo.source === "tuimdb" && genre.includes(genreName)),
            ) ||
            (genreName === "anime" && genres.includes("animation")) ||
            matchesNicheGenrePresentation(genreName, movie.title, genres)
          );
        });
        const topMatches = matchingMovies.slice(0, 36);
        genreMap[genreId] = topMatches;
        topMatches.forEach((movie) => assignedIds.add(movie.id));
      }

      setShownIds((previous) => {
        const next = new Set(previous);
        validMovies.forEach((movie) => next.add(movie.id));
        return new Set(Array.from(next).slice(-500));
      });
      setSubgenreSuggestions(subgenreMap);
      setGenreSuggestions(genreMap);
    } catch (error) {
      console.error("[GenreSuggest] Error:", error);
      setError(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [
    selectedGenres,
    selectedSubgenres,
    uid,
    blockedIds,
    shownIds,
  ]);
  const handleSave = async (tmdbId: number, title: string) => {
    if (!uid) return;
    try {
      const { error } = await saveMovie(uid, { tmdb_id: tmdbId, title });
      if (!error) {
        setSavedMovieIds((prev) => new Set([...prev, tmdbId]));
        setFeedbackMessage(`Added "${title}" to your list`);
        setTimeout(() => setFeedbackMessage(null), 3000);
      }
    } catch (e) {
      console.error("Failed to save movie:", e);
    }
  };

  const handleFeedback = async (
    tmdbId: number,
    type: "negative" | "positive",
    reasons?: string[],
  ) => {
    if (!uid) return;

    const allMovies = [
      ...Object.values(genreSuggestions).flat(),
      ...Object.values(subgenreSuggestions).flat(),
    ];
    const movie = allMovies.find((i) => i.id === tmdbId);
    const movieTitle = movie?.title || "this movie";

    try {
      if (type === "negative") {
        await Promise.all([
          addFeedback(uid, tmdbId, "negative", reasons),
          blockSuggestion(uid, tmdbId),
        ]);

        setBlockedIds((prev) => new Set([...prev, tmdbId]));

        // Mark as dismissed in genre suggestions
        setGenreSuggestions((prev) => {
          const next = { ...prev };
          for (const genreId in next) {
            next[Number(genreId)] = next[Number(genreId)].map((item) =>
              item.id === tmdbId ? { ...item, dismissed: true } : item,
            );
          }
          return next;
        });

        // Mark as dismissed in subgenre suggestions
        setSubgenreSuggestions((prev) => {
          const next = { ...prev };
          for (const subgenreKey in next) {
            next[subgenreKey] = next[subgenreKey].map((item) =>
              item.id === tmdbId ? { ...item, dismissed: true } : item,
            );
          }
          return next;
        });

        setUndoToast({ id: tmdbId, title: movieTitle });
        setTimeout(
          () =>
            setUndoToast((curr) => (curr && curr.id === tmdbId ? null : curr)),
          5000,
        );
      } else {
        await addFeedback(uid, tmdbId, "positive", reasons);
        setFeedbackMessage(`Great! We'll find more like "${movieTitle}"`);
        setTimeout(() => setFeedbackMessage(null), 3000);
      }
    } catch (e) {
      console.error("Failed to submit feedback:", e);
    }
  };

  const handleUndoDismiss = async (tmdbId: number) => {
    if (!uid) return;

    try {
      await unblockSuggestion(uid, tmdbId);
      setBlockedIds((prev) => {
        const next = new Set(prev);
        next.delete(tmdbId);
        return next;
      });

      // Unmark as dismissed in genre suggestions
      setGenreSuggestions((prev) => {
        const next = { ...prev };
        for (const genreId in next) {
          next[Number(genreId)] = next[Number(genreId)].map((item) =>
            item.id === tmdbId ? { ...item, dismissed: false } : item,
          );
        }
        return next;
      });

      // Unmark as dismissed in subgenre suggestions
      setSubgenreSuggestions((prev) => {
        const next = { ...prev };
        for (const subgenreKey in next) {
          next[subgenreKey] = next[subgenreKey].map((item) =>
            item.id === tmdbId ? { ...item, dismissed: false } : item,
          );
        }
        return next;
      });

      setUndoToast(null);
      setFeedbackMessage("Movie restored");
      setTimeout(() => setFeedbackMessage(null), 2000);
    } catch (e) {
      console.error("Failed to undo dismiss:", e);
    }
  };

  // Check if we have any results (genre or subgenre)
  const hasResults =
    Object.values(genreSuggestions).some((arr) => arr.length > 0) ||
    Object.values(subgenreSuggestions).some((arr) => arr.length > 0);

  // Helper to get subgenre display info
  const getSubgenreInfo = (subgenreKey: string) => {
    for (const genreId of Object.keys(SUBGENRES_BY_PARENT)) {
      const subgenres = SUBGENRES_BY_PARENT[Number(genreId)];
      const found = subgenres?.find((s) => s.key === subgenreKey);
      if (found) return found;
    }
    return null;
  };

  return (
    <AuthGate>
      <FeatureEvidenceContext.Provider value={featureEvidence}>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Genre Picks</h1>
              <p className="text-sm text-gray-600">
                Select genres to get personalized suggestions
              </p>
            </div>
            <a
              href="/suggest"
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              ← Back to Suggestions
            </a>
          </div>

          {/* Genre Selector */}
          <div className="bg-white border rounded-lg p-4 shadow-sm">
            <h2 className="text-lg font-semibold mb-3 text-gray-900">
              Select Genres
            </h2>
            <GenreSelector
              selectedGenres={selectedGenres}
              onChange={setSelectedGenres}
              disabled={loading}
              selectedSubgenres={selectedSubgenres}
              onSubgenreChange={setSelectedSubgenres}
              showSubgenres={true}
            />
          </div>

          {/* Generate Button */}
          <div className="flex items-center gap-4">
            <button
              onClick={runGenreSuggest}
              disabled={
                loading ||
                selectedGenres.length === 0 ||
                sourceFilms.length === 0
              }
              className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {loading ? (
                <>
                  <svg
                    className="animate-spin h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  <span>Generating...</span>
                </>
              ) : (
                <>
                  <span>🎬</span>
                  <span>Get Genre Suggestions</span>
                </>
              )}
            </button>
            {selectedGenres.length === 0 && (
              <span className="text-sm text-amber-600">
                Select at least one genre
              </span>
            )}
            {sourceFilms.length === 0 && (
              <span className="text-sm text-amber-600">
                <a href="/import" className="underline">
                  Import your Letterboxd data
                </a>{" "}
                first
              </span>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          {/* Progress Indicator */}
          {loading && (
            <ProgressIndicator
              current={progress.current}
              total={progress.total}
              stage={progress.stage}
              details={progress.details}
              stages={PROGRESS_STAGES}
            />
          )}

          {/* Feedback Message Toast */}
          {feedbackMessage && (
            <div className="fixed bottom-4 right-4 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-fade-in">
              {feedbackMessage}
            </div>
          )}

          {/* Undo Toast */}
          {undoToast && (
            <div className="fixed bottom-4 left-4 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg z-50 flex items-center gap-3 animate-fade-in">
              <span>Removed &ldquo;{undoToast.title}&rdquo;</span>
              <button
                onClick={() => handleUndoDismiss(undoToast.id)}
                className="text-blue-400 hover:text-blue-300 font-medium"
              >
                Undo
              </button>
            </div>
          )}

          {/* Sub-Genre Sections (rendered BEFORE parent genre sections) */}
          {hasResults && (
            <div className="space-y-8">
              {/* Sub-genre sections first */}
              {selectedSubgenres.map((subgenreKey) => {
                const movies = subgenreSuggestions[subgenreKey];
                if (!movies || movies.filter((m) => !m.dismissed).length === 0)
                  return null;

                const subgenreInfo = getSubgenreInfo(subgenreKey);
                if (!subgenreInfo) return null;

                const visibleMovies = movies.filter((m) => !m.dismissed);

                return (
                  <section key={subgenreKey}>
                    <div className="flex items-center gap-2 mb-4">
                      <span className="text-2xl">{subgenreInfo.emoji}</span>
                      <div>
                        <h2 className="text-lg font-semibold text-gray-900">
                          {subgenreInfo.name} Suggestions
                        </h2>
                        <p className="text-xs text-gray-600">
                          {visibleMovies.length} movies matching this sub-genre
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
                      {visibleMovies.map((item) => (
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
                );
              })}

              {/* Parent genre sections */}
              {selectedGenres.map((genreId) => {
                const movies = genreSuggestions[genreId];
                if (!movies || movies.filter((m) => !m.dismissed).length === 0)
                  return null;

                const genreInfo = ALL_GENRES.find((g) => g.id === genreId);
                if (!genreInfo) return null;

                const visibleMovies = movies.filter((m) => !m.dismissed);

                return (
                  <section key={genreId}>
                    <div className="flex items-center gap-2 mb-4">
                      <span className="text-2xl">{genreInfo.emoji}</span>
                      <div>
                        <h2 className="text-lg font-semibold text-gray-900">
                          {genreInfo.name} Suggestions
                        </h2>
                        <p className="text-xs text-gray-600">
                          {visibleMovies.length} movies based on your taste
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr">
                      {visibleMovies.map((item) => (
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
                );
              })}
            </div>
          )}

          {/* Empty State */}
          {!loading && !hasResults && selectedGenres.length > 0 && (
            <div className="text-center py-12 text-gray-500">
              <p className="text-lg">No suggestions yet</p>
              <p className="text-sm mt-1">
                Click &ldquo;Get Genre Suggestions&rdquo; to generate
                personalized recommendations
              </p>
            </div>
          )}
        </div>
      </FeatureEvidenceContext.Provider>
    </AuthGate>
  );
}
