const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export function parseSimilarityLimit(value: unknown): number | null {
  if (value === undefined || value === null) return DEFAULT_LIMIT;

  let numericValue: number;
  try {
    numericValue = Number(value);
  } catch {
    return null;
  }

  if (!Number.isFinite(numericValue) || !Number.isInteger(numericValue)) {
    return null;
  }

  return Math.min(MAX_LIMIT, Math.max(1, numericValue));
}
