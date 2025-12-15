/**
 * A/B Testing Infrastructure
 * 
 * Enables controlled experiments on recommendation algorithm parameters:
 * - MMR lambda (diversity vs relevance tradeoff)
 * - Exploration rate (how often to show exploratory picks)
 * - Source reliability weights
 * - Quality gate thresholds
 */

import { supabase } from './supabaseClient';

export type ABTestVariant = {
  name: string;
  params: {
    mmrLambda?: number;
    explorationRate?: number;
    sourceWeights?: Record<string, number>;
    qualityGateThreshold?: number;
    diversityTopK?: number;
    [key: string]: any;
  };
};

export type ABTestConfig = {
  id: number;
  testName: string;
  description?: string;
  status: 'draft' | 'running' | 'paused' | 'completed';
  startDate?: string;
  endDate?: string;
  variants: ABTestVariant[];
  trafficSplit: Record<string, number>;
  userCriteria?: {
    minFilmsRated?: number;
    genres?: string[];
    [key: string]: any;
  };
  primaryMetric: string;
  secondaryMetrics?: string[];
};

/**
 * Get active A/B tests
 */
export async function getActiveABTests(): Promise<ABTestConfig[]> {
  if (!supabase) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('ab_test_configs')
      .select('*')
      .eq('status', 'running')
      .lte('start_date', new Date().toISOString())
      .or(`end_date.is.null,end_date.gte.${new Date().toISOString()}`);

    if (error) {
      console.error('[ABTest] Error fetching active tests:', error);
      return [];
    }

    return (data || []).map(row => ({
      id: row.id,
      testName: row.test_name,
      description: row.description,
      status: row.status,
      startDate: row.start_date,
      endDate: row.end_date,
      variants: row.variants || [],
      trafficSplit: row.traffic_split || {},
      userCriteria: row.user_criteria,
      primaryMetric: row.primary_metric,
      secondaryMetrics: row.secondary_metrics,
    }));
  } catch (e) {
    console.error('[ABTest] Exception fetching active tests:', e);
    return [];
  }
}

/**
 * Get user's variant assignment for a test (or assign if not yet assigned)
 */
export async function getABTestVariant(params: {
  userId: string;
  testId: number;
  variants: ABTestVariant[];
  trafficSplit: Record<string, number>;
}): Promise<ABTestVariant | null> {
  if (!supabase) {
    return null;
  }

  const { userId, testId, variants, trafficSplit } = params;

  try {
    // Check if user already assigned
    const { data: existing, error: fetchError } = await supabase
      .from('ab_test_assignments')
      .select('variant_name')
      .eq('test_id', testId)
      .eq('user_id', userId)
      .maybeSingle();

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.error('[ABTest] Error fetching assignment:', fetchError);
      return null;
    }

    if (existing) {
      const variant = variants.find(v => v.name === existing.variant_name);
      return variant || null;
    }

    // Assign user to a variant based on traffic split
    const variantName = assignVariant(trafficSplit);
    const variant = variants.find(v => v.name === variantName);

    if (!variant) {
      console.warn('[ABTest] No variant found for:', variantName);
      return null;
    }

    // Record assignment
    const { error: insertError } = await supabase
      .from('ab_test_assignments')
      .insert({
        test_id: testId,
        user_id: userId,
        variant_name: variantName,
      });

    if (insertError) {
      console.error('[ABTest] Error recording assignment:', insertError);
      // Return variant anyway (assignment might have been created by race condition)
    }

    console.log('[ABTest] Assigned user to variant:', {
      testId,
      userId: userId.slice(0, 8),
      variant: variantName,
    });

    return variant;
  } catch (e) {
    console.error('[ABTest] Exception getting variant:', e);
    return null;
  }
}

/**
 * Randomly assign a variant based on traffic split
 */
function assignVariant(trafficSplit: Record<string, number>): string {
  const rand = Math.random();
  let cumulative = 0;

  for (const [variantName, weight] of Object.entries(trafficSplit)) {
    cumulative += weight;
    if (rand <= cumulative) {
      return variantName;
    }
  }

  // Fallback to first variant if weights don't sum to 1.0
  return Object.keys(trafficSplit)[0];
}

/**
 * Record A/B test metric
 */
export async function recordABTestMetric(params: {
  userId: string;
  testId: number;
  variantName: string;
  metricName: string;
  metricValue: number;
  sessionData?: any;
}): Promise<void> {
  if (!supabase) {
    return;
  }

  const { userId, testId, variantName, metricName, metricValue, sessionData } = params;

  try {
    const { error } = await supabase
      .from('ab_test_metrics')
      .insert({
        test_id: testId,
        user_id: userId,
        variant_name: variantName,
        metric_name: metricName,
        metric_value: metricValue,
        session_data: sessionData,
      });

    if (error) {
      console.error('[ABTest] Error recording metric:', error);
    }
  } catch (e) {
    console.error('[ABTest] Exception recording metric:', e);
  }
}

/**
 * Welch's t-test for comparing two sample means with unequal variances
 * Returns t-statistic and approximate degrees of freedom
 */
function welchTTest(
  mean1: number, var1: number, n1: number,
  mean2: number, var2: number, n2: number
): { tStat: number; df: number } {
  const se1 = var1 / n1;
  const se2 = var2 / n2;
  const se = Math.sqrt(se1 + se2);

  if (se === 0) return { tStat: 0, df: 1 };

  const tStat = (mean1 - mean2) / se;

  // Welch-Satterthwaite degrees of freedom
  const num = Math.pow(se1 + se2, 2);
  const denom = Math.pow(se1, 2) / (n1 - 1) + Math.pow(se2, 2) / (n2 - 1);
  const df = denom === 0 ? 1 : num / denom;

  return { tStat, df };
}

/**
 * Approximate p-value from t-statistic using Student's t-distribution
 * Uses a numerical approximation suitable for two-tailed tests
 */
function tDistributionPValue(tStat: number, df: number): number {
  const x = df / (df + tStat * tStat);
  // Regularized incomplete beta function approximation
  // For large df, approaches normal distribution
  if (df > 100) {
    // Use normal approximation for large df
    const z = Math.abs(tStat);
    const p = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
    return 2 * (1 - normalCDF(Math.abs(tStat)));
  }

  // Simple approximation for smaller df
  const a = df / 2;
  const b = 0.5;
  // Beta function approximation
  const beta = Math.exp(lnGamma(a) + lnGamma(b) - lnGamma(a + b));
  const I = regularizedIncompleteBeta(x, a, b);
  return I;
}

function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

function lnGamma(x: number): number {
  // Lanczos approximation
  const g = 7;
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7
  ];

  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  }

  x -= 1;
  let a = c[0];
  for (let i = 1; i < g + 2; i++) {
    a += c[i] / (x + i);
  }
  const t = x + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  // Simple continued fraction approximation
  if (x === 0) return 0;
  if (x === 1) return 1;

  // Use symmetry for numerical stability
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedIncompleteBeta(1 - x, b, a);
  }

  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;

  // Continued fraction (Lentz's algorithm)
  let f = 1, c = 1, d = 0;
  for (let m = 0; m <= 100; m++) {
    const m2 = 2 * m;

    // Even step
    let an = (m === 0) ? 1 : (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + an * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    f *= d * c;

    // Odd step
    an = -((a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + an * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    f *= delta;

    if (Math.abs(delta - 1) < 1e-10) break;
  }

  return front * f;
}

export type StatisticalComparison = {
  controlVariant: string;
  testVariant: string;
  metric: string;
  controlMean: number;
  testMean: number;
  difference: number;
  percentChange: number;
  pValue: number;
  isSignificant: boolean; // p < 0.05
  confidenceInterval: { lower: number; upper: number };
};

/**
 * Get A/B test results for a specific test with statistical significance
 */
export async function getABTestResults(testId: number): Promise<{
  variants: Array<{
    name: string;
    userCount: number;
    metrics: Record<string, { mean: number; stddev: number; count: number }>;
  }>;
  comparisons: StatisticalComparison[];
}> {
  if (!supabase) {
    return { variants: [], comparisons: [] };
  }

  try {
    // Get all assignments for this test
    const { data: assignments, error: assignError } = await supabase
      .from('ab_test_assignments')
      .select('variant_name, user_id')
      .eq('test_id', testId);

    if (assignError) {
      console.error('[ABTest] Error fetching assignments:', assignError);
      return { variants: [], comparisons: [] };
    }

    // Get all metrics for this test
    const { data: metrics, error: metricsError } = await supabase
      .from('ab_test_metrics')
      .select('variant_name, metric_name, metric_value')
      .eq('test_id', testId);

    if (metricsError) {
      console.error('[ABTest] Error fetching metrics:', metricsError);
      return { variants: [], comparisons: [] };
    }

    // Aggregate by variant
    const variantStats = new Map<string, {
      userCount: number;
      metrics: Map<string, number[]>;
    }>();

    for (const assignment of (assignments || [])) {
      if (!variantStats.has(assignment.variant_name)) {
        variantStats.set(assignment.variant_name, {
          userCount: 0,
          metrics: new Map(),
        });
      }
      const stats = variantStats.get(assignment.variant_name)!;
      stats.userCount += 1;
    }

    for (const metric of (metrics || [])) {
      const stats = variantStats.get(metric.variant_name);
      if (!stats) continue;

      if (!stats.metrics.has(metric.metric_name)) {
        stats.metrics.set(metric.metric_name, []);
      }
      stats.metrics.get(metric.metric_name)!.push(metric.metric_value);
    }

    // Calculate mean and stddev for each metric
    const results = Array.from(variantStats.entries()).map(([name, stats]) => {
      const metricsObj: Record<string, { mean: number; stddev: number; count: number; variance: number }> = {};

      for (const [metricName, values] of stats.metrics.entries()) {
        const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
        const stddev = Math.sqrt(variance);

        metricsObj[metricName] = {
          mean,
          stddev,
          count: values.length,
          variance,
        };
      }

      return {
        name,
        userCount: stats.userCount,
        metrics: metricsObj,
      };
    });

    // Generate statistical comparisons between variants
    const comparisons: StatisticalComparison[] = [];

    // Find control variant (usually named 'control' or first variant)
    const controlVariant = results.find(v => v.name.toLowerCase() === 'control') || results[0];

    if (controlVariant && results.length > 1) {
      const testVariants = results.filter(v => v.name !== controlVariant.name);

      // Get all unique metric names
      const allMetricNames = new Set<string>();
      for (const variant of results) {
        for (const metricName of Object.keys(variant.metrics)) {
          allMetricNames.add(metricName);
        }
      }

      // Compare each test variant against control for each metric
      for (const testVariant of testVariants) {
        for (const metricName of allMetricNames) {
          const controlMetric = controlVariant.metrics[metricName];
          const testMetric = testVariant.metrics[metricName];

          if (!controlMetric || !testMetric || controlMetric.count < 2 || testMetric.count < 2) {
            continue; // Need at least 2 samples for t-test
          }

          const { tStat, df } = welchTTest(
            testMetric.mean, testMetric.variance, testMetric.count,
            controlMetric.mean, controlMetric.variance, controlMetric.count
          );

          const pValue = tDistributionPValue(tStat, df);
          const difference = testMetric.mean - controlMetric.mean;
          const percentChange = controlMetric.mean !== 0
            ? ((testMetric.mean - controlMetric.mean) / controlMetric.mean) * 100
            : 0;

          // 95% confidence interval for the difference
          const criticalValue = 1.96; // Approximation for large samples
          const se = Math.sqrt(testMetric.variance / testMetric.count + controlMetric.variance / controlMetric.count);
          const marginOfError = criticalValue * se;

          comparisons.push({
            controlVariant: controlVariant.name,
            testVariant: testVariant.name,
            metric: metricName,
            controlMean: controlMetric.mean,
            testMean: testMetric.mean,
            difference,
            percentChange,
            pValue,
            isSignificant: pValue < 0.05,
            confidenceInterval: {
              lower: difference - marginOfError,
              upper: difference + marginOfError,
            },
          });
        }
      }
    }

    return { variants: results, comparisons };
  } catch (e) {
    console.error('[ABTest] Exception getting test results:', e);
    return { variants: [], comparisons: [] };
  }
}

/**
 * Check if user meets criteria for a test
 */
export async function userMeetsCriteria(params: {
  userId: string;
  criteria?: {
    minFilmsRated?: number;
    genres?: string[];
    [key: string]: any;
  };
}): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  const { userId, criteria } = params;

  if (!criteria) {
    return true; // No criteria = everyone qualifies
  }

  try {
    // Check min films rated
    if (criteria.minFilmsRated !== undefined) {
      const { count, error } = await supabase
        .from('film_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (error) {
        console.error('[ABTest] Error checking film count:', error);
        return false;
      }

      if ((count || 0) < criteria.minFilmsRated) {
        return false;
      }
    }

    // Add more criteria checks as needed
    // e.g., check favorite genres, activity level, etc.

    return true;
  } catch (e) {
    console.error('[ABTest] Exception checking criteria:', e);
    return false;
  }
}
