import { supabaseAdmin } from "./supabaseAdmin";

type SupportedKeyType = "user" | "developer" | "admin";
type WindowName = "minute" | "hour" | "day";

interface LimitConfig {
  minute: number;
  hour: number;
  day: number;
}

interface WindowDefinition {
  name: WindowName;
  durationMs: number;
}

interface WindowEvaluation {
  count: number;
  limit: number;
  remaining: number;
  reset: number;
  retryAfter: number;
  exceeded: boolean;
}

export interface RateLimitResult {
  exceeded: boolean;
  retryAfter?: number;
  limit: number;
  remaining: number;
  reset: number;
}

const RATE_LIMITS: Record<SupportedKeyType, LimitConfig> = {
  user: { minute: 60, hour: 1000, day: 10000 },
  developer: { minute: 120, hour: 3000, day: 30000 },
  admin: { minute: 300, hour: 10000, day: 100000 },
};

const WINDOW_DEFINITIONS: WindowDefinition[] = [
  { name: "minute", durationMs: 60_000 },
  { name: "hour", durationMs: 3_600_000 },
  { name: "day", durationMs: 86_400_000 },
];

const requestBuckets = new Map<string, number>();
const ONE_SECOND_MS = 1_000;

function normalizeKeyType(keyType: string): SupportedKeyType {
  if (keyType === "admin" || keyType === "developer" || keyType === "user") {
    return keyType;
  }

  return "user";
}

function currentBucketTimestamp(now: number): number {
  return Math.floor(now / ONE_SECOND_MS) * ONE_SECOND_MS;
}

function mapKey(keyId: string, bucketTimestamp: number): string {
  return `${keyId}:${bucketTimestamp}`;
}

function pruneMemory(now: number): void {
  const cutoff =
    now - WINDOW_DEFINITIONS[WINDOW_DEFINITIONS.length - 1].durationMs;

  for (const [key] of requestBuckets) {
    const [, timestampPart] = key.split(":");
    const bucketTimestamp = Number(timestampPart);

    if (!Number.isFinite(bucketTimestamp) || bucketTimestamp < cutoff) {
      requestBuckets.delete(key);
    }
  }
}

function getMemoryBucketsForKey(
  keyId: string,
  now: number,
): Map<number, number> {
  const cutoff =
    now - WINDOW_DEFINITIONS[WINDOW_DEFINITIONS.length - 1].durationMs;
  const buckets = new Map<number, number>();

  for (const [key, count] of requestBuckets) {
    if (!key.startsWith(`${keyId}:`)) {
      continue;
    }

    const bucketTimestamp = Number(key.slice(keyId.length + 1));
    if (!Number.isFinite(bucketTimestamp) || bucketTimestamp < cutoff) {
      continue;
    }

    buckets.set(bucketTimestamp, count);
  }

  return buckets;
}

async function getPersistedBucketsForKey(
  keyId: string,
  now: number,
): Promise<Map<number, number>> {
  const cutoffIso = new Date(
    now - WINDOW_DEFINITIONS[WINDOW_DEFINITIONS.length - 1].durationMs,
  ).toISOString();
  const buckets = new Map<number, number>();

  try {
    const { data, error } = await supabaseAdmin
      .from("api_rate_limits")
      .select("window_start, request_count")
      .eq("key_id", keyId)
      .gte("window_start", cutoffIso);

    if (error) {
      console.error("[API v1] Failed to read persisted rate limits", error);
      return buckets;
    }

    for (const row of data ?? []) {
      const bucketTimestamp = new Date(String(row.window_start)).getTime();
      const requestCount = Number(row.request_count ?? 0);

      if (Number.isFinite(bucketTimestamp) && requestCount > 0) {
        buckets.set(bucketTimestamp, requestCount);
      }
    }
  } catch (error) {
    console.error("[API v1] Unexpected rate limit read error", error);
  }

  return buckets;
}

async function persistBucket(
  keyId: string,
  bucketTimestamp: number,
): Promise<void> {
  try {
    const windowStart = new Date(bucketTimestamp).toISOString();
    const { error } = await supabaseAdmin.rpc("increment_rate_limit", {
      p_key_id: keyId,
      p_window_start: windowStart,
    });

    if (error) {
      console.error("[API v1] Failed to persist rate limit bucket", error);
    }
  } catch (error) {
    console.error("[API v1] Unexpected rate limit persist error", error);
  }
}

function combineBuckets(
  primary: Map<number, number>,
  fallback: Map<number, number>,
): Map<number, number> {
  const combined = new Map<number, number>(fallback);

  for (const [timestamp, count] of primary) {
    combined.set(timestamp, count);
  }

  return combined;
}

function evaluateWindow(
  buckets: Map<number, number>,
  now: number,
  limit: number,
  durationMs: number,
): WindowEvaluation {
  const cutoff = now - durationMs;
  let count = 0;
  let oldestRelevantBucket = Number.POSITIVE_INFINITY;

  for (const [bucketTimestamp, bucketCount] of buckets) {
    if (bucketTimestamp >= cutoff) {
      count += bucketCount;
      if (bucketTimestamp < oldestRelevantBucket) {
        oldestRelevantBucket = bucketTimestamp;
      }
    }
  }

  const remaining = Math.max(limit - count, 0);
  const resetMs = Number.isFinite(oldestRelevantBucket)
    ? oldestRelevantBucket + durationMs
    : now + durationMs;
  const retryAfter = Math.max(1, Math.ceil((resetMs - now) / 1_000));

  return {
    count,
    limit,
    remaining,
    reset: Math.ceil(resetMs / 1_000),
    retryAfter,
    exceeded: count > limit,
  };
}

export async function checkRateLimit(
  keyId: string,
  keyType: string,
): Promise<{
  exceeded: boolean;
  retryAfter?: number;
  limit: number;
  remaining: number;
  reset: number;
}> {
  const normalizedKeyType = normalizeKeyType(keyType);
  const limits = RATE_LIMITS[normalizedKeyType];
  const now = Date.now();
  const bucketTimestamp = currentBucketTimestamp(now);

  pruneMemory(now);

  const existingMemoryBuckets = getMemoryBucketsForKey(keyId, now);
  const persistedBuckets =
    existingMemoryBuckets.size === 0
      ? await getPersistedBucketsForKey(keyId, now)
      : new Map<number, number>();

  const currentMapKey = mapKey(keyId, bucketTimestamp);
  requestBuckets.set(
    currentMapKey,
    (requestBuckets.get(currentMapKey) ?? 0) + 1,
  );

  const memoryBuckets = getMemoryBucketsForKey(keyId, now);
  const combinedBuckets = combineBuckets(memoryBuckets, persistedBuckets);

  void persistBucket(keyId, bucketTimestamp);

  const evaluations = WINDOW_DEFINITIONS.map((windowDefinition) =>
    evaluateWindow(
      combinedBuckets,
      now,
      limits[windowDefinition.name],
      windowDefinition.durationMs,
    ),
  );

  const exceededWindows = evaluations.filter(
    (evaluation) => evaluation.exceeded,
  );
  if (exceededWindows.length > 0) {
    const strictestExceeded = exceededWindows.reduce((current, candidate) =>
      candidate.retryAfter > current.retryAfter ? candidate : current,
    );

    return {
      exceeded: true,
      retryAfter: strictestExceeded.retryAfter,
      limit: strictestExceeded.limit,
      remaining: 0,
      reset: strictestExceeded.reset,
    };
  }

  const tightestWindow = evaluations.reduce((current, candidate) => {
    const currentRatio = current.remaining / current.limit;
    const candidateRatio = candidate.remaining / candidate.limit;

    return candidateRatio < currentRatio ? candidate : current;
  });

  return {
    exceeded: false,
    limit: tightestWindow.limit,
    remaining: tightestWindow.remaining,
    reset: tightestWindow.reset,
  };
}

export function rateLimitHeaders(
  result: RateLimitResult,
): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(result.reset),
  };
}
