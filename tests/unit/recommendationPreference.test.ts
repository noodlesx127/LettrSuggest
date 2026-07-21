import { describe, expect, it } from "vitest";
import {
  classifyPreferenceProbability,
  normalizeFeatureKey,
} from "@/lib/recommendationPreference";
import { buildFeatureFeedbackFromRows } from "@/lib/serverSuggestionsEngine";

describe("classifyPreferenceProbability", () => {
  it.each([
    [0.49, "negative"],
    [0.5, "neutral"],
    [0.51, "positive"],
  ] as const)("classifies %s as %s", (value, expected) => {
    expect(classifyPreferenceProbability(value)).toBe(expected);
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "treats %s as neutral",
    (value) => {
      expect(classifyPreferenceProbability(value)).toBe("neutral");
    },
  );

  it.each([
    ["0.49", "negative"],
    ["0.5", "neutral"],
    ["0.51", "positive"],
    ["negative", "negative"],
    ["positive", "positive"],
  ] as const)("classifies legacy value %s as %s", (value, expected) => {
    expect(classifyPreferenceProbability(value)).toBe(expected);
  });

  it.each([-0.01, 1.01, "-0.01", "1.01"])(
    "treats out-of-range value %s as neutral",
    (value) => {
      expect(classifyPreferenceProbability(value)).toBe("neutral");
    },
  );
});

describe("normalizeFeatureKey", () => {
  it("normalizes whitespace, case, and a plural feature type", () => {
    expect(normalizeFeatureKey(" Keywords ", "Time Travel")).toEqual({
      type: "keyword",
      id: "time travel",
    });
  });

  it.each([
    ["Actors", "actor"],
    ["Directors", "director"],
    ["Genres", "genre"],
    ["Sub-Genres", "subgenre"],
    ["Franchises", "collection"],
    ["Collections", "collection"],
  ])("canonicalizes %s to %s", (input, expected) => {
    expect(normalizeFeatureKey(input, "42")).toEqual({
      type: expected,
      id: "42",
    });
  });
});

describe("buildFeatureFeedbackFromRows", () => {
  it("uses probability polarity, ignores neutral rows, and normalizes feature types", () => {
    const feedback = buildFeatureFeedbackFromRows([
      {
        feature_id: 1,
        feature_name: "Negative",
        feature_type: "Keywords",
        inferred_preference: 0.49,
        positive_count: 1,
        negative_count: 3,
      },
      {
        feature_id: 2,
        feature_name: "Neutral",
        feature_type: "keyword",
        inferred_preference: 0.5,
        positive_count: 2,
        negative_count: 2,
      },
      {
        feature_id: 3,
        feature_name: "Positive",
        feature_type: "keyword",
        inferred_preference: 0.51,
        positive_count: 3,
        negative_count: 1,
      },
    ]);

    expect(feedback.avoidKeywords.map(({ id }) => id)).toEqual([1]);
    expect(feedback.preferKeywords.map(({ id }) => id)).toEqual([3]);
  });

  it("weights stronger negative probabilities above near-neutral negatives", () => {
    const feedback = buildFeatureFeedbackFromRows([
      {
        feature_id: 1,
        feature_name: "Near neutral",
        feature_type: "keyword",
        inferred_preference: 0.49,
        positive_count: 1,
        negative_count: 2,
      },
      {
        feature_id: 2,
        feature_name: "Strong negative",
        feature_type: "keyword",
        inferred_preference: 0,
        positive_count: 0,
        negative_count: 1,
      },
    ]);

    expect(
      feedback.avoidKeywords.map(({ id, weight }) => ({ id, weight })),
    ).toEqual([
      { id: 2, weight: 1 },
      { id: 1, weight: 0.51 },
    ]);
  });

  it("uses positive evidence when a strong signal overrides a negative subgenre probability", () => {
    const feedback = buildFeatureFeedbackFromRows([
      {
        feature_id: 99,
        feature_name: " Cosmic Horror ",
        feature_type: "Sub-Genres",
        inferred_preference: 0.1,
        positive_count: 10,
        negative_count: 2,
      },
    ]);

    expect(feedback.avoidSubgenres).toEqual([]);
    expect(feedback.preferSubgenres).toEqual([
      { key: "cosmic horror", weight: 10, count: 10 },
    ]);
  });
});
