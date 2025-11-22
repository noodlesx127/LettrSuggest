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
  onFeedback?: (id: number, type: 'negative' | 'positive') => void;
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

// Custom popover component for film lists
function FilmListPopover({ films, count, isOpen, onClose, position }: {
  films: Array<{ id: number; title: string }>;
  count: string;
  isOpen: boolean;
  onClose: () => void;
  position: { x: number; y: number };
}) {
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop to capture clicks */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
      />

      {/* Popover */}
      <div
        className="fixed z-50 bg-white rounded-lg shadow-2xl border border-gray-200 p-3 max-w-xs"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          transform: 'translate(-50%, -100%) translateY(-8px)'
        }}
      >
        <div className="text-xs font-semibold text-gray-700 mb-2">
          Based on {films.length} film{films.length !== 1 ? 's' : ''} you rated highly:
        </div>
        <div className="max-h-64 overflow-y-auto space-y-1">
          {films.slice(0, 20).map((film, idx) => (
            <div key={film.id} className="text-xs text-gray-600 flex items-start gap-1.5">
              <span className="text-blue-500 flex-shrink-0">•</span>
              <span className="flex-1">{film.title}</span>
            </div>
          ))}
          {films.length > 20 && (
            <div className="text-xs text-gray-500 italic pt-1">
              ...and {films.length - 20} more
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// Helper function to enhance reason text with clickable counts
function enhanceReasonText(
  reason: string,
  reasonIndex: number,
  contributingFilms: Record<string, Array<{ id: number; title: string }>> | undefined,
  onCountClick: (films: Array<{ id: number; title: string }>, count: string, event: React.MouseEvent) => void
) {
  // Patterns to match film counts
  const patterns = [
    { regex: /\((\d+) similar films?\)/g, type: 'count' },
    { regex: /\((\d+) highly-rated similar films?\)/g, type: 'count' },
    { regex: /\((\d+\+?) highly-rated films?\)/g, type: 'count' },
    { regex: /(\d+) films? by (this|these) directors?/g, type: 'count' },
    { regex: /(\d+) films? from this studio/g, type: 'count' },
  ];

  // Get the contributing films for this specific reason
  const films = getContributingFilmsForReason(reason, contributingFilms);

  // Check if any pattern matches
  let hasMatch = false;
  for (const pattern of patterns) {
    if (pattern.regex.test(reason)) {
      hasMatch = true;
      break;
    }
  }

  if (!hasMatch || films.length === 0) {
    return <span className="flex-1">{reason}</span>;
  }

  // Split the reason by the patterns and create interactive elements
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let partKey = 0;

  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0; // Reset regex
    const matches = Array.from(reason.matchAll(pattern.regex));

    for (const match of matches) {
      const matchStart = match.index!;
      const matchEnd = matchStart + match[0].length;
      const count = match[1];

      // Add text before match
      if (matchStart > lastIndex) {
        parts.push(
          <span key={`text-${partKey++}`}>{reason.substring(lastIndex, matchStart)}</span>
        );
      }

      // Add interactive count
      parts.push(
        <span
          key={`count-${partKey++}`}
          className="film-count-interactive"
          onClick={(e) => onCountClick(films, count, e)}
        >
          {match[0]}
        </span>
      );

      lastIndex = matchEnd;
    }
  }

  // Add remaining text
  if (lastIndex < reason.length) {
    parts.push(
      <span key={`text-${partKey++}`}>{reason.substring(lastIndex)}</span>
    );
  }

  return <span className="flex-1">{parts}</span>;
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
  onFeedback,
  vote_average,
  vote_count,
  overview,
  contributingFilms
}: MovieCardProps) {
  const [showVideo, setShowVideo] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [popover, setPopover] = useState<{
    films: Array<{ id: number; title: string }>;
    count: string;
    position: { x: number; y: number };
  } | null>(null);

  const voteCategoryBadge = voteCategory && voteCategory !== 'standard' ? {
    'hidden-gem': { label: '💎 Hidden Gem', className: 'bg-purple-100 text-purple-800' },
    'crowd-pleaser': { label: '🎉 Crowd Pleaser', className: 'bg-green-100 text-green-800' },
    'cult-classic': { label: '🎭 Cult Classic', className: 'bg-orange-100 text-orange-800' }
  }[voteCategory] : null;

  const displayedReasons = expanded ? reasons : reasons?.slice(0, 3);
  const hasMoreReasons = reasons && reasons.length > 3;

  const handleCountClick = (films: Array<{ id: number; title: string }>, count: string, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const rect = (event.target as HTMLElement).getBoundingClientRect();
    setPopover({
      films,
      count,
      position: {
        x: rect.left + rect.width / 2,
        y: rect.top
      }
    });
  };

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

      {/* Film List Popover */}
      {popover && (
        <FilmListPopover
          films={popover.films}
          count={popover.count}
          isOpen={!!popover}
          onClose={() => setPopover(null)}
          position={popover.position}
        />
      )}

      <div className={`border bg-white rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-all h-full flex flex-col ${expanded ? '' : 'min-h-[280px]'}`}>
        <div className="flex gap-4 p-4 flex-1">
          {/* Poster Column */}
          <div className="flex-shrink-0 flex flex-col gap-2">
            {/* Poster */}
            <div className="w-24 h-36 bg-gray-100 rounded overflow-hidden relative">
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

            {/* Badges under poster */}
            <div className="flex flex-col gap-1 w-32">
              {trailerKey && (
                <button
                  className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded hover:bg-red-200 transition-colors text-center whitespace-nowrap"
                  onClick={() => setShowVideo(true)}
                  title="Watch trailer">
                  ▶️ Trailer
                </button>
              )}
              {isInWatchlist && (
                <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded text-center whitespace-nowrap" title="In your watchlist">
                  📋 Watchlist
                </span>
              )}
              {voteCategoryBadge && (
                <span className={`px-2 py-1 text-xs font-medium rounded text-center whitespace-nowrap ${voteCategoryBadge.className}`}>
                  {voteCategoryBadge.label}
                </span>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            <div className="mb-1">
              <h3 className="font-semibold text-lg break-words" title={title}>
                {title}
              </h3>
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
                      {enhanceReasonText(r, i, contributingFilms, handleCountClick)}
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

            {/* Movie Description */}
            {overview && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className={`text-xs text-gray-600 leading-relaxed ${descriptionExpanded ? '' : 'line-clamp-3'}`}>
                  {overview}
                </p>
                {overview.length > 100 && (
                  <button
                    onClick={() => setDescriptionExpanded(!descriptionExpanded)}
                    className="mt-1 text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
                  >
                    {descriptionExpanded ? 'Read less' : 'Read more'}
                  </button>
                )}
              </div>
            )}

            {/* Feedback buttons */}
            {onFeedback && (
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => onFeedback(id, 'negative')}
                  className="flex-1 py-1.5 px-2 rounded bg-gray-50 hover:bg-gray-100 text-xs text-gray-600 hover:text-gray-900 font-medium flex items-center justify-center gap-1.5 transition-colors border border-gray-200"
                  title="Not interested in this suggestion"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.096c.5 0 .905-.405.905-.904 0-.715.211-1.413.608-2.008L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5" />
                  </svg>
                  <span>Not Interested</span>
                </button>
                <button
                  onClick={() => onFeedback(id, 'positive')}
                  className="flex-1 py-1.5 px-2 rounded bg-blue-50 hover:bg-blue-100 text-xs text-blue-700 hover:text-blue-900 font-medium flex items-center justify-center gap-1.5 transition-colors border border-blue-100"
                  title="Show more suggestions like this"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                  </svg>
                  <span>More Like This</span>
                </button>
              </div>
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
          cursor: pointer;
          font-weight: 500;
        }
        .film-count-interactive:hover {
          color: #1d4ed8;
          text-decoration-style: solid;
        }
      `}</style>
    </>
  );
}
