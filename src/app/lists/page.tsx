'use client';
import { useEffect, useState } from 'react';
import AuthGate from '@/components/AuthGate';
import { supabase } from '@/lib/supabaseClient';
import { getSavedMovies, removeMovie, reorderMovies, exportToLetterboxd, type SavedMovie } from '@/lib/lists';
import Image from 'next/image';

function useUserId() {
    const [uid, setUid] = useState<string | null>(null);
    useEffect(() => {
        const init = async () => {
            try {
                if (!supabase) return;
                const { data: sessionRes } = await supabase.auth.getSession();
                setUid(sessionRes.session?.user?.id ?? null);
            } catch {
                setUid(null);
            }
        };
        void init();
    }, []);
    return uid;
}

export default function ListsPage() {
    const uid = useUserId();
    const [movies, setMovies] = useState<SavedMovie[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadMovies = async () => {
        if (!uid) return;
        setLoading(true);
        const { movies: fetchedMovies, error: fetchError } = await getSavedMovies(uid);
        if (fetchError) {
            setError(fetchError);
        } else {
            setMovies(fetchedMovies);
            setError(null);
        }
        setLoading(false);
    };

    useEffect(() => {
        if (uid) {
            void loadMovies();
        }
    }, [uid]);

    const handleRemove = async (tmdbId: number) => {
        if (!uid) return;
        const result = await removeMovie(uid, tmdbId);
        if (result.success) {
            setMovies(prev => prev.filter(m => m.tmdb_id !== tmdbId));
        } else {
            alert(`Failed to remove movie: ${result.error}`);
        }
    };

    const handleMoveUp = async (index: number) => {
        if (index === 0) return;
        const newMovies = [...movies];
        [newMovies[index - 1], newMovies[index]] = [newMovies[index], newMovies[index - 1]];
        setMovies(newMovies);

        if (uid) {
            const result = await reorderMovies(uid, newMovies.map(m => m.tmdb_id));
            if (!result.success) {
                alert(`Failed to reorder: ${result.error}`);
                void loadMovies(); // Reload on error
            }
        }
    };

    const handleMoveDown = async (index: number) => {
        if (index === movies.length - 1) return;
        const newMovies = [...movies];
        [newMovies[index], newMovies[index + 1]] = [newMovies[index + 1], newMovies[index]];
        setMovies(newMovies);

        if (uid) {
            const result = await reorderMovies(uid, newMovies.map(m => m.tmdb_id));
            if (!result.success) {
                alert(`Failed to reorder: ${result.error}`);
                void loadMovies(); // Reload on error
            }
        }
    };

    const handleExport = () => {
        const csv = exportToLetterboxd(movies);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `lettrsuggest-watchlist-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <AuthGate>
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-xl font-semibold">My Lists</h1>
                {movies.length > 0 && (
                    <button
                        onClick={handleExport}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm font-medium flex items-center gap-2"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Export to Letterboxd
                    </button>
                )}
            </div>

            <p className="text-sm text-gray-700 mb-4">
                Saved movie suggestions. You can remove or reorder them, and export to{' '}
                <a
                    href="https://letterboxd.com/about/importing-data/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                >
                    Letterboxd
                </a>
                .
            </p>

            {loading && <p className="text-sm text-gray-600">Loading your saved movies…</p>}
            {error && <p className="text-sm text-red-600">Error: {error}</p>}

            {!loading && !error && movies.length === 0 && (
                <div className="text-center py-12">
                    <p className="text-gray-600 mb-2">No saved movies yet.</p>
                    <p className="text-sm text-gray-500">
                        Go to{' '}
                        <a href="/suggest" className="text-blue-600 hover:underline">
                            Suggestions
                        </a>{' '}
                        to save movies to your list.
                    </p>
                </div>
            )}

            {!loading && movies.length > 0 && (
                <div className="space-y-3">
                    {movies.map((movie, index) => (
                        <div
                            key={movie.id}
                            className="flex items-center gap-4 bg-white border rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow"
                        >
                            {/* Poster */}
                            <div className="w-16 h-24 bg-gray-100 rounded overflow-hidden flex-shrink-0 relative">
                                {movie.poster_path ? (
                                    <Image
                                        src={`https://image.tmdb.org/t/p/w185${movie.poster_path}`}
                                        alt={movie.title}
                                        fill
                                        sizes="64px"
                                        className="object-cover"
                                        unoptimized
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs text-center p-1">
                                        No poster
                                    </div>
                                )}
                            </div>

                            {/* Movie Info */}
                            <div className="flex-1 min-w-0">
                                <h3 className="font-semibold text-base truncate">{movie.title}</h3>
                                {movie.year && <p className="text-sm text-gray-600">{movie.year}</p>}
                            </div>

                            {/* Action Buttons */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                                {/* Reorder buttons */}
                                <div className="flex flex-col gap-1">
                                    <button
                                        onClick={() => handleMoveUp(index)}
                                        disabled={index === 0}
                                        className={`p-1 rounded ${index === 0
                                                ? 'text-gray-300 cursor-not-allowed'
                                                : 'text-gray-600 hover:bg-gray-100'
                                            }`}
                                        title="Move up"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                                        </svg>
                                    </button>
                                    <button
                                        onClick={() => handleMoveDown(index)}
                                        disabled={index === movies.length - 1}
                                        className={`p-1 rounded ${index === movies.length - 1
                                                ? 'text-gray-300 cursor-not-allowed'
                                                : 'text-gray-600 hover:bg-gray-100'
                                            }`}
                                        title="Move down"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </button>
                                </div>

                                {/* Remove button */}
                                <button
                                    onClick={() => handleRemove(movie.tmdb_id)}
                                    className="px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded transition-colors"
                                    title="Remove from list"
                                >
                                    Remove
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </AuthGate>
    );
}
