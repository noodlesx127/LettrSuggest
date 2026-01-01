'use client';
import { useState, useCallback, useEffect } from 'react';
import { TMDB_GENRE_MAP, TUIMDB_GENRES } from '@/lib/genreEnhancement';

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
    { id: TUIMDB_GENRES.ANIME, name: 'Anime', emoji: '🎌', source: 'tuimdb' },
    { id: TUIMDB_GENRES.FOOD, name: 'Food', emoji: '🍕', source: 'tuimdb' },
    { id: TUIMDB_GENRES.TRAVEL, name: 'Travel', emoji: '✈️', source: 'tuimdb' },
    { id: TUIMDB_GENRES.STAND_UP, name: 'Stand Up', emoji: '🎤', source: 'tuimdb' },
    { id: TUIMDB_GENRES.SPORTS, name: 'Sports', emoji: '⚽', source: 'tuimdb' },
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
}

export default function GenreSelector({ selectedGenres, onChange, disabled }: GenreSelectorProps) {
    const toggleGenre = useCallback((id: number) => {
        if (disabled) return;
        if (selectedGenres.includes(id)) {
            onChange(selectedGenres.filter(g => g !== id));
        } else {
            onChange([...selectedGenres, id]);
        }
    }, [selectedGenres, onChange, disabled]);

    const selectAll = () => {
        if (disabled) return;
        onChange(ALL_GENRES.map(g => g.id));
    };

    const clearAll = () => {
        if (disabled) return;
        onChange([]);
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
                    {selectedGenres.length} selected
                </span>
            </div>

            {/* Genre Pills */}
            <div className="flex flex-wrap gap-2">
                {ALL_GENRES.map((genre) => {
                    const isSelected = selectedGenres.includes(genre.id);
                    return (
                        <button
                            key={genre.source ? `${genre.source}-${genre.id}` : genre.id}
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
                        </button>
                    );
                })}
            </div>

            {/* Legend for niche genres */}
            <p className="text-xs text-gray-500 flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded-full ring-1 ring-purple-300 bg-white"></span>
                <span>Niche genres (Anime, Food, Travel, etc.)</span>
            </p>
        </div>
    );
}
