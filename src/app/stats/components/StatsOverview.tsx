"use client";

import { useMemo } from "react";

import type { StatsTabProps } from "@/app/stats/types";
import { useStatsData } from "@/app/stats/hooks/useStatsData";
import { useTasteProfile } from "@/app/stats/hooks/useTasteProfile";
import { ProgressBar } from "@/app/stats/components/shared/ProgressBar";
import { SectionCard } from "@/app/stats/components/shared/SectionCard";
import { StatCard } from "@/app/stats/components/shared/StatCard";
import { TagCloud } from "@/app/stats/components/shared/TagCloud";
import { Body, Heading } from "@/components/ui";

const DAY_MS = 1000 * 60 * 60 * 24;

const isValidDate = (value: Date) => !Number.isNaN(value.getTime());

const formatDate = (value: Date) =>
  value.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

const formatPercent = (value: number) => `${Math.round(value)}%`;

export default function StatsOverview({
  timeFilter,
  filteredFilms,
  uid,
}: StatsTabProps) {
  const { tmdbDetails, filmMappings, mappingCoverage, isLoading, error } =
    useStatsData(uid, filteredFilms);

  const watchlistFilms = useMemo(
    () => filteredFilms.filter((film) => film.onWatchlist),
    [filteredFilms],
  );

  const {
    tasteProfile,
    isLoading: isTasteLoading,
    error: tasteError,
  } = useTasteProfile(
    filteredFilms,
    tmdbDetails,
    uid,
    filmMappings,
    watchlistFilms,
  );

  const overviewMetrics = useMemo(() => {
    const totalFilms = filteredFilms.length;
    const ratedFilms = filteredFilms.filter(
      (film) => film.rating != null,
    ).length;
    const ratedPercent = totalFilms
      ? Math.round((ratedFilms / totalFilms) * 100)
      : 0;
    const watchlistCount = watchlistFilms.length;

    const totalWatches = filteredFilms.reduce(
      (sum, film) => sum + (film.watchCount ?? 0),
      0,
    );

    const rewatchEntries = filteredFilms.reduce((sum, film) => {
      const watchCount = film.watchCount ?? 0;
      if (film.rewatch) return sum + Math.max(1, watchCount - 1);
      if (watchCount > 1) return sum + (watchCount - 1);
      return sum;
    }, 0);

    const ratingTotal = filteredFilms.reduce(
      (sum, film) => sum + (film.rating ?? 0),
      0,
    );
    const averageRating = ratedFilms
      ? Number((ratingTotal / ratedFilms).toFixed(2))
      : null;

    const validDates = filteredFilms
      .map((film) => (film.lastDate ? new Date(film.lastDate) : null))
      .filter((date): date is Date => Boolean(date && isValidDate(date)));

    const latestDate = validDates.length
      ? new Date(Math.max(...validDates.map((date) => date.getTime())))
      : null;
    const earliestDate = validDates.length
      ? new Date(Math.min(...validDates.map((date) => date.getTime())))
      : null;

    const daysSinceLatest = latestDate
      ? Math.floor((Date.now() - latestDate.getTime()) / DAY_MS)
      : null;

    const activeMonths = new Set(
      validDates.map((date) => `${date.getFullYear()}-${date.getMonth() + 1}`),
    ).size;

    const spanDays =
      latestDate && earliestDate
        ? Math.max(
            1,
            Math.round(
              (latestDate.getTime() - earliestDate.getTime()) / DAY_MS,
            ),
          )
        : null;

    const watchesPerMonth =
      activeMonths > 0 ? Number((totalWatches / activeMonths).toFixed(1)) : 0;

    return {
      totalFilms,
      ratedFilms,
      ratedPercent,
      watchlistCount,
      totalWatches,
      rewatchEntries,
      averageRating,
      latestDate,
      earliestDate,
      daysSinceLatest,
      activeMonths,
      spanDays,
      watchesPerMonth,
    };
  }, [filteredFilms, watchlistFilms.length]);

  const detailCoverage = useMemo(() => {
    if (!mappingCoverage || mappingCoverage.mapped === 0) return null;

    let withPoster = 0;
    let withOverview = 0;
    let withVotes = 0;

    for (const [uri, tmdbId] of filmMappings.entries()) {
      const details = tmdbDetails.get(tmdbId);
      if (!details) continue;
      if (details.poster_path) withPoster += 1;
      if (details.overview) withOverview += 1;
      if ((details.vote_count ?? 0) > 0) withVotes += 1;
    }

    return {
      withPoster,
      withOverview,
      withVotes,
      total: mappingCoverage.mapped,
    };
  }, [filmMappings, mappingCoverage, tmdbDetails]);

  const genreTags = useMemo(() => {
    if (!tasteProfile?.topGenres?.length) return [];
    const topGenres = tasteProfile.topGenres.slice(0, 5);
    const maxWeight = Math.max(...topGenres.map((genre) => genre.weight));
    return topGenres.map((genre) => ({
      label: genre.name,
      weight: maxWeight > 0 ? genre.weight / maxWeight : 0,
      count: genre.count,
    }));
  }, [tasteProfile]);

  const filterLabel =
    timeFilter === "all"
      ? "All time"
      : timeFilter === "year"
        ? "Past year"
        : "Past month";

  if (filteredFilms.length === 0) {
    return (
      <div className="space-y-6">
        <Heading level={2}>Overview</Heading>
        <SectionCard title="No data yet">
          <Body className="text-gray-600">
            Import your Letterboxd data or adjust your time filter to see stats.
          </Body>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Heading level={2}>Overview</Heading>
        <Body className="text-gray-500">{filterLabel} snapshot</Body>
        {(isLoading || isTasteLoading) && (
          <Body className="text-gray-500">Loading overview data...</Body>
        )}
        {(error || tasteError) && (
          <Body className="text-red-600">
            Some overview details could not be loaded. Please refresh if this
            persists.
          </Body>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Films Watched"
          value={overviewMetrics.totalFilms}
          icon="film"
          variant="highlight"
        />
        <StatCard
          title="Total Watches"
          value={overviewMetrics.totalWatches}
          icon="play"
          change={
            overviewMetrics.rewatchEntries > 0
              ? {
                  value: overviewMetrics.rewatchEntries,
                  trend: "neutral",
                  label: "rewatches",
                }
              : undefined
          }
        />
        <StatCard
          title="Average Rating"
          value={
            overviewMetrics.averageRating != null
              ? `${overviewMetrics.averageRating.toFixed(2)}★`
              : "—"
          }
          icon="star"
          change={
            overviewMetrics.ratedFilms > 0
              ? {
                  value: overviewMetrics.ratedPercent,
                  trend: "neutral",
                  label: "rated",
                }
              : undefined
          }
        />
        <StatCard
          title="On Watchlist"
          value={overviewMetrics.watchlistCount}
          icon="bookmark"
          variant="subtle"
        />
      </div>

      <SectionCard
        title="Data Coverage"
        subtitle="Metadata completeness for mapped films"
      >
        <div className="space-y-4">
          <ProgressBar
            label="TMDB Mapping"
            value={mappingCoverage?.mapped ?? 0}
            max={mappingCoverage?.total ?? 100}
            showPercentage
            variant="success"
          />
          <ProgressBar
            label="TMDB Details Loaded"
            value={tmdbDetails.size}
            max={mappingCoverage?.mapped ?? 100}
            showPercentage
            variant="default"
          />
          {detailCoverage && detailCoverage.total > 0 && (
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1">
                <Body className="text-sm text-gray-500">Poster coverage</Body>
                <Body className="font-semibold text-gray-900">
                  {formatPercent(
                    (detailCoverage.withPoster / detailCoverage.total) * 100,
                  )}
                </Body>
              </div>
              <div className="space-y-1">
                <Body className="text-sm text-gray-500">Overview coverage</Body>
                <Body className="font-semibold text-gray-900">
                  {formatPercent(
                    (detailCoverage.withOverview / detailCoverage.total) * 100,
                  )}
                </Body>
              </div>
              <div className="space-y-1">
                <Body className="text-sm text-gray-500">
                  Vote data coverage
                </Body>
                <Body className="font-semibold text-gray-900">
                  {formatPercent(
                    (detailCoverage.withVotes / detailCoverage.total) * 100,
                  )}
                </Body>
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Viewing Patterns" subtitle="Recent activity trends">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Body className="text-sm text-gray-500">Most recent activity</Body>
            <Body className="font-semibold text-gray-900">
              {overviewMetrics.latestDate
                ? `${formatDate(overviewMetrics.latestDate)} (${overviewMetrics.daysSinceLatest} days ago)`
                : "No recent activity"}
            </Body>
          </div>
          <div className="space-y-2">
            <Body className="text-sm text-gray-500">Active months</Body>
            <Body className="font-semibold text-gray-900">
              {overviewMetrics.activeMonths} months ·{" "}
              {overviewMetrics.watchesPerMonth} watches/month
            </Body>
          </div>
          <div className="space-y-2">
            <Body className="text-sm text-gray-500">Activity window</Body>
            <Body className="font-semibold text-gray-900">
              {overviewMetrics.earliestDate && overviewMetrics.latestDate
                ? `${formatDate(overviewMetrics.earliestDate)} → ${formatDate(overviewMetrics.latestDate)}`
                : "—"}
            </Body>
          </div>
          <div className="space-y-2">
            <Body className="text-sm text-gray-500">Data freshness</Body>
            <Body className="font-semibold text-gray-900">
              {overviewMetrics.daysSinceLatest != null
                ? overviewMetrics.daysSinceLatest <= 30
                  ? "Fresh (last 30 days)"
                  : overviewMetrics.daysSinceLatest <= 90
                    ? "Recent (last 90 days)"
                    : overviewMetrics.daysSinceLatest <= 365
                      ? "Aging (last year)"
                      : "Stale (over a year)"
                : "Unknown"}
            </Body>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Quick Insights" subtitle="Top genres at a glance">
        {genreTags.length > 0 ? (
          <TagCloud tags={genreTags} maxTags={5} variant="gradient" />
        ) : (
          <Body className="text-gray-500">
            Taste insights will appear once TMDB enrichment finishes.
          </Body>
        )}
      </SectionCard>
    </div>
  );
}
