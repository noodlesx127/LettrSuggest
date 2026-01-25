"use client";
import Image from "next/image";
import { createContext, useContext, useMemo, useState } from "react";
import type { FeatureEvidenceSummary, FeatureType } from "@/lib/enrich";

// ============================================================================
// MATCH SCORE DISPLAY COMPONENT (Task 2.1)
// A dramatic circular progress ring with cinematic aesthetics
// ============================================================================

type MatchScoreProps = {
  score: number; // 0-1 scale
};

function getMatchTier(percentage: number): {
  label: string;
  gradient: { start: string; end: string; glow: string };
  textColor: string;
  bgClass: string;
} {
  if (percentage >= 90) {
    return {
      label: "Exceptional",
      gradient: {
        start: "#fbbf24",
        end: "#f59e0b",
        glow: "rgba(251, 191, 36, 0.6)",
      },
      textColor: "text-amber-400",
      bgClass: "bg-gradient-to-br from-amber-500/20 to-orange-500/20",
    };
  }
  if (percentage >= 80) {
    return {
      label: "Great",
      gradient: {
        start: "#22d3ee",
        end: "#06b6d4",
        glow: "rgba(34, 211, 238, 0.5)",
      },
      textColor: "text-cyan-400",
      bgClass: "bg-gradient-to-br from-cyan-500/20 to-teal-500/20",
    };
  }
  if (percentage >= 70) {
    return {
      label: "Good",
      gradient: {
        start: "#a78bfa",
        end: "#8b5cf6",
        glow: "rgba(167, 139, 250, 0.4)",
      },
      textColor: "text-violet-400",
      bgClass: "bg-gradient-to-br from-violet-500/20 to-purple-500/20",
    };
  }
  if (percentage >= 60) {
    return {
      label: "Decent",
      gradient: {
        start: "#60a5fa",
        end: "#3b82f6",
        glow: "rgba(96, 165, 250, 0.35)",
      },
      textColor: "text-blue-400",
      bgClass: "bg-gradient-to-br from-blue-500/15 to-indigo-500/15",
    };
  }
  return {
    label: "Explore",
    gradient: {
      start: "#94a3b8",
      end: "#64748b",
      glow: "rgba(148, 163, 184, 0.25)",
    },
    textColor: "text-slate-400",
    bgClass: "bg-gradient-to-br from-slate-500/10 to-gray-500/10",
  };
}

function MatchScoreRing({ score }: MatchScoreProps) {
  const percentage = Math.round(score * 100);
  const tier = getMatchTier(percentage);

  // SVG circle parameters
  const size = 52;
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - score * circumference;

  // Unique gradient ID for this instance
  const gradientId = `match-gradient-${Math.random().toString(36).substr(2, 9)}`;

  if (process.env.NODE_ENV === "development") {
    console.log("[MatchScoreRing] Rendering score:", {
      score,
      percentage,
      tier: tier.label,
    });
  }

  return (
    <div
      className="relative group cursor-help"
      title={`${percentage}% Match — ${tier.label} match based on your taste profile and viewing history`}
      aria-label={`Match score: ${percentage}% - ${tier.label} match`}
    >
      {/* Glow effect on hover */}
      <div
        className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-md"
        style={{ backgroundColor: tier.gradient.glow }}
      />

      {/* Main ring container */}
      <div className={`relative ${tier.bgClass} rounded-full p-0.5`}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="transform -rotate-90"
        >
          {/* Gradient definition */}
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={tier.gradient.start} />
              <stop offset="100%" stopColor={tier.gradient.end} />
            </linearGradient>
          </defs>

          {/* Background track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-gray-200 dark:text-gray-700"
          />

          {/* Progress arc */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-700 ease-out"
            style={{
              filter: `drop-shadow(0 0 4px ${tier.gradient.glow})`,
            }}
          />
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={`text-sm font-bold tracking-tight ${tier.textColor}`}
          >
            {percentage}
          </span>
          <span className="text-[8px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider -mt-0.5">
            match
          </span>
        </div>
      </div>

      {/* Tier label tooltip on hover */}
      <div className="absolute -bottom-6 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
        <span
          className={`text-[10px] font-semibold ${tier.textColor} whitespace-nowrap`}
        >
          {tier.label}
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// "BECAUSE YOU LOVED..." CALLOUT COMPONENT (Task 2.2)
// Film strip-inspired design showing influential films from user's history
// ============================================================================

type ContributingFilm = { id: number; title: string };

type BecauseYouLovedProps = {
  contributingFilms: Record<string, Array<ContributingFilm>>;
};

function extractInfluentialFilms(
  contributingFilms: Record<string, Array<ContributingFilm>>,
): Array<{ film: ContributingFilm; categories: string[]; score: number }> {
  // Count how many feature categories each film appears in (more = more influential)
  const filmScores = new Map<
    number,
    { film: ContributingFilm; categories: Set<string> }
  >();

  for (const [key, films] of Object.entries(contributingFilms)) {
    const category = key.split(":")[0]; // e.g., "director", "genre", "keyword"
    for (const film of films) {
      const existing = filmScores.get(film.id);
      if (existing) {
        existing.categories.add(category);
      } else {
        filmScores.set(film.id, { film, categories: new Set([category]) });
      }
    }
  }

  // Convert to array and sort by number of categories (influence score)
  const ranked = Array.from(filmScores.values())
    .map(({ film, categories }) => ({
      film,
      categories: Array.from(categories),
      score: categories.size,
    }))
    .sort((a, b) => b.score - a.score);

  if (process.env.NODE_ENV === "development") {
    console.log(
      "[BecauseYouLoved] Extracted influential films:",
      ranked.slice(0, 3),
    );
  }

  return ranked.slice(0, 3); // Top 3 most influential
}

function truncateTitle(title: string, maxLength: number = 20): string {
  if (title.length <= maxLength) return title;
  return title.substring(0, maxLength - 1) + "…";
}

function BecauseYouLovedCallout({ contributingFilms }: BecauseYouLovedProps) {
  const [hoveredFilm, setHoveredFilm] = useState<number | null>(null);
  const [focusedFilm, setFocusedFilm] = useState<number | null>(null);

  const influential = useMemo(
    () => extractInfluentialFilms(contributingFilms),
    [contributingFilms],
  );

  if (influential.length === 0) {
    return null;
  }

  const categoryLabels: Record<string, string> = {
    director: "director",
    genre: "genre",
    keyword: "themes",
    cast: "cast",
    studio: "studio",
  };

  // Show tooltip when hovered OR focused (for keyboard accessibility)
  const activeFilmId = hoveredFilm ?? focusedFilm;

  return (
    <div className="mb-2 relative">
      {/* Film strip header with gradient accent */}
      <div className="flex items-center gap-2 mb-1.5">
        {/* Film reel icon */}
        <div className="flex-shrink-0 w-5 h-5 relative">
          <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
            <circle
              cx="12"
              cy="12"
              r="10"
              className="stroke-rose-400 dark:stroke-rose-500"
              strokeWidth="1.5"
            />
            <circle
              cx="12"
              cy="12"
              r="3"
              className="fill-rose-400 dark:fill-rose-500"
            />
            <circle
              cx="12"
              cy="5"
              r="1.5"
              className="fill-rose-300 dark:fill-rose-400"
            />
            <circle
              cx="12"
              cy="19"
              r="1.5"
              className="fill-rose-300 dark:fill-rose-400"
            />
            <circle
              cx="5"
              cy="12"
              r="1.5"
              className="fill-rose-300 dark:fill-rose-400"
            />
            <circle
              cx="19"
              cy="12"
              r="1.5"
              className="fill-rose-300 dark:fill-rose-400"
            />
          </svg>
        </div>

        <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
          Because you loved
        </span>

        {/* Decorative line */}
        <div className="flex-1 h-px bg-gradient-to-r from-rose-200 via-rose-100 to-transparent dark:from-rose-800/50 dark:via-rose-900/30 dark:to-transparent" />
      </div>

      {/* Film chips */}
      <div className="flex flex-wrap gap-1.5">
        {influential.map(({ film, categories, score }) => {
          const tooltipId = `film-chip-tooltip-${film.id}`;
          const isTooltipVisible = activeFilmId === film.id;

          const handleKeyDown = (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setFocusedFilm((prev) => (prev === film.id ? null : film.id));
            } else if (e.key === "Escape") {
              setFocusedFilm(null);
            }
          };

          return (
            <div
              key={film.id}
              className="group/chip relative"
              onMouseEnter={() => setHoveredFilm(film.id)}
              onMouseLeave={() => setHoveredFilm(null)}
              onFocus={() => setFocusedFilm(film.id)}
              onBlur={() => setFocusedFilm(null)}
              onKeyDown={handleKeyDown}
              tabIndex={0}
              role="button"
              aria-describedby={isTooltipVisible ? tooltipId : undefined}
            >
              {/* Film chip */}
              <div
                className={`
                  inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
                  cursor-help transition-all duration-200
                  bg-gradient-to-r from-rose-50 to-pink-50 
                  dark:from-rose-950/40 dark:to-pink-950/40
                  border border-rose-200/60 dark:border-rose-800/40
                  hover:border-rose-300 dark:hover:border-rose-700
                  hover:shadow-sm hover:shadow-rose-200/50 dark:hover:shadow-rose-900/30
                  group-hover/chip:scale-[1.02]
                `}
              >
                {/* Heart icon with pulse effect for high-influence films */}
                <span
                  className={`text-rose-400 dark:text-rose-500 ${score >= 2 ? "animate-pulse" : ""}`}
                >
                  {score >= 2 ? "💗" : "💕"}
                </span>

                <span className="text-gray-700 dark:text-gray-200 font-medium">
                  {truncateTitle(film.title)}
                </span>

                {/* Influence indicator for films appearing in multiple categories */}
                {score >= 2 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 dark:bg-rose-500 flex-shrink-0" />
                )}
              </div>

              {/* Tooltip on hover or focus */}
              {isTooltipVisible && (
                <div
                  role="tooltip"
                  id={tooltipId}
                  className="absolute z-30 bottom-full left-1/2 transform -translate-x-1/2 mb-2 
                             bg-gray-900 dark:bg-gray-800 text-white rounded-lg shadow-xl 
                             px-3 py-2 text-[11px] leading-relaxed whitespace-nowrap
                             animate-fade-in-up pointer-events-none"
                >
                  <div className="font-semibold text-rose-300 mb-0.5">
                    {film.title}
                  </div>
                  <div className="text-gray-300">
                    Shared{" "}
                    {categories.map((c) => categoryLabels[c] || c).join(" & ")}
                  </div>
                  {/* Tooltip arrow */}
                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-px">
                    <div className="border-4 border-transparent border-t-gray-900 dark:border-t-gray-800" />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Poster image component with error handling
function PosterImage({
  posterPath,
  title,
}: {
  posterPath?: string | null;
  title: string;
}) {
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  if (!posterPath || error) {
    return (
      <div className="w-24 h-36 bg-gray-700 rounded overflow-hidden relative flex items-center justify-center text-gray-400 text-xs text-center p-2">
        No poster
      </div>
    );
  }

  return (
    <div className="w-24 h-36 bg-gray-700 rounded overflow-hidden relative">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-700">
          <div className="w-6 h-6 border-2 border-gray-500 border-t-gray-300 rounded-full animate-spin" />
        </div>
      )}
      <Image
        src={`https://image.tmdb.org/t/p/w185${posterPath}`}
        alt={title}
        fill
        sizes="96px"
        className="object-cover"
        unoptimized
        onLoad={() => setLoading(false)}
        onError={() => {
          console.error("[PosterImage] Failed to load:", posterPath);
          setError(true);
          setLoading(false);
        }}
      />
    </div>
  );
}

type MovieCardProps = {
  id: number;
  title: string;
  year?: string;
  posterPath?: string | null;
  trailerKey?: string | null;
  isInWatchlist?: boolean;
  reasons?: string[];
  score?: number;
  voteCategory?: "hidden-gem" | "crowd-pleaser" | "cult-classic" | "standard";
  collectionName?: string;
  showTrailer?: boolean;
  onFeedback?: (
    id: number,
    type: "negative" | "positive",
    reasons?: string[],
  ) => void;
  onSave?: (
    id: number,
    title: string,
    year?: string,
    posterPath?: string | null,
  ) => Promise<void>;
  isSaved?: boolean;
  vote_average?: number;
  vote_count?: number;
  overview?: string;
  contributingFilms?: Record<string, Array<{ id: number; title: string }>>;
  dismissed?: boolean;
  imdb_rating?: string;
  imdb_source?: "omdb" | "tmdb" | "watchmode" | "tuimdb";
  rotten_tomatoes?: string;
  metacritic?: string;
  awards?: string;
  genres?: string[];
  // Multi-source recommendation data
  sources?: string[];
  consensusLevel?: "high" | "medium" | "low";
  reliabilityMultiplier?: number;
  onUndoDismiss?: (id: number) => void;
  featureEvidence?: Record<string, FeatureEvidenceSummary>;
  // P2.3: Streaming availability
  streamingSources?: Array<{
    name: string;
    type: "sub" | "buy" | "rent" | "free";
    url?: string;
  }>;
};

// Source display labels
const SOURCE_LABELS: Record<string, string> = {
  tmdb: "TMDB",
  tastedive: "TasteDive",
  trakt: "Trakt",
  tuimdb: "TuiMDB",
  watchmode: "Watchmode",
};

// ============================================================================
// SOURCE ICONS & CONSENSUS BADGE SYSTEM (Task 2.3)
// Premium certification seal aesthetic with trust hierarchy
// ============================================================================

// Source icons - each represents what the source specializes in
const SOURCE_ICONS: Record<string, { icon: string; specialty: string }> = {
  tmdb: { icon: "🎬", specialty: "Collaborative filtering & user ratings" },
  tastedive: { icon: "🎯", specialty: "Taste pattern analysis" },
  trakt: { icon: "📊", specialty: "Community watch trends" },
  tuimdb: { icon: "🔍", specialty: "Deep catalog search" },
  watchmode: { icon: "📺", specialty: "Streaming availability intelligence" },
};

type ConsensusTier = "perfect-match" | "high" | "medium" | "single";

interface ConsensusBadgeConfig {
  tier: ConsensusTier;
  label: string;
  icon: string;
  description: string;
  gradient: { from: string; to: string; glow: string };
  borderColor: string;
  textColor: string;
  darkGradient: { from: string; to: string; glow: string };
  darkBorderColor: string;
  darkTextColor: string;
}

function getConsensusBadgeConfig(
  sources: string[] | undefined,
  consensusLevel: "high" | "medium" | "low" | undefined,
  score: number | undefined,
): ConsensusBadgeConfig | null {
  const sourceCount = sources?.length || 0;

  // Perfect Match: High consensus + exceptional score
  if (consensusLevel === "high" && score !== undefined && score >= 0.85) {
    return {
      tier: "perfect-match",
      label: "Perfect Match",
      icon: "🌟",
      description: `A rare find: recommended by ${sourceCount} sources with ${Math.round(score * 100)}% match score. This is as good as it gets!`,
      gradient: {
        from: "from-violet-500",
        to: "to-fuchsia-500",
        glow: "rgba(139, 92, 246, 0.5)",
      },
      borderColor: "border-violet-400/60",
      textColor: "text-violet-900",
      darkGradient: {
        from: "dark:from-violet-600",
        to: "dark:to-fuchsia-600",
        glow: "rgba(139, 92, 246, 0.4)",
      },
      darkBorderColor: "dark:border-violet-500/50",
      darkTextColor: "dark:text-violet-100",
    };
  }

  // High Consensus: 3+ sources
  if (sourceCount >= 3 || consensusLevel === "high") {
    return {
      tier: "high",
      label: "High Consensus",
      icon: "✨",
      description: `Strong agreement across ${sourceCount} different algorithms. Multiple recommendation engines independently suggest this film.`,
      gradient: {
        from: "from-amber-400",
        to: "to-yellow-500",
        glow: "rgba(251, 191, 36, 0.45)",
      },
      borderColor: "border-amber-400/70",
      textColor: "text-amber-900",
      darkGradient: {
        from: "dark:from-amber-500",
        to: "dark:to-yellow-600",
        glow: "rgba(251, 191, 36, 0.35)",
      },
      darkBorderColor: "dark:border-amber-500/60",
      darkTextColor: "dark:text-amber-100",
    };
  }

  // Medium Consensus: 2 sources
  if (sourceCount === 2 || consensusLevel === "medium") {
    return {
      tier: "medium",
      label: "Consensus",
      icon: "🤝",
      description: `Good multi-source agreement. Two independent recommendation systems both suggest this film for you.`,
      gradient: {
        from: "from-cyan-400",
        to: "to-teal-500",
        glow: "rgba(34, 211, 238, 0.35)",
      },
      borderColor: "border-cyan-400/60",
      textColor: "text-cyan-900",
      darkGradient: {
        from: "dark:from-cyan-500",
        to: "dark:to-teal-600",
        glow: "rgba(34, 211, 238, 0.3)",
      },
      darkBorderColor: "dark:border-cyan-500/50",
      darkTextColor: "dark:text-cyan-100",
    };
  }

  // Single Source
  if (sourceCount === 1) {
    const sourceKey = sources![0];
    return {
      tier: "single",
      label: `via ${SOURCE_LABELS[sourceKey] || sourceKey}`,
      icon: SOURCE_ICONS[sourceKey]?.icon || "📌",
      description:
        SOURCE_ICONS[sourceKey]?.specialty || "Single-source suggestion",
      gradient: {
        from: "from-slate-200",
        to: "to-gray-300",
        glow: "transparent",
      },
      borderColor: "border-slate-300/70",
      textColor: "text-slate-700",
      darkGradient: {
        from: "dark:from-slate-700",
        to: "dark:to-gray-700",
        glow: "transparent",
      },
      darkBorderColor: "dark:border-slate-600/60",
      darkTextColor: "dark:text-slate-200",
    };
  }

  return null;
}

type ConsensusSourceBadgeProps = {
  sources: string[] | undefined;
  consensusLevel: "high" | "medium" | "low" | undefined;
  score: number | undefined;
};

function ConsensusSourceBadge({
  sources,
  consensusLevel,
  score,
}: ConsensusSourceBadgeProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  // Show tooltip on hover OR focus for keyboard accessibility
  const showTooltip = isHovered || isFocused;

  // Generate unique ID for ARIA association
  const tooltipId = `consensus-tooltip-${sources?.join("-") || "none"}-${score?.toString().replace(".", "-") || "0"}`;

  const config = getConsensusBadgeConfig(sources, consensusLevel, score);

  if (!config || !sources || sources.length === 0) {
    return null;
  }

  if (process.env.NODE_ENV === "development") {
    console.log("[ConsensusSourceBadge] Rendering:", {
      sources,
      consensusLevel,
      score,
      tier: config.tier,
    });
  }

  const sourceIcons = sources
    .map((s) => SOURCE_ICONS[s]?.icon || "")
    .filter(Boolean)
    .join("");

  // Keyboard handler for accessibility
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setIsFocused((prev) => !prev);
    } else if (e.key === "Escape") {
      setIsFocused(false);
    }
  };

  // Build detailed tooltip content
  const tooltipContent = (
    <div className="max-w-xs">
      <div className="font-bold text-sm mb-1.5 flex items-center gap-1.5">
        <span>{config.icon}</span>
        <span>{config.label}</span>
      </div>
      <p className="text-xs text-gray-200 mb-2 leading-relaxed">
        {config.description}
      </p>
      {sources.length > 0 && (
        <div className="space-y-1 pt-2 border-t border-gray-600">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
            Sources
          </div>
          {sources.map((source) => (
            <div
              key={source}
              className="flex items-center gap-2 text-xs text-gray-300"
            >
              <span>{SOURCE_ICONS[source]?.icon || "📌"}</span>
              <span className="font-medium">
                {SOURCE_LABELS[source] || source}
              </span>
              <span className="text-gray-500 text-[10px]">
                — {SOURCE_ICONS[source]?.specialty || "Recommendation source"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // Perfect Match gets the most elaborate treatment
  if (config.tier === "perfect-match") {
    return (
      <div
        className="relative inline-flex"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="button"
        aria-describedby={showTooltip ? tooltipId : undefined}
      >
        {/* Outer glow animation */}
        <div
          className="absolute inset-0 rounded-full blur-md animate-pulse opacity-60"
          style={{
            background: `linear-gradient(135deg, ${config.gradient.glow}, ${config.darkGradient.glow})`,
          }}
        />

        {/* Main badge */}
        <div
          className={`
            relative px-3 py-1.5 rounded-full text-xs font-bold
            bg-gradient-to-r ${config.gradient.from} ${config.gradient.to}
            ${config.darkGradient.from} ${config.darkGradient.to}
            border-2 ${config.borderColor} ${config.darkBorderColor}
            ${config.textColor} ${config.darkTextColor}
            shadow-lg cursor-help
            transition-all duration-300 ease-out
            hover:scale-105 hover:shadow-xl
          `}
          aria-label={`${config.label}: ${config.description}`}
        >
          <span className="flex items-center gap-1.5">
            <span className="text-sm">{config.icon}</span>
            <span className="tracking-wide">{config.label}</span>
            {sourceIcons && (
              <>
                <span className="opacity-50">•</span>
                <span className="text-[11px] opacity-90">{sourceIcons}</span>
              </>
            )}
          </span>
        </div>

        {/* Tooltip */}
        {showTooltip && (
          <div
            role="tooltip"
            id={tooltipId}
            className="absolute z-50 bottom-full left-1/2 transform -translate-x-1/2 mb-2 
                       bg-gray-900 text-white rounded-xl shadow-2xl px-4 py-3
                       animate-fade-in-up pointer-events-none min-w-[280px]
                       border border-violet-500/30"
          >
            {tooltipContent}
            <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-px">
              <div className="border-8 border-transparent border-t-gray-900" />
            </div>
          </div>
        )}
      </div>
    );
  }

  // High Consensus - Gold award seal aesthetic
  if (config.tier === "high") {
    return (
      <div
        className="relative inline-flex"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="button"
        aria-describedby={showTooltip ? tooltipId : undefined}
      >
        {/* Subtle shimmer effect */}
        <div
          className="absolute inset-0 rounded-full opacity-40 blur-sm"
          style={{ backgroundColor: config.gradient.glow }}
        />

        {/* Main badge */}
        <div
          className={`
            relative px-2.5 py-1 rounded-full text-xs font-semibold
            bg-gradient-to-r ${config.gradient.from} ${config.gradient.to}
            ${config.darkGradient.from} ${config.darkGradient.to}
            border ${config.borderColor} ${config.darkBorderColor}
            ${config.textColor} ${config.darkTextColor}
            shadow-md cursor-help
            transition-all duration-200
            hover:shadow-lg hover:scale-[1.02]
          `}
          aria-label={`${config.label}: ${config.description}`}
        >
          <span className="flex items-center gap-1.5">
            <span>{config.icon}</span>
            <span className="tracking-wide">{config.label}</span>
            {sourceIcons && (
              <>
                <span className="opacity-40">•</span>
                <span className="text-[10px] opacity-80">{sourceIcons}</span>
              </>
            )}
          </span>
        </div>

        {/* Tooltip */}
        {showTooltip && (
          <div
            role="tooltip"
            id={tooltipId}
            className="absolute z-50 bottom-full left-1/2 transform -translate-x-1/2 mb-2 
                       bg-gray-900 text-white rounded-xl shadow-2xl px-4 py-3
                       animate-fade-in-up pointer-events-none min-w-[280px]
                       border border-amber-500/30"
          >
            {tooltipContent}
            <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-px">
              <div className="border-8 border-transparent border-t-gray-900" />
            </div>
          </div>
        )}
      </div>
    );
  }

  // Medium Consensus - Trust verification badge
  if (config.tier === "medium") {
    return (
      <div
        className="relative inline-flex"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="button"
        aria-describedby={showTooltip ? tooltipId : undefined}
      >
        {/* Main badge */}
        <div
          className={`
            relative px-2.5 py-1 rounded-full text-xs font-medium
            bg-gradient-to-r ${config.gradient.from} ${config.gradient.to}
            ${config.darkGradient.from} ${config.darkGradient.to}
            border ${config.borderColor} ${config.darkBorderColor}
            ${config.textColor} ${config.darkTextColor}
            shadow cursor-help
            transition-all duration-200
            hover:shadow-md
          `}
          aria-label={`${config.label}: ${config.description}`}
        >
          <span className="flex items-center gap-1.5">
            <span>{config.icon}</span>
            <span>{config.label}</span>
            {sourceIcons && (
              <>
                <span className="opacity-40">•</span>
                <span className="text-[10px] opacity-75">{sourceIcons}</span>
              </>
            )}
          </span>
        </div>

        {/* Tooltip */}
        {showTooltip && (
          <div
            role="tooltip"
            id={tooltipId}
            className="absolute z-50 bottom-full left-1/2 transform -translate-x-1/2 mb-2 
                       bg-gray-900 text-white rounded-xl shadow-2xl px-4 py-3
                       animate-fade-in-up pointer-events-none min-w-[260px]
                       border border-cyan-500/30"
          >
            {tooltipContent}
            <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-px">
              <div className="border-8 border-transparent border-t-gray-900" />
            </div>
          </div>
        )}
      </div>
    );
  }

  // Single Source - Subtle informational badge
  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-describedby={showTooltip ? tooltipId : undefined}
    >
      {/* Main badge */}
      <div
        className={`
          relative px-2 py-1 rounded-full text-xs font-medium
          bg-gradient-to-r ${config.gradient.from} ${config.gradient.to}
          ${config.darkGradient.from} ${config.darkGradient.to}
          border ${config.borderColor} ${config.darkBorderColor}
          ${config.textColor} ${config.darkTextColor}
          cursor-help transition-all duration-200
        `}
        aria-label={`${config.label}: ${config.description}`}
      >
        <span className="flex items-center gap-1">
          <span className="text-[10px]">{config.icon}</span>
          <span>{config.label}</span>
        </span>
      </div>

      {/* Tooltip */}
      {showTooltip && (
        <div
          role="tooltip"
          id={tooltipId}
          className="absolute z-50 bottom-full left-1/2 transform -translate-x-1/2 mb-2 
                     bg-gray-900 text-white rounded-lg shadow-xl px-3 py-2
                     animate-fade-in-up pointer-events-none min-w-[200px]"
        >
          {tooltipContent}
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-px">
            <div className="border-6 border-transparent border-t-gray-900" />
          </div>
        </div>
      )}
    </div>
  );
}

export const FeatureEvidenceContext = createContext<
  Record<string, FeatureEvidenceSummary> | undefined
>(undefined);

// Helper function to extract genres, directors, keywords, etc. from a reason string
function extractFeatureInfo(reason: string): {
  type: "genre" | "director" | "keyword" | "cast" | "studio" | null;
  names: string[];
} {
  // Extract genres from patterns like "Matches your taste in Drama, Thriller (X films)"
  const genreMatch = reason.match(
    /Matches your (?:specific )?taste in ([^(]+)/,
  );
  if (genreMatch) {
    const names = genreMatch[1]
      .split(/,| \+ /)
      .map((s) => s.trim())
      .filter(Boolean);
    return { type: "genre", names };
  }

  // Extract directors from "Directed by Christopher Nolan, ..."
  const directorMatch = reason.match(/Directed by ([^—]+)/);
  if (directorMatch) {
    const names = directorMatch[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return { type: "director", names };
  }

  // Extract keywords from "Matches specific themes you ... : theme1, theme2, theme3"
  const keywordMatch = reason.match(
    /(?:Matches specific themes|explores) (?:you )?(?:especially love|enjoy)[^:]*: ([^(]+)/,
  );
  if (keywordMatch) {
    const names = keywordMatch[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return { type: "keyword", names };
  }

  // Extract studios from "From A24 —"
  const studioMatch = reason.match(/From ([^—]+)/);
  if (studioMatch) {
    const names = studioMatch[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return { type: "studio", names };
  }

  // Extract cast from "Stars Actor Name, ..."
  const castMatch = reason.match(/Stars ([^—]+)/);
  if (castMatch) {
    const names = castMatch[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return { type: "cast", names };
  }

  return { type: null, names: [] };
}

// Helper function to get contributing films for a reason
function getContributingFilmsForReason(
  reason: string,
  contributingFilms?: Record<string, Array<{ id: number; title: string }>>,
): Array<{ id: number; title: string }> {
  if (!contributingFilms) return [];

  const { type, names } = extractFeatureInfo(reason);
  if (!type || names.length === 0) return [];

  const allFilms = new Map<number, { id: number; title: string }>();

  // Collect all films that match the extracted feature names
  for (const name of names) {
    const key = `${type}:${name}`;
    const films = contributingFilms[key] || [];
    films.forEach((f) => allFilms.set(f.id, f));
  }

  return Array.from(allFilms.values());
}

// Custom popover component for film lists
function FilmListPopover({
  films,
  count,
  isOpen,
  onClose,
  position,
}: {
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
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Popover */}
      <div
        className="fixed z-50 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 p-3 max-w-xs"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          transform: "translate(-50%, -100%) translateY(-8px)",
        }}
      >
        <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
          Based on {films.length} film{films.length !== 1 ? "s" : ""} you rated
          highly:
        </div>
        <div className="max-h-64 overflow-y-auto space-y-1">
          {films.slice(0, 20).map((film, idx) => (
            <div
              key={film.id}
              className="text-xs text-gray-600 dark:text-gray-400 flex items-start gap-1.5"
            >
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
  contributingFilms:
    | Record<string, Array<{ id: number; title: string }>>
    | undefined,
  onCountClick: (
    films: Array<{ id: number; title: string }>,
    count: string,
    event: React.MouseEvent,
  ) => void,
) {
  // Patterns to match film counts
  const patterns = [
    { regex: /\((\d+) similar films?\)/g, type: "count" },
    { regex: /\((\d+) highly-rated similar films?\)/g, type: "count" },
    { regex: /\((\d+\+?) highly-rated films?\)/g, type: "count" },
    { regex: /(\d+) films? by (this|these) directors?/g, type: "count" },
    { regex: /(\d+) films? from this studio/g, type: "count" },
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
          <span key={`text-${partKey++}`}>
            {reason.substring(lastIndex, matchStart)}
          </span>,
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
        </span>,
      );

      lastIndex = matchEnd;
    }
  }

  // Add remaining text
  if (lastIndex < reason.length) {
    parts.push(
      <span key={`text-${partKey++}`}>{reason.substring(lastIndex)}</span>,
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
  onSave,
  isSaved = false,
  vote_average,
  vote_count,
  overview,
  contributingFilms,
  dismissed = false,
  imdb_rating,
  imdb_source,
  rotten_tomatoes,
  metacritic,
  awards,
  genres,
  sources,
  consensusLevel,
  reliabilityMultiplier,
  onUndoDismiss,
  featureEvidence,
  streamingSources, // P2.3
}: MovieCardProps) {
  const [showVideo, setShowVideo] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [popover, setPopover] = useState<{
    films: Array<{ id: number; title: string }>;
    count: string;
    position: { x: number; y: number };
  } | null>(null);
  const [feedbackState, setFeedbackState] = useState<
    "negative" | "positive" | null
  >(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    isSaved ? "saved" : "idle",
  );
  const evidenceFromContext = useContext(FeatureEvidenceContext);
  const evidenceLookup = featureEvidence ?? evidenceFromContext;
  const reasonEvidenceLookup = useMemo<Record<string, FeatureEvidenceSummary>>(
    () =>
      (evidenceLookup as Record<string, FeatureEvidenceSummary> | undefined) ??
      {},
    [evidenceLookup],
  );

  const getReasonEvidence = (reason: string) => {
    const info = extractFeatureInfo(reason);
    if (!info.type || info.names.length === 0) return null;
    const matches: FeatureEvidenceSummary[] = [];
    info.names.forEach((name) => {
      const key = `${info.type}:${name.toLowerCase()}`;
      const data = reasonEvidenceLookup[key];
      if (data) matches.push(data);
    });
    if (matches.length === 0) return null;

    const strongest = matches.reduce((best, curr) => {
      const bestScore = best.totalCount * best.decayMultiplier;
      const currScore = curr.totalCount * curr.decayMultiplier;
      return currScore > bestScore ? curr : best;
    });

    const latestTs = matches.reduce((max, curr) => {
      if (!curr.lastUpdated) return max;
      const ts = new Date(curr.lastUpdated).getTime();
      return Math.max(max, ts);
    }, -Infinity);

    const daysAgo = Number.isFinite(latestTs)
      ? Math.max(0, Math.round((Date.now() - latestTs) / (1000 * 60 * 60 * 24)))
      : null;

    const label = (() => {
      const effective = strongest.totalCount * strongest.decayMultiplier;
      if (effective >= 6) return "Strong";
      if (effective >= 3) return "Solid";
      return "Light";
    })();

    const recencyLabel =
      daysAgo === null ? "stale" : daysAgo === 0 ? "<1d" : `${daysAgo}d`;
    const names = info.names.join(", ");

    return {
      label,
      count: strongest.totalCount,
      recencyLabel,
      title: `${label} evidence from ${strongest.totalCount} signals for ${names}${daysAgo === null ? "" : ` • last updated ${recencyLabel} ago`}`,
    };
  };

  // Helper to get rating source label
  const getRatingSourceLabel = (
    source?: "omdb" | "tmdb" | "watchmode" | "tuimdb",
  ): string => {
    if (!source || source === "omdb") return "IMDb";
    if (source === "tmdb") return "TMDB";
    if (source === "watchmode") return "Watchmode";
    if (source === "tuimdb") return "TuiMDB";
    return "IMDb";
  };

  const voteCategoryBadge =
    voteCategory && voteCategory !== "standard"
      ? {
          "hidden-gem": {
            label: "💎 Hidden Gem",
            className: "bg-purple-100 text-purple-800",
          },
          "crowd-pleaser": {
            label: "🎉 Crowd Pleaser",
            className: "bg-green-100 text-green-800",
          },
          "cult-classic": {
            label: "🎭 Cult Classic",
            className: "bg-orange-100 text-orange-800",
          },
        }[voteCategory]
      : null;

  // Note: consensusLevel is now handled by the enhanced ConsensusSourceBadge component (Task 2.3)

  const reliabilityBadge = reliabilityMultiplier
    ? {
        label:
          reliabilityMultiplier > 1
            ? `Reliability +${Math.round((reliabilityMultiplier - 1) * 100)}%`
            : `Reliability ${Math.round((reliabilityMultiplier - 1) * 100)}%`,
        className:
          reliabilityMultiplier >= 1
            ? "bg-sky-100 dark:bg-sky-900/40 text-sky-800 dark:text-sky-200"
            : "bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200",
      }
    : null;

  const strengthScore = (() => {
    let s = 0;
    if (reliabilityMultiplier) s += reliabilityMultiplier - 1; // +/- confidence
    if (consensusLevel === "high") s += 0.12;
    else if (consensusLevel === "medium") s += 0.05;
    else if (consensusLevel === "low") s -= 0.05;
    return s;
  })();

  const strengthBadge = (() => {
    if (!reliabilityMultiplier && !consensusLevel) return null;
    if (strengthScore >= 0.12)
      return {
        label: "High Match Strength",
        className:
          "bg-lime-100 dark:bg-lime-900/40 text-lime-800 dark:text-lime-200",
      };
    if (strengthScore >= 0.02)
      return {
        label: "Solid Match",
        className:
          "bg-amber-50 dark:bg-amber-900/40 text-amber-700 dark:text-amber-200",
      };
    return {
      label: "Exploratory",
      className:
        "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300",
    };
  })();

  // Show moderate number of reasons by default to balance space usage
  const defaultReasonCount = 6;
  const displayedReasons = expanded
    ? reasons
    : reasons?.slice(0, defaultReasonCount);
  const hasMoreReasons = reasons && reasons.length > defaultReasonCount;

  const handleCountClick = (
    films: Array<{ id: number; title: string }>,
    count: string,
    event: React.MouseEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const rect = (event.target as HTMLElement).getBoundingClientRect();
    setPopover({
      films,
      count,
      position: {
        x: rect.left + rect.width / 2,
        y: rect.top,
      },
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

      <div
        className={`border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col relative self-start w-full h-full`}
      >
        {/* Gray overlay when dismissed */}
        {dismissed && (
          <div className="absolute inset-0 bg-gray-900 bg-opacity-60 z-10 flex items-center justify-center rounded-lg">
            <div className="bg-white dark:bg-gray-900 px-4 py-2 rounded-lg shadow-lg">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Dismissed
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Will be removed on refresh
              </p>
              {onUndoDismiss && (
                <button
                  className="mt-2 w-full text-xs font-semibold text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-blue-200 hover:underline"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onUndoDismiss(id);
                  }}
                >
                  Undo
                </button>
              )}
            </div>
          </div>
        )}

        {/* Header Section - Title, Year, Ratings + Match Score */}
        <div className="p-3 pb-2 border-b border-gray-100 dark:border-gray-700">
          {/* Title row with Match Score */}
          <div className="flex items-start gap-3">
            {/* Title and meta info */}
            <div className="flex-1 min-w-0">
              <h3
                className="font-semibold text-base leading-tight mb-1 line-clamp-2"
                title={title}
              >
                {title}
              </h3>

              {/* Year and Ratings Row */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                {year && (
                  <span className="text-gray-600 dark:text-gray-400 font-medium">
                    {year}
                  </span>
                )}

                {vote_average && (
                  <>
                    {year && <span className="text-gray-400">•</span>}
                    <span
                      className="flex items-center gap-1"
                      title={`TMDB: ${vote_average.toFixed(1)}/10 from ${vote_count ? vote_count.toLocaleString() : "N/A"} votes`}
                    >
                      <span className="text-yellow-500">⭐</span>
                      <span className="font-medium text-gray-900 dark:text-gray-100">
                        {vote_average.toFixed(1)}
                      </span>
                    </span>
                  </>
                )}

                {imdb_rating && (
                  <>
                    <span className="text-gray-400">•</span>
                    <span
                      className="flex items-center gap-1"
                      title={`${getRatingSourceLabel(imdb_source)}: ${imdb_rating}/10`}
                    >
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        IMDb {imdb_rating}
                      </span>
                    </span>
                  </>
                )}

                {rotten_tomatoes && (
                  <>
                    <span className="text-gray-400">•</span>
                    <span
                      className="flex items-center gap-1"
                      title={`Rotten Tomatoes: ${rotten_tomatoes}`}
                    >
                      <span className="text-red-500">🍅</span>
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        {rotten_tomatoes}
                      </span>
                    </span>
                  </>
                )}

                {metacritic && (
                  <>
                    <span className="text-gray-400">•</span>
                    <span
                      className="flex items-center gap-1"
                      title={`Metacritic: ${metacritic}/100`}
                    >
                      <span className="text-green-600">Ⓜ️</span>
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        {metacritic}
                      </span>
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Match Score Ring - Task 2.1 */}
            {typeof score === "number" && score > 0 && (
              <div className="flex-shrink-0">
                <MatchScoreRing score={score} />
              </div>
            )}
          </div>

          {/* Genres */}
          {genres && genres.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {genres.slice(0, 5).map((genre, idx) => (
                <span
                  key={idx}
                  className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full"
                >
                  {genre}
                </span>
              ))}
              {genres.length > 5 && (
                <span className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-full">
                  +{genres.length - 5}
                </span>
              )}
            </div>
          )}

          {/* P2.3: Streaming Availability */}
          {streamingSources && streamingSources.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">
                📺
              </span>
              {streamingSources
                .filter((s) => s.type === "sub" || s.type === "free") // Prioritize subscription/free
                .slice(0, 4)
                .map((s, idx) => (
                  <a
                    key={idx}
                    href={s.url || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`px-2 py-0.5 text-xs rounded-full transition-colors ${
                      s.type === "sub"
                        ? "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-200 hover:bg-purple-200 dark:hover:bg-purple-900/60"
                        : "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-200 hover:bg-green-200 dark:hover:bg-green-900/60"
                    }`}
                    title={
                      s.type === "sub"
                        ? `Stream on ${s.name}`
                        : `Free on ${s.name}`
                    }
                    onClick={(e) => !s.url && e.preventDefault()}
                  >
                    {s.name}
                  </a>
                ))}
              {streamingSources.filter(
                (s) => s.type === "sub" || s.type === "free",
              ).length > 4 && (
                <span className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 rounded-full">
                  +
                  {streamingSources.filter(
                    (s) => s.type === "sub" || s.type === "free",
                  ).length - 4}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Main Content Area */}
        <div className="flex gap-3 p-3">
          {/* Poster Column */}
          <div className="flex-shrink-0">
            <PosterImage posterPath={posterPath} title={title} />

            {/* Quick Action Buttons */}
            {trailerKey && (
              <button
                className="mt-2 w-24 px-2 py-1.5 text-xs font-medium rounded text-center transition-colors
                  bg-red-100 text-red-800 hover:bg-red-200
                  dark:bg-red-900/40 dark:text-red-100 dark:hover:bg-red-900/60 flex items-center justify-center gap-1"
                onClick={() => setShowVideo(true)}
                title="Watch trailer"
              >
                <span>▶️</span>
                <span>Trailer</span>
              </button>
            )}
          </div>

          {/* Content Column */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* Key Badges */}
            <div className="flex flex-wrap gap-1.5 mb-1.5 items-center">
              {/* Enhanced Multi-Source Consensus Badge - Task 2.3 (Primary visual) */}
              <ConsensusSourceBadge
                sources={sources}
                consensusLevel={consensusLevel}
                score={score}
              />

              {strengthBadge && (
                <span
                  className={`px-2 py-1 text-xs font-medium rounded whitespace-nowrap ${strengthBadge.className}`}
                  title="Overall match strength from consensus and reliability"
                >
                  {strengthBadge.label}
                </span>
              )}

              {reliabilityBadge && (
                <span
                  className={`px-2 py-1 text-xs font-medium rounded whitespace-nowrap ${reliabilityBadge.className}`}
                  title="Per-source reliability learned from your feedback"
                >
                  {reliabilityBadge.label}
                </span>
              )}

              {isInWatchlist && (
                <span
                  className="px-2 py-1 text-xs font-medium bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-200 rounded whitespace-nowrap"
                  title="In your watchlist"
                >
                  📋 Watchlist
                </span>
              )}

              {voteCategoryBadge && (
                <span
                  className={`px-2 py-1 text-xs font-medium rounded whitespace-nowrap ${voteCategoryBadge.className}`}
                >
                  {voteCategoryBadge.label}
                </span>
              )}

              {collectionName && (
                <span
                  className="px-2 py-1 text-xs font-medium bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200 rounded whitespace-nowrap"
                  title="Part of a collection"
                >
                  🎬 {collectionName}
                </span>
              )}
            </div>

            {/* Awards */}
            {awards && awards !== "N/A" && (
              <div className="mb-1.5 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 px-2 py-1.5 rounded border border-amber-200 dark:border-amber-800 flex items-start gap-1.5">
                <span className="mt-0.5">🏆</span>
                <span className="flex-1 line-clamp-2" title={awards}>
                  {awards}
                </span>
              </div>
            )}

            {/* "Because You Loved..." Callout - Task 2.2 */}
            {contributingFilms && Object.keys(contributingFilms).length > 0 && (
              <BecauseYouLovedCallout contributingFilms={contributingFilms} />
            )}

            {/* Reasons */}
            {reasons && reasons.length > 0 && (
              <div className={`mb-1 ${expanded ? "flex-1 flex flex-col" : ""}`}>
                <ul className={`space-y-1 ${expanded ? "flex-1" : ""}`}>
                  {displayedReasons?.map((r, i) => (
                    <li
                      key={i}
                      className="text-xs text-gray-700 dark:text-gray-300 flex items-start gap-1.5 leading-tight"
                    >
                      <span className="text-blue-500 mt-0.5 flex-shrink-0">
                        •
                      </span>
                      <div className="flex-1 flex flex-col gap-0.5 min-w-0">
                        <div className="flex items-start gap-1.5 flex-wrap">
                          {enhanceReasonText(
                            r,
                            i,
                            contributingFilms,
                            handleCountClick,
                          )}
                          {(() => {
                            const ev = getReasonEvidence(r);
                            if (!ev) return null;
                            const badgeClass =
                              ev.label === "Strong"
                                ? "bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-200"
                                : ev.label === "Solid"
                                  ? "bg-amber-50 dark:bg-amber-900/40 text-amber-700 dark:text-amber-200"
                                  : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300";
                            return (
                              <span
                                className={`px-1.5 py-0.5 text-[10px] font-medium rounded whitespace-nowrap ${badgeClass}`}
                                title={ev.title}
                              >
                                {ev.label}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                {hasMoreReasons && (
                  <button
                    onClick={() => setExpanded(!expanded)}
                    className="mt-1.5 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium flex items-center gap-1 transition-colors flex-shrink-0"
                  >
                    {expanded ? (
                      <>
                        <span>Show less</span>
                        <svg
                          className="w-3 h-3"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 15l7-7 7 7"
                          />
                        </svg>
                      </>
                    ) : (
                      <>
                        <span>+{reasons.length - defaultReasonCount} more</span>
                        <svg
                          className="w-3 h-3"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                      </>
                    )}
                  </button>
                )}
              </div>
            )}

            {/* Description */}
            {overview &&
              (() => {
                const shouldShowToggle = overview.length > 120;
                const shouldClamp = shouldShowToggle && !descriptionExpanded;
                return (
                  <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 flex flex-col">
                    <p
                      className={`text-xs text-gray-600 dark:text-gray-400 leading-relaxed ${shouldClamp ? "line-clamp-3" : ""}`}
                    >
                      {overview}
                    </p>
                    {shouldShowToggle && (
                      <button
                        onClick={() =>
                          setDescriptionExpanded(!descriptionExpanded)
                        }
                        className="mt-1 text-xs text-blue-600 dark:text-blue-400 hover:underline font-medium self-start"
                      >
                        {descriptionExpanded ? "Less" : "More"}
                      </button>
                    )}
                  </div>
                );
              })()}
          </div>
        </div>

        {/* Footer - Action Buttons */}
        {(onFeedback || onSave) && (
          <div className="p-3 pt-2 flex gap-2 flex-shrink-0 mt-auto">
            {onFeedback && (
              <>
                <button
                  onClick={async (e) => {
                    e.preventDefault();
                    if (feedbackState) return;
                    setFeedbackState("negative");
                    await onFeedback(id, "negative", reasons);
                    setFeedbackState(null);
                  }}
                  disabled={!!feedbackState}
                  className={`flex-1 py-2 px-2 rounded text-xs font-medium flex items-center justify-center gap-1 transition-colors min-w-0 ${
                    feedbackState === "negative"
                      ? "bg-gray-200 text-gray-400 cursor-wait"
                      : "bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200"
                  }`}
                  title="Not interested in this suggestion"
                >
                  {feedbackState === "negative" ? (
                    <>
                      <svg
                        className="w-3.5 h-3.5 animate-spin"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      <span>Removing...</span>
                    </>
                  ) : (
                    <>
                      <svg
                        className="w-3 h-3 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                      <span className="whitespace-nowrap truncate">
                        Not Interested
                      </span>
                    </>
                  )}
                </button>
                <button
                  onClick={async (e) => {
                    e.preventDefault();
                    if (feedbackState) return;
                    setFeedbackState("positive");
                    await onFeedback(id, "positive", reasons);
                    setFeedbackState(null);
                  }}
                  disabled={!!feedbackState}
                  className={`flex-1 py-2 px-2 rounded text-xs font-medium flex items-center justify-center gap-1 transition-colors min-w-0 ${
                    feedbackState === "positive"
                      ? "bg-blue-200 text-blue-400 cursor-wait"
                      : "bg-blue-600 hover:bg-blue-700 text-white dark:bg-blue-500 dark:hover:bg-blue-600"
                  }`}
                  title="Show more suggestions like this"
                >
                  {feedbackState === "positive" ? (
                    <>
                      <svg
                        className="w-3.5 h-3.5 animate-spin"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      <span>Updating...</span>
                    </>
                  ) : (
                    <>
                      <svg
                        className="w-3 h-3 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"
                        />
                      </svg>
                      <span className="whitespace-nowrap truncate">
                        More Like This
                      </span>
                    </>
                  )}
                </button>
              </>
            )}
            {onSave && (
              <button
                onClick={async (e) => {
                  e.preventDefault();
                  if (saveState !== "idle") return;
                  setSaveState("saving");
                  try {
                    await onSave(id, title, year, posterPath);
                    setSaveState("saved");
                  } catch (error) {
                    console.error("Error saving movie:", error);
                    setSaveState("idle");
                  }
                }}
                disabled={saveState !== "idle"}
                className={`flex-1 py-2 px-2 rounded text-xs font-medium flex items-center justify-center gap-1 transition-colors min-w-0 ${
                  saveState === "saved"
                    ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200"
                    : saveState === "saving"
                      ? "bg-purple-200 text-purple-400 cursor-wait"
                      : "bg-purple-600 hover:bg-purple-700 text-white dark:bg-purple-500 dark:hover:bg-purple-600"
                }`}
                title={
                  saveState === "saved"
                    ? "Saved to your list"
                    : "Save to your list"
                }
              >
                {saveState === "saving" ? (
                  <>
                    <svg
                      className="w-3.5 h-3.5 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    <span>Saving...</span>
                  </>
                ) : saveState === "saved" ? (
                  <>
                    <svg
                      className="w-3 h-3 flex-shrink-0"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span className="whitespace-nowrap truncate">Saved</span>
                  </>
                ) : (
                  <>
                    <svg
                      className="w-3 h-3 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
                      />
                    </svg>
                    <span className="whitespace-nowrap truncate">
                      Save to List
                    </span>
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Global styles for interactive film counts, match score animations, and consensus badges */}
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

        /* Match score ring entrance animation */
        @keyframes score-ring-draw {
          from {
            stroke-dashoffset: 150.79644737231007;
          }
        }

        .score-ring-animate {
          animation: score-ring-draw 1s ease-out forwards;
        }

        /* Tooltip fade-in animation for consensus badges */
        @keyframes fade-in-up {
          from {
            opacity: 0;
            transform: translate(-50%, -100%) translateY(4px);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -100%) translateY(-8px);
          }
        }

        .animate-fade-in-up {
          animation: fade-in-up 0.2s ease-out forwards;
        }

        /* Shimmer effect for high consensus badges */
        @keyframes badge-shimmer {
          0% {
            background-position: -200% center;
          }
          100% {
            background-position: 200% center;
          }
        }

        .badge-shimmer {
          background-size: 200% auto;
          animation: badge-shimmer 3s linear infinite;
        }

        /* Gentle pulse for perfect match glow */
        @keyframes gentle-pulse {
          0%,
          100% {
            opacity: 0.5;
          }
          50% {
            opacity: 0.8;
          }
        }

        .animate-gentle-pulse {
          animation: gentle-pulse 2s ease-in-out infinite;
        }
      `}</style>
    </>
  );
}
