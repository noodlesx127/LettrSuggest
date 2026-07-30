import type { WebRecommendationItem } from "@/lib/recommendationAdapters";

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
