'use client';
import { useState, useCallback } from 'react';
import { TUIMDB_GENRES } from '@/lib/genreEnhancement';
import { SUBGENRES_BY_PARENT, hasSubgenres, getSubgenresForGenre, type SubgenreInfo } from '@/lib/subgenreData';

// All selectable genres: TMDB standard + TuiMDB niche
export const ALL_GENRES = [
    // Standard TMDB genres
    { id: 28, name: 'Action', emoji: '💥' },
    { id: 12, name: 'Adventure', emoji: '🗺️' },
    { id: 16, name: 'Animation', emoji: '🎨' },
    { id: 35, name: 'Comedy', emoji: '😂' },
    { id: 80, name: 'Crime', emoji: '🔪' },
    { id: 99, name: 'Documentary', emoji: '📹' },
    { id: 18, name: 'Drama', emoji: '🎭' },
    { id: 10751, name: 'Family', emoji: '👨‍👩‍👧‍👦' },
    { id: 14, name: 'Fantasy', emoji: '🧙' },
    { id: 36, name: 'History', emoji: '📜' },
    { id: 27, name: 'Horror', emoji: '👻' },
    { id: 10402, name: 'Music', emoji: '🎵' },
    { id: 9648, name: 'Mystery', emoji: '🔍' },
    { id: 10749, name: 'Romance', emoji: '💕' },
    { id: 878, name: 'Science Fiction', emoji: '🚀' },
    { id: 10770, name: 'TV Movie', emoji: '📺' },
    { id: 53, name: 'Thriller', emoji: '😰' },
    { id: 10752, name: 'War', emoji: '⚔️' },
    { id: 37, name: 'Western', emoji: '🤠' },
    // TuiMDB niche genres
    { id: TUIMDB_GENRES.ANIME, name: 'Anime', emoji: '🎌', source: 'tuimdb' as const },
    { id: TUIMDB_GENRES.FOOD, name: 'Food', emoji: '🍕', source: 'tuimdb' as const },
    { id: TUIMDB_GENRES.TRAVEL, name: 'Travel', emoji: '✈️', source: 'tuimdb' as const },
    { id: TUIMDB_GENRES.STAND_UP, name: 'Stand Up', emoji: '🎤', source: 'tuimdb' as const },
    { id: TUIMDB_GENRES.SPORTS, name: 'Sports', emoji: '⚽', source: 'tuimdb' as const },
];

export interface Genre {
    id: number;
    name: string;
    emoji: string;
    source?: 'tuimdb';
}

interface GenreSelectorProps {
    selectedGenres: number[];
    onChange: (ids: number[]) => void;
    disabled?: boolean;
    // New: sub-genre selection support
    selectedSubgenres?: string[];
    onSubgenreChange?: (keys: string[]) => void;
    showSubgenres?: boolean;
}

export default function GenreSelector({
    selectedGenres,
    onChange,
    disabled,
    selectedSubgenres = [],
    onSubgenreChange,
    showSubgenres = true
}: GenreSelectorProps) {
    // Track which genres have expanded sub-genre panels
    const [expandedGenres, setExpandedGenres] = useState<Set<number>>(new Set());

    const toggleGenre = useCallback((id: number) => {
        if (disabled) return;
        if (selectedGenres.includes(id)) {
            onChange(selectedGenres.filter(g => g !== id));
            // Also collapse subgenres when deselecting
            setExpandedGenres(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
            // Clear any selected subgenres for this genre
            if (onSubgenreChange) {
                const subgenresForGenre = getSubgenresForGenre(id);
                const keysToRemove = new Set(subgenresForGenre.map(s => s.key));
                onSubgenreChange(selectedSubgenres.filter(k => !keysToRemove.has(k)));
            }
        } else {
            onChange([...selectedGenres, id]);
        }
    }, [selectedGenres, onChange, disabled, onSubgenreChange, selectedSubgenres]);

    const toggleExpanded = useCallback((genreId: number, e: React.MouseEvent) => {
        e.stopPropagation();
        if (disabled) return;
        setExpandedGenres(prev => {
            const next = new Set(prev);
            if (next.has(genreId)) {
                next.delete(genreId);
            } else {
                next.add(genreId);
            }
            return next;
        });
    }, [disabled]);

    const toggleSubgenre = useCallback((subgenre: SubgenreInfo) => {
        if (disabled || !onSubgenreChange) return;
        if (selectedSubgenres.includes(subgenre.key)) {
            onSubgenreChange(selectedSubgenres.filter(k => k !== subgenre.key));
        } else {
            onSubgenreChange([...selectedSubgenres, subgenre.key]);
            // Also ensure parent genre is selected
            if (!selectedGenres.includes(subgenre.parentGenreId)) {
                onChange([...selectedGenres, subgenre.parentGenreId]);
            }
        }
    }, [selectedSubgenres, onSubgenreChange, disabled, selectedGenres, onChange]);

    const selectAllSubgenres = useCallback((genreId: number) => {
        if (disabled || !onSubgenreChange) return;
        const subgenres = getSubgenresForGenre(genreId);
        const newKeys = new Set(selectedSubgenres);
        subgenres.forEach(s => newKeys.add(s.key));
        onSubgenreChange(Array.from(newKeys));
    }, [disabled, onSubgenreChange, selectedSubgenres]);

    const clearSubgenres = useCallback((genreId: number) => {
        if (disabled || !onSubgenreChange) return;
        const subgenres = getSubgenresForGenre(genreId);
        const keysToRemove = new Set(subgenres.map(s => s.key));
        onSubgenreChange(selectedSubgenres.filter(k => !keysToRemove.has(k)));
    }, [disabled, onSubgenreChange, selectedSubgenres]);

    const selectAll = () => {
        if (disabled) return;
        onChange(ALL_GENRES.map(g => g.id));
    };

    const clearAll = () => {
        if (disabled) return;
        onChange([]);
        setExpandedGenres(new Set());
        if (onSubgenreChange) {
            onSubgenreChange([]);
        }
    };

    // Count selected subgenres for a genre
    const countSelectedSubgenres = (genreId: number): number => {
        const subgenres = getSubgenresForGenre(genreId);
        return subgenres.filter(s => selectedSubgenres.includes(s.key)).length;
    };

    return (
        <div className="space-y-4">
            {/* Quick Actions */}
            <div className="flex items-center gap-3">
                <button
                    onClick={selectAll}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Select All
                </button>
                <span className="text-gray-300">|</span>
                <button
                    onClick={clearAll}
                    disabled={disabled}
                    className="text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Clear All
                </button>
                <span className="ml-auto text-sm text-gray-500">
                    {selectedGenres.length} genres{selectedSubgenres.length > 0 && `, ${selectedSubgenres.length} sub-genres`}
                </span>
            </div>

            {/* Genre Pills */}
            <div className="flex flex-wrap gap-2">
                {ALL_GENRES.map((genre) => {
                    const isSelected = selectedGenres.includes(genre.id);
                    const hasSubgenreOptions = showSubgenres && hasSubgenres(genre.id);
                    const isExpanded = expandedGenres.has(genre.id);
                    const selectedSubCount = countSelectedSubgenres(genre.id);

                    return (
                        <div key={genre.source ? `${genre.source}-${genre.id}` : genre.id} className="relative">
                            <button
                                onClick={() => toggleGenre(genre.id)}
                                disabled={disabled}
                                className={`
                                    px-3 py-2 rounded-full text-sm font-medium transition-all
                                    flex items-center gap-1.5 border
                                    ${isSelected
                                        ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                                        : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:bg-blue-50'
                                    }
                                    ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                                    ${genre.source === 'tuimdb' ? 'ring-1 ring-purple-300' : ''}
                                `}
                                title={genre.source === 'tuimdb' ? 'Niche genre (TuiMDB)' : undefined}
                            >
                                <span>{genre.emoji}</span>
                                <span>{genre.name}</span>
                                {selectedSubCount > 0 && (
                                    <span className="ml-1 px-1.5 py-0.5 text-xs bg-blue-500 text-white rounded-full">
                                        {selectedSubCount}
                                    </span>
                                )}
                                {hasSubgenreOptions && isSelected && (
                                    <button
                                        onClick={(e) => toggleExpanded(genre.id, e)}
                                        className="ml-1 p-0.5 hover:bg-blue-500 rounded transition-colors"
                                        title="Show sub-genres"
                                    >
                                        <svg
                                            className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                        >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </button>
                                )}
                            </button>
                        </div>
                    );
                })}
            </div>

            {/* Expanded Sub-genre Panels */}
            {showSubgenres && Array.from(expandedGenres).map(genreId => {
                const genre = ALL_GENRES.find(g => g.id === genreId);
                if (!genre || !selectedGenres.includes(genreId)) return null;

                const subgenres = getSubgenresForGenre(genreId);
                if (subgenres.length === 0) return null;

                return (
                    <div
                        key={`subgenres-${genreId}`}
                        className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-lg"
                    >
                        <div className="flex items-center justify-between mb-2">
                            <h4 className="text-sm font-medium text-gray-700 flex items-center gap-1">
                                <span>{genre.emoji}</span>
                                <span>{genre.name} Sub-genres</span>
                            </h4>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => selectAllSubgenres(genreId)}
                                    disabled={disabled}
                                    className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
                                >
                                    All
                                </button>
                                <span className="text-gray-300">|</span>
                                <button
                                    onClick={() => clearSubgenres(genreId)}
                                    disabled={disabled}
                                    className="text-xs text-gray-600 hover:text-gray-800 disabled:opacity-50"
                                >
                                    Clear
                                </button>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {subgenres.map(subgenre => {
                                const isSubSelected = selectedSubgenres.includes(subgenre.key);
                                return (
                                    <button
                                        key={subgenre.key}
                                        onClick={() => toggleSubgenre(subgenre)}
                                        disabled={disabled}
                                        className={`
                                            px-2 py-1 rounded-full text-xs font-medium transition-all
                                            flex items-center gap-1 border
                                            ${isSubSelected
                                                ? 'bg-purple-600 text-white border-purple-600'
                                                : 'bg-white text-gray-600 border-gray-200 hover:border-purple-400 hover:bg-purple-50'
                                            }
                                            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                                        `}
                                    >
                                        <span>{subgenre.emoji}</span>
                                        <span>{subgenre.name}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );
            })}

            {/* Legend */}
            <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                <p className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-full ring-1 ring-purple-300 bg-white"></span>
                    <span>Niche genres (TuiMDB)</span>
                </p>
                {showSubgenres && (
                    <p className="flex items-center gap-1">
                        <span className="inline-block w-3 h-3 rounded-full bg-purple-600"></span>
                        <span>Sub-genres (for targeted discovery)</span>
                    </p>
                )}
            </div>
        </div>
    );
}
