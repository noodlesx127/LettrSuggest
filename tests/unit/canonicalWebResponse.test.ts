import { describe, expect, it } from "vitest";

import {
  parseCanonicalWebItems,
  parseCanonicalWebPreRanks,
} from "@/lib/canonicalWebResponse";
import { MAX_RECOMMENDATION_COUNT } from "@/lib/recommendationTypes";

const INVALID_RESPONSE_ERROR =
  "Recommendation service returned an invalid response";

describe("parseCanonicalWebItems", () => {
  it("returns the original items array in order", () => {
    const items = [
      { id: 101, title: "First", reasons: [], score: 0.9 },
      { id: 202, title: "Second", reasons: [], score: 0.8 },
    ];

    const parsed = parseCanonicalWebItems({ items });

    expect(parsed).toBe(items);
    expect(parsed).toEqual(items);
  });

  it.each([
    undefined,
    null,
    "invalid",
    {},
    { items: undefined },
    { items: {} },
  ])("throws for malformed payload %#", (payload) => {
    expect(() => parseCanonicalWebItems(payload)).toThrowError(
      new Error(INVALID_RESPONSE_ERROR),
    );
  });
});

describe("parseCanonicalWebPreRanks", () => {
  it("parses a bounded [id, rank] tuple array into a Map", () => {
    const parsed = parseCanonicalWebPreRanks({
      preRanks: [
        [11, 3],
        [22, 1],
        [33, 2],
      ],
    });

    expect(parsed).toBeInstanceOf(Map);
    expect([...parsed.entries()]).toEqual([
      [11, 3],
      [22, 1],
      [33, 2],
    ]);
  });

  it("dedupes repeated ids, keeping the first rank", () => {
    const parsed = parseCanonicalWebPreRanks({
      preRanks: [
        [11, 3],
        [11, 9],
      ],
    });

    expect(parsed.get(11)).toBe(3);
    expect(parsed.size).toBe(1);
  });

  it("accepts an empty preRanks array", () => {
    expect(parseCanonicalWebPreRanks({ preRanks: [] }).size).toBe(0);
  });

  it("accepts the maximum bounded number of entries", () => {
    const preRanks = Array.from(
      { length: MAX_RECOMMENDATION_COUNT },
      (_, index) => [index + 1, index + 1],
    );

    expect(parseCanonicalWebPreRanks({ preRanks }).size).toBe(
      MAX_RECOMMENDATION_COUNT,
    );
  });

  it.each([
    undefined,
    null,
    "invalid",
    {},
    { preRanks: undefined },
    { preRanks: {} },
    { preRanks: "nope" },
    // Non-tuple entries.
    { preRanks: [11] },
    { preRanks: [[11]] },
    { preRanks: [[11, 3, 4]] },
    { preRanks: [null] },
    // Invalid ids.
    { preRanks: [[0, 3]] },
    { preRanks: [[-1, 3]] },
    { preRanks: [[1.5, 3]] },
    { preRanks: [["11", 3]] },
    { preRanks: [[Number.NaN, 3]] },
    // Invalid ranks.
    { preRanks: [[11, 0]] },
    { preRanks: [[11, -3]] },
    { preRanks: [[11, 1.5]] },
    { preRanks: [[11, "3"]] },
    { preRanks: [[11, Number.NaN]] },
  ])("fails closed for malformed payload %#", (payload) => {
    expect(() => parseCanonicalWebPreRanks(payload)).toThrowError(
      new Error(INVALID_RESPONSE_ERROR),
    );
  });

  it("fails closed when the entry count exceeds the bounded maximum", () => {
    const preRanks = Array.from(
      { length: MAX_RECOMMENDATION_COUNT + 1 },
      (_, index) => [index + 1, index + 1],
    );

    expect(() => parseCanonicalWebPreRanks({ preRanks })).toThrowError(
      new Error(INVALID_RESPONSE_ERROR),
    );
  });
});
