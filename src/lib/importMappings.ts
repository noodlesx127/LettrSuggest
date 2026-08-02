import type { ImportSnapshotMapping } from "@/lib/importSnapshot";

/**
 * Pure mapping load/merge seams for the import flow.
 *
 * Contract:
 * - ALL existing mappings are always loaded (force re-enrich controls search
 *   only, never whether prior mappings are known).
 * - Any page fetch error or rejection aborts the import.
 * - A confirmed match replaces the prior mapping.
 * - A confirmed no-match retains the prior mapping (so force re-enrich cannot
 *   silently drop a known mapping). API errors abort before merge.
 */

export type ExistingMappingRow = { uri: string; tmdb_id: number };

export type EnrichmentOutcome =
  | { kind: "match"; uri: string; tmdbId: number }
  | { kind: "no-match"; uri: string };

export type MappingPageFetcher = (
  from: number,
  to: number,
) => Promise<{
  data: ExistingMappingRow[] | null;
  error: { message: string } | null;
}>;

/**
 * Load every existing mapping for the user, paginating until a short page.
 * Throws on any page error or rejection so the caller aborts rather than
 * reconciling against a partial view of prior mappings.
 */
export async function loadAllExistingMappings(
  fetchPage: MappingPageFetcher,
  pageSize = 1000,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  let from = 0;

  for (;;) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) {
      throw new Error(`Failed to load existing mappings: ${error.message}`);
    }

    const rows = data ?? [];
    for (const row of rows) {
      result.set(row.uri, Number(row.tmdb_id));
    }

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return result;
}

/**
 * Decide which retained films to search. Force re-enrich searches every titled
 * film; otherwise already-mapped films are skipped. Titles are required to
 * search at all.
 */
export function selectFilmsToEnrich(
  filmUris: string[],
  hasTitle: (uri: string) => boolean,
  existing: Map<string, number>,
  forceReenrich: boolean,
): string[] {
  return filmUris.filter(
    (uri) => hasTitle(uri) && (forceReenrich || !existing.has(uri)),
  );
}

export type MergeImportMappingsInput = {
  filmUris: string[];
  existing: Map<string, number>;
  outcomes: EnrichmentOutcome[];
};

/**
 * Build the final mapping set for the snapshot. Starts from existing mappings
 * restricted to retained films, then applies enrichment outcomes: a match
 * replaces, a no-match keeps the prior mapping. Films with no prior mapping and
 * no confirmed match remain unmapped.
 */
export function mergeImportMappings(
  input: MergeImportMappingsInput,
): ImportSnapshotMapping[] {
  const filmSet = new Set(input.filmUris);
  const byUri = new Map<string, number>();

  for (const uri of filmSet) {
    const existing = input.existing.get(uri);
    if (existing != null) byUri.set(uri, existing);
  }

  for (const outcome of input.outcomes) {
    if (!filmSet.has(outcome.uri)) continue;
    if (outcome.kind === "match") {
      byUri.set(outcome.uri, outcome.tmdbId);
    }
    // no-match: retain whatever existing mapping is already present.
  }

  const mappings: ImportSnapshotMapping[] = [];
  for (const uri of filmSet) {
    const tmdbId = byUri.get(uri);
    if (tmdbId != null) mappings.push({ uri, tmdbId });
  }
  return mappings;
}
