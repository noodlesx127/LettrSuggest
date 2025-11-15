'use client';
import Image from 'next/image';
import { useState } from 'react';

type MovieCardProps = {
  id: number;
  title: string;
  year?: string;
  posterPath?: string | null;
  trailerKey?: string | null;
  isInWatchlist?: boolean;
  reasons?: string[];
  score?: number;
  voteCategory?: 'hidden-gem' | 'crowd-pleaser' | 'cult-classic' | 'standard';
  collectionName?: string;
  showTrailer?: boolean;
};

export default function MovieCard({
  id,
  title,
  year,
  posterPath,
  trailerKey,
  isInWatchlist,
  reasons,
  score,
  voteCategory,
  collectionName,
  showTrailer = true
}: MovieCardProps) {
  const [showVideo, setShowVideo] = useState(false);

  const voteCategoryBadge = voteCategory && voteCategory !== 'standard' ? {
    'hidden-gem': { label: '💎 Hidden Gem', className: 'bg-purple-100 text-purple-800' },
    'crowd-pleaser': { label: '🎉 Crowd Pleaser', className: 'bg-green-100 text-green-800' },
    'cult-classic': { label: '🎭 Cult Classic', className: 'bg-orange-100 text-orange-800' }
  }[voteCategory] : null;

  return (
    <div className="border bg-white rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      <div className="flex gap-4 p-4">
        {/* Poster or Trailer */}
        <div className="flex-shrink-0 w-24 h-36 bg-gray-100 rounded overflow-hidden relative">
          {showVideo && trailerKey ? (
            <iframe
              width="96"
              height="144"
              src={`https://www.youtube.com/embed/${trailerKey}?autoplay=1&mute=1`}
              title={`${title} trailer`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 w-full h-full"
            />
          ) : posterPath ? (
            <Image
              src={`https://image.tmdb.org/t/p/w185${posterPath}`}
              alt={title}
              fill
              sizes="96px"
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs text-center p-2">
              No poster
            </div>
          )}
          
          {/* Trailer toggle button */}
          {!showVideo && trailerKey && showTrailer && (
            <button
              onClick={() => setShowVideo(true)}
              className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-40 transition-all flex items-center justify-center group"
              aria-label="Play trailer"
            >
              <div className="w-10 h-10 bg-black bg-opacity-70 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                </svg>
              </div>
            </button>
          )}
          
          {showVideo && (
            <button
              onClick={() => setShowVideo(false)}
              className="absolute top-1 right-1 w-6 h-6 bg-black bg-opacity-70 rounded-full flex items-center justify-center text-white text-xs hover:bg-opacity-90"
              aria-label="Close trailer"
            >
              ✕
            </button>
          )}
        </div>
        
        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="font-semibold text-lg truncate flex-1" title={title}>
              {title}
            </h3>
            <div className="flex gap-1 flex-wrap justify-end">
              {isInWatchlist && (
                <span className="flex-shrink-0 px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded" title="This movie is already in your watchlist">
                  📋 Watchlist
                </span>
              )}
              {voteCategoryBadge && (
                <span className={`flex-shrink-0 px-2 py-0.5 text-xs font-medium rounded ${voteCategoryBadge.className}`}>
                  {voteCategoryBadge.label}
                </span>
              )}
            </div>
          </div>
          
          {(year || collectionName) && (
            <div className="text-sm text-gray-600 mb-3">
              {year}
              {year && collectionName && ' • '}
              {collectionName && (
                <span className="text-indigo-600" title="Part of a collection">
                  🎬 {collectionName}
                </span>
              )}
            </div>
          )}
          
          {/* Reasons */}
          {reasons && reasons.length > 0 && (
            <ul className="space-y-2">
              {reasons.map((r, i) => (
                <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">•</span>
                  <span className="flex-1">{r}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
