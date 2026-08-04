export const TASTE_PROFILE_MODEL_VERSION = "taste-profile-v1" as const;
export const TASTE_PROFILE_METADATA_VERSION = "tmdb-metadata-v1" as const;

export const TASTE_PROFILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type RecommendationRevisionFilm = {
  uri: string;
  title?: string | null;
  year?: number | null;
  rating?: number | null;
  rewatch?: boolean | null;
  lastDate?: string | null;
  watchCount?: number | null;
  liked?: boolean | null;
  onWatchlist?: boolean | null;
};

export type RecommendationRevisionMapping = {
  uri: string;
  tmdbId: number;
};

export type RecommendationRevisionFeedback = {
  featureId: number;
  featureName: string;
  featureType: string;
  inferredPreference: number | string | null;
  positiveCount: number;
  negativeCount: number;
};

export type RecommendationRevisionWatchlistItem = {
  uri: string;
  watchlistAddedAt?: string | null;
};

export type RecommendationRevisionQuizState =
  | {
      status: "ok";
      responseCount: number;
      latestResponseId: number | null;
      latestResponseAt: string | null;
    }
  | { status: "unavailable" };

export type RecommendationRevisionInput = {
  films: readonly RecommendationRevisionFilm[];
  mappings: readonly RecommendationRevisionMapping[];
  watchlist: readonly RecommendationRevisionWatchlistItem[];
  feedback: readonly RecommendationRevisionFeedback[];
  quizState: RecommendationRevisionQuizState;
  blockedIds: readonly number[];
  metadataVersion: string;
  profileModelVersion: string;
};

export type TasteProfileCacheRow = {
  input_revision?: string | null;
  profile_model_version?: string | null;
  computed_at?: string | null;
  film_count?: number | null;
};

export type TasteProfileCacheRevision = {
  inputRevision: string;
  profileModelVersion: string;
};

export type TasteProfileCacheValidityOptions = {
  now?: number;
  ttlMs?: number;
};

export type BoundedTasteProfileCacheDiagnostics = {
  revision: string | null;
  modelVersion: string | null;
};

function canonicalize(value: unknown): unknown {
  if (value === null) return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return typeof value === "bigint" ? value.toString() : value;
  }

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        if (record[key] !== undefined) {
          Object.defineProperty(result, key, {
            configurable: true,
            enumerable: true,
            value: canonicalize(record[key]),
            writable: true,
          });
        }
        return result;
      }, Object.create(null) as Record<string, unknown>);
  }

  return String(value);
}

/**
 * Serialize JSON-like values with object keys in lexical order.
 * Collection ordering is normalized by createRecommendationRevision because
 * some profile inputs are database sets rather than ordered sequences.
 */
export function stableCanonicalSerialize(value: unknown): string {
  return JSON.stringify(canonicalize(value)) ?? "null";
}

function sortCollection<T>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => {
    const leftKey = stableCanonicalSerialize(left);
    const rightKey = stableCanonicalSerialize(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function normalizeRevisionInput(
  input: RecommendationRevisionInput,
): Record<string, unknown> {
  return {
    blockedIds: [...input.blockedIds].sort((left, right) => left - right),
    feedback: sortCollection(input.feedback),
    films: sortCollection(input.films),
    mappings: sortCollection(input.mappings),
    metadataVersion: input.metadataVersion,
    profileModelVersion: input.profileModelVersion,
    quizState:
      input.quizState.status === "ok"
        ? {
            status: "ok",
            responseCount: input.quizState.responseCount,
            latestResponseId: input.quizState.latestResponseId,
            latestResponseAt: input.quizState.latestResponseAt,
          }
        : { status: "unavailable" },
    watchlist: sortCollection(input.watchlist),
  };
}

const FNV64_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;

/**
 * Hash without Node-only crypto APIs so the revision remains safe to use in
 * server runtimes that expose standard ECMAScript features only.
 */
export function hashCanonicalRevision(value: string): string {
  let hash = FNV64_OFFSET_BASIS;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * FNV64_PRIME);
  }

  return hash.toString(16).padStart(16, "0");
}

export function createRecommendationRevision(
  input: RecommendationRevisionInput,
): string {
  return hashCanonicalRevision(
    stableCanonicalSerialize(normalizeRevisionInput(input)),
  );
}

export function isTasteProfileCacheValid(
  cache: TasteProfileCacheRow | null | undefined,
  current: TasteProfileCacheRevision,
  options: TasteProfileCacheValidityOptions = {},
): boolean {
  if (!cache) return false;
  if (cache.input_revision !== current.inputRevision) return false;
  if (cache.profile_model_version !== current.profileModelVersion) return false;

  const computedAtMs = cache.computed_at
    ? new Date(cache.computed_at).getTime()
    : Number.NaN;
  if (Number.isNaN(computedAtMs)) return false;

  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? TASTE_PROFILE_CACHE_TTL_MS;
  if (!Number.isFinite(now) || !Number.isFinite(ttlMs) || ttlMs < 0) {
    return false;
  }

  if (computedAtMs > now) return false;

  return now - computedAtMs < ttlMs;
}

export type TasteProfileCacheDecision = "hit" | "miss";

export function decideTasteProfileCache(
  cache: TasteProfileCacheRow | null | undefined,
  current: TasteProfileCacheRevision,
  options: TasteProfileCacheValidityOptions = {},
): TasteProfileCacheDecision {
  return isTasteProfileCacheValid(cache, current, options) ? "hit" : "miss";
}

export type TasteProfileCacheWriteInput<TProfile> = {
  userId: string;
  profile: TProfile;
  filmCount: number;
  computedAt: string;
  revision: TasteProfileCacheRevision;
};

export type TasteProfileCacheWritePayload<TProfile> = {
  user_id: string;
  profile: TProfile;
  film_count: number;
  computed_at: string;
  input_revision: string;
  profile_model_version: string;
};

export function createTasteProfileCacheWritePayload<TProfile>(
  input: TasteProfileCacheWriteInput<TProfile>,
): TasteProfileCacheWritePayload<TProfile> {
  return {
    user_id: input.userId,
    profile: input.profile,
    film_count: input.filmCount,
    computed_at: input.computedAt,
    input_revision: input.revision.inputRevision,
    profile_model_version: input.revision.profileModelVersion,
  };
}

const REVISION_DIAGNOSTIC_PATTERN = /^[0-9a-f]{16}$/i;
const MODEL_VERSION_DIAGNOSTIC_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export function getBoundedTasteProfileCacheDiagnostics(
  cache: TasteProfileCacheRow | null | undefined,
): BoundedTasteProfileCacheDiagnostics {
  const revision =
    typeof cache?.input_revision === "string" &&
    REVISION_DIAGNOSTIC_PATTERN.test(cache.input_revision)
      ? cache.input_revision.toLowerCase()
      : null;
  const modelVersion =
    typeof cache?.profile_model_version === "string" &&
    MODEL_VERSION_DIAGNOSTIC_PATTERN.test(cache.profile_model_version)
      ? cache.profile_model_version
      : null;

  return { revision, modelVersion };
}
