import type { WebRecommendationItem } from "@/lib/recommendationAdapters";
import type {
  RecommendationDiagnostics,
  RecommendationTrace,
} from "@/lib/recommendationTypes";

export type CanonicalWebRecommendationItem = WebRecommendationItem;

export const METADATA_UNAVAILABLE_RECOMMENDATION_ERROR = {
  code: "METADATA_UNAVAILABLE",
  message:
    "Movie metadata is temporarily unavailable. Please retry suggestions.",
  retryable: true,
} as const;

export type CanonicalWebRecommendationError = {
  code: typeof METADATA_UNAVAILABLE_RECOMMENDATION_ERROR.code;
  message: typeof METADATA_UNAVAILABLE_RECOMMENDATION_ERROR.message;
  retryable: typeof METADATA_UNAVAILABLE_RECOMMENDATION_ERROR.retryable;
};

export type CanonicalWebRecommendationSuccess = {
  items: CanonicalWebRecommendationItem[];
  diagnostics: RecommendationDiagnostics;
  trace: RecommendationTrace;
  /**
   * Bounded serializable form of the engine's pre-rerank rank map: one
   * `[tmdbId, preRank]` tuple per final result (max 100). A Map cannot cross
   * the server action seam, so tuples are the canonical wire shape.
   */
  preRanks: ReadonlyArray<readonly [number, number]>;
};

export type CanonicalWebRecommendationFailure = {
  error: CanonicalWebRecommendationError;
};

export type CanonicalWebRecommendationResult =
  | CanonicalWebRecommendationSuccess
  | CanonicalWebRecommendationFailure;

export function createMetadataUnavailableRecommendationResult(): CanonicalWebRecommendationFailure {
  return {
    error: METADATA_UNAVAILABLE_RECOMMENDATION_ERROR,
  };
}

export function isCanonicalWebRecommendationFailure(
  result: CanonicalWebRecommendationResult,
): result is CanonicalWebRecommendationFailure {
  return "error" in result;
}
