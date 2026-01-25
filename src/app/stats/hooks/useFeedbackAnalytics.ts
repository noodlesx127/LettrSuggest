import { useEffect, useMemo, useState } from "react";

import { supabase } from "@/lib/supabaseClient";

import type {
  ConsensusAcceptance,
  ConsensusLevel,
  FeedbackRow,
  FeedbackSummary,
  PairwiseStats,
  ReasonAcceptance,
  SourceReliability,
  TimeFilter,
} from "@/app/stats/types";

type SourceConsensusBuckets = {
  high: { pos: number; total: number };
  medium: { pos: number; total: number };
  low: { pos: number; total: number };
};

function normalizeStringArray(value?: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry : String(entry ?? "")))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function useFeedbackAnalytics(uid: string, timeFilter: TimeFilter) {
  const [feedbackSummary, setFeedbackSummary] =
    useState<FeedbackSummary | null>(null);
  const [sourceReliability, setSourceReliability] = useState<
    SourceReliability[]
  >([]);
  const [pairwiseStats, setPairwiseStats] = useState<PairwiseStats | null>(
    null,
  );
  const [consensusAcceptance, setConsensusAcceptance] =
    useState<ConsensusAcceptance | null>(null);
  const [reasonAcceptance, setReasonAcceptance] = useState<ReasonAcceptance[]>(
    [],
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const [feedbackRows, setFeedbackRows] = useState<FeedbackRow[]>([]);
  const [sourceReliabilityRecent, setSourceReliabilityRecent] = useState<
    SourceReliability[]
  >([]);
  const [sourceConsensus, setSourceConsensus] = useState<
    Array<{ source: string } & SourceConsensusBuckets>
  >([]);

  useEffect(() => {
    let isActive = true;

    if (!supabase || !uid) {
      setFeedbackSummary(null);
      setSourceReliability([]);
      setSourceReliabilityRecent([]);
      setSourceConsensus([]);
      setPairwiseStats(null);
      setConsensusAcceptance(null);
      setReasonAcceptance([]);
      setFeedbackRows([]);
      setIsLoading(false);
      setError(null);
      return () => {
        isActive = false;
      };
    }

    const fetchFeedbackSummary = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const client = supabase;
        if (!client) return;
        const { data, error: feedbackError } = await client
          .from("suggestion_feedback")
          .select(
            "feedback_type, recommendation_sources, consensus_level, reason_types, movie_features, tmdb_id, created_at",
          )
          .eq("user_id", uid);

        if (feedbackError) {
          console.error(
            "[Stats Hook useFeedbackAnalytics] Error fetching feedback summary",
            feedbackError,
          );
          if (isActive)
            setError(new Error(feedbackError.message || "Query failed"));
          return;
        }

        const rows = (data ?? []) as FeedbackRow[];
        if (!isActive) return;

        setFeedbackRows(rows);

        const total = rows.length;
        const positive = rows.filter(
          (row) => row.feedback_type === "positive",
        ).length;
        const negative = rows.filter(
          (row) => row.feedback_type === "negative",
        ).length;
        const hitRate = total > 0 ? positive / total : 0;
        setFeedbackSummary({ total, positive, negative, hitRate });

        const byReason = new Map<string, { pos: number; total: number }>();
        rows.forEach((row) => {
          const reasons = normalizeStringArray(row.reason_types as unknown);
          const isPos = row.feedback_type === "positive";
          reasons.forEach((reason) => {
            const key = reason.toLowerCase();
            const curr = byReason.get(key) ?? { pos: 0, total: 0 };
            if (isPos) curr.pos += 1;
            curr.total += 1;
            byReason.set(key, curr);
          });
        });

        const reasonEntries = Array.from(byReason.entries())
          .map(([reason, stats]) => ({
            reason,
            total: stats.total,
            positive: stats.pos,
            hitRate: stats.total > 0 ? stats.pos / stats.total : 0,
          }))
          .filter((entry) => entry.total >= 5)
          .sort((a, b) => b.total - a.total);
        setReasonAcceptance(reasonEntries);

        const bySource = new Map<string, { pos: number; total: number }>();
        rows.forEach((row) => {
          const sources = normalizeStringArray(
            row.recommendation_sources as unknown,
          );
          const isPos = row.feedback_type === "positive";
          sources.forEach((source) => {
            const key = source.toLowerCase();
            const curr = bySource.get(key) ?? { pos: 0, total: 0 };
            if (isPos) curr.pos += 1;
            curr.total += 1;
            bySource.set(key, curr);
          });
        });

        const entries = Array.from(bySource.entries())
          .map(([source, stats]) => ({
            source,
            total: stats.total,
            positive: stats.pos,
            hitRate: stats.total > 0 ? stats.pos / stats.total : 0,
          }))
          .filter((entry) => entry.total >= 3)
          .sort((a, b) => b.total - a.total);
        setSourceReliability(entries);

        const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
        const bySourceRecent = new Map<
          string,
          { pos: number; total: number }
        >();
        rows.forEach((row) => {
          const ts = row.created_at ? new Date(row.created_at).getTime() : 0;
          if (!ts || ts < ninetyDaysAgo) return;
          const sources = normalizeStringArray(
            row.recommendation_sources as unknown,
          );
          const isPos = row.feedback_type === "positive";
          sources.forEach((source) => {
            const key = source.toLowerCase();
            const curr = bySourceRecent.get(key) ?? { pos: 0, total: 0 };
            if (isPos) curr.pos += 1;
            curr.total += 1;
            bySourceRecent.set(key, curr);
          });
        });

        const recentEntries = Array.from(bySourceRecent.entries())
          .map(([source, stats]) => ({
            source,
            total: stats.total,
            positive: stats.pos,
            hitRate: stats.total > 0 ? stats.pos / stats.total : 0,
          }))
          .filter((entry) => entry.total >= 3)
          .sort((a, b) => b.total - a.total);
        setSourceReliabilityRecent(recentEntries);

        const bySourceConsensus = new Map<string, SourceConsensusBuckets>();
        rows.forEach((row) => {
          const sources = normalizeStringArray(
            row.recommendation_sources as unknown,
          );
          const level = row.consensus_level ?? "low";
          const bucket: ConsensusLevel =
            level === "high" ? "high" : level === "medium" ? "medium" : "low";
          const isPos = row.feedback_type === "positive";
          sources.forEach((source) => {
            const key = source.toLowerCase();
            const curr = bySourceConsensus.get(key) ?? {
              high: { pos: 0, total: 0 },
              medium: { pos: 0, total: 0 },
              low: { pos: 0, total: 0 },
            };
            const target = curr[bucket];
            if (isPos) target.pos += 1;
            target.total += 1;
            bySourceConsensus.set(key, curr);
          });
        });

        const consensusEntries = Array.from(bySourceConsensus.entries())
          .map(([source, buckets]) => ({ source, ...buckets }))
          .filter(
            (entry) =>
              entry.high.total + entry.medium.total + entry.low.total >= 5,
          )
          .sort(
            (a, b) =>
              b.high.total +
              b.medium.total +
              b.low.total -
              (a.high.total + a.medium.total + a.low.total),
          );
        setSourceConsensus(consensusEntries);

        const consensusTotals = rows.reduce(
          (acc, row) => {
            const level = row.consensus_level ?? "low";
            const bucket: ConsensusLevel =
              level === "high" ? "high" : level === "medium" ? "medium" : "low";
            const isPos = row.feedback_type === "positive";
            acc[bucket].total += 1;
            if (isPos) acc[bucket].pos += 1;
            return acc;
          },
          {
            high: { pos: 0, total: 0 },
            medium: { pos: 0, total: 0 },
            low: { pos: 0, total: 0 },
          },
        );
        setConsensusAcceptance(consensusTotals);
      } catch (err) {
        const errorValue =
          err instanceof Error ? err : new Error("Unknown error occurred");
        console.error(
          "[Stats Hook useFeedbackAnalytics] Exception fetching feedback",
          errorValue,
        );
        if (isActive) setError(errorValue);
      } finally {
        if (isActive) setIsLoading(false);
      }
    };

    void fetchFeedbackSummary();

    return () => {
      isActive = false;
    };
  }, [uid]);

  useEffect(() => {
    let isActive = true;

    if (!supabase || !uid) {
      setPairwiseStats(null);
      return () => {
        isActive = false;
      };
    }

    const fetchPairwiseStats = async () => {
      try {
        const client = supabase;
        if (!client) return;
        const { data: pairwiseEvents, error: pairwiseError } = await client
          .from("pairwise_events")
          .select("created_at, winner_consensus, loser_consensus")
          .eq("user_id", uid);

        if (pairwiseError) {
          console.error(
            "[Stats Hook useFeedbackAnalytics] Error fetching pairwise events",
            pairwiseError,
          );
          return;
        }

        if (!pairwiseEvents || pairwiseEvents.length === 0) {
          if (isActive) setPairwiseStats(null);
          return;
        }

        const now = Date.now();
        const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
        const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;

        const recent30d = pairwiseEvents.filter((event) => {
          const ts = event.created_at
            ? new Date(event.created_at).getTime()
            : 0;
          return ts >= thirtyDaysAgo;
        }).length;

        const recent90d = pairwiseEvents.filter((event) => {
          const ts = event.created_at
            ? new Date(event.created_at).getTime()
            : 0;
          return ts >= ninetyDaysAgo;
        }).length;

        const highConsensusWins = pairwiseEvents.filter(
          (event) => event.winner_consensus === "high",
        ).length;
        const mediumConsensusWins = pairwiseEvents.filter(
          (event) => event.winner_consensus === "medium",
        ).length;
        const lowConsensusWins = pairwiseEvents.filter(
          (event) => event.winner_consensus === "low",
        ).length;

        if (!isActive) return;
        setPairwiseStats({
          total_comparisons: pairwiseEvents.length,
          recent_30d: recent30d,
          recent_90d: recent90d,
          high_consensus_wins: highConsensusWins,
          medium_consensus_wins: mediumConsensusWins,
          low_consensus_wins: lowConsensusWins,
        });
      } catch (err) {
        console.error(
          "[Stats Hook useFeedbackAnalytics] Exception fetching pairwise stats",
          err,
        );
      }
    };

    void fetchPairwiseStats();

    return () => {
      isActive = false;
    };
  }, [uid]);

  useEffect(() => {
    if (timeFilter === "all") return;

    console.log("[Stats Hook useFeedbackAnalytics] Time filter set", {
      timeFilter,
    });
  }, [timeFilter]);

  const filteredSourceReliability = useMemo(() => {
    if (timeFilter === "month" || timeFilter === "year") {
      return sourceReliabilityRecent.length > 0
        ? sourceReliabilityRecent
        : sourceReliability;
    }
    return sourceReliability;
  }, [sourceReliability, sourceReliabilityRecent, timeFilter]);

  return {
    feedbackSummary,
    sourceReliability: filteredSourceReliability,
    pairwiseStats,
    consensusAcceptance,
    reasonAcceptance,
    isLoading,
    error,
    sourceReliabilityRecent,
    sourceConsensus,
    feedbackRows,
  };
}
