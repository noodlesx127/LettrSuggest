import type { WebRecommendationItem } from "@/lib/recommendationAdapters";
import { MAX_RECOMMENDATION_COUNT } from "@/lib/recommendationTypes";

const INVALID_RESPONSE_ERROR =
  "Recommendation service returned an invalid response";

export function parseCanonicalWebItems(
  payload: unknown,
): WebRecommendationItem[] {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("items" in payload) ||
    !Array.isArray(payload.items)
  ) {
    throw new Error(INVALID_RESPONSE_ERROR);
  }

  return payload.items as WebRecommendationItem[];
}

function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value > 0
  );
}

/**
 * Parse the bounded canonical web `preRanks` payload into a pre-rerank rank
 * map keyed by TMDB id. Fails closed on any malformed shape: a missing or
 * non-array field, an oversized entry list, a non-tuple entry, or a non
 * positive-safe-integer id or rank. Repeated ids keep the first rank so a
 * corrupted payload can never surface a later, unvalidated rank.
 */
export function parseCanonicalWebPreRanks(
  payload: unknown,
): Map<number, number> {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("preRanks" in payload) ||
    !Array.isArray(payload.preRanks) ||
    payload.preRanks.length > MAX_RECOMMENDATION_COUNT
  ) {
    throw new Error(INVALID_RESPONSE_ERROR);
  }

  const preRanksById = new Map<number, number>();
  for (const entry of payload.preRanks) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !isPositiveSafeInteger(entry[0]) ||
      !isPositiveSafeInteger(entry[1])
    ) {
      throw new Error(INVALID_RESPONSE_ERROR);
    }
    if (!preRanksById.has(entry[0])) {
      preRanksById.set(entry[0], entry[1]);
    }
  }

  return preRanksById;
}
