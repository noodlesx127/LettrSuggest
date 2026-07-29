import { describe, expect, it } from "vitest";

import { parseSimilarityLimit } from "@/lib/vectorSimilarityLimit";

describe("vector similarity limit validation", () => {
  it.each([2.5, Number.NaN, Number.POSITIVE_INFINITY, "2.5", "NaN"])(
    "rejects non-integer or non-finite limit %s",
    (limit) => {
      expect(parseSimilarityLimit(limit)).toBeNull();
    },
  );

  it.each([undefined, null, 2, "2", 0, 100])(
    "returns an integer RPC limit for %s",
    (limit) => {
      const parsed = parseSimilarityLimit(limit);

      expect(parsed).toEqual(expect.any(Number));
      expect(Number.isSafeInteger(parsed)).toBe(true);
    },
  );
});
