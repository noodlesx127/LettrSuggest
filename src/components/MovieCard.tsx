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
  onRemove?: (id: number) => void;
  vote_average?: number;
  vote_count?: number;
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
  showTrailer = true,
  onRemove,
  vote_average,
  vote_count
}: MovieCardProps) {
  const [showVideo, setShowVideo] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const voteCategoryBadge = voteCategory && voteCategory !== 'standard' ? {
    'hidden-gem': { label: '💎 Hidden Gem', className: 'bg-purple-100 text-purple-800' },
    'crowd-pleaser': { label: '🎉 Crowd Pleaser', className: 'bg-green-100 text-green-800' },
    'cult-classic': { label: '🎭 Cult Classic', className: 'bg-orange-100 text-orange-800' }
  }[voteCategory] : null;

  const displayedReasons = expanded ? reasons : reasons?.slice(0, 3);
  const hasMoreReasons = reasons && reasons.length > 3;

  return (
    <>
      {/* Fullscreen Trailer Modal */}
      {showVideo && trailerKey && (
        <div
          className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
          onClick={() => setShowVideo(false)}
        >
          <div
            className="relative w-full max-w-4xl aspect-video"
            onClick={(e) => e.stopPropagation()}
          >
            <iframe
              src={`https://www.youtube.com/embed/${trailerKey}?autoplay=1`}
              title={`${title} trailer`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 w-full h-full rounded-lg"
            />
            <button
              onClick={() => setShowVideo(false)}
              className="absolute -top-10 right-0 w-8 h-8 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-full flex items-center justify-center text-white text-lg transition-all"
              aria-label="Close trailer"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <div className={`border bg-white rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-all h-full flex flex-col ${expanded ? '' : 'min-h-[280px]'}`}>
        <div className="flex gap-4 p-4 flex-1">
          {/* Poster */}
          <div className="flex-shrink-0 w-24 h-36 bg-gray-100 rounded overflow-hidden relative">
            {posterPath ? (
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
            {trailerKey && showTrailer && (
              <button
                onClick={() => setShowVideo(true)}
                className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-60 transition-all flex items-center justify-center group"
                aria-label="Play trailer"
              >
                <div className="w-12 h-12 bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                  <svg className="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                  </svg>
                </div>
              </button>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1">
              <h3 className="font-semibold text-lg line-clamp-2 flex-1" title={title}>
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

            {(year || vote_average || collectionName) && (
              <div className="text-sm text-gray-600 mb-3 flex flex-wrap items-center gap-2">
                {year && <span>{year}</span>}
                {vote_average && (
                  <>
                    {year && <span>•</span>}
                    <span className="flex items-center gap-1" title={`${vote_average.toFixed(1)}/10 from ${vote_count ? vote_count.toLocaleString() : 'N/A'} votes`}>
                      <span className="text-yellow-500">⭐</span>
                      <span className="font-medium">{vote_average.toFixed(1)}</span>
                      <span className="text-gray-400 text-xs">/{10}</span>
                    </span>
                  </>
                )}
                {collectionName && (
                  <>
                    {(year || vote_average) && <span>•</span>}
                    <span className="text-indigo-600" title="Part of a collection">
                      🎬 {collectionName}
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Reasons */}
            {reasons && reasons.length > 0 && (
              <div>
                <ul className="space-y-1.5 overflow-hidden">
                  {displayedReasons?.map((r, i) => (
                    <li key={i} className="text-xs text-gray-700 flex items-start gap-2 leading-snug">
                      <span className="text-blue-500 mt-0.5 flex-shrink-0">•</span>
                      <span className="flex-1 line-clamp-2">{r}</span>
                    </li>
                  ))}
                </ul>
                {hasMoreReasons && (
                  <button
                    onClick={() => setExpanded(!expanded)}
                    className="mt-2 text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 transition-colors"
                  >
                    {expanded ? (
                      <>
                        <span>Show less</span>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                      </>
                    ) : (
                      <>
                        <span>+{reasons.length - 3} more reason{reasons.length - 3 > 1 ? 's' : ''}</span>
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </>
                    )}
                  </button>
                )}
              </div>
            )}

            {/* Remove button (only shown if onRemove is provided) */}
            {onRemove && (
              <button
                onClick={() => onRemove(id)}
                className="mt-2 text-xs text-red-600 hover:text-red-800 font-medium flex items-center gap-1 transition-colors"
                title="Remove this suggestion"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span>Remove suggestion</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
