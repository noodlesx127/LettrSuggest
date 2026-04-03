import {
  TASTEDIVE_CACHE_TTL_DAYS,
  TMDB_SIMILAR_CACHE_TTL_DAYS,
  TUIMDB_UID_CACHE_TTL_DAYS,
  WATCHMODE_CACHE_TTL_HOURS,
} from "@/lib/apiCache";
import { ApiError } from "./responseEnvelope";
import { supabaseAdmin } from "./supabaseAdmin";

export const CLEARABLE_TABLES = [
  "tmdb_similar_cache",
  "tuimdb_uid_cache",
  "tastedive_cache",
  "watchmode_cache",
] as const;

export type ClearableCacheTable = (typeof CLEARABLE_TABLES)[number];

export interface CacheTableStats {
  name: ClearableCacheTable;
  count: number;
  expiredCount: number;
}

export interface ClearedCacheTableResult {
  table: ClearableCacheTable;
  deletedCount: number;
}

const CACHE_DELETE_FLOOR = "1970-01-01T00:00:00.000Z";
const HOURS_IN_MS = 60 * 60 * 1000;
const DAYS_IN_MS = 24 * HOURS_IN_MS;

const CACHE_TABLE_TTL_MS: Record<ClearableCacheTable, number> = {
  tmdb_similar_cache: TMDB_SIMILAR_CACHE_TTL_DAYS * DAYS_IN_MS,
  tuimdb_uid_cache: TUIMDB_UID_CACHE_TTL_DAYS * DAYS_IN_MS,
  tastedive_cache: TASTEDIVE_CACHE_TTL_DAYS * DAYS_IN_MS,
  watchmode_cache: WATCHMODE_CACHE_TTL_HOURS * HOURS_IN_MS,
};

export function isClearableCacheTable(
  value: string,
): value is ClearableCacheTable {
  return CLEARABLE_TABLES.includes(value as ClearableCacheTable);
}

export async function getCacheTableStats(): Promise<CacheTableStats[]> {
  return Promise.all(
    CLEARABLE_TABLES.map(async (tableName) => {
      const expiredBefore = new Date(
        Date.now() - CACHE_TABLE_TTL_MS[tableName],
      ).toISOString();

      const [countResult, expiredResult] = await Promise.all([
        supabaseAdmin
          .from(tableName)
          .select("*", { count: "exact", head: true }),
        supabaseAdmin
          .from(tableName)
          .select("*", { count: "exact", head: true })
          .lt("cached_at", expiredBefore),
      ]);

      if (countResult.error) {
        console.error("[API v1] Failed to count cache table rows", {
          tableName,
          error: countResult.error,
        });
        throw new ApiError(
          500,
          "INTERNAL_ERROR",
          "Failed to fetch cache stats",
        );
      }

      if (expiredResult.error) {
        console.error("[API v1] Failed to count expired cache rows", {
          tableName,
          error: expiredResult.error,
        });
        throw new ApiError(
          500,
          "INTERNAL_ERROR",
          "Failed to fetch cache stats",
        );
      }

      return {
        name: tableName,
        count: countResult.count ?? 0,
        expiredCount: expiredResult.count ?? 0,
      } satisfies CacheTableStats;
    }),
  );
}

export async function clearCacheTables(
  tables: readonly ClearableCacheTable[],
): Promise<ClearedCacheTableResult[]> {
  return Promise.all(
    tables.map(async (tableName) => {
      const deleteResult = await supabaseAdmin
        .from(tableName)
        .delete()
        .or(`cached_at.gte.${CACHE_DELETE_FLOOR},cached_at.is.null`)
        .select();

      if (deleteResult.error) {
        console.error("[API v1] Failed to clear cache table", {
          tableName,
          error: deleteResult.error,
        });
        throw new ApiError(
          500,
          "INTERNAL_ERROR",
          "Failed to clear cache table",
        );
      }

      return {
        table: tableName,
        deletedCount: deleteResult.data?.length ?? 0,
      } satisfies ClearedCacheTableResult;
    }),
  );
}
