"use client";

import { useDeferredValue, useMemo } from "react";

import type { StatsTabProps } from "@/app/stats/types";
import { useStatsData } from "@/app/stats/hooks/useStatsData";
import { ProgressBar } from "@/app/stats/components/shared/ProgressBar";
import { SectionCard } from "@/app/stats/components/shared/SectionCard";
import { StatCard } from "@/app/stats/components/shared/StatCard";
import { Body, Heading } from "@/components/ui";
import Chart from "@/components/Chart";

type Granularity = "day" | "week" | "month";

type PeriodSummary = {
  date: Date;
  key: string;
  label: string;
  watchCount: number;
  ratedCount: number;
  ratingTotal: number;
  rewatchEntries: number;
};

type HistoryMetrics = {
  totalWatches: number;
  totalFilms: number;
  ratedFilms: number;
  averageRating: number | null;
  rewatchEntries: number;
  rewatchRate: number;
  activeDays: number;
  longestStreak: number;
  currentStreak: number;
  busiestPeriod: PeriodSummary | null;
  averagePerPeriod: number;
  dayOfWeekCounts: Array<{ day: string; count: number }>;
  periodSeries: PeriodSummary[];
  topRatingPeriods: Array<{
    label: string;
    averageRating: number;
    ratedCount: number;
  }>;
  topDays: Array<{ label: string; count: number }>;
  heatmapCells: Array<{ date: Date; count: number; key: string }>;
  heatmapMax: number;
};

type ChartOption = Record<string, unknown>;

const DAY_MS = 1000 * 60 * 60 * 24;
const WEEK_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const isValidDate = (value: Date) => !Number.isNaN(value.getTime());

const formatDate = (value: Date) =>
  value.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

const formatShortDate = (value: Date) =>
  `${MONTHS[value.getMonth()]} ${value.getDate()}`;

const formatMonthLabel = (value: Date) =>
  `${MONTHS[value.getMonth()]} ${value.getFullYear()}`;

const getGranularity = (
  timeFilter: StatsTabProps["timeFilter"],
): Granularity => {
  if (timeFilter === "month") return "day";
  if (timeFilter === "year") return "week";
  return "month";
};

const getStartOfWeek = (value: Date) => {
  const date = new Date(value);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
};

const getPeriodKey = (value: Date, granularity: Granularity) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");

  if (granularity === "day") return `${year}-${month}-${day}`;
  if (granularity === "week") {
    const start = getStartOfWeek(value);
    const startMonth = `${start.getMonth() + 1}`.padStart(2, "0");
    const startDay = `${start.getDate()}`.padStart(2, "0");
    return `${start.getFullYear()}-${startMonth}-${startDay}`;
  }
  return `${year}-${month}`;
};

const parsePeriodDate = (key: string, granularity: Granularity) => {
  if (granularity === "month") {
    const [year, month] = key.split("-").map(Number);
    return new Date(year, (month ?? 1) - 1, 1);
  }
  return new Date(key);
};

const formatPeriodLabel = (value: Date, granularity: Granularity) => {
  if (granularity === "day") return formatShortDate(value);
  if (granularity === "week") return `Week of ${formatShortDate(value)}`;
  return formatMonthLabel(value);
};

const getIntensityClass = (ratio: number) => {
  if (ratio <= 0) return "bg-gray-100 dark:bg-gray-700";
  if (ratio <= 0.25) return "bg-emerald-100 dark:bg-emerald-900/40";
  if (ratio <= 0.5) return "bg-emerald-300 dark:bg-emerald-700/60";
  if (ratio <= 0.75) return "bg-emerald-500 dark:bg-emerald-600";
  return "bg-emerald-700 dark:bg-emerald-500";
};

export default function WatchHistoryTab({
  timeFilter,
  filteredFilms,
  uid,
}: StatsTabProps) {
  const { isLoading, error } = useStatsData(uid, filteredFilms);

  const historyMetrics = useMemo<HistoryMetrics>(() => {
    const validEntries = filteredFilms
      .map((film) => {
        if (!film.lastDate) return null;
        const date = new Date(film.lastDate);
        if (!isValidDate(date)) return null;
        return { film, date };
      })
      .filter(
        (
          entry,
        ): entry is { film: (typeof filteredFilms)[number]; date: Date } =>
          Boolean(entry),
      );

    const totalFilms = filteredFilms.length;
    const totalWatches = filteredFilms.reduce((sum, film) => {
      if (typeof film.watchCount === "number") {
        return sum + Math.max(0, film.watchCount);
      }
      return sum + 1;
    }, 0);

    const ratedFilms = filteredFilms.filter(
      (film) => film.rating != null,
    ).length;
    const ratingTotal = filteredFilms.reduce(
      (sum, film) => sum + (film.rating ?? 0),
      0,
    );

    const averageRating = ratedFilms > 0 ? ratingTotal / ratedFilms : null;

    const rewatchEntries = filteredFilms.reduce((sum, film) => {
      const watchCount = film.watchCount ?? 0;
      if (film.rewatch) return sum + Math.max(1, watchCount - 1);
      if (watchCount > 1) return sum + (watchCount - 1);
      return sum;
    }, 0);

    const rewatchRate = totalWatches > 0 ? rewatchEntries / totalWatches : 0;

    const dailyMap = new Map<string, number>();
    const dayOfWeekCounts = new Array(7).fill(0) as number[];
    const periodMap = new Map<string, PeriodSummary>();
    const granularity = getGranularity(timeFilter);

    validEntries.forEach(({ film, date }) => {
      const watchCount =
        typeof film.watchCount === "number" ? Math.max(0, film.watchCount) : 1;
      const dayKey = getPeriodKey(date, "day");
      dailyMap.set(dayKey, (dailyMap.get(dayKey) ?? 0) + watchCount);

      const weekday = date.getDay();
      dayOfWeekCounts[weekday] += watchCount;

      const periodKey = getPeriodKey(date, granularity);
      const periodDate = parsePeriodDate(periodKey, granularity);
      const existing = periodMap.get(periodKey) ?? {
        date: periodDate,
        key: periodKey,
        label: formatPeriodLabel(periodDate, granularity),
        watchCount: 0,
        ratedCount: 0,
        ratingTotal: 0,
        rewatchEntries: 0,
      };

      existing.watchCount += watchCount;
      if (film.rating != null) {
        existing.ratedCount += 1;
        existing.ratingTotal += film.rating;
      }
      if (film.rewatch) {
        existing.rewatchEntries += Math.max(1, watchCount - 1);
      } else if (watchCount > 1) {
        existing.rewatchEntries += watchCount - 1;
      }
      periodMap.set(periodKey, existing);
    });

    const periodSeries = Array.from(periodMap.values()).sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    );

    const busiestPeriod = periodSeries.reduce<PeriodSummary | null>(
      (max, entry) => (max && max.watchCount >= entry.watchCount ? max : entry),
      null,
    );

    const activeDays = dailyMap.size;

    const sortedDays = Array.from(dailyMap.keys())
      .map((key) => new Date(key))
      .filter(isValidDate)
      .sort((a, b) => a.getTime() - b.getTime());

    let longestStreak = 0;
    let currentStreak = 0;
    let streak = 0;
    let previous: Date | null = null;

    sortedDays.forEach((date) => {
      if (!previous) {
        streak = 1;
      } else {
        const diffDays = Math.round(
          (date.getTime() - previous.getTime()) / DAY_MS,
        );
        streak = diffDays === 1 ? streak + 1 : 1;
      }
      if (streak > longestStreak) longestStreak = streak;
      previous = date;
    });

    if (sortedDays.length > 0) {
      const latest = sortedDays[sortedDays.length - 1];
      const daysSinceLatest = Math.floor(
        (Date.now() - latest.getTime()) / DAY_MS,
      );
      if (daysSinceLatest <= 1) {
        let tempStreak = 0;
        for (let i = sortedDays.length - 1; i >= 0; i -= 1) {
          const current = sortedDays[i];
          const next = sortedDays[i + 1];
          if (!next) {
            tempStreak = 1;
            continue;
          }
          const diffDays = Math.round(
            (next.getTime() - current.getTime()) / DAY_MS,
          );
          if (diffDays === 1) tempStreak += 1;
          else break;
        }
        currentStreak = tempStreak;
      }
    }

    const averagePerPeriod = periodSeries.length
      ? Number((totalWatches / periodSeries.length).toFixed(1))
      : 0;

    const dayOfWeekData = WEEK_DAYS.map((day, index) => ({
      day,
      count: dayOfWeekCounts[index] ?? 0,
    })).sort((a, b) => b.count - a.count);

    const topRatingPeriods = periodSeries
      .filter((entry) => entry.ratedCount > 0)
      .map((entry) => ({
        label: entry.label,
        averageRating: entry.ratingTotal / entry.ratedCount,
        ratedCount: entry.ratedCount,
      }))
      .sort((a, b) => b.averageRating - a.averageRating)
      .slice(0, 6);

    const topDays = Array.from(dailyMap.entries())
      .map(([key, count]) => ({ label: key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((entry) => ({
        label: formatDate(new Date(entry.label)),
        count: entry.count,
      }));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - 90);
    const startOfCalendar = getStartOfWeek(start);

    const heatmapCells: Array<{ date: Date; count: number; key: string }> = [];
    for (let i = 0; i < 91; i += 1) {
      const date = new Date(startOfCalendar);
      date.setDate(startOfCalendar.getDate() + i);
      const key = getPeriodKey(date, "day");
      heatmapCells.push({
        date,
        key,
        count: dailyMap.get(key) ?? 0,
      });
    }

    const heatmapMax = heatmapCells.reduce(
      (max, cell) => Math.max(max, cell.count),
      0,
    );

    return {
      totalWatches,
      totalFilms,
      ratedFilms,
      averageRating,
      rewatchEntries,
      rewatchRate,
      activeDays,
      longestStreak,
      currentStreak,
      busiestPeriod,
      averagePerPeriod,
      dayOfWeekCounts: dayOfWeekData,
      periodSeries,
      topRatingPeriods,
      topDays,
      heatmapCells,
      heatmapMax,
    };
  }, [filteredFilms, timeFilter]);

  const deferredPeriodSeries = useDeferredValue(historyMetrics.periodSeries);
  const deferredRatingPeriods = useDeferredValue(
    historyMetrics.topRatingPeriods,
  );

  const watchSeries = useMemo(() => {
    const labels = deferredPeriodSeries.map((entry) => entry.label);
    const values = deferredPeriodSeries.map((entry) => entry.watchCount);

    return {
      labels,
      values,
    };
  }, [deferredPeriodSeries]);

  const ratingSeries = useMemo(() => {
    return deferredPeriodSeries.map((entry) => ({
      label: entry.label,
      average: entry.ratedCount > 0 ? entry.ratingTotal / entry.ratedCount : 0,
    }));
  }, [deferredPeriodSeries]);

  const viewingOption = useMemo<ChartOption>(() => {
    return {
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: watchSeries.labels,
        axisLabel: {
          interval:
            watchSeries.labels.length > 12
              ? Math.floor(watchSeries.labels.length / 8)
              : 0,
        },
      },
      yAxis: { type: "value" },
      series: [
        {
          type: "line",
          data: watchSeries.values,
          smooth: true,
          itemStyle: { color: "#10b981" },
          areaStyle: { opacity: 0.2 },
        },
      ],
    };
  }, [watchSeries.labels, watchSeries.values]);

  const ratingOption = useMemo<ChartOption>(() => {
    return {
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: ratingSeries.map((entry) => entry.label),
        axisLabel: {
          interval:
            ratingSeries.length > 12 ? Math.floor(ratingSeries.length / 8) : 0,
        },
      },
      yAxis: { type: "value", min: 0, max: 5 },
      series: [
        {
          type: "bar",
          data: ratingSeries.map((entry) => Number(entry.average.toFixed(2))),
          itemStyle: { color: "#6366f1" },
        },
      ],
    };
  }, [ratingSeries]);

  const filterLabel =
    timeFilter === "all"
      ? "All time"
      : timeFilter === "year"
        ? "Past year"
        : "Past month";

  if (filteredFilms.length === 0) {
    return (
      <div className="space-y-6">
        <Heading level={2}>Watch History</Heading>
        <SectionCard title="No watch history yet">
          <Body className="text-gray-600">
            Import your Letterboxd diary or adjust your time filter to see
            viewing patterns.
          </Body>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Heading level={2}>Watch History</Heading>
        <Body className="text-gray-500">{filterLabel} activity</Body>
        {isLoading && <Body className="text-gray-500">Loading charts...</Body>}
        {error && (
          <Body className="text-red-600">
            Some watch history details could not be loaded.
          </Body>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Total Watches"
          value={historyMetrics.totalWatches}
          icon="play"
          variant="highlight"
        />
        <StatCard
          title="Active Days"
          value={historyMetrics.activeDays}
          icon="calendar"
          change={
            historyMetrics.longestStreak > 0
              ? {
                  value: historyMetrics.longestStreak,
                  trend: "neutral",
                  label: "longest streak",
                }
              : undefined
          }
        />
        <StatCard
          title="Rewatch Rate"
          value={`${Math.round(historyMetrics.rewatchRate * 100)}%`}
          icon="refresh"
          variant="subtle"
          change={
            historyMetrics.rewatchEntries > 0
              ? {
                  value: historyMetrics.rewatchEntries,
                  trend: "neutral",
                  label: "rewatch entries",
                }
              : undefined
          }
        />
      </div>

      <SectionCard
        title="Viewing Over Time"
        subtitle="Watches per period"
        collapsible
        defaultOpen
      >
        {watchSeries.labels.length > 1 ? (
          <Chart option={viewingOption} />
        ) : (
          <Body className="text-gray-500">
            Not enough dated entries to chart a timeline yet.
          </Body>
        )}
        {historyMetrics.busiestPeriod && (
          <div className="mt-4 text-sm text-gray-600">
            Most active period: {historyMetrics.busiestPeriod.label} ·{" "}
            {historyMetrics.busiestPeriod.watchCount} watches
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Viewing Calendar"
        subtitle="Last 13 weeks"
        collapsible
      >
        <div className="flex flex-col gap-3">
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}
          >
            {historyMetrics.heatmapCells.map((cell) => {
              const ratio =
                historyMetrics.heatmapMax > 0
                  ? cell.count / historyMetrics.heatmapMax
                  : 0;
              return (
                <div
                  key={cell.key}
                  title={`${formatDate(cell.date)}: ${cell.count} watch${cell.count === 1 ? "" : "es"}`}
                  className={`h-3 w-3 rounded-sm ${getIntensityClass(ratio)}`}
                />
              );
            })}
          </div>
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Less</span>
            <div className="flex items-center gap-1">
              {[0, 0.25, 0.5, 0.75, 1].map((value) => (
                <span
                  key={value}
                  className={`h-2.5 w-2.5 rounded-sm ${getIntensityClass(value)}`}
                />
              ))}
            </div>
            <span>More</span>
          </div>
          {/* TODO: Add ECharts calendar heatmap */}
        </div>
      </SectionCard>

      <SectionCard
        title="Ratings Over Time"
        subtitle="Average rating by period"
        collapsible
      >
        {ratingSeries.length > 1 ? (
          <Chart option={ratingOption} />
        ) : (
          <Body className="text-gray-500">
            Rate more films to see trends over time.
          </Body>
        )}
        {deferredRatingPeriods.length > 0 && (
          <div className="mt-4 space-y-2">
            <Body className="text-sm text-gray-500">Top-rated periods</Body>
            {deferredRatingPeriods.map((entry) => (
              <ProgressBar
                key={entry.label}
                label={`${entry.label} (${entry.ratedCount} ratings)`}
                value={entry.averageRating}
                max={5}
                showPercentage={false}
                variant="default"
              />
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Viewing Patterns" subtitle="Habits and streaks">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <Body className="text-sm text-gray-500">Current streak</Body>
            <Body className="text-xl font-semibold text-gray-900">
              {historyMetrics.currentStreak > 0
                ? `${historyMetrics.currentStreak} day${
                    historyMetrics.currentStreak === 1 ? "" : "s"
                  }`
                : "No active streak"}
            </Body>
            <Body className="text-sm text-gray-500">
              Longest streak: {historyMetrics.longestStreak} days
            </Body>
          </div>
          <div className="space-y-3">
            <Body className="text-sm text-gray-500">Most active day</Body>
            {historyMetrics.dayOfWeekCounts[0] ? (
              <Body className="text-xl font-semibold text-gray-900">
                {historyMetrics.dayOfWeekCounts[0].day}
              </Body>
            ) : (
              <Body className="text-gray-500">No activity yet</Body>
            )}
            <div className="space-y-2">
              {historyMetrics.dayOfWeekCounts.slice(0, 5).map((entry) => (
                <ProgressBar
                  key={entry.day}
                  label={entry.day}
                  value={entry.count}
                  max={historyMetrics.dayOfWeekCounts[0]?.count ?? 1}
                  showPercentage
                  variant="success"
                />
              ))}
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Top Watch Days"
        subtitle="Peak viewing days"
        collapsible
      >
        {historyMetrics.topDays.length > 0 ? (
          <div className="space-y-3">
            {historyMetrics.topDays.map((entry) => (
              <div
                key={entry.label}
                className="flex items-center justify-between text-sm text-gray-600"
              >
                <span>{entry.label}</span>
                <span className="font-semibold text-gray-900">
                  {entry.count} watches
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Body className="text-gray-500">
            Log more diary entries to see peaks.
          </Body>
        )}
      </SectionCard>
    </div>
  );
}
