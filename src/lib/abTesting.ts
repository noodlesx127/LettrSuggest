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
 * Get A/B test results for a specific test
 */
export async function getABTestResults(testId: number): Promise<{
  variants: Array<{
    name: string;
    userCount: number;
    metrics: Record<string, { mean: number; stddev: number; count: number }>;
  }>;
}> {
  if (!supabase) {
    return { variants: [] };
  }

  try {
    // Get all assignments for this test
    const { data: assignments, error: assignError } = await supabase
      .from('ab_test_assignments')
      .select('variant_name, user_id')
      .eq('test_id', testId);

    if (assignError) {
      console.error('[ABTest] Error fetching assignments:', assignError);
      return { variants: [] };
    }

    // Get all metrics for this test
    const { data: metrics, error: metricsError } = await supabase
      .from('ab_test_metrics')
      .select('variant_name, metric_name, metric_value')
      .eq('test_id', testId);

    if (metricsError) {
      console.error('[ABTest] Error fetching metrics:', metricsError);
      return { variants: [] };
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
      const metricsObj: Record<string, { mean: number; stddev: number; count: number }> = {};

      for (const [metricName, values] of stats.metrics.entries()) {
        const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
        const stddev = Math.sqrt(variance);

        metricsObj[metricName] = {
          mean,
          stddev,
          count: values.length,
        };
      }

      return {
        name,
        userCount: stats.userCount,
        metrics: metricsObj,
      };
    });

    return { variants: results };
  } catch (e) {
    console.error('[ABTest] Exception getting test results:', e);
    return { variants: [] };
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
