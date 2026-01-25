"use client";

import { useMemo } from "react";

import type {
  ConsensusAcceptance,
  FeedbackRow,
  ReasonAcceptance,
  SourceReliability,
  StatsTabProps,
} from "@/app/stats/types";
import { useFeedbackAnalytics } from "@/app/stats/hooks/useFeedbackAnalytics";
import { ProgressBar } from "@/app/stats/components/shared/ProgressBar";
import { SectionCard } from "@/app/stats/components/shared/SectionCard";
import { StatCard } from "@/app/stats/components/shared/StatCard";
import { TagCloud, type Tag } from "@/app/stats/components/shared/TagCloud";
import { Body, Heading } from "@/components/ui";

const DAY_MS = 1000 * 60 * 60 * 24;

const formatPercent = (value: number, digits = 1) =>
  `${(value * 100).toFixed(digits)}%`;

const formatSourceName = (source: string) => {
  const normalized = source.trim();
  const lower = normalized.toLowerCase();
  if (lower === "tmdb") return "TMDB";
  if (lower === "trakt") return "Trakt";
  if (lower === "tuimdb") return "TuIMDb";
  if (lower === "letterboxd") return "Letterboxd";
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
};

const reliabilityVariant = (rate: number) => {
  if (rate >= 0.7) return "success";
  if (rate >= 0.5) return "warning";
  return "danger" as const;
};

const getTrendLabel = (rateChange: number) => {
  if (rateChange > 0.02) return "up";
  if (rateChange < -0.02) return "down";
  return "neutral";
};

const toDisplayCount = (value: number) => value.toLocaleString();

const buildReasonTags = (
  reasons: ReasonAcceptance[],
  variant: "accepted" | "rejected",
  max = 12,
): Tag[] => {
  if (reasons.length === 0) return [];
  const sorted = [...reasons].sort((a, b) => b.total - a.total).slice(0, max);
  const getWeight = (entry: ReasonAcceptance) =>
    variant === "accepted" ? entry.hitRate : 1 - entry.hitRate;
  const maxWeight = Math.max(...sorted.map(getWeight));
  return sorted.map((entry) => ({
    label: entry.reason,
    weight: maxWeight > 0 ? getWeight(entry) / maxWeight : 0,
    count: entry.total,
  }));
};

const getConsensusRate = (bucket: { pos: number; total: number }) =>
  bucket.total > 0 ? bucket.pos / bucket.total : null;

const sumConsensusTotals = (consensus: ConsensusAcceptance | null) =>
  consensus
    ? consensus.high.total + consensus.medium.total + consensus.low.total
    : 0;

const buildConsensusSummary = (
  consensus: ConsensusAcceptance | null,
): Array<{
  key: "high" | "medium" | "low";
  label: string;
  rate: number | null;
  total: number;
}> => {
  if (!consensus) return [];
  return [
    {
      key: "high",
      label: "High (3+ sources)",
      rate: getConsensusRate(consensus.high),
      total: consensus.high.total,
    },
    {
      key: "medium",
      label: "Medium (2 sources)",
      rate: getConsensusRate(consensus.medium),
      total: consensus.medium.total,
    },
    {
      key: "low",
      label: "Low (1 source)",
      rate: getConsensusRate(consensus.low),
      total: consensus.low.total,
    },
  ];
};

const resolveMostReliableConsensus = (
  summary: ReturnType<typeof buildConsensusSummary>,
) => {
  const withRates = summary.filter((entry) => entry.rate !== null);
  if (withRates.length === 0) return null;
  return withRates.reduce((best, current) =>
    (current.rate ?? 0) > (best.rate ?? 0) ? current : best,
  );
};

const computeWeightedAverage = (sources: SourceReliability[]) => {
  const total = sources.reduce((sum, entry) => sum + entry.total, 0);
  if (total === 0) return 0;
  const weighted = sources.reduce(
    (sum, entry) => sum + entry.hitRate * entry.total,
    0,
  );
  return weighted / total;
};

const buildMonthlyTrend = (rows: FeedbackRow[], maxMonths: number) => {
  if (rows.length === 0) return [];
  const now = new Date();
  const monthBuckets = new Map<
    string,
    { label: string; total: number; positive: number }
  >();

  for (let i = 0; i < maxMonths; i += 1) {
    const month = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${month.getFullYear()}-${month.getMonth()}`;
    const label = month.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
    monthBuckets.set(key, { label, total: 0, positive: 0 });
  }

  rows.forEach((row) => {
    if (!row.created_at) return;
    const date = new Date(row.created_at);
    if (Number.isNaN(date.getTime())) return;
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const bucket = monthBuckets.get(key);
    if (!bucket) return;
    bucket.total += 1;
    if (row.feedback_type === "positive") bucket.positive += 1;
  });

  return Array.from(monthBuckets.values()).reverse();
};

const computeRateTrend = (rows: FeedbackRow[]) => {
  if (rows.length === 0) return null;
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * DAY_MS;
  const sixtyDaysAgo = now - 60 * DAY_MS;

  const recent = rows.filter((row) => {
    if (!row.created_at) return false;
    const ts = new Date(row.created_at).getTime();
    return ts >= thirtyDaysAgo;
  });

  const previous = rows.filter((row) => {
    if (!row.created_at) return false;
    const ts = new Date(row.created_at).getTime();
    return ts >= sixtyDaysAgo && ts < thirtyDaysAgo;
  });

  const rate = (items: FeedbackRow[]) => {
    if (items.length === 0) return 0;
    const positives = items.filter((row) => row.feedback_type === "positive");
    return positives.length / items.length;
  };

  const recentRate = rate(recent);
  const previousRate = rate(previous);
  return {
    recentRate,
    previousRate,
    change: recentRate - previousRate,
    recentCount: recent.length,
    previousCount: previous.length,
  };
};

export default function AlgorithmInsightsTab({
  timeFilter,
  filteredFilms,
  uid,
}: StatsTabProps) {
  const {
    feedbackSummary,
    sourceReliability,
    pairwiseStats,
    consensusAcceptance,
    reasonAcceptance,
    isLoading,
    error,
    sourceReliabilityRecent,
    sourceConsensus,
    feedbackRows,
  } = useFeedbackAnalytics(uid, timeFilter);

  const filterLabel =
    timeFilter === "all"
      ? "All time"
      : timeFilter === "year"
        ? "Past year"
        : "Past month";

  const feedbackMetrics = useMemo(() => {
    const total = feedbackSummary?.total ?? 0;
    const positive = feedbackSummary?.positive ?? 0;
    const negative = feedbackSummary?.negative ?? 0;
    const acceptanceRate = feedbackSummary?.hitRate ?? 0;
    const rejectionRate = total > 0 ? negative / total : 0;

    const sortedByDate = [...feedbackRows].sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bTime - aTime;
    });
    let streak = 0;
    for (const row of sortedByDate) {
      if (row.feedback_type !== "positive") break;
      streak += 1;
    }

    const explorationCount = feedbackRows.filter(
      (row) => (row.consensus_level ?? "low") === "low",
    ).length;

    return {
      total,
      positive,
      negative,
      acceptanceRate,
      rejectionRate,
      streak,
      explorationCount,
    };
  }, [feedbackRows, feedbackSummary]);

  const sortedSources = useMemo(() => {
    return [...sourceReliability].sort((a, b) => {
      if (b.hitRate === a.hitRate) return b.total - a.total;
      return b.hitRate - a.hitRate;
    });
  }, [sourceReliability]);

  const sourceTrendMap = useMemo(() => {
    const map = new Map<string, SourceReliability>();
    sourceReliabilityRecent.forEach((entry) => {
      map.set(entry.source.toLowerCase(), entry);
    });
    return map;
  }, [sourceReliabilityRecent]);

  const sourceSummary = useMemo(() => {
    const weightedAverage = computeWeightedAverage(sortedSources);
    const totalSamples = sortedSources.reduce(
      (sum, entry) => sum + entry.total,
      0,
    );
    return { weightedAverage, totalSamples };
  }, [sortedSources]);

  const consensusSummary = useMemo(
    () => buildConsensusSummary(consensusAcceptance),
    [consensusAcceptance],
  );

  const mostReliableConsensus = useMemo(
    () => resolveMostReliableConsensus(consensusSummary),
    [consensusSummary],
  );

  const reasonAcceptedTags = useMemo(
    () => buildReasonTags(reasonAcceptance, "accepted", 12),
    [reasonAcceptance],
  );

  const reasonRejectedTags = useMemo(
    () => buildReasonTags(reasonAcceptance, "rejected", 12),
    [reasonAcceptance],
  );

  const reasonEffectiveness = useMemo(() => {
    if (reasonAcceptance.length === 0) return [];
    return [...reasonAcceptance]
      .sort((a, b) => b.hitRate - a.hitRate)
      .slice(0, 8)
      .map((entry) => ({
        reason: entry.reason,
        hitRate: entry.hitRate,
        total: entry.total,
      }));
  }, [reasonAcceptance]);

  const learningTrend = useMemo(() => {
    const maxMonths =
      timeFilter === "month" ? 3 : timeFilter === "year" ? 12 : 18;
    return buildMonthlyTrend(feedbackRows, maxMonths);
  }, [feedbackRows, timeFilter]);

  const rateTrend = useMemo(
    () => computeRateTrend(feedbackRows),
    [feedbackRows],
  );

  const explorationBalance = useMemo(() => {
    const total = feedbackSummary?.total ?? 0;
    if (!consensusAcceptance || total === 0) {
      return {
        explorationRate: 0,
        exploitationRate: 0,
        explorationCount: 0,
      };
    }
    const explorationCount = consensusAcceptance.low.total;
    const explorationRate = total > 0 ? explorationCount / total : 0;
    return {
      explorationRate,
      exploitationRate: 1 - explorationRate,
      explorationCount,
    };
  }, [consensusAcceptance, feedbackSummary?.total]);

  const hasFeedback = feedbackSummary?.total && feedbackSummary.total > 0;

  if (isLoading) {
    return <div className="p-6">Loading algorithm insights...</div>;
  }

  if (!hasFeedback && filteredFilms.length === 0) {
    return (
      <div className="space-y-6">
        <Heading level={2}>Algorithm Insights</Heading>
        <SectionCard title="No data yet">
          <Body className="text-gray-600">
            Import your Letterboxd data or interact with suggestions to see
            algorithm insights.
          </Body>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Heading level={2}>Algorithm Insights</Heading>
        <Body className="text-gray-500">
          Behavioral feedback · {filterLabel}
        </Body>
        {error && (
          <Body className="text-red-600">
            Some algorithm insights couldn&apos;t load. Please refresh if this
            persists.
          </Body>
        )}
      </div>

      <SectionCard
        title="Feedback Overview"
        subtitle="How your thumbs-up/down guide recommendations"
      >
        {feedbackSummary ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
              <StatCard
                title="Total Feedback"
                value={toDisplayCount(feedbackMetrics.total)}
                icon="thumbs-up"
                variant="highlight"
              />
              <StatCard
                title="Acceptance Rate"
                value={formatPercent(feedbackMetrics.acceptanceRate, 1)}
                icon="sparkles"
                change={
                  rateTrend
                    ? {
                        value: Number((rateTrend.change * 100).toFixed(1)),
                        trend: getTrendLabel(rateTrend.change),
                        label: "vs prior 30d",
                      }
                    : undefined
                }
              />
              <StatCard
                title="Rejection Rate"
                value={formatPercent(feedbackMetrics.rejectionRate, 1)}
                icon="x"
                variant="subtle"
              />
              <StatCard
                title="Exploration Picks"
                value={feedbackMetrics.explorationCount}
                icon="compass"
                change={
                  feedbackMetrics.total > 0
                    ? {
                        value: Math.round(
                          (feedbackMetrics.explorationCount /
                            feedbackMetrics.total) *
                            100,
                        ),
                        trend: "neutral",
                        label: "% of feedback",
                      }
                    : undefined
                }
              />
              <StatCard
                title="Learning Streak"
                value={feedbackMetrics.streak}
                icon="flame"
                variant="subtle"
                change={
                  feedbackMetrics.streak > 0
                    ? {
                        value: feedbackMetrics.streak,
                        trend: "up",
                        label: "positive picks",
                      }
                    : undefined
                }
              />
            </div>

            {rateTrend && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1">
                    <Body className="text-sm text-gray-500">
                      Last 30 days acceptance
                    </Body>
                    <Body className="font-semibold text-gray-900">
                      {formatPercent(rateTrend.recentRate, 1)} ·{" "}
                      {rateTrend.recentCount} picks
                    </Body>
                  </div>
                  <div className="space-y-1">
                    <Body className="text-sm text-gray-500">
                      Prior 30 days acceptance
                    </Body>
                    <Body className="font-semibold text-gray-900">
                      {formatPercent(rateTrend.previousRate, 1)} ·{" "}
                      {rateTrend.previousCount} picks
                    </Body>
                  </div>
                  <div className="space-y-1">
                    <Body className="text-sm text-gray-500">Momentum</Body>
                    <Body className="font-semibold text-gray-900">
                      {rateTrend.change >= 0 ? "+" : ""}
                      {(rateTrend.change * 100).toFixed(1)}% change
                    </Body>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <Body className="text-gray-500">
            No feedback data yet. Start rating suggestions to see performance
            insights.
          </Body>
        )}
      </SectionCard>

      <SectionCard
        title="Source Performance"
        subtitle="How each recommendation source is performing"
      >
        {sortedSources.length > 0 ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {sortedSources.slice(0, 6).map((source) => {
                const recent = sourceTrendMap.get(source.source.toLowerCase());
                const delta = recent ? recent.hitRate - source.hitRate : null;
                return (
                  <div
                    key={source.source}
                    className="space-y-2 rounded-lg border border-gray-200 bg-white p-4"
                  >
                    <div className="flex items-center justify-between">
                      <Body className="font-semibold text-gray-900">
                        {formatSourceName(source.source)}
                      </Body>
                      <Body className="text-sm text-gray-500">
                        {source.total} samples
                      </Body>
                    </div>
                    <ProgressBar
                      label="Reliability"
                      value={source.hitRate * 100}
                      showPercentage
                      variant={reliabilityVariant(source.hitRate)}
                    />
                    {delta !== null && recent && (
                      <Body className="text-xs text-gray-500">
                        Recent 90d: {formatPercent(recent.hitRate, 1)} ·
                        {delta >= 0 ? " +" : " "}
                        {(delta * 100).toFixed(1)}% change
                      </Body>
                    )}
                  </div>
                );
              })}
            </div>

            {sortedSources.length > 6 && (
              <Body className="text-xs text-gray-500">
                Showing top 6 sources. {sortedSources.length - 6} more available
                with smaller sample sizes.
              </Body>
            )}

            <div className="grid gap-4 md:grid-cols-3">
              <StatCard
                title="Weighted Reliability"
                value={formatPercent(sourceSummary.weightedAverage, 1)}
                icon="chart"
                variant="highlight"
              />
              <StatCard
                title="Total Samples"
                value={toDisplayCount(sourceSummary.totalSamples)}
                icon="database"
              />
              <StatCard
                title="Active Sources"
                value={sortedSources.length}
                icon="layers"
                variant="subtle"
              />
            </div>
          </div>
        ) : (
          <Body className="text-gray-500">
            Source reliability will appear once you provide suggestion feedback.
          </Body>
        )}
      </SectionCard>

      <SectionCard
        title="Consensus Analysis"
        subtitle="How multi-source agreement impacts acceptance"
      >
        {consensusSummary.length > 0 &&
        sumConsensusTotals(consensusAcceptance) > 0 ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              {consensusSummary.map((entry) => (
                <div
                  key={entry.key}
                  className="rounded-lg border border-gray-200 bg-white p-4 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <Body className="font-semibold text-gray-900">
                      {entry.label}
                    </Body>
                    <Body className="text-xs text-gray-500">
                      {entry.total} picks
                    </Body>
                  </div>
                  <ProgressBar
                    value={(entry.rate ?? 0) * 100}
                    showPercentage
                    variant={reliabilityVariant(entry.rate ?? 0)}
                  />
                  <Body className="text-xs text-gray-500">
                    {entry.rate != null
                      ? `${formatPercent(entry.rate, 1)} acceptance`
                      : "No feedback yet"}
                  </Body>
                </div>
              ))}
            </div>

            {mostReliableConsensus && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                <Body className="text-sm font-semibold text-emerald-900">
                  Most reliable consensus level: {mostReliableConsensus.label}
                </Body>
                <Body className="text-xs text-emerald-700">
                  {formatPercent(mostReliableConsensus.rate ?? 0, 1)} acceptance
                  · {mostReliableConsensus.total} samples
                </Body>
              </div>
            )}

            {sourceConsensus.length > 0 && (
              <div className="space-y-3">
                <Body className="text-sm font-semibold text-gray-900">
                  Source agreement by consensus level
                </Body>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {sourceConsensus.slice(0, 6).map((entry) => {
                    const highRate = getConsensusRate(entry.high);
                    const mediumRate = getConsensusRate(entry.medium);
                    const lowRate = getConsensusRate(entry.low);
                    return (
                      <div
                        key={entry.source}
                        className="rounded-lg border border-gray-200 bg-white p-4 space-y-2"
                      >
                        <Body className="font-semibold text-gray-900">
                          {formatSourceName(entry.source)}
                        </Body>
                        <div className="space-y-2 text-xs text-gray-500">
                          <div className="flex items-center justify-between">
                            <span>High consensus</span>
                            <span>
                              {highRate != null
                                ? formatPercent(highRate, 0)
                                : "—"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Medium consensus</span>
                            <span>
                              {mediumRate != null
                                ? formatPercent(mediumRate, 0)
                                : "—"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span>Low consensus</span>
                            <span>
                              {lowRate != null
                                ? formatPercent(lowRate, 0)
                                : "—"}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {sourceConsensus.length > 6 && (
                  <Body className="text-xs text-gray-500">
                    Showing top 6 sources by consensus volume. Explore more
                    sources as feedback grows.
                  </Body>
                )}
              </div>
            )}
          </div>
        ) : (
          <Body className="text-gray-500">
            Consensus insights will appear once there is enough feedback across
            multiple sources.
          </Body>
        )}
      </SectionCard>

      <SectionCard
        title="Reason Acceptance"
        subtitle="Why recommendations land or miss"
      >
        {reasonAcceptance.length > 0 ? (
          <div className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <Body className="text-sm font-semibold text-gray-900">
                  Top accepted reasons
                </Body>
                {reasonAcceptedTags.length > 0 ? (
                  <TagCloud
                    tags={reasonAcceptedTags}
                    maxTags={12}
                    variant="gradient"
                  />
                ) : (
                  <Body className="text-gray-500">
                    No accepted reasons yet.
                  </Body>
                )}
              </div>
              <div className="space-y-2">
                <Body className="text-sm font-semibold text-gray-900">
                  Top rejected reasons
                </Body>
                {reasonRejectedTags.length > 0 ? (
                  <TagCloud
                    tags={reasonRejectedTags}
                    maxTags={12}
                    variant="solid"
                  />
                ) : (
                  <Body className="text-gray-500">
                    No rejected reasons yet.
                  </Body>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between mb-3">
                <Body className="text-sm font-semibold text-gray-900">
                  Reason effectiveness scores
                </Body>
                <Body className="text-xs text-gray-500">
                  Top 8 by acceptance
                </Body>
              </div>
              <div className="space-y-3">
                {reasonEffectiveness.map((entry) => (
                  <div key={entry.reason} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-gray-700">
                        {entry.reason}
                      </span>
                      <span className="text-gray-500">
                        {formatPercent(entry.hitRate, 0)} · {entry.total}{" "}
                        samples
                      </span>
                    </div>
                    <ProgressBar
                      value={entry.hitRate * 100}
                      variant={reliabilityVariant(entry.hitRate)}
                      size="sm"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <Body className="text-gray-500">
            Reason analytics unlock once feedback includes reason tags.
          </Body>
        )}
      </SectionCard>

      <SectionCard
        title="Learning Progress"
        subtitle="How the engine adapts over time"
      >
        {learningTrend.length > 0 ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <StatCard
                title="Feedback Volume"
                value={toDisplayCount(feedbackMetrics.total)}
                icon="pulse"
                variant="subtle"
              />
              <StatCard
                title="Exploration Balance"
                value={formatPercent(explorationBalance.explorationRate, 1)}
                icon="compass"
                change={
                  explorationBalance.explorationCount > 0
                    ? {
                        value: explorationBalance.explorationCount,
                        trend: "neutral",
                        label: "low-consensus picks",
                      }
                    : undefined
                }
              />
              <StatCard
                title="Exploitation Focus"
                value={formatPercent(explorationBalance.exploitationRate, 1)}
                icon="target"
              />
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <Body className="text-sm font-semibold text-gray-900 mb-3">
                Acceptance trend ({filterLabel})
              </Body>
              <div className="space-y-3">
                {learningTrend.map((entry) => {
                  const rate =
                    entry.total > 0 ? entry.positive / entry.total : 0;
                  return (
                    <div key={entry.label} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-gray-700">
                          {entry.label}
                        </span>
                        <span className="text-gray-500">
                          {entry.total} picks · {formatPercent(rate, 0)}
                        </span>
                      </div>
                      <ProgressBar
                        value={rate * 100}
                        variant={reliabilityVariant(rate)}
                        size="sm"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <Body className="text-gray-500">
            Learning trends will appear once feedback history builds up.
          </Body>
        )}
      </SectionCard>

      <SectionCard
        title="Pairwise Comparison Stats"
        subtitle="Head-to-head choices that refine the algorithm"
      >
        {pairwiseStats && pairwiseStats.total_comparisons > 0 ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <StatCard
                title="Total Comparisons"
                value={toDisplayCount(pairwiseStats.total_comparisons)}
                icon="scale"
                variant="highlight"
              />
              <StatCard
                title="Recent Activity"
                value={toDisplayCount(pairwiseStats.recent_30d)}
                icon="clock"
                change={{
                  value: pairwiseStats.recent_90d,
                  trend: "neutral",
                  label: "last 90d",
                }}
              />
              <StatCard
                title="High-Consensus Wins"
                value={toDisplayCount(pairwiseStats.high_consensus_wins)}
                icon="sparkles"
                variant="subtle"
              />
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <Body className="text-sm font-semibold text-gray-900 mb-3">
                Consensus breakdown of wins
              </Body>
              <div className="space-y-2 text-sm text-gray-600">
                <div className="flex items-center justify-between">
                  <span>High consensus wins</span>
                  <span className="font-medium text-emerald-600">
                    {pairwiseStats.high_consensus_wins}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Medium consensus wins</span>
                  <span className="font-medium text-amber-600">
                    {pairwiseStats.medium_consensus_wins}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Low consensus wins</span>
                  <span className="font-medium text-orange-600">
                    {pairwiseStats.low_consensus_wins}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <Body className="text-gray-500">
            Pairwise learning stats will appear once you use the comparison
            feature on suggestions.
          </Body>
        )}
      </SectionCard>
    </div>
  );
}
