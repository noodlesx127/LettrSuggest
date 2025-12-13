/**
 * Counterfactual Replay Analysis Script
 * 
 * Simulates different parameter settings on historical suggestion data
 * to predict impact before running live A/B tests.
 * 
 * Usage:
 *   npx ts-node scripts/counterfactual_replay.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

type ExposureData = {
  tmdbId: number;
  exposedAt: string;
  baseScore: number;
  consensusLevel: string;
  sources: string[];
  mmrLambda: number;
  diversityRank: number;
  feedbackType: 'positive' | 'negative' | null;
};

/**
 * Recalculate scores with different MMR lambda
 */
function recalculateScore(
  baseScore: number,
  diversityRank: number,
  newLambda: number,
  originalLambda: number
): number {
  // Estimate the relevance component (before MMR rerank)
  // MMR formula: score = (1 - λ) * relevance + λ * diversity
  // We don't have the original diversity score, so we approximate
  
  // Reverse engineer approximate relevance
  const approxRelevance = baseScore;
  
  // Diversity penalty increases with rank
  const diversityPenalty = diversityRank * 0.01; // Simple approximation
  
  // Recalculate with new lambda
  const newScore = (1 - newLambda) * approxRelevance - newLambda * diversityPenalty;
  
  return newScore;
}

/**
 * Apply source weight multiplier
 */
function applySourceWeights(
  baseScore: number,
  sources: string[],
  newWeights: Record<string, number>
): number {
  const defaultWeights: Record<string, number> = {
    tmdb: 0.9,
    tastedive: 1.35,
    trakt: 1.4,
    tuimdb: 0.85,
    watchmode: 0.6,
  };

  let oldWeight = 0;
  let newWeight = 0;

  for (const source of sources) {
    const key = source.toLowerCase();
    oldWeight += defaultWeights[key] || 1.0;
    newWeight += newWeights[key] || defaultWeights[key] || 1.0;
  }

  // Adjust score proportionally
  return baseScore * (newWeight / (oldWeight || 1));
}

/**
 * Simulate parameter changes on historical data
 */
async function simulateParameterChange(params: {
  userId: string;
  lookbackDays: number;
  paramChanges: {
    mmrLambda?: number;
    sourceWeights?: Record<string, number>;
  };
}) {
  const { userId, lookbackDays, paramChanges } = params;

  console.log('Fetching exposure data...');
  
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);

  // Fetch exposure data
  const { data: exposures, error: expError } = await supabase
    .from('suggestion_exposure_log')
    .select('tmdb_id, exposed_at, base_score, consensus_level, sources, mmr_lambda, diversity_rank')
    .eq('user_id', userId)
    .gte('exposed_at', cutoff.toISOString())
    .order('exposed_at', { ascending: false });

  if (expError) {
    console.error('Error fetching exposures:', expError);
    return;
  }

  if (!exposures || exposures.length === 0) {
    console.log('No exposure data found for this user');
    return;
  }

  console.log(`Found ${exposures.length} exposures`);

  // Fetch feedback for these exposures
  const tmdbIds = exposures.map(e => e.tmdb_id);
  const { data: feedback, error: fbError } = await supabase
    .from('suggestion_feedback')
    .select('tmdb_id, feedback_type')
    .eq('user_id', userId)
    .in('tmdb_id', tmdbIds);

  if (fbError) {
    console.error('Error fetching feedback:', fbError);
    return;
  }

  const feedbackMap = new Map<number, string>();
  if (feedback) {
    for (const fb of feedback) {
      feedbackMap.set(fb.tmdb_id, fb.feedback_type);
    }
  }

  // Merge data
  const data: ExposureData[] = exposures.map(exp => ({
    tmdbId: exp.tmdb_id,
    exposedAt: exp.exposed_at,
    baseScore: exp.base_score || 0,
    consensusLevel: exp.consensus_level || 'low',
    sources: exp.sources || [],
    mmrLambda: exp.mmr_lambda || 0.25,
    diversityRank: exp.diversity_rank || 0,
    feedbackType: feedbackMap.get(exp.tmdb_id) as 'positive' | 'negative' | null || null,
  }));

  // Calculate original metrics
  const original = calculateMetrics(data);
  
  // Simulate with new parameters
  const simulated = data.map(exp => {
    let newScore = exp.baseScore;

    if (paramChanges.mmrLambda !== undefined) {
      newScore = recalculateScore(exp.baseScore, exp.diversityRank, paramChanges.mmrLambda, exp.mmrLambda);
    }

    if (paramChanges.sourceWeights) {
      newScore = applySourceWeights(newScore, exp.sources, paramChanges.sourceWeights);
    }

    return { ...exp, baseScore: newScore };
  });

  // Re-rank by new scores
  simulated.sort((a, b) => b.baseScore - a.baseScore);

  // Calculate new metrics (assuming top 50 would be shown)
  const topN = 50;
  const simulatedTop = simulated.slice(0, topN);
  const simulatedMetrics = calculateMetrics(simulatedTop);

  // Report
  console.log('\n=== Counterfactual Replay Results ===\n');
  console.log('Parameter Changes:');
  if (paramChanges.mmrLambda !== undefined) {
    console.log(`  MMR Lambda: ${paramChanges.mmrLambda} (original avg: 0.25)`);
  }
  if (paramChanges.sourceWeights) {
    console.log('  Source Weights:', paramChanges.sourceWeights);
  }

  console.log('\nOriginal (all exposures):');
  console.log('  Acceptance Rate:', (original.acceptanceRate * 100).toFixed(1) + '%');
  console.log('  Avg Score:', original.avgScore.toFixed(3));
  console.log('  High Consensus:', original.highConsensus + '/' + original.total, 
    '(' + (original.highConsensus / original.total * 100).toFixed(1) + '%)');

  console.log('\nSimulated (top', topN, 're-ranked):');
  console.log('  Acceptance Rate:', (simulatedMetrics.acceptanceRate * 100).toFixed(1) + '%');
  console.log('  Avg Score:', simulatedMetrics.avgScore.toFixed(3));
  console.log('  High Consensus:', simulatedMetrics.highConsensus + '/' + simulatedMetrics.total,
    '(' + (simulatedMetrics.highConsensus / simulatedMetrics.total * 100).toFixed(1) + '%)');

  const acceptanceDiff = (simulatedMetrics.acceptanceRate - original.acceptanceRate) * 100;
  const sign = acceptanceDiff > 0 ? '+' : '';
  console.log('\nEstimated Impact:', sign + acceptanceDiff.toFixed(1) + '% acceptance rate');
}

function calculateMetrics(data: ExposureData[]) {
  const total = data.length;
  const positive = data.filter(d => d.feedbackType === 'positive').length;
  const negative = data.filter(d => d.feedbackType === 'negative').length;
  const withFeedback = positive + negative;
  const acceptanceRate = withFeedback > 0 ? positive / withFeedback : 0;
  const avgScore = data.reduce((sum, d) => sum + d.baseScore, 0) / total;
  const highConsensus = data.filter(d => d.consensusLevel === 'high').length;

  return {
    total,
    positive,
    negative,
    withFeedback,
    acceptanceRate,
    avgScore,
    highConsensus,
  };
}

// Example usage
async function main() {
  const userId = process.argv[2];
  
  if (!userId) {
    console.log('Usage: npx ts-node scripts/counterfactual_replay.ts <user_id>');
    console.log('');
    console.log('Example:');
    console.log('  npx ts-node scripts/counterfactual_replay.ts 12345678-abcd-1234-abcd-123456789012');
    return;
  }

  // Example: Test higher MMR lambda (more diversity)
  await simulateParameterChange({
    userId,
    lookbackDays: 30,
    paramChanges: {
      mmrLambda: 0.35, // vs default 0.25
    },
  });

  console.log('\n--- Next simulation ---\n');

  // Example: Test boosted TasteDive weight
  await simulateParameterChange({
    userId,
    lookbackDays: 30,
    paramChanges: {
      sourceWeights: {
        tastedive: 1.6, // vs default 1.35
      },
    },
  });
}

main().catch(console.error);
