export type PreferenceDirection = "negative" | "neutral" | "positive";

const FEATURE_TYPE_ALIASES: Record<string, string> = {
  actor: "actor",
  actors: "actor",
  collection: "collection",
  collections: "collection",
  director: "director",
  directors: "director",
  franchise: "collection",
  franchises: "collection",
  genre: "genre",
  genres: "genre",
  keyword: "keyword",
  keywords: "keyword",
  "sub-genre": "subgenre",
  "sub-genres": "subgenre",
  subgenre: "subgenre",
  subgenres: "subgenre",
};

export function classifyPreferenceProbability(
  value: unknown,
): PreferenceDirection {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "negative" || normalized === "positive") {
      return normalized;
    }
    if (normalized === "") return "neutral";
    value = Number(normalized);
  }

  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    return "neutral";
  }
  if (value < 0.5) return "negative";
  if (value > 0.5) return "positive";
  return "neutral";
}

export function normalizeFeatureKey(
  type: string,
  id: string | number,
): { type: string; id: string } {
  const normalizedType = type.trim().toLowerCase();

  return {
    type: FEATURE_TYPE_ALIASES[normalizedType] ?? normalizedType,
    id: String(id).trim().toLowerCase(),
  };
}
