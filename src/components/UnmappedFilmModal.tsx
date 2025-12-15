'use client';
import { useState, useCallback } from 'react';
import Image from 'next/image';
import { searchTmdb, upsertFilmMapping, upsertTmdbCache } from '@/lib/enrich';

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

export default function UnmappedFilmModal({ isOpen, onClose, unmappedFilms, userId, onFilmMapped }: Props) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [searchQ, setSearchQ] = useState('');
    const [searchYear, setSearchYear] = useState<number | undefined>(undefined);
    const [results, setResults] = useState<any[] | null>(null);
    const [searching, setSearching] = useState(false);
    const [mapping, setMapping] = useState(false);

    const currentFilm = unmappedFilms[currentIndex];
    const remainingCount = unmappedFilms.length - currentIndex;

    // Reset state when current film changes
    const initSearch = useCallback((film: UnmappedFilm) => {
        setSearchQ(film.title);
        setSearchYear(film.year);
        setResults(null);
    }, []);

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

    const applyMapping = async (tmdbId: number) => {
        if (!userId || !currentFilm) return;
        setMapping(true);
        try {
            const chosen = results?.find((r) => r.id === tmdbId);
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

                {/* Search Section */}
                <div className="p-4 border-b dark:border-gray-700">
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
                </div>

                {/* Results */}
                <div className="flex-1 overflow-auto p-4">
                    {results === null && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
                            Click &quot;Search&quot; to find matching films
                        </p>
                    )}
                    {results && results.length === 0 && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
                            No results found. Try a different search term.
                        </p>
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
                                                alt={movie.title}
                                                fill
                                                sizes="(max-width: 768px) 50vw, 200px"
                                                className="object-cover"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs p-2 text-center">
                                                No poster
                                            </div>
                                        )}
                                    </div>
                                    <div className="p-2">
                                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 line-clamp-2">
                                            {movie.title}
                                        </p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            {movie.release_date ? movie.release_date.slice(0, 4) : 'Unknown year'}
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
