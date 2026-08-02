import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the search provider and the server/cache detail seams so the tests
// exercise enrichMovieForImport's failure policy in isolation:
// - a search/provider failure must propagate (not be laundered to null)
// - a genuine empty search must return null
// - post-match server/cache detail failures may degrade but must still return
//   the confirmed mapping
vi.mock("@/lib/movieAPI", () => ({
  searchMovies: vi.fn(),
}));

vi.mock("@/app/actions/enrichment", () => ({
  enrichMovieServerSide: vi.fn(),
  upsertTmdbCacheAction: vi.fn(),
}));

import { enrichMovieForImport } from "@/lib/importEnrich";
import { searchMovies } from "@/lib/movieAPI";
import {
  enrichMovieServerSide,
  upsertTmdbCacheAction,
} from "@/app/actions/enrichment";

const searchedMovie = { id: 348, title: "Alien", year: 1979 };

describe("enrichMovieForImport (failure policy)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("propagates a search/provider rejection instead of returning null", async () => {
    // A provider error is not a confirmed no-match; laundering it to null would
    // let the import treat an API outage as "no mapping" and drop data.
    vi.mocked(searchMovies).mockRejectedValue(new Error("search boom"));

    await expect(enrichMovieForImport("Alien", 1979)).rejects.toThrow(
      /search boom/,
    );
  });

  it("returns null when the search genuinely finds no match", async () => {
    vi.mocked(searchMovies).mockResolvedValue([]);

    await expect(enrichMovieForImport("Unknown Film", 2001)).resolves.toBeNull();
  });

  it("returns the confirmed mapping when server-side detail enrichment fails", async () => {
    vi.mocked(searchMovies).mockResolvedValue([searchedMovie] as never[]);
    vi.mocked(enrichMovieServerSide).mockRejectedValue(
      new Error("server boom"),
    );
    vi.mocked(upsertTmdbCacheAction).mockResolvedValue({ error: null } as never);

    const result = await enrichMovieForImport("Alien", 1979);

    expect(result).not.toBeNull();
    expect(result?.id).toBe(348);
  });

  it("returns the confirmed mapping when the cache upsert fails", async () => {
    vi.mocked(searchMovies).mockResolvedValue([searchedMovie] as never[]);
    vi.mocked(enrichMovieServerSide).mockResolvedValue({} as never);
    vi.mocked(upsertTmdbCacheAction).mockRejectedValue(
      new Error("cache boom"),
    );

    const result = await enrichMovieForImport("Alien", 1979);

    expect(result).not.toBeNull();
    expect(result?.id).toBe(348);
  });

  it("returns the confirmed mapping when the cache upsert reports an error", async () => {
    vi.mocked(searchMovies).mockResolvedValue([searchedMovie] as never[]);
    vi.mocked(enrichMovieServerSide).mockResolvedValue({} as never);
    vi.mocked(upsertTmdbCacheAction).mockResolvedValue({
      error: "cache write failed",
    } as never);

    const result = await enrichMovieForImport("Alien", 1979);

    expect(result).not.toBeNull();
    expect(result?.id).toBe(348);
  });
});
