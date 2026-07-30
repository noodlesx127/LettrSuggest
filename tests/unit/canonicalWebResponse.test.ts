import { describe, expect, it } from "vitest";

import { parseCanonicalWebItems } from "@/lib/canonicalWebResponse";

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
