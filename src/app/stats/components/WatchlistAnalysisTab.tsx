"use client";

import { useMemo } from "react";

import type { StatsTabProps } from "@/app/stats/types";
import { useStatsData } from "@/app/stats/hooks/useStatsData";
import { ProgressBar } from "@/app/stats/components/shared/ProgressBar";
import { SectionCard } from "@/app/stats/components/shared/SectionCard";
import { StatCard } from "@/app/stats/components/shared/StatCard";
import { TagCloud, type Tag } from "@/app/stats/components/shared/TagCloud";
import { Body, Heading } from "@/components/ui";
import type { FilmEvent } from "@/lib/normalize";

const DAY_MS = 1000 * 60 * 60 * 24;
const MONTHS_TO_SHOW = 6;

const isValidDate = (value: Date) => !Number.isNaN(value.getTime());

const formatPercent = (value: number, digits = 0) =>
  `${(value * 100).toFixed(digits)}%`;

const isWatched = (film: FilmEvent) =>
  (film.watchCount ?? 0) > 0 || film.rating != null || Boolean(film.lastDate);

const buildTagsFromCounts = (counts: Map<string, number>, maxTags: number) => {
  if (counts.size === 0) return [] as Tag[];
  const sorted = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTags);
  const maxCount = sorted[0]?.[1] ?? 0;
  return sorted.map(([label, count]) => ({
    label,
    count,
    weight: maxCount > 0 ? count / maxCount : 0,
  }));
};

const buildMonthlyBuckets = (dates: Date[], monthsToShow: number) => {
  const now = new Date();
  const buckets = new Map<string, { label: string; count: number }>();

  for (let i = 0; i < monthsToShow; i += 1) {
    const month = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${month.getFullYear()}-${month.getMonth()}`;
    const label = month.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
    buckets.set(key, { label, count: 0 });
  }

  dates.forEach((date) => {
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const bucket = buckets.get(key);
    if (!bucket) return;
    bucket.count += 1;
  });

  return Array.from(buckets.values()).reverse();
};

type WatchlistMetrics = {
  watchlistCount: number;
  watchedFromWatchlist: number;
  unviewedCount: number;
  conversionRate: number;
  averageAgeDays: number | null;
  averageDaysToWatch: number | null;
  medianDaysToWatch: number | null;
  recencyBuckets: Record<"fresh" | "warm" | "cool" | "stale", number>;
  recentAdditions: {
    last30: number;
    previous30: number;
    growthRate: number | null;
  };
  monthlyAdditions: Array<{ label: string; count: number }>;
  watchlistGenreCounts: Map<string, number>;
  watchedGenreCounts: Map<string, number>;
  watchlistGenreTags: Tag[];
  watchedGenreTags: Tag[];
  explorationTags: Tag[];
  genreAlignmentRate: number;
  genreDiversity: { unique: number; topShare: number };
  watchlistWithDatesCount: number;
};

export default function WatchlistAnalysisTab({
  timeFilter,
  filteredFilms,
  uid,
}: StatsTabProps) {
  const { tmdbDetails, filmMappings, isLoading, error } = useStatsData(
    uid,
    filteredFilms,
  );

  const watchlistMetrics = useMemo<WatchlistMetrics>(() => {
    const watchlistFilms = filteredFilms.filter((film) => film.onWatchlist);
    const watchedFromWatchlist = watchlistFilms.filter(isWatched);
    const unviewedWatchlist = watchlistFilms.filter((film) => !isWatched(film));
    const watchlistCount = watchlistFilms.length;
    const conversionRate =
      watchlistCount > 0 ? watchedFromWatchlist.length / watchlistCount : 0;

    const now = new Date();
    const watchlistDates = watchlistFilms
      .map((film) =>
        film.watchlistAddedAt ? new Date(film.watchlistAddedAt) : null,
      )
      .filter((date): date is Date => Boolean(date && isValidDate(date)));

    const recencyBuckets = { fresh: 0, warm: 0, cool: 0, stale: 0 };
    const watchlistAges: number[] = [];

    watchlistDates.forEach((date) => {
      const ageDays = (now.getTime() - date.getTime()) / DAY_MS;
      watchlistAges.push(ageDays);
      if (ageDays <= 90) recencyBuckets.fresh += 1;
      else if (ageDays <= 180) recencyBuckets.warm += 1;
      else if (ageDays <= 365) recencyBuckets.cool += 1;
      else recencyBuckets.stale += 1;
    });

    const averageAgeDays =
      watchlistAges.length > 0
        ? watchlistAges.reduce((sum, value) => sum + value, 0) /
          watchlistAges.length
        : null;

    const recentWindow = Date.now() - 30 * DAY_MS;
    const previousWindow = Date.now() - 60 * DAY_MS;
    const last30 = watchlistDates.filter(
      (date) => date.getTime() >= recentWindow,
    ).length;
    const previous30 = watchlistDates.filter((date) => {
      const ts = date.getTime();
      return ts >= previousWindow && ts < recentWindow;
    }).length;
    const growthRate =
      previous30 > 0 ? (last30 - previous30) / previous30 : null;

    const monthlyAdditions = buildMonthlyBuckets(
      watchlistDates,
      MONTHS_TO_SHOW,
    );

    const daysToWatch: number[] = [];
    watchlistFilms.forEach((film) => {
      if (!film.watchlistAddedAt || !film.lastDate) return;
      const addedAt = new Date(film.watchlistAddedAt);
      const watchedAt = new Date(film.lastDate);
      if (!isValidDate(addedAt) || !isValidDate(watchedAt)) return;
      const diff = (watchedAt.getTime() - addedAt.getTime()) / DAY_MS;
      if (diff >= 0) daysToWatch.push(diff);
    });

    const sortedDaysToWatch = [...daysToWatch].sort((a, b) => a - b);
    const averageDaysToWatch =
      daysToWatch.length > 0
        ? daysToWatch.reduce((sum, value) => sum + value, 0) /
          daysToWatch.length
        : null;
    const medianDaysToWatch =
      sortedDaysToWatch.length > 0
        ? sortedDaysToWatch[Math.floor(sortedDaysToWatch.length / 2)]
        : null;

    const watchlistGenreCounts = new Map<string, number>();
    const watchedGenreCounts = new Map<string, number>();

    const addGenres = (
      films: readonly FilmEvent[],
      target: Map<string, number>,
    ) => {
      films.forEach((film) => {
        const tmdbId = filmMappings.get(film.uri);
        if (!tmdbId) return;
        const details = tmdbDetails.get(tmdbId);
        if (!details?.genres?.length) return;
        details.genres.forEach((genre) => {
          target.set(genre.name, (target.get(genre.name) ?? 0) + 1);
        });
      });
    };

    addGenres(watchlistFilms, watchlistGenreCounts);
    addGenres(filteredFilms, watchedGenreCounts);

    const watchlistGenreTags = buildTagsFromCounts(watchlistGenreCounts, 12);
    const watchedGenreTags = buildTagsFromCounts(watchedGenreCounts, 12);

    const explorationCounts = new Map<string, number>();
    watchlistGenreCounts.forEach((count, genre) => {
      if (!watchedGenreCounts.has(genre)) {
        explorationCounts.set(genre, count);
      }
    });
    const explorationTags = buildTagsFromCounts(explorationCounts, 8);

    const overlap = [...watchlistGenreCounts.keys()].filter((genre) =>
      watchedGenreCounts.has(genre),
    ).length;
    const genreAlignmentRate =
      watchlistGenreCounts.size > 0 ? overlap / watchlistGenreCounts.size : 0;

    const totalWatchlistGenreMentions = Array.from(
      watchlistGenreCounts.values(),
    ).reduce((sum, value) => sum + value, 0);
    const topShare =
      totalWatchlistGenreMentions > 0
        ? Math.max(...watchlistGenreCounts.values()) /
          totalWatchlistGenreMentions
        : 0;

    return {
      watchlistCount,
      watchedFromWatchlist: watchedFromWatchlist.length,
      unviewedCount: unviewedWatchlist.length,
      conversionRate,
      averageAgeDays,
      averageDaysToWatch,
      medianDaysToWatch,
      recencyBuckets,
      recentAdditions: { last30, previous30, growthRate },
      monthlyAdditions,
      watchlistGenreCounts,
      watchedGenreCounts,
      watchlistGenreTags,
      watchedGenreTags,
      explorationTags,
      genreAlignmentRate,
      genreDiversity: {
        unique: watchlistGenreCounts.size,
        topShare,
      },
      watchlistWithDatesCount: watchlistDates.length,
    };
  }, [filteredFilms, filmMappings, tmdbDetails]);

  const filterLabel =
    timeFilter === "all"
      ? "All time"
      : timeFilter === "year"
        ? "Past year"
        : "Past month";

  if (filteredFilms.length === 0) {
    return (
      <div className="space-y-6">
        <Heading level={2}>Watchlist Analysis</Heading>
        <SectionCard title="No data yet">
          <Body className="text-gray-600">
            Import your Letterboxd watchlist to see intent signals and
            conversion patterns.
          </Body>
        </SectionCard>
      </div>
    );
  }

  if (watchlistMetrics.watchlistCount === 0) {
    return (
      <div className="space-y-6">
        <Heading level={2}>Watchlist Analysis</Heading>
        <SectionCard title="No watchlist items">
          <Body className="text-gray-600">
            Your watchlist is empty in the selected time range. Add titles to
            the watchlist to unlock intent analysis.
          </Body>
        </SectionCard>
      </div>
    );
  }

  const monthlyMax = Math.max(
    1,
    ...watchlistMetrics.monthlyAdditions.map((entry) => entry.count),
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Heading level={2}>Watchlist Analysis</Heading>
        <Body className="text-gray-500">Intent signals · {filterLabel}</Body>
        {isLoading && (
          <Body className="text-gray-500">Loading watchlist details...</Body>
        )}
        {error && (
          <Body className="text-red-600">
            Some watchlist details couldn&apos;t load. Please refresh if this
            persists.
          </Body>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard
          title="On Watchlist"
          value={watchlistMetrics.watchlistCount}
          icon="bookmark"
          variant="highlight"
        />
        <StatCard
          title="Unviewed"
          value={watchlistMetrics.unviewedCount}
          icon="clock"
        />
        <StatCard
          title="Viewed from Watchlist"
          value={watchlistMetrics.watchedFromWatchlist}
          icon="play"
        />
        <StatCard
          title="Conversion Rate"
          value={formatPercent(watchlistMetrics.conversionRate, 0)}
          icon="sparkles"
          variant="subtle"
        />
        <StatCard
          title="Avg Time on Watchlist"
          value={
            watchlistMetrics.averageAgeDays != null
              ? `${Math.round(watchlistMetrics.averageAgeDays)} days`
              : "—"
          }
          icon="calendar"
          variant="subtle"
        />
      </div>

      <SectionCard
        title="Intent Signals"
        subtitle="How recently you added titles"
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <Body className="text-sm font-semibold text-gray-900">
              Additions by month
            </Body>
            {watchlistMetrics.watchlistWithDatesCount > 0 ? (
              <div className="space-y-2">
                {watchlistMetrics.monthlyAdditions.map((entry) => (
                  <ProgressBar
                    key={entry.label}
                    label={`${entry.label} (${entry.count})`}
                    value={entry.count}
                    max={monthlyMax}
                    size="sm"
                    variant="success"
                  />
                ))}
              </div>
            ) : (
              <Body className="text-gray-500">
                Watchlist add dates are missing. Re-import to unlock recency
                signals.
              </Body>
            )}
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Body className="text-sm font-semibold text-gray-900">
                Recency mix
              </Body>
              <div className="space-y-2">
                <ProgressBar
                  label={`Fresh (≤90d)`}
                  value={watchlistMetrics.recencyBuckets.fresh}
                  max={watchlistMetrics.watchlistWithDatesCount || 1}
                  showPercentage
                  variant="success"
                  size="sm"
                />
                <ProgressBar
                  label={`Warm (91-180d)`}
                  value={watchlistMetrics.recencyBuckets.warm}
                  max={watchlistMetrics.watchlistWithDatesCount || 1}
                  showPercentage
                  variant="default"
                  size="sm"
                />
                <ProgressBar
                  label={`Cooling (181-365d)`}
                  value={watchlistMetrics.recencyBuckets.cool}
                  max={watchlistMetrics.watchlistWithDatesCount || 1}
                  showPercentage
                  variant="warning"
                  size="sm"
                />
                <ProgressBar
                  label={`Stale (366d+)`}
                  value={watchlistMetrics.recencyBuckets.stale}
                  max={watchlistMetrics.watchlistWithDatesCount || 1}
                  showPercentage
                  variant="danger"
                  size="sm"
                />
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
              <Body className="text-sm font-semibold text-gray-900">
                Watchlist momentum
              </Body>
              <Body className="text-sm text-gray-600">
                {watchlistMetrics.recentAdditions.last30} added in the last 30
                days · {watchlistMetrics.recentAdditions.previous30} in the
                prior 30 days
              </Body>
              <Body className="text-xs text-gray-500">
                {watchlistMetrics.recentAdditions.growthRate != null
                  ? `Growth: ${(watchlistMetrics.recentAdditions.growthRate * 100).toFixed(0)}%`
                  : "Growth rate needs more history"}
              </Body>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Taste Alignment"
        subtitle="How your watchlist aligns with viewing habits"
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <Body className="text-sm font-semibold text-gray-900">
              Watchlist genres
            </Body>
            {watchlistMetrics.watchlistGenreTags.length > 0 ? (
              <TagCloud
                tags={watchlistMetrics.watchlistGenreTags}
                maxTags={12}
                variant="gradient"
              />
            ) : (
              <Body className="text-gray-500">
                Genre insights require TMDB enrichment.
              </Body>
            )}
          </div>
          <div className="space-y-3">
            <Body className="text-sm font-semibold text-gray-900">
              Watched genre preferences
            </Body>
            {watchlistMetrics.watchedGenreTags.length > 0 ? (
              <TagCloud
                tags={watchlistMetrics.watchedGenreTags}
                maxTags={12}
                variant="solid"
              />
            ) : (
              <Body className="text-gray-500">
                Watch history genre data isn&apos;t available yet.
              </Body>
            )}
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
            <Body className="text-sm font-semibold text-gray-900">
              Alignment score
            </Body>
            <ProgressBar
              value={watchlistMetrics.genreAlignmentRate * 100}
              showPercentage
              variant="success"
            />
            <Body className="text-xs text-gray-500">
              Overlap between watchlist and watched genres
            </Body>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-1">
            <Body className="text-sm font-semibold text-gray-900">
              Genre diversity
            </Body>
            <Body className="text-xl font-semibold text-gray-900">
              {watchlistMetrics.genreDiversity.unique}
            </Body>
            <Body className="text-xs text-gray-500">
              Unique genres on your watchlist
            </Body>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-1">
            <Body className="text-sm font-semibold text-gray-900">
              Top genre share
            </Body>
            <Body className="text-xl font-semibold text-gray-900">
              {formatPercent(watchlistMetrics.genreDiversity.topShare, 0)}
            </Body>
            <Body className="text-xs text-gray-500">
              Concentration in most common genre
            </Body>
          </div>
        </div>

        {watchlistMetrics.explorationTags.length > 0 && (
          <div className="mt-6 space-y-2">
            <Body className="text-sm font-semibold text-gray-900">
              Exploration genres (not in recent viewing)
            </Body>
            <TagCloud
              tags={watchlistMetrics.explorationTags}
              maxTags={8}
              variant="solid"
            />
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Conversion Analysis"
        subtitle="From watchlist to watched"
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <Body className="text-sm font-semibold text-gray-900">
              Conversion performance
            </Body>
            <ProgressBar
              label="Watchlist → watched"
              value={watchlistMetrics.conversionRate * 100}
              showPercentage
              variant="success"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <StatCard
                title="Avg days to watch"
                value={
                  watchlistMetrics.averageDaysToWatch != null
                    ? Math.round(watchlistMetrics.averageDaysToWatch)
                    : "—"
                }
                icon="clock"
                variant="subtle"
              />
              <StatCard
                title="Median days to watch"
                value={
                  watchlistMetrics.medianDaysToWatch != null
                    ? Math.round(watchlistMetrics.medianDaysToWatch)
                    : "—"
                }
                icon="calendar"
                variant="subtle"
              />
            </div>
          </div>
          <div className="space-y-3">
            <Body className="text-sm font-semibold text-gray-900">
              Most common reasons for adding
            </Body>
            {watchlistMetrics.watchlistGenreTags.length > 0 ? (
              <TagCloud
                tags={watchlistMetrics.watchlistGenreTags}
                maxTags={10}
                variant="gradient"
              />
            ) : (
              <Body className="text-gray-500">
                Genre reasons will appear once enrichment is complete.
              </Body>
            )}
            <Body className="text-xs text-gray-500">
              Genres act as the strongest watchlist intent signals for matching
              recommendations.
            </Body>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
