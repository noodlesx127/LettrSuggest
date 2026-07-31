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

const validOptionalFields = {
  year: "2024",
  collectionName: "Modern Mysteries",
  overview: "A thoughtful mystery.",
  imdb_rating: "8.1",
  rotten_tomatoes: "95%",
  metacritic: "87",
  awards: "Best Picture",
  original_language: "en",
  explanation: "It matches your recent favorites.",
  poster_path: "/poster.jpg",
  trailerKey: null,
  vote_average: 8.2,
  vote_count: 1234,
  reliabilityMultiplier: 0.9,
  runtime: 120,
  critic_score: 91,
  dismissed: false,
  voteCategory: "hidden-gem",
  imdb_source: "omdb",
  consensusLevel: "high",
  genres: ["Drama", "Mystery"],
  sources: ["tmdb", "watchmode"],
  spoken_languages: ["English"],
  production_countries: ["US"],
  keyword_names: ["neo-noir"],
  streamingSources: [
    {
      name: "Example Streamer",
      type: "sub",
      url: "https://example.com/title/101",
    },
  ],
  contributingFilms: {
    sharedTaste: [{ id: 202, title: "Another valid film" }],
  },
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

  it.each<[Record<string, unknown>, string]>([
    [{ ...validItem, year: 2024 }, "non-string year"],
    [{ ...validItem, collectionName: 123 }, "non-string collection name"],
    [{ ...validItem, overview: false }, "non-string overview"],
    [{ ...validItem, imdb_rating: 8.1 }, "non-string IMDb rating"],
    [{ ...validItem, rotten_tomatoes: null }, "non-string Rotten Tomatoes rating"],
    [{ ...validItem, metacritic: [] }, "non-string Metacritic rating"],
    [{ ...validItem, awards: {} }, "non-string awards"],
    [{ ...validItem, original_language: 42 }, "non-string original language"],
    [{ ...validItem, explanation: true }, "non-string explanation"],
    [{ ...validItem, poster_path: 123 }, "invalid nullable poster path"],
    [{ ...validItem, trailerKey: false }, "invalid nullable trailer key"],
    [{ ...validItem, vote_average: Number.NaN }, "NaN vote average"],
    [{ ...validItem, vote_count: "1234" }, "non-number vote count"],
    [
      { ...validItem, reliabilityMultiplier: "0.9" },
      "non-number reliability multiplier",
    ],
    [{ ...validItem, runtime: null }, "JSON-representable NaN runtime"],
    [{ ...validItem, critic_score: true }, "non-number critic score"],
    [{ ...validItem, dismissed: "false" }, "non-boolean dismissed flag"],
    [{ ...validItem, voteCategory: "unknown" }, "invalid vote category"],
    [{ ...validItem, imdb_source: "letterboxd" }, "invalid IMDb source"],
    [{ ...validItem, consensusLevel: "excellent" }, "invalid consensus level"],
    [{ ...validItem, genres: "Drama" }, "non-array genres"],
    [{ ...validItem, genres: ["Drama", 42] }, "non-string genre member"],
    [{ ...validItem, sources: "tmdb" }, "non-array sources"],
    [{ ...validItem, sources: ["tmdb", 42] }, "non-string source member"],
    [{ ...validItem, spoken_languages: {} }, "non-array spoken languages"],
    [
      { ...validItem, spoken_languages: ["English", null] },
      "non-string spoken language member",
    ],
    [
      { ...validItem, production_countries: "US" },
      "non-array production countries",
    ],
    [
      { ...validItem, production_countries: ["US", false] },
      "non-string production country member",
    ],
    [{ ...validItem, keyword_names: 42 }, "non-array keyword names"],
    [
      { ...validItem, keyword_names: ["neo-noir", {}] },
      "non-string keyword name member",
    ],
    [{ ...validItem, streamingSources: {} }, "non-array streaming sources"],
    [
      {
        ...validItem,
        streamingSources: [{ name: "Example Streamer", type: "invalid" }],
      },
      "invalid streaming source type",
    ],
    [
      {
        ...validItem,
        streamingSources: [{ name: 123, type: "sub" }],
      },
      "non-string streaming source name",
    ],
    [
      {
        ...validItem,
        streamingSources: [
          { name: "Example Streamer", type: "sub", url: 123 },
        ],
      },
      "non-string streaming source URL",
    ],
    [{ ...validItem, contributingFilms: [] }, "array contributing films"],
    [
      { ...validItem, contributingFilms: { sharedTaste: "not an array" } },
      "non-array contributing film group",
    ],
    [
      {
        ...validItem,
        contributingFilms: { sharedTaste: [{ id: 0, title: "Invalid film" }] },
      },
      "non-positive contributing film ID",
    ],
    [
      {
        ...validItem,
        contributingFilms: { sharedTaste: [{ id: 202, title: 123 }] },
      },
      "non-string contributing film title",
    ],
  ])("rejects malformed known optional fields: %s", (item, _reason) => {
    expect(parseStoredSuggestionItems(JSON.stringify([item]))).toBeNull();
  });

  it("sanitizes unknown fields while preserving a valid optional payload", () => {
    const restored = parseStoredSuggestionItems(
      JSON.stringify([
        {
          ...validItem,
          ...validOptionalFields,
          unknownField: "must be dropped",
          unknownObject: { privateValue: "must be dropped" },
        },
      ]),
    );

    expect(restored).toEqual([{ ...validItem, ...validOptionalFields }]);
    expect(restored?.[0]).not.toHaveProperty("unknownField");
    expect(restored?.[0]).not.toHaveProperty("unknownObject");
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
