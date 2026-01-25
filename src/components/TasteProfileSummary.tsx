"use client";

import { useState, useEffect, useMemo } from "react";

// ============================================================================
// TASTE PROFILE SUMMARY COMPONENT (Phase 2 Task 2.5)
// A cinematic "dossier" style widget that reveals what the algorithm learned
// about the user's taste - building trust through transparency
// ============================================================================

export interface TasteProfileSummaryProps {
  topGenres?: Array<{ name: string; percentage?: number; count: number }>;
  topDirectors?: Array<{ name: string; count: number }>;
  topActors?: Array<{ name: string; count: number }>;
  topKeywords?: Array<{ keyword: string; count: number }>;
  totalFilms?: number;
  averageRating?: number;
  nichePercentage?: number; // 0-100, higher = more niche taste
  explorationRate?: number; // 0-1, from user_exploration_stats
  mostActiveDecade?: string; // e.g., "2010s"
}

// Genre icons mapping
const GENRE_ICONS: Record<string, string> = {
  drama: "🎭",
  comedy: "😄",
  thriller: "🔪",
  horror: "👻",
  "science fiction": "🚀",
  "sci-fi": "🚀",
  action: "💥",
  adventure: "🗺️",
  romance: "💕",
  animation: "✨",
  documentary: "🎥",
  fantasy: "🧙",
  mystery: "🔍",
  crime: "🕵️",
  war: "⚔️",
  western: "🤠",
  musical: "🎵",
  family: "👨‍👩‍👧",
  history: "📜",
  music: "🎸",
};

// Exploration style labels
function getExplorationLabel(nichePercentage: number): {
  label: string;
  icon: string;
  description: string;
  color: string;
} {
  if (nichePercentage >= 70) {
    return {
      label: "Curator",
      icon: "🎨",
      description: "You seek the obscure and undiscovered",
      color: "text-violet-400",
    };
  }
  if (nichePercentage >= 50) {
    return {
      label: "Explorer",
      icon: "🧭",
      description: "You balance mainstream with hidden gems",
      color: "text-cyan-400",
    };
  }
  if (nichePercentage >= 30) {
    return {
      label: "Enthusiast",
      icon: "🎬",
      description: "You enjoy popular cinema with occasional discoveries",
      color: "text-amber-400",
    };
  }
  return {
    label: "Mainstream",
    icon: "🍿",
    description: "You prefer crowd-pleasing favorites",
    color: "text-rose-400",
  };
}

// Star rating visualization
function StarRating({ rating }: { rating: number }) {
  const fullStars = Math.floor(rating);
  const hasHalf = rating % 1 >= 0.5;
  const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0);

  return (
    <span
      className="inline-flex items-center gap-0.5"
      aria-label={`${rating.toFixed(1)} stars`}
    >
      {Array(fullStars)
        .fill(null)
        .map((_, i) => (
          <span key={`full-${i}`} className="text-amber-400">
            ★
          </span>
        ))}
      {hasHalf && <span className="text-amber-400">½</span>}
      {Array(emptyStars)
        .fill(null)
        .map((_, i) => (
          <span key={`empty-${i}`} className="text-gray-400 dark:text-gray-600">
            ☆
          </span>
        ))}
    </span>
  );
}

// Animated stat number
function AnimatedStat({
  value,
  suffix = "",
}: {
  value: number;
  suffix?: string;
}) {
  const [displayed, setDisplayed] = useState(0);

  useEffect(() => {
    const duration = 800;
    const steps = 30;
    const increment = value / steps;
    let current = 0;
    let step = 0;

    const timer = setInterval(() => {
      step++;
      current = Math.min(value, increment * step);
      setDisplayed(Math.round(current));

      if (step >= steps) {
        clearInterval(timer);
        setDisplayed(value);
      }
    }, duration / steps);

    return () => clearInterval(timer);
  }, [value]);

  return (
    <span>
      {displayed.toLocaleString()}
      {suffix}
    </span>
  );
}

// Section divider with decorative line
function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 my-4">
      <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-300 to-transparent dark:via-gray-600" />
      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
        {label}
      </span>
      <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-300 to-transparent dark:via-gray-600" />
    </div>
  );
}

export default function TasteProfileSummary({
  topGenres = [],
  topDirectors = [],
  topActors = [],
  topKeywords = [],
  totalFilms = 0,
  averageRating = 0,
  nichePercentage = 50,
  explorationRate = 0.5, // eslint-disable-line @typescript-eslint/no-unused-vars
  mostActiveDecade,
}: TasteProfileSummaryProps) {
  // Note: explorationRate is accepted as a prop for future use
  // Currently using nichePercentage for the exploration style indicator
  void explorationRate; // Prevent unused variable warning
  const [isExpanded, setIsExpanded] = useState(true);
  const [mounted, setMounted] = useState(false);

  // Load expanded state from localStorage
  useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem("tasteProfileExpanded");
      if (stored !== null) {
        setIsExpanded(stored === "true");
      }
    } catch {
      // localStorage not available
    }
  }, []);

  // Save expanded state to localStorage
  useEffect(() => {
    if (mounted) {
      try {
        localStorage.setItem("tasteProfileExpanded", String(isExpanded));
      } catch {
        // localStorage not available
      }
    }
  }, [isExpanded, mounted]);

  // Check if we have enough data
  const hasMinimalData = totalFilms < 10 || topGenres.length === 0;

  // Compute exploration style
  const explorationStyle = useMemo(
    () => getExplorationLabel(nichePercentage),
    [nichePercentage],
  );

  // Log render
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.log("[TasteProfile] Rendered with", {
        genres: topGenres.length,
        directors: topDirectors.length,
        actors: topActors.length,
        keywords: topKeywords.length,
        totalFilms,
        averageRating,
        nichePercentage,
      });
    }
  }, [
    topGenres,
    topDirectors,
    topActors,
    topKeywords,
    totalFilms,
    averageRating,
    nichePercentage,
  ]);

  // Handle collapse toggle
  const handleToggle = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <div
      className="relative mb-8 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700/50 
                 bg-gradient-to-br from-white via-gray-50/50 to-gray-100/30 
                 dark:from-gray-800/90 dark:via-gray-800/70 dark:to-gray-900/50
                 shadow-lg shadow-gray-200/50 dark:shadow-black/20
                 backdrop-blur-sm transition-all duration-300"
      role="region"
      aria-label="Your Taste Profile Summary"
    >
      {/* Decorative film strip pattern - top border */}
      <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-amber-400 via-violet-500 to-cyan-400 opacity-80" />

      {/* Header - Always visible, clickable */}
      <button
        onClick={handleToggle}
        className="w-full px-6 py-4 flex items-center justify-between cursor-pointer 
                   hover:bg-gray-50/50 dark:hover:bg-gray-700/30 transition-colors
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-inset"
        aria-expanded={isExpanded}
        aria-controls="taste-profile-content"
      >
        <div className="flex items-center gap-4">
          {/* Dossier icon */}
          <div
            className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 
                        flex items-center justify-center shadow-lg shadow-violet-500/30
                        dark:shadow-violet-900/50"
          >
            <svg
              className="w-6 h-6 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>

          <div className="text-left">
            <h2
              className="text-lg font-bold tracking-tight text-gray-900 dark:text-gray-100
                         bg-gradient-to-r from-gray-900 via-gray-700 to-gray-900 
                         dark:from-gray-100 dark:via-gray-300 dark:to-gray-100
                         bg-clip-text"
              style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
            >
              Your Cinematic Identity
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {hasMinimalData
                ? "Complete your import to unlock insights"
                : `Based on ${totalFilms.toLocaleString()} films in your library`}
            </p>
          </div>
        </div>

        {/* Collapse/expand chevron */}
        <div
          className={`w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center
                     transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`}
        >
          <svg
            className="w-5 h-5 text-gray-500 dark:text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </button>

      {/* Collapsible content */}
      <div
        id="taste-profile-content"
        className={`overflow-hidden transition-all duration-500 ease-out ${
          isExpanded ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0"
        }`}
        aria-hidden={!isExpanded}
      >
        {/* Empty state */}
        {hasMinimalData ? (
          <div className="px-6 pb-6">
            <div
              className="rounded-xl bg-gradient-to-br from-violet-50 to-purple-50 
                          dark:from-violet-900/20 dark:to-purple-900/20
                          border border-violet-200/50 dark:border-violet-700/30
                          p-6 text-center"
            >
              <div className="text-4xl mb-3">🎬</div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-1">
                Your taste profile is building...
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Import more of your Letterboxd history to see what makes your
                taste unique.
              </p>
              <a
                href="/import"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg
                          bg-gradient-to-r from-violet-500 to-purple-600 
                          hover:from-violet-600 hover:to-purple-700
                          text-white font-medium text-sm shadow-lg shadow-violet-500/30
                          transition-all hover:scale-105"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  />
                </svg>
                Complete Your Import
              </a>
            </div>
          </div>
        ) : (
          <div className="px-6 pb-6">
            {/* Stats Overview Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              {/* Total Films */}
              <div className="text-center p-3 rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-100/50 dark:border-blue-800/30">
                <div className="text-2xl sm:text-3xl font-bold text-blue-600 dark:text-blue-400">
                  <AnimatedStat value={totalFilms} />
                </div>
                <div className="text-xs font-medium text-blue-700/70 dark:text-blue-300/70 uppercase tracking-wide mt-0.5">
                  Films Rated
                </div>
              </div>

              {/* Average Rating */}
              <div className="text-center p-3 rounded-xl bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20 border border-amber-100/50 dark:border-amber-800/30">
                <div className="text-2xl sm:text-3xl font-bold text-amber-600 dark:text-amber-400">
                  {averageRating.toFixed(1)}
                </div>
                <div className="text-xs font-medium text-amber-700/70 dark:text-amber-300/70 uppercase tracking-wide mt-0.5">
                  Avg Rating
                </div>
                <div className="mt-1">
                  <StarRating rating={averageRating} />
                </div>
              </div>

              {/* Exploration Style */}
              <div className="text-center p-3 rounded-xl bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-900/20 dark:to-purple-900/20 border border-violet-100/50 dark:border-violet-800/30">
                <div className="text-2xl mb-0.5">{explorationStyle.icon}</div>
                <div className={`text-sm font-bold ${explorationStyle.color}`}>
                  {explorationStyle.label}
                </div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-tight">
                  {nichePercentage}% niche
                </div>
              </div>

              {/* Most Active Decade */}
              <div className="text-center p-3 rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-900/20 dark:to-teal-900/20 border border-emerald-100/50 dark:border-emerald-800/30">
                <div className="text-2xl sm:text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                  {mostActiveDecade || "2010s"}
                </div>
                <div className="text-xs font-medium text-emerald-700/70 dark:text-emerald-300/70 uppercase tracking-wide mt-0.5">
                  Peak Era
                </div>
              </div>
            </div>

            {/* Genres Section */}
            {topGenres.length > 0 && (
              <>
                <SectionDivider label="Your Genres" />
                <div className="flex flex-wrap gap-2 mb-2">
                  {topGenres.slice(0, 5).map((genre, idx) => {
                    const icon = GENRE_ICONS[genre.name.toLowerCase()] || "🎬";
                    const isTop = idx === 0;

                    return (
                      <div
                        key={genre.name}
                        className={`
                          inline-flex items-center gap-2 px-3 py-1.5 rounded-full
                          transition-all duration-200 cursor-default
                          ${
                            isTop
                              ? "bg-gradient-to-r from-amber-100 to-yellow-100 dark:from-amber-900/40 dark:to-yellow-900/40 border-amber-300/60 dark:border-amber-700/50 ring-2 ring-amber-400/30"
                              : "bg-gray-100 dark:bg-gray-700/50 border-gray-200/60 dark:border-gray-600/50"
                          }
                          border hover:scale-105
                        `}
                        title={`${genre.name}: ${genre.count} films${genre.percentage ? ` (${genre.percentage}%)` : ""}`}
                      >
                        <span className="text-lg" aria-hidden="true">
                          {icon}
                        </span>
                        <span
                          className={`font-medium text-sm ${isTop ? "text-amber-800 dark:text-amber-200" : "text-gray-700 dark:text-gray-300"}`}
                        >
                          {genre.name}
                        </span>
                        {genre.percentage && (
                          <span
                            className={`text-xs font-semibold ${isTop ? "text-amber-600 dark:text-amber-400" : "text-gray-500 dark:text-gray-400"}`}
                          >
                            {genre.percentage}%
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Directors & Actors Grid */}
            {(topDirectors.length > 0 || topActors.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                {/* Favorite Directors */}
                {topDirectors.length > 0 && (
                  <div className="p-4 rounded-xl bg-gradient-to-br from-rose-50/80 to-pink-50/80 dark:from-rose-900/20 dark:to-pink-900/20 border border-rose-200/40 dark:border-rose-800/30">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-lg">🎬</span>
                      <h3 className="font-semibold text-sm uppercase tracking-wide text-rose-700 dark:text-rose-300">
                        Favorite Directors
                      </h3>
                    </div>
                    <div className="space-y-2">
                      {topDirectors.slice(0, 3).map((director, idx) => (
                        <div
                          key={director.name}
                          className="flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold
                              ${idx === 0 ? "bg-rose-500 text-white" : "bg-rose-200 dark:bg-rose-800 text-rose-700 dark:text-rose-200"}`}
                            >
                              {idx + 1}
                            </span>
                            <span className="font-medium text-gray-800 dark:text-gray-200 text-sm">
                              {director.name}
                            </span>
                          </div>
                          <span className="text-xs text-gray-500 dark:text-gray-400 bg-white/50 dark:bg-black/20 px-2 py-0.5 rounded-full">
                            {director.count} films
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Favorite Actors */}
                {topActors.length > 0 && (
                  <div className="p-4 rounded-xl bg-gradient-to-br from-cyan-50/80 to-teal-50/80 dark:from-cyan-900/20 dark:to-teal-900/20 border border-cyan-200/40 dark:border-cyan-800/30">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-lg">⭐</span>
                      <h3 className="font-semibold text-sm uppercase tracking-wide text-cyan-700 dark:text-cyan-300">
                        Favorite Actors
                      </h3>
                    </div>
                    <div className="space-y-2">
                      {topActors.slice(0, 3).map((actor, idx) => (
                        <div
                          key={actor.name}
                          className="flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold
                              ${idx === 0 ? "bg-cyan-500 text-white" : "bg-cyan-200 dark:bg-cyan-800 text-cyan-700 dark:text-cyan-200"}`}
                            >
                              {idx + 1}
                            </span>
                            <span className="font-medium text-gray-800 dark:text-gray-200 text-sm">
                              {actor.name}
                            </span>
                          </div>
                          <span className="text-xs text-gray-500 dark:text-gray-400 bg-white/50 dark:bg-black/20 px-2 py-0.5 rounded-full">
                            {actor.count} films
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Keywords/Themes Section */}
            {topKeywords.length > 0 && (
              <>
                <SectionDivider label="Themes You Love" />
                <div className="flex flex-wrap gap-2">
                  {topKeywords.slice(0, 8).map((kw, idx) => {
                    // Gradient intensity based on position
                    const opacity = Math.max(0.3, 1 - idx * 0.1);

                    return (
                      <span
                        key={kw.keyword}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm
                                  bg-gradient-to-r from-gray-100 to-gray-50 
                                  dark:from-gray-700/60 dark:to-gray-700/40
                                  border border-gray-200/50 dark:border-gray-600/40
                                  text-gray-700 dark:text-gray-300
                                  hover:scale-105 transition-transform cursor-default"
                        style={{ opacity }}
                        title={`${kw.keyword}: appears in ${kw.count} of your favorites`}
                      >
                        <span className="text-violet-500 dark:text-violet-400 text-xs">
                          #
                        </span>
                        {kw.keyword}
                      </span>
                    );
                  })}
                </div>
              </>
            )}

            {/* Exploration Style Description */}
            <div className="mt-6 p-4 rounded-xl bg-gradient-to-r from-gray-100/80 via-white to-gray-100/80 dark:from-gray-700/40 dark:via-gray-800/60 dark:to-gray-700/40 border border-gray-200/30 dark:border-gray-600/20">
              <div className="flex items-start gap-3">
                <div
                  className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 
                              flex items-center justify-center text-xl shadow-md"
                >
                  {explorationStyle.icon}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-bold ${explorationStyle.color}`}>
                      {explorationStyle.label}
                    </span>
                    <span className="text-gray-400">•</span>
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      {explorationStyle.description}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 leading-relaxed">
                    {nichePercentage >= 50 ? (
                      <>
                        You gravitate toward hidden gems and international
                        cinema. Your recommendations will include rare finds and
                        festival favorites alongside acclaimed films.
                      </>
                    ) : (
                      <>
                        You enjoy widely-loved films with broad appeal. Your
                        recommendations will feature popular choices and
                        critically acclaimed favorites.
                      </>
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* Footer attribution */}
            <div className="mt-4 pt-3 border-t border-gray-200/50 dark:border-gray-700/30 text-center">
              <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                Profile generated from your Letterboxd watch history
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// EXAMPLE USAGE WITH MOCK DATA
// Use this for testing the component in isolation
// ============================================================================

/**
 * Example usage:
 *
 * ```tsx
 * import TasteProfileSummary from '@/components/TasteProfileSummary';
 *
 * <TasteProfileSummary
 *   topGenres={[
 *     { name: "Drama", percentage: 45, count: 156 },
 *     { name: "Thriller", percentage: 32, count: 112 },
 *     { name: "Science Fiction", percentage: 28, count: 98 },
 *     { name: "Crime", percentage: 22, count: 77 },
 *     { name: "Mystery", percentage: 18, count: 63 },
 *   ]}
 *   topDirectors={[
 *     { name: "Christopher Nolan", count: 8 },
 *     { name: "Denis Villeneuve", count: 6 },
 *     { name: "David Fincher", count: 5 },
 *   ]}
 *   topActors={[
 *     { name: "Jake Gyllenhaal", count: 12 },
 *     { name: "Timothée Chalamet", count: 7 },
 *     { name: "Florence Pugh", count: 6 },
 *   ]}
 *   topKeywords={[
 *     { keyword: "time travel", count: 24 },
 *     { keyword: "psychological", count: 21 },
 *     { keyword: "dystopia", count: 18 },
 *     { keyword: "space", count: 15 },
 *     { keyword: "mystery", count: 12 },
 *   ]}
 *   totalFilms={342}
 *   averageRating={3.8}
 *   nichePercentage={68}
 *   explorationRate={0.45}
 *   mostActiveDecade="2010s"
 * />
 * ```
 */
