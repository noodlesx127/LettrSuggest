import { describe, expect, it } from "vitest";

import {
  getSuggestionStorageKeys,
  parseStoredPairHistory,
  parseStoredPairwiseCount,
  parseStoredShownIds,
  parseStoredSuggestionItems,
} from "@/lib/suggestionStorage";

const now = 1_753_968_000_000;
const validItem = {
  id: 101,
  title: "A valid suggestion",
  reasons: ["Matches your profile"],
  score: 0.75,
};

describe("suggestion storage keys", () => {
  it("namespaces every user-owned key by the authenticated UID", () => {
    expect(getSuggestionStorageKeys("user-a")).toEqual({
      items: "lettrsuggest:user-a:items",
      shownIds: "lettrsuggest:user-a:shown_ids",
      pairHistory: "lettrsuggest:user-a:pair_history",
      pairwiseCount: "lettrsuggest:user-a:pairwise_count",
    });
    expect(getSuggestionStorageKeys("user-b")?.items).not.toBe(
      getSuggestionStorageKeys("user-a")?.items,
    );
  });

  it("does not create an anonymous or legacy global namespace", () => {
    expect(getSuggestionStorageKeys(null)).toBeNull();
    expect(getSuggestionStorageKeys("")).toBeNull();
    expect(getSuggestionStorageKeys("lettrsuggest_items")?.items).not.toBe(
      "lettrsuggest_items",
    );
  });
});

describe("parseStoredSuggestionItems", () => {
  it.each([
    [null, "missing payload"],
    ["not json", "malformed JSON"],
    [JSON.stringify({ items: [validItem] }), "non-array payload"],
    [JSON.stringify([]), "empty payload"],
    [
      JSON.stringify([{ ...validItem, id: 0 }]),
      "non-positive IDs",
    ],
    [
      JSON.stringify([{ ...validItem, id: -1 }]),
      "negative IDs",
    ],
    [
      JSON.stringify([{ ...validItem, id: Number.MAX_SAFE_INTEGER + 1 }]),
      "unsafe IDs",
    ],
    [
      JSON.stringify([{ ...validItem, score: null }]),
      "non-finite scores",
    ],
    [
      JSON.stringify([{ ...validItem, title: 123 }]),
      "non-string titles",
    ],
    [
      JSON.stringify([{ ...validItem, reasons: "reason" }]),
      "non-string reasons",
    ],
    [
      JSON.stringify([{ ...validItem, reasons: ["valid", 123] }]),
      "mixed reason values",
    ],
  ])("rejects %s", (payload, _reason) => {
    expect(parseStoredSuggestionItems(payload)).toBeNull();
  });

  it("accepts valid items and caps the restored array at 300 entries", () => {
    const restored = parseStoredSuggestionItems(
      JSON.stringify(
        Array.from({ length: 301 }, (_, index) => ({
          ...validItem,
          id: index + 1,
        })),
      ),
    );

    expect(restored).toHaveLength(300);
    expect(restored?.[0]).toEqual({ ...validItem, id: 1 });
  });
});

describe("parseStoredShownIds", () => {
  it.each([
    [null, "missing payload"],
    ["not json", "malformed JSON"],
    [JSON.stringify({ ids: [1] }), "missing timestamp"],
    [
      JSON.stringify({ ids: [1], timestamp: now - 7 * 24 * 60 * 60 * 1000 }),
      "expired payload",
    ],
    [
      JSON.stringify({ ids: [1], timestamp: now + 1 }),
      "future timestamp",
    ],
    [
      JSON.stringify({ ids: [1], timestamp: now - 0.5 }),
      "fractional timestamp",
    ],
    [
      JSON.stringify({ ids: "1", timestamp: now - 1000 }),
      "non-array IDs",
    ],
    [
      JSON.stringify({ ids: [0], timestamp: now - 1000 }),
      "non-positive IDs",
    ],
    [
      JSON.stringify({ ids: [1.5], timestamp: now - 1000 }),
      "non-integer IDs",
    ],
    [
      JSON.stringify({ ids: [1, "2"], timestamp: now - 1000 }),
      "non-numeric IDs",
    ],
  ])("rejects %s", (payload, _reason) => {
    expect(parseStoredShownIds(payload, now)).toBeNull();
  });

  it("accepts valid positive integer IDs and caps the array at 300", () => {
    const ids = Array.from({ length: 301 }, (_, index) => index + 1);
    const restored = parseStoredShownIds(
      JSON.stringify({ ids, timestamp: now - 1000 }),
      now,
    );

    expect(restored).toHaveLength(300);
    expect(restored?.slice(0, 3)).toEqual([1, 2, 3]);
  });
});

describe("parseStoredPairHistory", () => {
  it.each([
    [null, "missing payload"],
    ["not json", "malformed JSON"],
    [JSON.stringify({ pairs: ["1:2"] }), "non-array payload"],
    [JSON.stringify(["1:2", 2]), "non-string history entry"],
  ])("rejects %s", (payload, _reason) => {
    expect(parseStoredPairHistory(payload)).toBeNull();
  });

  it("accepts only string arrays and caps history at 300 entries", () => {
    const history = Array.from({ length: 301 }, (_, index) => `pair-${index}`);

    expect(parseStoredPairHistory(JSON.stringify(history))).toEqual(
      history.slice(0, 300),
    );
    expect(parseStoredPairHistory(JSON.stringify([]))).toEqual([]);
  });
});

describe("parseStoredPairwiseCount", () => {
  it.each([
    [null, "missing payload"],
    ["", "empty payload"],
    ["not a number", "malformed number"],
    ["-1", "negative count"],
    ["6", "count above the session limit"],
    ["1.5", "fractional count"],
    ["01", "non-canonical integer"],
    [" 1 ", "whitespace-padded count"],
    ["NaN", "non-finite count"],
    ["Infinity", "infinite count"],
  ])("rejects %s", (payload, _reason) => {
    expect(parseStoredPairwiseCount(payload)).toBeNull();
  });

  it.each([0, 1, 5])("accepts bounded count %s", (count) => {
    expect(parseStoredPairwiseCount(String(count))).toBe(count);
  });
});
