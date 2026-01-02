'use client';
import AuthGate from '@/components/AuthGate';
import MovieCard, { FeatureEvidenceContext } from '@/components/MovieCard';
import ProgressIndicator from '@/components/ProgressIndicator';
import GenreSelector, { ALL_GENRES } from '@/components/GenreSelector';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useImportData } from '@/lib/importStore';
import { supabase } from '@/lib/supabaseClient';
import { getFilmMappings, getBulkTmdbDetails, suggestByOverlap, buildTasteProfile, getBlockedSuggestions, blockSuggestion, unblockSuggestion, addFeedback, getFeedback, getAvoidedFeatures, getMovieFeaturesForPopup, getFeatureEvidenceSummary, refreshTmdbCacheForIds, type FeedbackLearningInsights, type FeatureEvidenceSummary, type FeatureType } from '@/lib/enrich';
import { generateSmartCandidates, discoverMoviesByProfile, getWeightedSeedIdsByGenre, type FilmForSeeding } from '@/lib/trending';
import { usePostersSWR } from '@/lib/usePostersSWR';
import { TMDB_GENRE_MAP } from '@/lib/genreEnhancement';
import { saveMovie, getSavedMovies } from '@/lib/lists';
import { getKeywordIdsForSubgenres, SUBGENRE_TO_KEYWORD_IDS, SUBGENRES_BY_PARENT } from '@/lib/subgenreData';
import type { FilmEvent } from '@/lib/normalize';

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
    rotten_tomatoes?: string;
    metacritic?: string;
    awards?: string;
    sources?: string[];
    consensusLevel?: 'high' | 'medium' | 'low';
    reliabilityMultiplier?: number;
    runtime?: number;
    original_language?: string;
    streamingSources?: Array<{ name: string; type: 'sub' | 'buy' | 'rent' | 'free'; url?: string }>;
    keyword_ids?: number[]; // TMDB keyword IDs for sub-genre filtering
};

type GenreSuggestions = {
    [genreId: number]: MovieItem[];
};

// Sub-genre suggestions keyed by subgenre key (e.g., 'THRILLER_SPY')
type SubgenreSuggestions = {
    [subgenreKey: string]: MovieItem[];
};

const PROGRESS_STAGES = [
    { key: 'init', label: 'Initialize', description: 'Setting up recommendation engine' },
    { key: 'library', label: 'Library', description: 'Loading your watch history' },
    { key: 'cache', label: 'Cache', description: 'Fetching movie metadata' },
    { key: 'taste', label: 'Analyze', description: 'Building your taste profile' },
    { key: 'discover', label: 'Discover', description: 'Finding candidates from multiple sources' },
    { key: 'score', label: 'Score', description: 'Ranking suggestions' },
    { key: 'details', label: 'Details', description: 'Loading full movie information' }
];

const STORAGE_KEY = 'lettrsuggest_genre_selection';
const SUBGENRE_STORAGE_KEY = 'lettrsuggest_subgenre_selection';

export default function GenreSuggestPage() {
    const { films, loading: loadingFilms } = useImportData();
    const [uid, setUid] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [genreSuggestions, setGenreSuggestions] = useState<GenreSuggestions>({});
    const [subgenreSuggestions, setSubgenreSuggestions] = useState<SubgenreSuggestions>({});
    const [fallbackFilms, setFallbackFilms] = useState<FilmEvent[] | null>(null);
    const [watchlistTmdbIds, setWatchlistTmdbIds] = useState<Set<number>>(new Set());
    const [blockedIds, setBlockedIds] = useState<Set<number>>(new Set());
    const [shownIds, setShownIds] = useState<Set<number>>(new Set());
    const [cacheKey, setCacheKey] = useState<number>(Date.now());
    const [progress, setProgress] = useState<{ current: number; total: number; stage: string; details?: string }>({
        current: 0,
        total: 7,
        stage: '',
        details: undefined
    });
    const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
    const [undoToast, setUndoToast] = useState<{ id: number; title: string } | null>(null);
    const [savedMovieIds, setSavedMovieIds] = useState<Set<number>>(new Set());
    const [selectedGenres, setSelectedGenres] = useState<number[]>([]);
    const [selectedSubgenres, setSelectedSubgenres] = useState<string[]>([]);
    const [featureEvidence, setFeatureEvidence] = useState<Record<string, FeatureEvidenceSummary>>({});

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
            console.error('[GenreSuggest] Failed to restore genre selection', e);
        }
    }, []);

    // Save selected genres to localStorage
    useEffect(() => {
        if (selectedGenres.length > 0) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedGenres));
            } catch (e) {
                console.error('[GenreSuggest] Failed to save genre selection', e);
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
            console.error('[GenreSuggest] Failed to restore subgenre selection', e);
        }
    }, []);

    // Save selected subgenres to localStorage
    useEffect(() => {
        try {
            localStorage.setItem(SUBGENRE_STORAGE_KEY, JSON.stringify(selectedSubgenres));
        } catch (e) {
            console.error('[GenreSuggest] Failed to save subgenre selection', e);
        }
    }, [selectedSubgenres]);

    // Load shownIds from localStorage on mount (7-day TTL)
    useEffect(() => {
        try {
            const stored = localStorage.getItem('lettrsuggest_genre_shown_ids');
            if (stored) {
                const { ids, timestamp } = JSON.parse(stored);
                const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
                const isValid = timestamp && (Date.now() - timestamp) < SEVEN_DAYS_MS;
                if (isValid && Array.isArray(ids) && ids.length > 0) {
                    setShownIds(new Set(ids));
                } else if (!isValid) {
                    localStorage.removeItem('lettrsuggest_genre_shown_ids');
                }
            }
        } catch (e) {
            console.error('[GenreSuggest] Failed to restore shown IDs', e);
        }
    }, []);

    // Save shownIds to localStorage when they change
    useEffect(() => {
        if (shownIds.size > 0) {
            const timeoutId = setTimeout(() => {
                try {
                    const data = { ids: Array.from(shownIds), timestamp: Date.now() };
                    localStorage.setItem('lettrsuggest_genre_shown_ids', JSON.stringify(data));
                } catch (e) {
                    console.error('[GenreSuggest] Failed to save shown IDs', e);
                }
            }, 500);
            return () => clearTimeout(timeoutId);
        }
    }, [shownIds]);

    // Get all movie IDs for poster fetching
    const allMovieIds = useMemo(() => {
        const ids: number[] = [];
        // Include movies from genre suggestions
        Object.values(genreSuggestions).forEach(movies => {
            movies.forEach(m => ids.push(m.id));
        });
        // Include movies from subgenre suggestions
        Object.values(subgenreSuggestions).forEach(movies => {
            movies.forEach(m => ids.push(m.id));
        });
        return [...new Set(ids)];
    }, [genreSuggestions, subgenreSuggestions]);

    const { posters, mutate: refreshPosters } = usePostersSWR(allMovieIds);

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

    const runGenreSuggest = useCallback(async () => {
        if (selectedGenres.length === 0) {
            setError('Please select at least one genre');
            return;
        }

        try {
            const freshCacheKey = Date.now();
            setCacheKey(freshCacheKey);
            console.log('[GenreSuggest] Starting', { selectedGenres, filmCount: sourceFilms.length });

            setGenreSuggestions({});
            setError(null);
            setLoading(true);
            setProgress({ current: 0, total: 7, stage: 'init', details: 'Preparing genre-based recommendations...' });

            if (!supabase) throw new Error('Supabase not initialized');
            if (!uid) throw new Error('Not signed in');

            const uris = sourceFilms.map((f) => f.uri);
            setProgress({ current: 1, total: 7, stage: 'library', details: `Loading ${uris.length} films from your Letterboxd...` });
            const mappings = await getFilmMappings(uid, uris);

            const watchedIds = new Set<number>();
            const watchlistIds = new Set<number>();
            for (const f of sourceFilms) {
                const mid = mappings.get(f.uri);
                if (mid) {
                    watchedIds.add(mid);
                    if (f.onWatchlist) watchlistIds.add(mid);
                }
            }
            setWatchlistTmdbIds(watchlistIds);

            // Pre-fetch TMDB details from cache
            const allMappedIds = Array.from(mappings.values());
            setProgress({ current: 2, total: 7, stage: 'cache', details: `Loading metadata for ${allMappedIds.length} movies...` });
            const tmdbDetailsMap = await getBulkTmdbDetails(allMappedIds);

            // Build taste profile
            setProgress({ current: 3, total: 7, stage: 'taste', details: 'Learning from your ratings...' });

            let negativeFeedbackIds: number[] = [];
            try {
                const feedbackMap = await getFeedback(uid);
                negativeFeedbackIds = Array.from(feedbackMap.entries())
                    .filter((entry): entry is [number, 'negative' | 'positive'] => entry[1] === 'negative')
                    .map((entry) => entry[0]);
            } catch (e) {
                console.error('[GenreSuggest] Failed to fetch feedback', e);
            }

            let featureFeedback = undefined;
            try {
                featureFeedback = await getAvoidedFeatures(uid);
            } catch (e) {
                console.error('[GenreSuggest] Failed to fetch feature feedback', e);
            }

            const watchlistFilms = sourceFilms.filter(f => f.onWatchlist && mappings.has(f.uri));

            const tasteProfile = await buildTasteProfile({
                films: sourceFilms,
                mappings,
                topN: 10,
                negativeFeedbackIds,
                tmdbDetails: tmdbDetailsMap,
                watchlistFilms,
                userId: uid
            });

            // Get highly-rated film IDs using weighted scoring
            // Factors: rating, liked flag, rewatch status, recency, and genre diversity
            const filmsForSeeding: FilmForSeeding[] = sourceFilms
                .filter(f => mappings.has(f.uri))
                .map(f => ({
                    uri: f.uri,
                    tmdbId: mappings.get(f.uri)!,
                    rating: f.rating,
                    liked: f.liked,
                    rewatch: f.rewatch,
                    lastDate: f.lastDate,
                    genreIds: tmdbDetailsMap.get(mappings.get(f.uri)!)?.genres?.map((g: any) => g.id) || []
                }));
            // Use genre-filtered seeds: only include user's highly-rated films in the selected genres
            // This ensures Horror selections seed with the user's top Horror films, not top Comedies
            const highlyRated = getWeightedSeedIdsByGenre(filmsForSeeding, selectedGenres, 30);

            const watchlistIdArray = sourceFilms
                .filter(f => f.onWatchlist === true)
                .map(f => mappings.get(f.uri))
                .filter((id): id is number => id != null);

            // Generate candidates
            setProgress({ current: 4, total: 7, stage: 'discover', details: 'Finding movies in selected genres...' });

            const smartCandidates = await generateSmartCandidates({
                highlyRatedIds: highlyRated,
                watchlistIds: watchlistIdArray,
                topGenres: tasteProfile.topGenres,
                topKeywords: tasteProfile.topKeywords,
                topDirectors: tasteProfile.topDirectors,
                nichePreferences: tasteProfile.nichePreferences,
                preferredSubgenreKeywordIds: tasteProfile.preferredSubgenreKeywordIds // NEW: Sub-genre discovery
            });

            let candidatesRaw: number[] = [];

            // QUALITY FIX: Pre-filter smartCandidates to only include movies in selected genres
            // This prevents trending/similar movies from polluting genre-specific sections
            const selectedGenreSet = new Set(selectedGenres);
            const filterBySelectedGenres = async (ids: number[]): Promise<number[]> => {
                if (selectedGenres.length === 0) return ids; // No filter if no genres selected

                const filtered: number[] = [];
                for (const id of ids) {
                    // Check if we have cached details
                    const cachedDetails = tmdbDetailsMap.get(id);
                    if (cachedDetails) {
                        const movieGenreIds = cachedDetails.genres?.map((g: any) => g.id) || [];
                        if (movieGenreIds.some((gid: number) => selectedGenreSet.has(gid))) {
                            filtered.push(id);
                        }
                    } else {
                        // No cached details - include it and let categorization filter later
                        filtered.push(id);
                    }
                }
                return filtered;
            };

            // Apply genre filter to smart candidates
            const filteredTrending = await filterBySelectedGenres(smartCandidates.trending);
            const filteredSimilar = await filterBySelectedGenres(smartCandidates.similar);
            const filteredDiscovered = await filterBySelectedGenres(smartCandidates.discovered);

            candidatesRaw.push(...filteredTrending);
            candidatesRaw.push(...filteredSimilar);
            candidatesRaw.push(...filteredDiscovered);
            console.log('[GenreSuggest] Smart candidates after genre filter:', {
                trending: `${filteredTrending.length}/${smartCandidates.trending.length}`,
                similar: `${filteredSimilar.length}/${smartCandidates.similar.length}`,
                discovered: `${filteredDiscovered.length}/${smartCandidates.discovered.length}`
            });

            // NEW: Add genre-specific discovery for each selected genre
            // This ensures we get plenty of candidates for each genre the user selected
            const tmdbGenreIds = selectedGenres.filter(id => {
                const genreInfo = ALL_GENRES.find(g => g.id === id);
                return genreInfo && genreInfo.source !== 'tuimdb'; // Only TMDB genres
            });

            if (tmdbGenreIds.length > 0) {
                console.log('[GenreSuggest] Running genre-specific discovery for:', tmdbGenreIds);

                // Discover by selected genres with multiple sort strategies
                const sortStrategies = ['vote_average.desc', 'popularity.desc', 'primary_release_date.desc'] as const;

                for (const sortBy of sortStrategies) {
                    const genreDiscovered = await discoverMoviesByProfile({
                        genres: tmdbGenreIds,
                        genreMode: 'OR', // Match ANY of the selected genres
                        sortBy,
                        minVotes: 50,
                        limit: 100
                    });
                    candidatesRaw.push(...genreDiscovered);
                    console.log(`[GenreSuggest] Genre discovery (${sortBy}):`, genreDiscovered.length);
                }

                // Also do individual genre discovery for better coverage
                for (const genreId of tmdbGenreIds.slice(0, 5)) { // Limit to first 5 to avoid too many API calls
                    const singleGenreDiscovered = await discoverMoviesByProfile({
                        genres: [genreId],
                        sortBy: 'popularity.desc',
                        minVotes: 30,
                        limit: 50
                    });
                    candidatesRaw.push(...singleGenreDiscovered);
                }
            }

            // NEW: Add sub-genre discovery using TMDB keywords
            // This targets specific sub-genres like "Supernatural Horror" or "Cyberpunk Sci-Fi"
            if (selectedSubgenres.length > 0) {
                const subgenreKeywordIds = getKeywordIdsForSubgenres(selectedSubgenres);
                console.log('[GenreSuggest] Running sub-genre discovery with keywords:', {
                    subgenres: selectedSubgenres,
                    keywordIds: subgenreKeywordIds
                });

                if (subgenreKeywordIds.length > 0) {
                    // Discover by sub-genre keywords with multiple strategies
                    for (const sortBy of ['vote_average.desc', 'popularity.desc'] as const) {
                        const subgenreDiscovered = await discoverMoviesByProfile({
                            keywords: subgenreKeywordIds,
                            genres: tmdbGenreIds.length > 0 ? tmdbGenreIds : undefined,
                            genreMode: 'OR',
                            sortBy,
                            minVotes: 100,
                            limit: 100
                        });
                        candidatesRaw.push(...subgenreDiscovered);
                        console.log(`[GenreSuggest] Sub-genre discovery (${sortBy}):`, subgenreDiscovered.length);
                    }

                    // Also do individual keyword discovery for each selected subgenre
                    for (const keywordId of subgenreKeywordIds.slice(0, 8)) { // Limit to avoid too many API calls
                        const keywordDiscovered = await discoverMoviesByProfile({
                            keywords: [keywordId],
                            sortBy: 'popularity.desc',
                            minVotes: 50,
                            limit: 40
                        });
                        candidatesRaw.push(...keywordDiscovered);
                    }
                }
            }

            // Deduplicate and filter
            const candidatesFiltered = candidatesRaw
                .filter((id, idx, arr) => arr.indexOf(id) === idx)
                .filter((id) => !watchedIds.has(id))
                .filter((id) => !blockedIds.has(id))
                .filter((id) => !shownIds.has(id));

            console.log('[GenreSuggest] Candidates after filtering:', candidatesFiltered.length);

            if (candidatesFiltered.length === 0) {
                setError('No candidates found. Try importing more films or clearing your shown history.');
                setLoading(false);
                return;
            }

            // Score candidates
            setProgress({ current: 5, total: 7, stage: 'score', details: 'Scoring candidates...' });

            const watchlistEntries = watchlistFilms.map(f => ({
                tmdbId: mappings.get(f.uri)!,
                addedAt: f.watchlistAddedAt ?? null,
            }));

            const lite = sourceFilms.map((f) => ({ uri: f.uri, title: f.title, year: f.year, rating: f.rating, liked: f.liked }));
            const suggestions = await suggestByOverlap({
                userId: uid,
                films: lite,
                mappings,
                candidates: candidatesFiltered.slice(0, 1000),
                excludeGenres: undefined,
                maxCandidates: 1000,
                concurrency: 8,
                excludeWatchedIds: watchedIds,
                desiredResults: 400,
                context: { mode: 'auto', localHour: new Date().getHours() },
                watchlistEntries,
                enhancedProfile: {
                    topActors: tasteProfile.topActors,
                    topStudios: tasteProfile.topStudios,
                    avoidGenres: tasteProfile.avoidGenres,
                    avoidKeywords: tasteProfile.avoidKeywords,
                    avoidDirectors: tasteProfile.avoidDirectors,
                    topDecades: tasteProfile.topDecades,
                    watchlistGenres: tasteProfile.watchlistGenres?.map(w => w.name),
                    watchlistKeywords: tasteProfile.watchlistKeywords?.map(w => w.name),
                    watchlistDirectors: tasteProfile.watchlistDirectors?.map(w => w.name)
                },
                featureFeedback
            });

            console.log('[GenreSuggest] Suggestions scored:', suggestions.length);

            // Fetch full movie details
            setProgress({ current: 6, total: 7, stage: 'details', details: `Loading details for ${suggestions.length} movies...` });

            const movieItems: MovieItem[] = [];
            const detailPromises = suggestions.slice(0, 300).map(async (s) => {
                try {
                    const u = new URL('/api/tmdb/movie', getBaseUrl());
                    u.searchParams.set('id', String(s.tmdbId));
                    u.searchParams.set('_t', String(freshCacheKey));
                    const r = await fetch(u.toString(), { cache: 'no-store' });
                    const j = await r.json();

                    if (j.ok && j.movie) {
                        const movie = j.movie;
                        const videos = movie.videos?.results || [];
                        const trailer = videos.find((v: any) => v.site === 'YouTube' && v.type === 'Trailer' && v.official)
                            || videos.find((v: any) => v.site === 'YouTube' && v.type === 'Trailer');

                        return {
                            id: s.tmdbId,
                            title: s.title ?? movie.title ?? `#${s.tmdbId}`,
                            year: s.release_date?.slice(0, 4) || movie.release_date?.slice(0, 4),
                            reasons: s.reasons,
                            poster_path: s.poster_path || movie.poster_path,
                            score: s.score,
                            trailerKey: trailer?.key || null,
                            voteCategory: s.voteCategory || 'standard',
                            collectionName: movie.belongs_to_collection?.name,
                            genres: (movie.genres || []).map((g: any) => g.name),
                            vote_average: movie.vote_average,
                            vote_count: movie.vote_count,
                            overview: movie.overview,
                            contributingFilms: s.contributingFilms,
                            runtime: movie.runtime,
                            original_language: movie.original_language,
                            sources: s.sources,
                            consensusLevel: s.consensusLevel,
                            genre_ids: (movie.genres || []).map((g: any) => g.id),
                            // Extract keyword IDs for sub-genre filtering
                            keyword_ids: (movie.keywords?.keywords || movie.keywords?.results || []).map((k: any) => k.id)
                        } as MovieItem & { genre_ids: number[]; keyword_ids: number[] };
                    }
                    return null;
                } catch (e) {
                    console.error(`[GenreSuggest] Failed to fetch movie ${s.tmdbId}`, e);
                    return null;
                }
            });

            const detailResults = await Promise.all(detailPromises);
            const validMovies = detailResults.filter((m): m is MovieItem & { genre_ids: number[]; keyword_ids: number[] } => m !== null);

            // Categorize by selected genres and subgenres
            setProgress({ current: 7, total: 7, stage: 'details', details: 'Organizing by genre and sub-genre...' });

            const genreMap: GenreSuggestions = {};
            const subgenreMap: SubgenreSuggestions = {};

            // Track movies assigned to subgenres to avoid duplicating them in parent genre sections
            const assignedToSubgenre = new Set<number>();

            // STEP 1: Create sub-genre sections FIRST
            // For each selected subgenre, find movies that match its keyword IDs
            if (selectedSubgenres.length > 0) {
                console.log('[GenreSuggest] Creating sub-genre sections for:', selectedSubgenres);

                for (const subgenreKey of selectedSubgenres) {
                    const keywordIds = SUBGENRE_TO_KEYWORD_IDS[subgenreKey] || [];
                    if (keywordIds.length === 0) continue;

                    // Find movies that have any of this subgenre's keyword IDs
                    const matchingMovies = validMovies.filter(m => {
                        const movieKeywordIds = m.keyword_ids || [];
                        return keywordIds.some(kwId => movieKeywordIds.includes(kwId));
                    });

                    // Sort by score and take top 18
                    matchingMovies.sort((a, b) => b.score - a.score);
                    const topMatches = matchingMovies.slice(0, 18);

                    if (topMatches.length > 0) {
                        subgenreMap[subgenreKey] = topMatches;
                        // Mark these movies as assigned to a subgenre
                        topMatches.forEach(m => assignedToSubgenre.add(m.id));
                        console.log(`[GenreSuggest] Sub-genre ${subgenreKey}: ${topMatches.length} movies (keywords: ${keywordIds.join(',')})`);
                    }
                }
            }

            // STEP 2: Create parent genre sections
            // Movies already assigned to a subgenre OR another parent genre are excluded
            // This prevents cross-genre duplication (e.g., "Carrie" appearing in both Horror and Thriller)
            const assignedToGenre = new Set<number>();

            for (const genreId of selectedGenres) {
                const genreInfo = ALL_GENRES.find(g => g.id === genreId);
                if (!genreInfo) continue;

                // For TMDB genres, filter by genre_ids
                // For TuiMDB niche genres, filter by genre name in genres array
                let matchingMovies: (MovieItem & { genre_ids: number[]; keyword_ids: number[] })[];

                if (genreInfo.source === 'tuimdb') {
                    // Niche genre - match by name in genres array
                    const genreName = genreInfo.name.toLowerCase();
                    matchingMovies = validMovies.filter(m =>
                        !assignedToSubgenre.has(m.id) && !assignedToGenre.has(m.id) && (
                            m.genres?.some(g => g.toLowerCase().includes(genreName)) ||
                            (genreName === 'anime' && m.genres?.includes('Animation')) ||
                            (genreName === 'stand up' && m.title.toLowerCase().includes('stand-up')) ||
                            (genreName === 'food' && m.genres?.includes('Documentary') && m.title.toLowerCase().match(/food|chef|cook|restaurant/)) ||
                            (genreName === 'travel' && m.genres?.includes('Documentary') && m.title.toLowerCase().match(/travel|journey|world/))
                        )
                    );
                } else {
                    // TMDB genre - match by ID, excluding movies already assigned
                    matchingMovies = validMovies.filter(m =>
                        !assignedToSubgenre.has(m.id) && !assignedToGenre.has(m.id) && m.genre_ids?.includes(genreId)
                    );
                }

                // Sort by score and take top 18 per genre
                matchingMovies.sort((a, b) => b.score - a.score);
                const topMatches = matchingMovies.slice(0, 18);
                genreMap[genreId] = topMatches;

                // Mark these movies as assigned to prevent duplication in later genre sections
                topMatches.forEach(m => assignedToGenre.add(m.id));
            }

            // Update shownIds
            const newShownIds = new Set(shownIds);
            validMovies.forEach(m => newShownIds.add(m.id));
            setShownIds(newShownIds);

            setSubgenreSuggestions(subgenreMap);
            setGenreSuggestions(genreMap);

            // Best-effort: refresh TMDB cache for all suggested movies to ensure posters are available
            try {
                const allSuggestedIds = validMovies.map(m => m.id);
                console.log('[GenreSuggest] Refreshing TMDB cache for posters', allSuggestedIds.length);
                await refreshTmdbCacheForIds(allSuggestedIds);
                await refreshPosters();
            } catch (e) {
                console.error('[GenreSuggest] Failed to refresh poster cache', e);
                // Continue anyway - suggestions still work without posters
            }

            setLoading(false);
            console.log('[GenreSuggest] Complete', {
                genres: Object.keys(genreMap).length,
                subgenres: Object.keys(subgenreMap).length,
                subgenreAssigned: assignedToSubgenre.size
            });

        } catch (e) {
            console.error('[GenreSuggest] Error:', e);
            setError(e instanceof Error ? e.message : 'An error occurred');
            setLoading(false);
        }
    }, [selectedGenres, selectedSubgenres, sourceFilms, uid, blockedIds, shownIds]);

    const handleSave = async (tmdbId: number, title: string) => {
        if (!uid) return;
        try {
            const { error } = await saveMovie(uid, { tmdb_id: tmdbId, title });
            if (!error) {
                setSavedMovieIds(prev => new Set([...prev, tmdbId]));
                setFeedbackMessage(`Added "${title}" to your list`);
                setTimeout(() => setFeedbackMessage(null), 3000);
            }
        } catch (e) {
            console.error('Failed to save movie:', e);
        }
    };

    const handleFeedback = async (tmdbId: number, type: 'negative' | 'positive', reasons?: string[]) => {
        if (!uid) return;

        const allMovies = Object.values(genreSuggestions).flat();
        const movie = allMovies.find(i => i.id === tmdbId);
        const movieTitle = movie?.title || 'this movie';

        try {
            if (type === 'negative') {
                await Promise.all([
                    addFeedback(uid, tmdbId, 'negative', reasons),
                    blockSuggestion(uid, tmdbId)
                ]);

                setBlockedIds(prev => new Set([...prev, tmdbId]));

                // Mark as dismissed in genre suggestions
                setGenreSuggestions(prev => {
                    const next = { ...prev };
                    for (const genreId in next) {
                        next[Number(genreId)] = next[Number(genreId)].map(item =>
                            item.id === tmdbId ? { ...item, dismissed: true } : item
                        );
                    }
                    return next;
                });

                setUndoToast({ id: tmdbId, title: movieTitle });
                setTimeout(() => setUndoToast((curr) => curr && curr.id === tmdbId ? null : curr), 5000);
            } else {
                await addFeedback(uid, tmdbId, 'positive', reasons);
                setFeedbackMessage(`Great! We'll find more like "${movieTitle}"`);
                setTimeout(() => setFeedbackMessage(null), 3000);
            }
        } catch (e) {
            console.error('Failed to submit feedback:', e);
        }
    };

    const handleUndoDismiss = async (tmdbId: number) => {
        if (!uid) return;

        try {
            await unblockSuggestion(uid, tmdbId);
            setBlockedIds(prev => {
                const next = new Set(prev);
                next.delete(tmdbId);
                return next;
            });

            // Unmark as dismissed
            setGenreSuggestions(prev => {
                const next = { ...prev };
                for (const genreId in next) {
                    next[Number(genreId)] = next[Number(genreId)].map(item =>
                        item.id === tmdbId ? { ...item, dismissed: false } : item
                    );
                }
                return next;
            });

            setUndoToast(null);
            setFeedbackMessage('Movie restored');
            setTimeout(() => setFeedbackMessage(null), 2000);
        } catch (e) {
            console.error('Failed to undo dismiss:', e);
        }
    };

    // Check if we have any results (genre or subgenre)
    const hasResults = Object.values(genreSuggestions).some(arr => arr.length > 0) ||
        Object.values(subgenreSuggestions).some(arr => arr.length > 0);

    // Helper to get subgenre display info
    const getSubgenreInfo = (subgenreKey: string) => {
        for (const genreId of Object.keys(SUBGENRES_BY_PARENT)) {
            const subgenres = SUBGENRES_BY_PARENT[Number(genreId)];
            const found = subgenres?.find(s => s.key === subgenreKey);
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
                            <p className="text-sm text-gray-600">Select genres to get personalized suggestions</p>
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
                        <h2 className="text-lg font-semibold mb-3 text-gray-900">Select Genres</h2>
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
                            disabled={loading || selectedGenres.length === 0 || sourceFilms.length === 0}
                            className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
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
                            <span className="text-sm text-amber-600">Select at least one genre</span>
                        )}
                        {sourceFilms.length === 0 && (
                            <span className="text-sm text-amber-600">
                                <a href="/import" className="underline">Import your Letterboxd data</a> first
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
                            {selectedSubgenres.map(subgenreKey => {
                                const movies = subgenreSuggestions[subgenreKey];
                                if (!movies || movies.filter(m => !m.dismissed).length === 0) return null;

                                const subgenreInfo = getSubgenreInfo(subgenreKey);
                                if (!subgenreInfo) return null;

                                const visibleMovies = movies.filter(m => !m.dismissed);

                                return (
                                    <section key={subgenreKey}>
                                        <div className="flex items-center gap-2 mb-4">
                                            <span className="text-2xl">{subgenreInfo.emoji}</span>
                                            <div>
                                                <h2 className="text-lg font-semibold text-gray-900">{subgenreInfo.name} Suggestions</h2>
                                                <p className="text-xs text-gray-600">{visibleMovies.length} movies matching this sub-genre</p>
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
                            {selectedGenres.map(genreId => {
                                const movies = genreSuggestions[genreId];
                                if (!movies || movies.filter(m => !m.dismissed).length === 0) return null;

                                const genreInfo = ALL_GENRES.find(g => g.id === genreId);
                                if (!genreInfo) return null;

                                const visibleMovies = movies.filter(m => !m.dismissed);

                                return (
                                    <section key={genreId}>
                                        <div className="flex items-center gap-2 mb-4">
                                            <span className="text-2xl">{genreInfo.emoji}</span>
                                            <div>
                                                <h2 className="text-lg font-semibold text-gray-900">{genreInfo.name} Suggestions</h2>
                                                <p className="text-xs text-gray-600">{visibleMovies.length} movies based on your taste</p>
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
                            <p className="text-sm mt-1">Click &ldquo;Get Genre Suggestions&rdquo; to generate personalized recommendations</p>
                        </div>
                    )}
                </div>
            </FeatureEvidenceContext.Provider>
        </AuthGate>
    );
}
