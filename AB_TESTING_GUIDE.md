# A/B Testing Guide

## Overview

The A/B testing infrastructure enables controlled experiments on recommendation algorithm parameters to optimize user experience through data-driven decisions.

## Quick Start

### 1. Create a Test Configuration

Insert a new test into `ab_test_configs`:

```sql
INSERT INTO ab_test_configs (
  test_name,
  description,
  status,
  start_date,
  variants,
  traffic_split,
  primary_metric,
  secondary_metrics
) VALUES (
  'mmr_lambda_optimization',
  'Test different MMR lambda values for diversity vs relevance tradeoff',
  'running',
  NOW(),
  '[
    {"name": "control", "params": {"mmrLambda": 0.25}},
    {"name": "variant_a", "params": {"mmrLambda": 0.15}},
    {"name": "variant_b", "params": {"mmrLambda": 0.35}}
  ]'::jsonb,
  '{"control": 0.34, "variant_a": 0.33, "variant_b": 0.33}'::jsonb,
  'acceptance_rate',
  ARRAY['diversity_score', 'repeat_rate']
);
```

### 2. Integrate with Recommendation Code

In your suggestion generation code (e.g., `suggest/page.tsx`):

```typescript
import { getActiveABTests, getABTestVariant, recordABTestMetric } from '@/lib/abTesting';

// Get active tests and user's variant
const activeTests = await getActiveABTests();
const mmrTest = activeTests.find(t => t.testName === 'mmr_lambda_optimization');

if (mmrTest) {
  const variant = await getABTestVariant({
    userId: uid,
    testId: mmrTest.id,
    variants: mmrTest.variants,
    trafficSplit: mmrTest.trafficSplit,
  });

  if (variant && variant.params.mmrLambda !== undefined) {
    // Use variant's MMR lambda instead of default
    mmrLambda = variant.params.mmrLambda;
    console.log('[ABTest] Using MMR lambda:', mmrLambda, 'from variant:', variant.name);
  }
}

// Later, when user provides feedback
if (mmrTest && variant) {
  await recordABTestMetric({
    userId: uid,
    testId: mmrTest.id,
    variantName: variant.name,
    metricName: 'acceptance_rate',
    metricValue: feedbackType === 'positive' ? 1 : 0,
  });
}
```

### 3. Monitor Results

Use the `getABTestResults()` function to analyze metrics:

```typescript
import { getABTestResults } from '@/lib/abTesting';

const results = await getABTestResults(testId);

for (const variant of results.variants) {
  console.log(`Variant: ${variant.name}`);
  console.log(`Users: ${variant.userCount}`);
  
  for (const [metricName, stats] of Object.entries(variant.metrics)) {
    console.log(`  ${metricName}: ${stats.mean.toFixed(3)} ± ${stats.stddev.toFixed(3)} (n=${stats.count})`);
  }
}
```

## Testable Parameters

### MMR Lambda
- **Range**: 0.0 - 0.5
- **Default**: 0.25
- **Impact**: Lower = more relevance, higher = more diversity

### Exploration Rate
- **Range**: 0.0 - 0.3
- **Default**: 0.15
- **Impact**: Percentage of exploratory suggestions shown

### Source Weights
```json
{
  "tmdb": 0.9,
  "tastedive": 1.35,
  "trakt": 1.4,
  "tuimdb": 0.85,
  "watchmode": 0.6
}
```

### Quality Gate Threshold
- **Range**: 0.0 - 1.0
- **Default**: 0.5
- **Impact**: Minimum metadata completeness score

## Key Metrics

### Primary Metrics
- `acceptance_rate`: Positive feedback / total feedback
- `diversity_score`: Unique genres/directors in accepted suggestions
- `repeat_rate`: Percentage of repeated suggestions

### Secondary Metrics
- `avg_rating`: Average rating given to suggestions
- `time_to_feedback`: How quickly users provide feedback
- `session_length`: Time spent browsing suggestions

## Best Practices

1. **Run for Sufficient Duration**: Aim for at least 100 users per variant
2. **Statistical Significance**: Use t-tests or Bayesian analysis before concluding
3. **Monitor Secondary Metrics**: Ensure improvements don't hurt other dimensions
4. **Document Learnings**: Record insights in test descriptions
5. **Clean Up**: Mark tests as 'completed' and remove from 'running' when done

## Example: Source Reliability Test

Test whether boosting TasteDive improves acceptance:

```sql
INSERT INTO ab_test_configs (
  test_name,
  description,
  status,
  start_date,
  variants,
  traffic_split,
  primary_metric
) VALUES (
  'source_reliability_boost',
  'Test increased weight for TasteDive recommendations',
  'running',
  NOW(),
  '[
    {"name": "control", "params": {"sourceWeights": {"tastedive": 1.35}}},
    {"name": "boosted", "params": {"sourceWeights": {"tastedive": 1.6}}}
  ]'::jsonb,
  '{"control": 0.5, "boosted": 0.5}'::jsonb,
  'acceptance_rate'
);
```

## Exposure Logging Integration

The `suggestion_exposure_log` table automatically captures:
- Base scores and consensus levels
- Contributing sources
- MMR parameters used
- Metadata completeness
- Session context (discovery level, filters, mode)

Use `getCounterfactualReplayData()` to retrieve this data and simulate alternative parameter settings retroactively.

## Admin Dashboard (Future)

Consider building a Stats page tab for A/B test management:
- View active tests
- Real-time metric dashboards
- Statistical significance calculators
- Test creation/management UI
