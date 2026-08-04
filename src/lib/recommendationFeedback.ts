import {
  classifyPreferenceProbability,
  normalizeFeatureKey,
} from "@/lib/recommendationPreference";

export type FeatureFeedbackRow = {
  feature_id: number;
  feature_name: string;
  feature_type: string;
  inferred_preference: number | string | null;
  positive_count: number;
  negative_count: number;
};

type FeatureFeedbackItem = {
  id: number;
  name: string;
  weight: number;
  count: number;
};

type SubgenreFeedbackItem = {
  key: string;
  weight: number;
  count: number;
};

export type FeatureFeedback = {
  avoidActors: FeatureFeedbackItem[];
  avoidKeywords: FeatureFeedbackItem[];
  avoidFranchises: FeatureFeedbackItem[];
  avoidDirectors: FeatureFeedbackItem[];
  avoidGenres: FeatureFeedbackItem[];
  avoidSubgenres: SubgenreFeedbackItem[];
  preferActors: FeatureFeedbackItem[];
  preferKeywords: FeatureFeedbackItem[];
  preferDirectors: FeatureFeedbackItem[];
  preferGenres: FeatureFeedbackItem[];
  preferSubgenres: SubgenreFeedbackItem[];
};

const SUBGENRE_POSITIVE_OVERRIDE_MIN = 10;

function createEmptyFeatureFeedback(): FeatureFeedback {
  return {
    avoidActors: [],
    avoidKeywords: [],
    avoidFranchises: [],
    avoidDirectors: [],
    avoidGenres: [],
    avoidSubgenres: [],
    preferActors: [],
    preferKeywords: [],
    preferDirectors: [],
    preferGenres: [],
    preferSubgenres: [],
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function buildWeight(
  row: FeatureFeedbackRow,
  direction: "positive" | "negative",
): number {
  const signal = row.inferred_preference;
  const signalDirection = classifyPreferenceProbability(signal);
  const numericSignal =
    typeof signal === "number"
      ? signal
      : typeof signal === "string" && signal.trim() !== ""
        ? Number(signal)
        : Number.NaN;

  if (
    Number.isFinite(numericSignal) &&
    numericSignal >= 0 &&
    numericSignal <= 1 &&
    signalDirection === direction
  ) {
    return direction === "positive" ? numericSignal : 1 - numericSignal;
  }

  if (signalDirection === direction) return 1;

  const delta = Math.abs(row.positive_count - row.negative_count);
  const directionalCount =
    direction === "positive" ? row.positive_count : row.negative_count;

  return Math.max(0.25, delta, directionalCount);
}

function buildCount(
  row: FeatureFeedbackRow,
  direction: "positive" | "negative",
): number {
  return direction === "positive" ? row.positive_count : row.negative_count;
}

/** Pure feature-feedback normalization shared by production scoring inputs. */
export function buildFeatureFeedbackFromRows(
  rows: FeatureFeedbackRow[],
): FeatureFeedback {
  const feedback = createEmptyFeatureFeedback();

  for (const row of rows) {
    const preference = classifyPreferenceProbability(row.inferred_preference);
    if (preference === "neutral") continue;

    const isPositive = preference === "positive";
    const normalizedType = normalizeFeatureKey(
      row.feature_type,
      row.feature_id,
    ).type;
    const featureKey = normalizeFeatureKey(
      normalizedType,
      normalizedType === "subgenre" ? row.feature_name : row.feature_id,
    );

    if (featureKey.type === "subgenre") {
      // Strong explicit positive evidence protects a subgenre from inferred
      // pattern-analysis avoidance, matching the established production rule.
      const hasStrongPositive =
        row.positive_count >= SUBGENRE_POSITIVE_OVERRIDE_MIN;
      const effectiveIsPositive = hasStrongPositive
        ? true
        : (isPositive ?? false);
      const effectiveDirection = effectiveIsPositive ? "positive" : "negative";
      const target = effectiveIsPositive
        ? feedback.preferSubgenres
        : feedback.avoidSubgenres;
      target.push({
        key: featureKey.id,
        weight: buildWeight(row, effectiveDirection),
        count: buildCount(row, effectiveDirection),
      });
      continue;
    }

    const direction = isPositive ? "positive" : "negative";
    const numericId = Number(featureKey.id);
    if (!isFiniteNumber(numericId)) continue;

    const item = {
      id: numericId,
      name: row.feature_name,
      weight: buildWeight(row, direction),
      count: buildCount(row, direction),
    };

    switch (featureKey.type) {
      case "actor":
        if (isPositive) feedback.preferActors.push(item);
        else feedback.avoidActors.push(item);
        break;
      case "keyword":
        if (isPositive) feedback.preferKeywords.push(item);
        else feedback.avoidKeywords.push(item);
        break;
      case "director":
        if (isPositive) feedback.preferDirectors.push(item);
        else feedback.avoidDirectors.push(item);
        break;
      case "genre":
        if (isPositive) feedback.preferGenres.push(item);
        else feedback.avoidGenres.push(item);
        break;
      case "franchise":
      case "collection":
        if (!isPositive) feedback.avoidFranchises.push(item);
        break;
      default:
        break;
    }
  }

  feedback.avoidActors.sort((a, b) => b.weight - a.weight);
  feedback.avoidKeywords.sort((a, b) => b.weight - a.weight);
  feedback.avoidFranchises.sort((a, b) => b.weight - a.weight);
  feedback.avoidDirectors.sort((a, b) => b.weight - a.weight);
  feedback.avoidGenres.sort((a, b) => b.weight - a.weight);
  feedback.avoidSubgenres.sort((a, b) => b.weight - a.weight);
  feedback.preferActors.sort((a, b) => b.weight - a.weight);
  feedback.preferKeywords.sort((a, b) => b.weight - a.weight);
  feedback.preferDirectors.sort((a, b) => b.weight - a.weight);
  feedback.preferGenres.sort((a, b) => b.weight - a.weight);
  feedback.preferSubgenres.sort((a, b) => b.weight - a.weight);

  return feedback;
}

export function buildAdjacentGenreMap(
  rows: Array<{
    from_genre_name: string;
    to_genre_name: string;
    success_rate: number;
  }>,
): Map<string, Array<{ genre: string; weight: number }>> {
  const map = new Map<string, Array<{ genre: string; weight: number }>>();

  for (const row of rows) {
    if (!map.has(row.from_genre_name)) map.set(row.from_genre_name, []);
    map.get(row.from_genre_name)!.push({
      genre: row.to_genre_name,
      weight: row.success_rate,
    });
  }

  return map;
}
