const MAX_RESTORED_ARRAY_LENGTH = 300;
const PAIRWISE_SESSION_LIMIT = 5;
const SHOWN_IDS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SuggestionStorageKeys = {
  items: string;
  shownIds: string;
  pairHistory: string;
  pairwiseCount: string;
};

export type StoredSuggestionItem = {
  id: number;
  title: string;
  reasons: string[];
  score: number;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: string | null): unknown | null {
  if (typeof value !== "string") return null;

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function getSuggestionStorageKeys(
  userId: string | null,
): SuggestionStorageKeys | null {
  if (typeof userId !== "string" || userId.trim().length === 0) return null;

  return {
    items: `lettrsuggest:${userId}:items`,
    shownIds: `lettrsuggest:${userId}:shown_ids`,
    pairHistory: `lettrsuggest:${userId}:pair_history`,
    pairwiseCount: `lettrsuggest:${userId}:pairwise_count`,
  };
}

export function parseStoredSuggestionItems(
  value: string | null,
): StoredSuggestionItem[] | null {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const valid = parsed.every((item) => {
    if (!isRecord(item)) return false;

    return (
      isPositiveInteger(item.id) &&
      typeof item.title === "string" &&
      Number.isFinite(item.score) &&
      Array.isArray(item.reasons) &&
      item.reasons.every((reason) => typeof reason === "string")
    );
  });

  if (!valid) return null;

  return parsed.slice(0, MAX_RESTORED_ARRAY_LENGTH) as StoredSuggestionItem[];
}

export function parseStoredShownIds(
  value: string | null,
  now = Date.now(),
): number[] | null {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) return null;

  const { ids, timestamp } = parsed;
  if (
    !Array.isArray(ids) ||
    !ids.every(isPositiveInteger) ||
    typeof timestamp !== "number" ||
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0 ||
    !Number.isFinite(now) ||
    timestamp > now ||
    now - timestamp >= SHOWN_IDS_TTL_MS
  ) {
    return null;
  }

  return ids.slice(0, MAX_RESTORED_ARRAY_LENGTH);
}

export function parseStoredPairHistory(value: string | null): string[] | null {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed) || !parsed.every((pair) => typeof pair === "string")) {
    return null;
  }

  return parsed.slice(0, MAX_RESTORED_ARRAY_LENGTH);
}

export function parseStoredPairwiseCount(value: string | null): number | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  if (!/^(?:0|[1-9]\d*)$/.test(value)) return null;

  const count = Number(value);
  if (
    !Number.isFinite(count) ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > PAIRWISE_SESSION_LIMIT
  ) {
    return null;
  }

  return count;
}
