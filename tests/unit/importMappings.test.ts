import { describe, expect, it, vi } from "vitest";

import {
  loadAllExistingMappings,
  mergeImportMappings,
  selectFilmsToEnrich,
  type EnrichmentOutcome,
} from "@/lib/importMappings";

const FILM_A = "https://letterboxd.com/film/a/";
const FILM_B = "https://letterboxd.com/film/b/";
const FILM_C = "https://letterboxd.com/film/c/";
const FILM_GONE = "https://letterboxd.com/film/gone/";

describe("selectFilmsToEnrich (force controls search only)", () => {
  const titled = new Set([FILM_A, FILM_B, FILM_C]);
  const hasTitle = (uri: string) => titled.has(uri);

  it("skips already-mapped films when not forcing", () => {
    const existing = new Map([[FILM_A, 1]]);
    expect(
      selectFilmsToEnrich([FILM_A, FILM_B, FILM_C], hasTitle, existing, false),
    ).toEqual([FILM_B, FILM_C]);
  });

  it("searches every titled film when forcing, regardless of existing mapping", () => {
    const existing = new Map([[FILM_A, 1]]);
    expect(
      selectFilmsToEnrich([FILM_A, FILM_B, FILM_C], hasTitle, existing, true),
    ).toEqual([FILM_A, FILM_B, FILM_C]);
  });

  it("never searches films without a title", () => {
    const existing = new Map<string, number>();
    expect(
      selectFilmsToEnrich([FILM_GONE], hasTitle, existing, true),
    ).toEqual([]);
  });
});

describe("mergeImportMappings", () => {
  it("retains existing mappings for retained films and drops absent films", () => {
    const existing = new Map([
      [FILM_A, 1],
      [FILM_GONE, 99],
    ]);
    const merged = mergeImportMappings({
      filmUris: [FILM_A, FILM_B],
      existing,
      outcomes: [],
    });
    expect(merged).toEqual([{ uri: FILM_A, tmdbId: 1 }]);
  });

  it("replaces the mapping on a confirmed match", () => {
    const existing = new Map([[FILM_A, 1]]);
    const outcomes: EnrichmentOutcome[] = [
      { kind: "match", uri: FILM_A, tmdbId: 555 },
    ];
    expect(
      mergeImportMappings({ filmUris: [FILM_A], existing, outcomes }),
    ).toEqual([{ uri: FILM_A, tmdbId: 555 }]);
  });

  it("retains the old mapping on a confirmed no-match (force re-enrich safe)", () => {
    const existing = new Map([[FILM_A, 1]]);
    const outcomes: EnrichmentOutcome[] = [{ kind: "no-match", uri: FILM_A }];
    expect(
      mergeImportMappings({ filmUris: [FILM_A], existing, outcomes }),
    ).toEqual([{ uri: FILM_A, tmdbId: 1 }]);
  });

  it("adds a new mapping for a previously unmapped film that matches", () => {
    const existing = new Map<string, number>();
    const outcomes: EnrichmentOutcome[] = [
      { kind: "match", uri: FILM_B, tmdbId: 202 },
    ];
    expect(
      mergeImportMappings({ filmUris: [FILM_A, FILM_B], existing, outcomes }),
    ).toEqual([{ uri: FILM_B, tmdbId: 202 }]);
  });

  it("leaves a confirmed no-match film unmapped when there is no prior mapping", () => {
    const existing = new Map<string, number>();
    const outcomes: EnrichmentOutcome[] = [{ kind: "no-match", uri: FILM_C }];
    expect(
      mergeImportMappings({ filmUris: [FILM_C], existing, outcomes }),
    ).toEqual([]);
  });

  it("ignores outcomes for films not retained in the snapshot", () => {
    const existing = new Map<string, number>();
    const outcomes: EnrichmentOutcome[] = [
      { kind: "match", uri: FILM_GONE, tmdbId: 99 },
    ];
    expect(
      mergeImportMappings({ filmUris: [FILM_A], existing, outcomes }),
    ).toEqual([]);
  });
});

describe("loadAllExistingMappings (always loads everything, aborts on error)", () => {
  it("paginates through all pages until a short page", async () => {
    const pages = [
      Array.from({ length: 1000 }, (_, i) => ({ uri: `u${i}`, tmdb_id: i })),
      [{ uri: "last", tmdb_id: 9999 }],
    ];
    const fetchPage = vi.fn(async (from: number) => {
      const idx = from === 0 ? 0 : 1;
      return { data: pages[idx], error: null };
    });

    const result = await loadAllExistingMappings(fetchPage, 1000);
    expect(result.size).toBe(1001);
    expect(result.get("last")).toBe(9999);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("aborts when any page returns an error", async () => {
    const fetchPage = vi.fn(async (from: number) => {
      if (from === 0) {
        return { data: [{ uri: "u0", tmdb_id: 0 }], error: null };
      }
      return { data: null, error: { message: "boom" } };
    });

    await expect(loadAllExistingMappings(fetchPage, 1)).rejects.toThrow(
      /failed to load existing mappings/i,
    );
  });

  it("aborts when the fetch rejects", async () => {
    const fetchPage = vi.fn(async () => {
      throw new Error("network");
    });
    await expect(loadAllExistingMappings(fetchPage, 1000)).rejects.toThrow(
      /network/,
    );
  });
});
