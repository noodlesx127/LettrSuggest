import Papa from "papaparse";

import type { FilmEvent, WatchEvent } from "@/lib/normalize";

/**
 * Fail-closed parse/validation and retry-state helpers for the import flow.
 * These are pure seams so the page can refuse destructive reconciliation on any
 * parse/read failure without coupling tests to React or Supabase.
 */

const RECOGNIZED_IMPORT_FILE_KEYS = [
  "watched",
  "diary",
  "ratings",
  "watchlist",
  "likesFilms",
  "reviews",
  "lists",
  "tags",
] as const;

export type ImportFileKind = (typeof RECOGNIZED_IMPORT_FILE_KEYS)[number];

export type ParsedImportData = Partial<Record<ImportFileKind, unknown[]>>;

export class ImportParseError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ImportParseError";
    this.code = code;
  }
}

export type ParsedImportRow = Record<string, string>;

/**
 * Classify one import entry path (ZIP entry name or dropped-file relative path)
 * into a logical ParsedImportData key, or null when the entry is not a
 * recognized Letterboxd file. Pure and side-effect free so both the ZIP and
 * direct-folder loops share one classification contract.
 *
 * Rules:
 *   - `/` and `\` separators are normalized; matching is case-insensitive.
 *   - Entries inside any `deleted/` or `orphaned/` directory are ignored.
 *   - Any CSV under a `lists/` directory is an aggregated `lists` entry, checked
 *     BEFORE basename matching, so `lists/diary.csv` and `lists/watched.csv` are
 *     lists and never required manifest groups.
 *   - `likes/films.csv` (optionally under one wrapper folder) is `likesFilms`.
 *   - The single-file required/recognized groups (watched, diary, ratings,
 *     watchlist, reviews, tags) are recognized ONLY at the export root, allowing
 *     a single wrapper/root folder from a ZIP or folder export. Nested arbitrary
 *     directories do not count.
 */
export function classifyImportPath(rawPath: string): ImportFileKind | null {
  const path = rawPath.replace(/\\/g, "/").toLowerCase().trim();
  if (!path) return null;

  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) return null;

  // Ignore anything inside a deleted/ or orphaned/ directory at any depth.
  if (segments.some((segment) => segment === "deleted" || segment === "orphaned")) {
    return null;
  }

  const fileName = segments[segments.length - 1];
  if (!fileName.endsWith(".csv")) return null;

  const dirSegments = segments.slice(0, -1);

  // lists/ wins before any basename check: every CSV under it is a list entry.
  if (dirSegments.includes("lists")) return "lists";

  // likes/films.csv at the export root or beneath a single wrapper folder only.
  // Deeper arbitrary nesting (for example a/b/likes/films.csv) is treated as an
  // unrelated file and ignored, mirroring the single-wrapper rule used for the
  // required single-file groups below.
  if (
    fileName === "films.csv" &&
    dirSegments[dirSegments.length - 1] === "likes" &&
    dirSegments.length <= 2
  ) {
    return "likesFilms";
  }

  // Required/recognized single-file groups live only at the export root, with at
  // most one wrapper folder. More than one directory level is treated as an
  // unrelated nested file and ignored.
  if (dirSegments.length > 1) return null;

  switch (fileName) {
    case "watched.csv":
      return "watched";
    case "diary.csv":
      return "diary";
    case "ratings.csv":
      return "ratings";
    case "watchlist.csv":
      return "watchlist";
    case "reviews.csv":
      return "reviews";
    case "tags.csv":
      return "tags";
    default:
      return null;
  }
}

/**
 * Assign parsed rows to a logical group, failing closed on a duplicate. `lists`
 * aggregates across multiple CSVs (many list files are expected); every other
 * group must be assigned at most once. A second required file (for example a
 * root `watched.csv` plus a wrapper `export/watched.csv`) is ambiguous and must
 * never silently overwrite the first, so it throws before reconciliation.
 */
export function assignImportGroup(
  data: ParsedImportData,
  key: ImportFileKind,
  rows: unknown[],
): void {
  if (key === "lists") {
    data.lists = [...(data.lists ?? []), ...rows];
    return;
  }
  if (Array.isArray(data[key])) {
    throw new ImportParseError(
      `Duplicate Letterboxd file for "${key}"; expected exactly one`,
      "DUPLICATE_IMPORT_FILE",
    );
  }
  data[key] = rows;
}

/**
 * Parse one Letterboxd CSV into clean rows using the Papa parser. Fails closed:
 * any parser error (for example an unterminated quoted field) throws an
 * ImportParseError so a partially-read file can never reach normalization or
 * reconciliation. Headers are BOM-stripped and trimmed so the first column of a
 * UTF-8-BOM export keys correctly.
 */
export function parseImportCsv(text: string): ParsedImportRow[] {
  const result = Papa.parse<ParsedImportRow>(text, {
    header: true,
    skipEmptyLines: true,
  });

  if (result.errors.length > 0) {
    const first = result.errors[0];
    throw new ImportParseError(
      `Failed to parse CSV: ${first.message}`,
      "CSV_PARSE_ERROR",
    );
  }

  return (result.data ?? [])
    .filter(Boolean)
    .map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key.replace(/^\uFEFF/, "").trim(),
          value,
        ]),
      ),
    );
}

/**
 * Count recognized Letterboxd file groups that actually contain rows. Empty
 * arrays and unknown keys do not count as a recognized export.
 */
export function countRecognizedImportFiles(data: ParsedImportData): number {
  return RECOGNIZED_IMPORT_FILE_KEYS.filter((key) => {
    const rows = data[key];
    return Array.isArray(rows) && rows.length > 0;
  }).length;
}

/**
 * Fail closed when the selection contained no recognized Letterboxd files. A
 * ZIP read failure or a folder of unrelated CSVs must never reach reconciliation.
 */
export function assertRecognizedImportFiles(data: ParsedImportData): void {
  if (countRecognizedImportFiles(data) === 0) {
    throw new ImportParseError(
      "No recognized Letterboxd files found in the selection",
      "NO_RECOGNIZED_FILES",
    );
  }
}

/**
 * The six source groups consumed by normalizeData. A full reconciliation makes
 * the cloud tables match the snapshot exactly and deletes any category that is
 * absent, so it may only run when all six groups are present. Presence (a parsed
 * array, even an empty one) counts; a valid export can contain a zero-row CSV.
 */
const REQUIRED_MANIFEST_GROUPS = [
  "watched",
  "diary",
  "ratings",
  "watchlist",
  "likesFilms",
  "reviews",
] as const;

/**
 * Fail closed on a partial export before normalization/reconciliation. Because a
 * full snapshot replace deletes absent categories, reconciling fewer than the
 * six source groups would silently destroy the user's data for the missing
 * groups. Every required group must be present as a parsed array (empty arrays
 * count). Extra recognized groups (lists/tags) are tolerated. The error names the
 * missing groups so the recovery is actionable.
 */
export function assertCompleteImportManifest(data: ParsedImportData): void {
  const missing = REQUIRED_MANIFEST_GROUPS.filter(
    (key) => !Array.isArray(data[key]),
  );
  if (missing.length > 0) {
    throw new ImportParseError(
      `Incomplete Letterboxd export: missing ${missing.join(", ")}. ` +
        "A full import replaces your cloud data and requires all six source " +
        "files (watched, diary, ratings, watchlist, likes/films, reviews). " +
        "Upload the complete export ZIP, or select all six CSVs together.",
      "INCOMPLETE_MANIFEST",
    );
  }
}

export type NormalizedImportSnapshot = {
  films: FilmEvent[];
  watchEvents: WatchEvent[];
};

/**
 * Fail closed on an unexpectedly empty normalized snapshot. A real export always
 * yields at least one film; an empty result indicates a parse/read problem and
 * must not trigger a destructive full-snapshot replace.
 */
export function assertNonEmptyImportSnapshot(
  snapshot: NormalizedImportSnapshot,
): void {
  if (!Array.isArray(snapshot.films) || snapshot.films.length === 0) {
    throw new ImportParseError(
      "Import produced no films; nothing to save",
      "EMPTY_SNAPSHOT",
    );
  }
}

/**
 * The upload UI is ZIP-only: a supported selection is exactly one Letterboxd
 * export ZIP and nothing else. Loose CSVs, folders, mixed selections, multiple
 * ZIPs, and other file types are rejected with an actionable message rather than
 * silently ignored, so the UI never advertises folder/multi-CSV traversal it
 * does not implement. Pure and File-agnostic (accepts any `{ name }`) so the
 * selection contract is unit-testable without a DOM.
 */
export type ImportUploadSelection<T> =
  | { kind: "zip"; file: T }
  | { kind: "rejected"; message: string };

export function selectImportUpload<T extends { name: string }>(
  files: T[],
): ImportUploadSelection<T> {
  if (files.length === 0) {
    return {
      kind: "rejected",
      message: "No file selected. Choose your complete Letterboxd export ZIP.",
    };
  }

  const isZip = (file: T): boolean =>
    file.name.toLowerCase().endsWith(".zip");
  const zipFiles = files.filter(isZip);
  const nonZipFiles = files.filter((file) => !isZip(file));

  // Any non-ZIP present means the selection is not the single-ZIP contract.
  if (nonZipFiles.length > 0) {
    const hasCsv = nonZipFiles.some((file) =>
      file.name.toLowerCase().endsWith(".csv"),
    );
    return {
      kind: "rejected",
      message: hasCsv
        ? "CSV files and folders are not supported here. Download your complete Letterboxd export ZIP and upload that single file."
        : "Unsupported file type. Upload your complete Letterboxd export ZIP.",
    };
  }

  if (zipFiles.length > 1) {
    return {
      kind: "rejected",
      message: "Multiple ZIP files selected. Choose a single Letterboxd export ZIP.",
    };
  }

  return { kind: "zip", file: zipFiles[0] };
}

export type ImportFailureResolution = {
  step: "upload";
  message: string;
};

/**
 * Resolve a failed import into an actionable UI state. The full parsed snapshot
 * is not persisted for replay (only local films survive in IndexedDB), so the
 * truthful recovery is to ask the user to select the export again.
 */
export function resolveImportFailure(error: unknown): ImportFailureResolution {
  const detail = error instanceof Error ? error.message : "Import failed";
  return {
    step: "upload",
    message: `${detail}. Please select your Letterboxd export again to retry.`,
  };
}
