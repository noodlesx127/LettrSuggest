/**
 * Structural/format TMDB metadata tags — describe film format or production context, not content taste.
 * These must never influence preference learning (neither positive nor negative).
 *
 * Updated: keep in sync with writeNegativeFeedback in blocked/route.ts and
 * updateFeaturePreferences / buildFeatureUpdates / extractFeatures in enrich.ts.
 */
export const TECHNICAL_METADATA_KEYWORDS = new Set([
  "aftercreditsstinger",
  "duringcreditsstinger",
  "reboot",
  "remake",
  "based on video game",
  "based on video game or app",
  "cameo",
  "mockumentary",
  "in medias res",
  "ensemble cast",
  "cinéma vérité",
  "found footage",
  "fourth wall",
]);

/**
 * Minimum number of positive feature-feedback signals required to override
 * a watch-history-based subgenre avoidance pattern.
 * When a user has explicitly liked this many films in a subgenre, that
 * explicit preference overrides the pattern-analysis avoidance signal.
 */
export const SUBGENRE_PREFER_OVERRIDE_THRESHOLD = 5;
