'use client';
import { useState, useCallback, useEffect } from 'react';
import Image from 'next/image';
import { searchTmdb, upsertFilmMapping, upsertTmdbCache, fetchMovieById } from '@/lib/enrich';

export interface UnmappedFilm {
    uri: string;
    title: string;
    year?: number;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    unmappedFilms: UnmappedFilm[];
    userId: string;
    onFilmMapped: (uri: string, tmdbId: number) => void;
}

interface LetterboxdSuggestion {
    tmdbId: number;
    mediaType: 'movie' | 'tv';
    movie?: any;
    loading: boolean;
    error?: string;
}

/**
 * Parse a TMDB URL or ID string to extract the ID and media type
 * Supports:
 *   - https://www.themoviedb.org/movie/53094-welt-am-draht
 *   - https://www.themoviedb.org/tv/86449
 *   - movie:53094
 *   - tv:86449
 *   - 53094 (assumes movie)
 */
function parseTmdbInput(input: string): { id: number; mediaType: 'movie' | 'tv' } | null {
    const trimmed = input.trim();
    if (!trimmed) return null;

    // URL pattern: themoviedb.org/(movie|tv)/{id}
    const urlMatch = trimmed.match(/themoviedb\.org\/(movie|tv)\/(\d+)/i);
    if (urlMatch) {
        return {
            mediaType: urlMatch[1].toLowerCase() as 'movie' | 'tv',
            id: parseInt(urlMatch[2], 10)
        };
    }

    // Prefix pattern: movie:123 or tv:123
    const prefixMatch = trimmed.match(/^(movie|tv):(\d+)$/i);
    if (prefixMatch) {
        return {
            mediaType: prefixMatch[1].toLowerCase() as 'movie' | 'tv',
            id: parseInt(prefixMatch[2], 10)
        };
    }

    // Plain number (assume movie)
    const numMatch = trimmed.match(/^(\d+)$/);
    if (numMatch) {
        return {
            mediaType: 'movie',
            id: parseInt(numMatch[1], 10)
        };
    }

    return null;
}

export default function UnmappedFilmModal({ isOpen, onClose, unmappedFilms, userId, onFilmMapped }: Props) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [searchQ, setSearchQ] = useState('');
    const [searchYear, setSearchYear] = useState<number | undefined>(undefined);
    const [results, setResults] = useState<any[] | null>(null);
    const [searching, setSearching] = useState(false);
    const [mapping, setMapping] = useState(false);

    // Letterboxd suggestion state
    const [letterboxdSuggestion, setLetterboxdSuggestion] = useState<LetterboxdSuggestion | null>(null);

    // Manual TMDB ID input state
    const [manualIdInput, setManualIdInput] = useState('');
    const [manualIdLoading, setManualIdLoading] = useState(false);
    const [manualIdError, setManualIdError] = useState('');

    const currentFilm = unmappedFilms[currentIndex];
    const remainingCount = unmappedFilms.length - currentIndex;

    // Reset state when current film changes
    const initSearch = useCallback((film: UnmappedFilm) => {
        setSearchQ(film.title);
        setSearchYear(film.year);
        setResults(null);
        setLetterboxdSuggestion(null);
        setManualIdInput('');
        setManualIdError('');
    }, []);

    // Auto-lookup TMDB ID from Letterboxd when film changes
    useEffect(() => {
        if (!isOpen || !currentFilm?.uri) return;

        const lookupLetterboxd = async () => {
            setLetterboxdSuggestion({ tmdbId: 0, mediaType: 'movie', loading: true });

            try {
                const res = await fetch(`/api/letterboxd/tmdb-id?uri=${encodeURIComponent(currentFilm.uri)}`);
                const data = await res.json();

                if (data.ok && data.tmdbId) {
                    // Fetch the movie details to show
                    setLetterboxdSuggestion({
                        tmdbId: data.tmdbId,
                        mediaType: data.mediaType || 'movie',
                        loading: true
                    });

                    // Fetch movie details
                    const movie = await fetchMovieById(data.tmdbId, data.mediaType);
                    setLetterboxdSuggestion({
                        tmdbId: data.tmdbId,
                        mediaType: data.mediaType || 'movie',
                        movie,
                        loading: false
                    });
                } else {
                    setLetterboxdSuggestion(null);
                }
            } catch (e) {
                console.error('[UnmappedModal] Letterboxd lookup error:', e);
                setLetterboxdSuggestion(null);
            }
        };

        lookupLetterboxd();
    }, [isOpen, currentFilm?.uri]);

    // Initialize search with current film's info
    const runSearch = async () => {
        if (!searchQ.trim()) return;
        setSearching(true);
        try {
            const r = await searchTmdb(searchQ.trim(), searchYear);
            setResults(r);
        } catch (e) {
            console.error('[UnmappedModal] Search error:', e);
            setResults([]);
        } finally {
            setSearching(false);
        }
    };

    // Fetch movie by manual ID input
    const fetchManualId = async () => {
        const parsed = parseTmdbInput(manualIdInput);
        if (!parsed) {
            setManualIdError('Invalid format. Use TMDB URL, ID, or "tv:123"');
            return;
        }

        setManualIdLoading(true);
        setManualIdError('');

        try {
            const movie = await fetchMovieById(parsed.id, parsed.mediaType);
            if (movie) {
                // Add to results for display
                setResults([movie]);
            } else {
                setManualIdError('No movie found with that ID');
            }
        } catch (e) {
            console.error('[UnmappedModal] Manual ID fetch error:', e);
            setManualIdError('Failed to fetch movie');
        } finally {
            setManualIdLoading(false);
        }
    };

    const applyMapping = async (tmdbId: number, movieData?: any) => {
        if (!userId || !currentFilm) return;
        setMapping(true);
        try {
            // Use provided movie data or find from results
            const chosen = movieData || results?.find((r) => r.id === tmdbId);
            if (chosen) {
                await upsertTmdbCache(chosen);
            }
            await upsertFilmMapping(userId, currentFilm.uri, tmdbId);
            onFilmMapped(currentFilm.uri, tmdbId);

            // Move to next film or close if done
            if (currentIndex < unmappedFilms.length - 1) {
                const nextFilm = unmappedFilms[currentIndex + 1];
                setCurrentIndex(currentIndex + 1);
                initSearch(nextFilm);
            } else {
                onClose();
            }
        } catch (e) {
            console.error('[UnmappedModal] Mapping error:', e);
        } finally {
            setMapping(false);
        }
    };

    const skipFilm = () => {
        if (currentIndex < unmappedFilms.length - 1) {
            const nextFilm = unmappedFilms[currentIndex + 1];
            setCurrentIndex(currentIndex + 1);
            initSearch(nextFilm);
        } else {
            onClose();
        }
    };

    // Initialize search when modal opens or film changes
    if (isOpen && currentFilm && searchQ === '' && results === null) {
        initSearch(currentFilm);
    }

    if (!isOpen || !currentFilm) return null;

    return (
        <>
            {/* Backdrop */}
            <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />

            {/* Modal */}
            <div className="fixed inset-4 md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-2xl md:max-h-[80vh] bg-white dark:bg-gray-800 rounded-lg shadow-xl z-50 flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                            Fix Unmapped Films
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            {remainingCount} film{remainingCount !== 1 ? 's' : ''} remaining
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-2xl leading-none"
                    >
                        ×
                    </button>
                </div>

                {/* Current Film Info */}
                <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border-b dark:border-gray-700">
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                        <span className="font-medium">Letterboxd Entry:</span>{' '}
                        <span className="font-semibold">{currentFilm.title}</span>
                        {currentFilm.year && <span className="text-amber-600 dark:text-amber-400"> ({currentFilm.year})</span>}
                    </p>
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                        This film couldn&apos;t be automatically matched to TMDB. Search below to find the correct match.
                    </p>
                </div>

                {/* Letterboxd Suggestion */}
                {letterboxdSuggestion && (
                    <div className="p-4 bg-green-50 dark:bg-green-900/20 border-b dark:border-gray-700">
                        <p className="text-sm font-medium text-green-800 dark:text-green-200 mb-2">
                            ✨ Suggested match from Letterboxd
                        </p>
                        {letterboxdSuggestion.loading ? (
                            <p className="text-xs text-green-600 dark:text-green-400">Loading...</p>
                        ) : letterboxdSuggestion.movie ? (
                            <button
                                onClick={() => applyMapping(letterboxdSuggestion.tmdbId, letterboxdSuggestion.movie)}
                                disabled={mapping}
                                className="flex items-center gap-3 w-full text-left p-2 rounded border border-green-300 dark:border-green-700 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors disabled:opacity-50"
                            >
                                <div className="w-12 h-18 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden flex-shrink-0 relative">
                                    {letterboxdSuggestion.movie.poster_path ? (
                                        <Image
                                            src={`https://image.tmdb.org/t/p/w92${letterboxdSuggestion.movie.poster_path}`}
                                            alt={letterboxdSuggestion.movie.title || letterboxdSuggestion.movie.name}
                                            fill
                                            sizes="48px"
                                            className="object-cover"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                                            ?
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-green-900 dark:text-green-100 truncate">
                                        {letterboxdSuggestion.movie.title || letterboxdSuggestion.movie.name}
                                    </p>
                                    <p className="text-xs text-green-600 dark:text-green-400">
                                        {(letterboxdSuggestion.movie.release_date || letterboxdSuggestion.movie.first_air_date)?.slice(0, 4) || 'Unknown year'}
                                        {' • '}
                                        {letterboxdSuggestion.mediaType === 'tv' ? 'TV Show' : 'Movie'}
                                        {' • '}
                                        TMDB ID: {letterboxdSuggestion.tmdbId}
                                    </p>
                                </div>
                                <span className="text-green-600 dark:text-green-400 text-sm">
                                    Use this →
                                </span>
                            </button>
                        ) : (
                            <p className="text-xs text-green-600 dark:text-green-400">
                                Could not load movie details
                            </p>
                        )}
                    </div>
                )}

                {/* Search Section */}
                <div className="p-4 border-b dark:border-gray-700 space-y-3">
                    {/* Title Search */}
                    <div className="flex gap-2">
                        <input
                            className="flex-1 text-sm border dark:border-gray-600 rounded px-3 py-2 dark:bg-gray-700 dark:text-gray-100"
                            placeholder="Search title"
                            value={searchQ}
                            onChange={(e) => setSearchQ(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                        />
                        <input
                            className="w-24 text-sm border dark:border-gray-600 rounded px-3 py-2 dark:bg-gray-700 dark:text-gray-100"
                            placeholder="Year"
                            type="number"
                            value={searchYear ?? ''}
                            onChange={(e) => setSearchYear(e.target.value ? Number(e.target.value) : undefined)}
                            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                        />
                        <button
                            onClick={runSearch}
                            disabled={searching || !searchQ.trim()}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded disabled:opacity-50"
                        >
                            {searching ? 'Searching…' : 'Search'}
                        </button>
                    </div>

                    {/* Manual TMDB ID Input */}
                    <div className="flex gap-2 items-center">
                        <input
                            className="flex-1 text-sm border dark:border-gray-600 rounded px-3 py-2 dark:bg-gray-700 dark:text-gray-100"
                            placeholder="Or paste TMDB URL/ID (e.g., https://themoviedb.org/tv/86449 or tv:86449)"
                            value={manualIdInput}
                            onChange={(e) => {
                                setManualIdInput(e.target.value);
                                setManualIdError('');
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && fetchManualId()}
                        />
                        <button
                            onClick={fetchManualId}
                            disabled={manualIdLoading || !manualIdInput.trim()}
                            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded disabled:opacity-50"
                        >
                            {manualIdLoading ? 'Loading…' : 'Fetch'}
                        </button>
                    </div>
                    {manualIdError && (
                        <p className="text-xs text-red-500">{manualIdError}</p>
                    )}
                </div>

                {/* Results */}
                <div className="flex-1 overflow-auto p-4">
                    {results === null && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
                            Click &quot;Search&quot; to find matching films
                        </p>
                    )}
                    {results && results.length === 0 && (
                        <div className="text-center py-8">
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                No results found. Try a different search term.
                            </p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                                Tip: Try the original language title, or paste a TMDB URL above
                            </p>
                        </div>
                    )}
                    {results && results.length > 0 && (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {results.slice(0, 12).map((movie) => (
                                <button
                                    key={movie.id}
                                    onClick={() => applyMapping(movie.id)}
                                    disabled={mapping}
                                    className="text-left border dark:border-gray-600 rounded-lg overflow-hidden hover:border-blue-500 hover:ring-2 hover:ring-blue-200 dark:hover:ring-blue-800 transition-all disabled:opacity-50"
                                >
                                    <div className="aspect-[2/3] bg-gray-200 dark:bg-gray-700 relative">
                                        {movie.poster_path ? (
                                            <Image
                                                src={`https://image.tmdb.org/t/p/w185${movie.poster_path}`}
                                                alt={movie.title || movie.name}
                                                fill
                                                sizes="(max-width: 768px) 50vw, 200px"
                                                className="object-cover"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs p-2 text-center">
                                                No poster
                                            </div>
                                        )}
                                        {/* Media type badge */}
                                        {movie.media_type && (
                                            <span className={`absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded ${movie.media_type === 'tv'
                                                    ? 'bg-purple-500 text-white'
                                                    : 'bg-blue-500 text-white'
                                                }`}>
                                                {movie.media_type === 'tv' ? 'TV' : 'Movie'}
                                            </span>
                                        )}
                                    </div>
                                    <div className="p-2">
                                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-2">
                                            {movie.title || movie.name}
                                        </p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            {(movie.release_date || movie.first_air_date)?.slice(0, 4) || 'Unknown year'}
                                        </p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t dark:border-gray-700 flex justify-between">
                    <button
                        onClick={skipFilm}
                        className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                    >
                        Skip this film
                    </button>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded"
                    >
                        Done for now
                    </button>
                </div>
            </div>
        </>
    );
}
