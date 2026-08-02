import { describe, expect, it } from "vitest";

import {
  assertCompleteImportManifest,
  assertNonEmptyImportSnapshot,
  assertRecognizedImportFiles,
  assignImportGroup,
  classifyImportPath,
  countRecognizedImportFiles,
  ImportParseError,
  parseImportCsv,
  resolveImportFailure,
  selectImportUpload,
  type ParsedImportData,
} from "@/lib/importParse";
import type { FilmEvent } from "@/lib/normalize";

function film(uri: string): FilmEvent {
  return { uri, title: "Film", year: 2020 };
}

describe("import parse fail-closed validation", () => {
  it("counts only recognized, non-empty Letterboxd file groups", () => {
    expect(
      countRecognizedImportFiles({
        watched: [{ a: "1" }],
        diary: [],
        ratings: [{ b: "2" }],
        lists: [],
      }),
    ).toBe(2);
    expect(countRecognizedImportFiles({})).toBe(0);
    expect(countRecognizedImportFiles({ watched: [] })).toBe(0);
  });

  it("fails closed when no recognized Letterboxd files are present", () => {
    expect(() => assertRecognizedImportFiles({})).toThrow(ImportParseError);
    expect(() => assertRecognizedImportFiles({ watched: [] })).toThrow(
      /no recognized letterboxd/i,
    );
    expect(() => assertRecognizedImportFiles({ lists: [] })).toThrow(
      ImportParseError,
    );
  });

  it("accepts a selection containing at least one recognized file group", () => {
    expect(() =>
      assertRecognizedImportFiles({ watched: [{ uri: "x" }] }),
    ).not.toThrow();
    expect(() =>
      assertRecognizedImportFiles({ watchlist: [{ uri: "y" }] }),
    ).not.toThrow();
  });

  it("fails closed on an unexpectedly empty normalized snapshot", () => {
    expect(() =>
      assertNonEmptyImportSnapshot({ films: [], watchEvents: [] }),
    ).toThrow(ImportParseError);
    expect(() =>
      assertNonEmptyImportSnapshot({ films: [], watchEvents: [] }),
    ).toThrow(/no films/i);
  });

  it("accepts a normalized snapshot that contains films", () => {
    expect(() =>
      assertNonEmptyImportSnapshot({
        films: [film("https://letterboxd.com/film/a/")],
        watchEvents: [],
      }),
    ).not.toThrow();
  });
});

describe("assertCompleteImportManifest (full six-file snapshot guard)", () => {
  // The six source groups consumed by normalizeData. A full reconciliation
  // deletes absent categories, so all six must be present before it may run.
  const complete = {
    watched: [{ uri: "w" }],
    diary: [{ uri: "d" }],
    ratings: [{ uri: "r" }],
    watchlist: [{ uri: "wl" }],
    likesFilms: [{ uri: "l" }],
    reviews: [{ uri: "rv" }],
  };

  it("accepts a complete manifest with all six source groups present", () => {
    expect(() => assertCompleteImportManifest(complete)).not.toThrow();
  });

  it("counts a zero-row CSV as present (presence, not row count)", () => {
    // A valid export can contain an empty CSV; the group is still present and
    // must not be treated as missing.
    expect(() =>
      assertCompleteImportManifest({
        watched: [],
        diary: [],
        ratings: [],
        watchlist: [],
        likesFilms: [],
        reviews: [],
      }),
    ).not.toThrow();
  });

  it("tolerates extra recognized groups (lists/tags) alongside the six", () => {
    expect(() =>
      assertCompleteImportManifest({
        ...complete,
        lists: [{ uri: "list" }],
        tags: [{ uri: "tag" }],
      }),
    ).not.toThrow();
  });

  it("fails closed on a partial selection missing any required group", () => {
    const { ratings, ...partial } = complete;
    void ratings;
    let caught: unknown;
    try {
      assertCompleteImportManifest(partial);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ImportParseError);
    expect((caught as ImportParseError).code).toBe("INCOMPLETE_MANIFEST");
    // Actionable: names the missing group(s).
    expect((caught as Error).message).toMatch(/ratings/);
  });

  it("names every missing group when several are absent", () => {
    let caught: unknown;
    try {
      assertCompleteImportManifest({ watched: [{ uri: "w" }] });
    } catch (e) {
      caught = e;
    }
    const message = (caught as Error).message;
    expect(message).toMatch(/diary/);
    expect(message).toMatch(/ratings/);
    expect(message).toMatch(/watchlist/);
    expect(message).toMatch(/reviews/);
  });

  it("fails closed on an empty selection", () => {
    expect(() => assertCompleteImportManifest({})).toThrow(
      ImportParseError,
    );
  });

  it("fails closed when only non-source groups (lists/tags) are present", () => {
    expect(() =>
      assertCompleteImportManifest({ lists: [{ uri: "x" }], tags: [] }),
    ).toThrow(/incomplete letterboxd export/i);
  });
});

describe("parseImportCsv (Papa-backed, fail-closed)", () => {
  it("returns rows keyed by BOM-stripped, trimmed headers", () => {
    const rows = parseImportCsv("\uFEFF Name , Year \nAlien,1979\n");
    expect(rows).toEqual([{ Name: "Alien", Year: "1979" }]);
  });

  it("skips blank lines without producing empty rows", () => {
    const rows = parseImportCsv("Name,Year\nAlien,1979\n\n");
    expect(rows).toEqual([{ Name: "Alien", Year: "1979" }]);
  });

  it("parses multiple data rows in order", () => {
    const rows = parseImportCsv("Name,Year\nAlien,1979\nHeat,1995");
    expect(rows).toEqual([
      { Name: "Alien", Year: "1979" },
      { Name: "Heat", Year: "1995" },
    ]);
  });

  it("throws ImportParseError when the parser reports errors", () => {
    // An unterminated quoted field is a deterministic parser error.
    let caught: unknown;
    try {
      parseImportCsv('Name,Year\n"Unclosed,1979');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ImportParseError);
    expect((caught as ImportParseError).code).toBe("CSV_PARSE_ERROR");
  });
});

describe("classifyImportPath (root-path classification)", () => {
  it("classifies required files at the export root", () => {
    expect(classifyImportPath("watched.csv")).toBe("watched");
    expect(classifyImportPath("diary.csv")).toBe("diary");
    expect(classifyImportPath("ratings.csv")).toBe("ratings");
    expect(classifyImportPath("watchlist.csv")).toBe("watchlist");
    expect(classifyImportPath("reviews.csv")).toBe("reviews");
    expect(classifyImportPath("tags.csv")).toBe("tags");
  });

  it("allows a single wrapper/root folder from a ZIP or folder export", () => {
    expect(classifyImportPath("letterboxd-export/watched.csv")).toBe("watched");
    expect(classifyImportPath("export/diary.csv")).toBe("diary");
    expect(classifyImportPath("export/likes/films.csv")).toBe("likesFilms");
    expect(classifyImportPath("export/lists/anything.csv")).toBe("lists");
  });

  it("does not recognize required files in nested arbitrary directories", () => {
    expect(classifyImportPath("a/b/watched.csv")).toBeNull();
    expect(classifyImportPath("export/sub/diary.csv")).toBeNull();
    expect(classifyImportPath("deeply/nested/path/ratings.csv")).toBeNull();
  });

  it("normalizes Windows backslash separators", () => {
    expect(classifyImportPath("export\\watched.csv")).toBe("watched");
    expect(classifyImportPath("likes\\films.csv")).toBe("likesFilms");
    expect(classifyImportPath("export\\lists\\foo.csv")).toBe("lists");
    expect(classifyImportPath("a\\b\\diary.csv")).toBeNull();
  });

  it("classifies likes/films.csv (and only films.csv under likes)", () => {
    expect(classifyImportPath("likes/films.csv")).toBe("likesFilms");
    expect(classifyImportPath("likes/other.csv")).toBeNull();
    // A bare films.csv at the root is not a recognized Letterboxd group.
    expect(classifyImportPath("films.csv")).toBeNull();
  });

  it("accepts likes/films.csv only at the root or under a single wrapper", () => {
    expect(classifyImportPath("likes/films.csv")).toBe("likesFilms");
    expect(classifyImportPath("export/likes/films.csv")).toBe("likesFilms");
    expect(classifyImportPath("wrapper\\likes\\films.csv")).toBe("likesFilms");
  });

  it("rejects likes/films.csv under deeper arbitrary nesting", () => {
    expect(classifyImportPath("a/b/likes/films.csv")).toBeNull();
    expect(classifyImportPath("export/sub/likes/films.csv")).toBeNull();
    expect(classifyImportPath("deeply/nested/path/likes/films.csv")).toBeNull();
    expect(classifyImportPath("a\\b\\likes\\films.csv")).toBeNull();
  });

  it("keeps lists/ collision precedence over likes for mixed wrappers", () => {
    // A likes/films.csv nested under lists/ is an aggregated list entry, never
    // a likesFilms manifest group, regardless of wrapper depth.
    expect(classifyImportPath("lists/likes/films.csv")).toBe("lists");
    expect(classifyImportPath("export/lists/likes/films.csv")).toBe("lists");
  });

  it("classifies any CSV under lists/ as lists BEFORE basename checks", () => {
    // The collision cases: these basenames are required manifest groups, but
    // under lists/ they are aggregated list entries, never required groups.
    expect(classifyImportPath("lists/diary.csv")).toBe("lists");
    expect(classifyImportPath("lists/watched.csv")).toBe("lists");
    expect(classifyImportPath("lists/ratings.csv")).toBe("lists");
    expect(classifyImportPath("lists/my-list.csv")).toBe("lists");
    expect(classifyImportPath("export/lists/watched.csv")).toBe("lists");
    expect(classifyImportPath("lists\\watched.csv")).toBe("lists");
  });

  it("ignores deleted/ and orphaned/ directories anywhere in the path", () => {
    expect(classifyImportPath("deleted/watched.csv")).toBeNull();
    expect(classifyImportPath("orphaned/ratings.csv")).toBeNull();
    expect(classifyImportPath("export/deleted/diary.csv")).toBeNull();
    expect(classifyImportPath("export\\orphaned\\watched.csv")).toBeNull();
    expect(classifyImportPath("lists/deleted/foo.csv")).toBeNull();
  });

  it("ignores non-CSV entries", () => {
    expect(classifyImportPath("watched.txt")).toBeNull();
    expect(classifyImportPath("lists/foo.txt")).toBeNull();
    expect(classifyImportPath("")).toBeNull();
  });
});

describe("assignImportGroup (duplicate required-file guard)", () => {
  it("assigns a required group once", () => {
    const data: ParsedImportData = {};
    assignImportGroup(data, "watched", [{ uri: "a" }]);
    expect(data.watched).toEqual([{ uri: "a" }]);
  });

  it("fails closed when a required group is assigned twice", () => {
    const data: ParsedImportData = {};
    assignImportGroup(data, "watched", [{ uri: "a" }]);
    let caught: unknown;
    try {
      assignImportGroup(data, "diary", [{ uri: "x" }]);
      assignImportGroup(data, "watched", [{ uri: "b" }]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ImportParseError);
    expect((caught as ImportParseError).code).toBe("DUPLICATE_IMPORT_FILE");
    // The first assignment is retained, never overwritten.
    expect(data.watched).toEqual([{ uri: "a" }]);
  });

  it("aggregates lists across multiple files instead of failing", () => {
    const data: ParsedImportData = {};
    assignImportGroup(data, "lists", [{ uri: "l1" }]);
    assignImportGroup(data, "lists", [{ uri: "l2" }]);
    expect(data.lists).toEqual([{ uri: "l1" }, { uri: "l2" }]);
  });
});

describe("import failure retry resolution", () => {
  it("returns the upload step so the UI is actionable again", () => {
    const resolution = resolveImportFailure(new Error("Cloud save failed"));
    expect(resolution.step).toBe("upload");
  });

  it("truthfully tells the user to select the export again", () => {
    const resolution = resolveImportFailure(new Error("schema cache stale"));
    expect(resolution.message).toMatch(/select your letterboxd export again/i);
    expect(resolution.message).toMatch(/schema cache stale/);
  });

  it("handles non-Error failures without crashing", () => {
    const resolution = resolveImportFailure("boom");
    expect(resolution.step).toBe("upload");
    expect(resolution.message).toMatch(/select your letterboxd export again/i);
  });
});

describe("selectImportUpload (ZIP-only upload contract)", () => {
  it("accepts a single ZIP file", () => {
    const selection = selectImportUpload([{ name: "letterboxd-export.zip" }]);
    expect(selection).toEqual({
      kind: "zip",
      file: { name: "letterboxd-export.zip" },
    });
  });

  it("accepts a ZIP case-insensitively and preserves the selected file", () => {
    const zip = { name: "My Export.ZIP" };
    const selection = selectImportUpload([zip]);
    expect(selection.kind).toBe("zip");
    if (selection.kind === "zip") {
      expect(selection.file).toBe(zip);
    }
  });

  it("rejects an empty selection with an actionable message", () => {
    const selection = selectImportUpload([]);
    expect(selection.kind).toBe("rejected");
    if (selection.kind === "rejected") {
      expect(selection.message).toMatch(/zip/i);
    }
  });

  it("rejects loose CSV files instead of silently ignoring them", () => {
    const selection = selectImportUpload([
      { name: "watched.csv" },
      { name: "diary.csv" },
    ]);
    expect(selection.kind).toBe("rejected");
    if (selection.kind === "rejected") {
      expect(selection.message).toMatch(/zip/i);
      expect(selection.message).toMatch(/csv/i);
    }
  });

  it("rejects a single loose CSV (folder/multi-CSV is not a supported path)", () => {
    const selection = selectImportUpload([{ name: "watched.csv" }]);
    expect(selection.kind).toBe("rejected");
  });

  it("rejects non-ZIP unsupported file types", () => {
    const selection = selectImportUpload([{ name: "export.tar.gz" }]);
    expect(selection.kind).toBe("rejected");
    if (selection.kind === "rejected") {
      expect(selection.message).toMatch(/zip/i);
    }
  });

  it("rejects multiple ZIPs so the choice is unambiguous", () => {
    const selection = selectImportUpload([
      { name: "a.zip" },
      { name: "b.zip" },
    ]);
    expect(selection.kind).toBe("rejected");
    if (selection.kind === "rejected") {
      expect(selection.message).toMatch(/single/i);
    }
  });

  it("prefers rejecting mixed ZIP+CSV over silently picking one", () => {
    const selection = selectImportUpload([
      { name: "export.zip" },
      { name: "watched.csv" },
    ]);
    expect(selection.kind).toBe("rejected");
  });
});
