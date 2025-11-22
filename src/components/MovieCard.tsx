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
  overview?: string;
  contributingFilms?: Record<string, Array<{ id: number; title: string }>>;
};

// Helper function to extract genres, directors, keywords, etc. from a reason string
function extractFeatureInfo(reason: string): { type: 'genre' | 'director' | 'keyword' | 'cast' | 'studio' | null; names: string[] } {
  // Extract genres from patterns like "Matches your taste in Drama, Thriller (X films)"
  const genreMatch = reason.match(/Matches your (?:specific )?taste in ([^(]+)/);
  if (genreMatch) {
    const names = genreMatch[1].split(/,| \+ /).map(s => s.trim()).filter(Boolean);
    return { type: 'genre', names };
  }

  // Extract directors from "Directed by Christopher Nolan, ..."
  const directorMatch = reason.match(/Directed by ([^—]+)/);
  if (directorMatch) {
    const names = directorMatch[1].split(',').map(s => s.trim()).filter(Boolean);
    return { type: 'director', names };
  }

  // Extract keywords from "Matches specific themes you ... : theme1, theme2, theme3"
  const keywordMatch = reason.match(/(?:Matches specific themes|explores) (?:you )?(?:especially love|enjoy)[^:]*: ([^(]+)/);
  if (keywordMatch) {
    const names = keywordMatch[1].split(',').map(s => s.trim()).filter(Boolean);
    return { type: 'keyword', names };
  }

  // Extract studios from "From A24 —"
  const studioMatch = reason.match(/From ([^—]+)/);
  if (studioMatch) {
    const names = studioMatch[1].split(',').map(s => s.trim()).filter(Boolean);
    return { type: 'studio', names };
  }

  // Extract cast from "Stars Actor Name, ..."
  const castMatch = reason.match(/Stars ([^—]+)/);
  if (castMatch) {
    const names = castMatch[1].split(',').map(s => s.trim()).filter(Boolean);
    return { type: 'cast', names };
  }

  return { type: null, names: [] };
}

// Helper function to get contributing films for a reason
function getContributingFilmsForReason(
  reason: string,
  contributingFilms?: Record<string, Array<{ id: number; title: string }>>
): Array<{ id: number; title: string }> {
  if (!contributingFilms) return [];

  const { type, names } = extractFeatureInfo(reason);
  if (!type || names.length === 0) return [];

  const allFilms = new Map<number, { id: number; title: string }>();

  // Collect all films that match the extracted feature names
  for (const name of names) {
    const key = `${type}:${name}`;
    const films = contributingFilms[key] || [];
    films.forEach(f => allFilms.set(f.id, f));
  }

  return Array.from(allFilms.values());
}

// Helper function to enhance reason text with clickable counts and tooltips
function enhanceReasonText(
  reason: string,
  reasonIndex: number,
  contributingFilms?: Record<string, Array<{ id: number; title: string }>>
) {
  // Patterns to match film counts
  const patterns = [
    { regex: /\((\d+) similar films?\)/g, type: 'count' },
    { regex: /\((\d+) highly-rated similar films?\)/g, type: 'count' },
    { regex: /\((\d+\+?) highly-rated films?\)/g, type: 'count' },
    { regex: /(\d+) films? by (this|these) directors?/g, type: 'count' },
    { regex: /(\d+) films? from this studio/g, type: 'count' },
  ];

  let enhancedReason = reason;
  let matchFound = false;

  // Get the contributing films for this specific reason
  const films = getContributingFilmsForReason(reason, contributingFilms);

  for (const pattern of patterns) {
    const matches = Array.from(reason.matchAll(pattern.regex));

    if (matches.length > 0 && films.length > 0) {
      matches.forEach((match) => {
        const fullMatch = match[0];
        const count = match[1];

        // Build tooltip with actual film titles
        const filmList = films.slice(0, 15).map(f => f.title).join('\n• ');
        const tooltipText = films.length > 0
          ? `Based on these ${films.length} films you rated highly:\n• ${filmList}${films.length > 15 ? `\n...and ${films.length - 15} more` : ''}`
          : `Based on ${count} films you rated highly`;

        // Replace with clickable span
        const replacement = `<span class="film-count-interactive" data-count="${count}" data-reason-idx="${reasonIndex}" title="${tooltipText}">${fullMatch}</span>`;
        enhancedReason = enhancedReason.replace(fullMatch, replacement);
        matchFound = true;
      });
    } else if (matches.length > 0) {
      // Fallback if no contributing films data
      matches.forEach((match) => {
        const fullMatch = match[0];
        const count = match[1];
        const tooltipText = `Based on ${count} films you've rated highly in your library`;
        const replacement = `<span class="film-count-interactive" data-count="${count}" data-reason-idx="${reasonIndex}" title="${tooltipText}">${fullMatch}</span>`;
        enhancedReason = enhancedReason.replace(fullMatch, replacement);
        matchFound = true;
      });
    }
  }

  return { text: enhancedReason, hasInteractive: matchFound };
}

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
  vote_count,
  overview,
  contributingFilms
}: MovieCardProps) {
  const [showVideo, setShowVideo] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);

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
                {trailerKey && (
                  <span
                    className="flex-shrink-0 px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800 rounded cursor-pointer hover:bg-red-200 transition-colors"
                    onClick={() => setShowVideo(true)}
                    title="Watch trailer">
                    ▶️ Trailer
                  </span>
                )}
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
                  {displayedReasons?.map((r, i) => {
                    const { text: enhancedText, hasInteractive } = enhanceReasonText(r, i, contributingFilms);

                    return (
                      <li key={i} className="text-xs text-gray-700 flex items-start gap-2 leading-snug">
                        <span className="text-blue-500 mt-0.5 flex-shrink-0">•</span>
                        {hasInteractive ? (
                          <span
                            className="flex-1"
                            dangerouslySetInnerHTML={{ __html: enhancedText }}
                          />
                        ) : (
                          <span className="flex-1">{r}</span>
                        )}
                      </li>
                    );
                  })}
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

            {/* Movie Description */}
            {overview && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className={`text-xs text-gray-600 leading-relaxed ${descriptionExpanded ? '' : 'line-clamp-3'}`}>
                  {overview}
                </p>
                {overview.length > 150 && (
                  <button
                    onClick={() => setDescriptionExpanded(!descriptionExpanded)}
                    className="mt-1 text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
                  >
                    {descriptionExpanded ? 'Read less' : 'Read more'}
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

      {/* Global styles for interactive film counts */}
      <style jsx global>{`
        .film-count-interactive {
          color: #2563eb;
          text-decoration: underline;
          text-decoration-style: dotted;
          cursor: help;
          font-weight: 500;
          position: relative;
        }
        .film-count-interactive:hover {
          color: #1d4ed8;
          text-decoration-style: solid;
        }
        /* Enhanced tooltip styling */
        .film-count-interactive[title] {
          white-space: pre-line;
        }
      `}</style>
    </>
  );
}
