import {
  deriveRecommendationMode,
  RECOMMENDATION_SOURCE_NAMES,
  type RecommendationEngineMode,
  type RecommendationInputHealth,
  type RecommendationSourceName,
  type SourceHealth,
} from "@/lib/recommendationTypes";
import {
  normalizeFilmTuples,
  type NormalizedFilmTuple,
} from "@/lib/recommendationNormalization";

export const RECOMMENDATION_CONTEXT_SOURCE_NAMES = [
  "films",
  "mappings",
  "metadata",
  "dates",
  "ratings",
  "features",
  "feedback",
  "exploration",
  "adjacent_genres",
  "exposures",
  "blocked",
] as const;

export type RecommendationContextSourceName =
  (typeof RECOMMENDATION_CONTEXT_SOURCE_NAMES)[number];

type RecordValue = Readonly<Record<string, unknown>>;

export type RecommendationFilmRecord = RecordValue & {
  uri: string;
  title?: string;
  year?: number | null;
  rating?: number | null;
  rewatch?: boolean | null;
  liked?: boolean | null;
  on_watchlist?: boolean | null;
  last_date?: string | null;
  lastDate?: string | null;
};

export type RecommendationMappingRecord = RecordValue & {
  uri: string;
  tmdbId: number;
};

export type RecommendationMetadataRecord = RecordValue & {
  tmdbId: number;
};

export type RecommendationDateRecord = RecordValue & {
  tmdbId?: number;
  uri?: string;
  watchedAt?: string | null;
  watched_at?: string | null;
  lastDate?: string | null;
  last_date?: string | null;
};

export type RecommendationRatingRecord = RecordValue & {
  tmdbId?: number;
  uri?: string;
  rating: number | null;
};

export type RecommendationFeatureRecord = RecordValue & {
  tmdbId: number;
};

export type RecommendationContextSourceResult<T> = Readonly<{
  data: readonly T[] | null;
  error?: unknown | null;
  health?: SourceHealth;
}>;

export type RecommendationContextSourceSnapshot = Readonly<{
  films: RecommendationContextSourceResult<RecommendationFilmRecord>;
  mappings: RecommendationContextSourceResult<
    RecommendationMappingRecord | (RecordValue & { uri: string; tmdb_id: number })
  >;
  metadata: RecommendationContextSourceResult<
    RecommendationMetadataRecord | (RecordValue & { tmdb_id: number })
  >;
  dates: RecommendationContextSourceResult<RecommendationDateRecord>;
  ratings: RecommendationContextSourceResult<RecommendationRatingRecord>;
  features: RecommendationContextSourceResult<
    RecommendationFeatureRecord | (RecordValue & { tmdb_id: number })
  >;
  inputHealth?: RecommendationInputHealth;
  sourceHealth?: Partial<
    Record<RecommendationContextSourceName, SourceHealth>
  >;
  sources?: Partial<
    Record<
      RecommendationContextSourceName,
      RecommendationContextSourceResult<RecordValue>
    >
  >;
  blockedTmdbIds?: readonly number[];
  hasPersonalizedEvidence?: boolean;
}>;

export type RecommendationContextRepository = Readonly<{
  load?: (
    userId: string,
  ) => Promise<RecommendationContextSourceSnapshot>;
  loadSources?: (
    userId: string,
  ) => Promise<RecommendationContextSourceSnapshot>;
  loadUserContext?: (userId: string) => Promise<unknown>;
}>;

export type RecommendationFilmTuple = NormalizedFilmTuple<
  RecommendationFilmRecord,
  RecommendationMetadataRecord,
  RecommendationFeatureRecord | null
> &
  Readonly<{
  mapping: RecommendationMappingRecord | null;
  date: RecommendationDateRecord | null;
  ratingRecord: RecommendationRatingRecord | null;
  metadata: RecommendationMetadataRecord | null;
}>;

export type RecommendationInputRevisionMaterial = Readonly<{
  sources: Readonly<
    Record<RecommendationContextSourceName, readonly RecordValue[]>
  >;
  sourceHealth: Readonly<
    Record<RecommendationContextSourceName, SourceHealth>
  >;
  inputHealth: RecommendationInputHealth;
}> &
  Readonly<
    Record<RecommendationContextSourceName, readonly RecordValue[]>
  >;

export type RecommendationContext = Readonly<{
  userId: string;
  films: readonly RecommendationFilmTuple[];
  filmTuples: readonly RecommendationFilmTuple[];
  mappings: ReadonlyMap<string, RecommendationMappingRecord>;
  metadata: ReadonlyMap<number, RecommendationMetadataRecord>;
  dates: ReadonlyMap<number, RecommendationDateRecord>;
  ratings: ReadonlyMap<number, RecommendationRatingRecord>;
  features: ReadonlyMap<number, RecommendationFeatureRecord>;
  sourceHealth: Readonly<
    Record<RecommendationContextSourceName, SourceHealth>
  >;
  inputHealth: RecommendationInputHealth;
  failedSources: readonly RecommendationSourceName[];
  mode: RecommendationEngineMode;
  hasPersonalizedEvidence: boolean;
  watchedTmdbIds: ReadonlySet<number>;
  blockedTmdbIds: ReadonlySet<number>;
  inputRevisionMaterial: RecommendationInputRevisionMaterial;
  revisionMaterial: RecommendationInputRevisionMaterial;
}>;

type InspectedRows<T extends RecordValue> = Readonly<{
  rows: readonly T[];
  health: SourceHealth;
}>;

const MAX_CONTEXT_ROWS = 10_000;
const REQUIRED_SOURCE_NAMES = new Set<RecommendationSourceName>([
  "films",
  "mappings",
  "blocked",
]);

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function boundedRowCount(value: number): number {
  return Math.min(MAX_CONTEXT_ROWS, Math.max(0, Math.floor(value)));
}

function healthForRows(rowCount: number): SourceHealth {
  const boundedCount = boundedRowCount(rowCount);
  return {
    health: boundedCount > 0 ? "ok" : "empty",
    rowCount: boundedCount,
  };
}

function normalizeHealth(
  health: SourceHealth | undefined,
  fallback: SourceHealth,
): SourceHealth {
  if (!health) return fallback;
  return {
    health: health.health,
    rowCount: boundedRowCount(health.rowCount),
  };
}

function getTmdbId(value: RecordValue): number | null {
  const candidate = value.tmdbId ?? value.tmdb_id ?? value.id;
  return isPositiveSafeInteger(candidate) ? candidate : null;
}

function getUri(value: RecordValue): string | null {
  return typeof value.uri === "string" && value.uri.trim().length > 0
    ? value.uri
    : null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((item) => canonicalize(item))
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      );
  }

  if (value instanceof Map) {
    return Array.from(value.entries())
      .map(([key, item]) => [canonicalize(key), canonicalize(item)])
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      );
  }

  if (value instanceof Set) {
    return Array.from(value, (item) => canonicalize(item)).sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }

  return value;
}

function stableRecordKey(value: RecordValue): string {
  return JSON.stringify(canonicalize(value));
}

function selectStableRecord<T extends RecordValue>(
  current: T | undefined,
  candidate: T,
): T {
  if (!current) return candidate;
  return stableRecordKey(candidate).localeCompare(stableRecordKey(current)) < 0
    ? candidate
    : current;
}

function inspectRows<T extends RecordValue>(
  result: RecommendationContextSourceResult<T> | undefined,
  normalize: (row: T) => RecordValue | null,
): InspectedRows<RecordValue> {
  if (!result || result.error != null || !Array.isArray(result.data)) {
    return { rows: [], health: { health: "failed", rowCount: 0 } };
  }

  if (result.health?.health === "failed") {
    return { rows: [], health: normalizeHealth(result.health, { health: "failed", rowCount: 0 }) };
  }

  const rows: RecordValue[] = [];
  for (const row of result.data) {
    const normalized = normalize(row);
    if (!normalized) {
      return { rows: [], health: { health: "failed", rowCount: 0 } };
    }
    rows.push(normalized);
  }

  return {
    rows,
    health: normalizeHealth(result.health, healthForRows(rows.length)),
  };
}

function normalizeFilm(row: RecommendationFilmRecord): RecommendationFilmRecord | null {
  const uri = getUri(row);
  if (!uri) return null;
  return { ...row, uri };
}

function normalizeMapping(
  row: RecommendationMappingRecord | (RecordValue & { uri: string; tmdb_id: number }),
): RecommendationMappingRecord | null {
  const uri = getUri(row);
  const tmdbId = getTmdbId(row);
  if (!uri || tmdbId === null) return null;
  return { ...row, uri, tmdbId };
}

function normalizeTmdbRecord<T extends RecordValue>(row: T): RecordValue | null {
  const tmdbId = getTmdbId(row);
  if (tmdbId === null) return null;
  return { ...row, tmdbId };
}

function normalizeKeyedRecord<T extends RecordValue>(
  row: T,
): RecordValue | null {
  const tmdbId = getTmdbId(row);
  const uri = getUri(row);
  if (tmdbId === null && !uri) return null;
  return {
    ...row,
    ...(tmdbId === null ? {} : { tmdbId }),
    ...(uri === null ? {} : { uri }),
  };
}

function asMappingRecord(value: RecordValue): RecommendationMappingRecord {
  return value as RecommendationMappingRecord;
}

function asMetadataRecord(value: RecordValue): RecommendationMetadataRecord {
  return value as RecommendationMetadataRecord;
}

function asDateRecord(value: RecordValue): RecommendationDateRecord {
  return value as RecommendationDateRecord;
}

function asRatingRecord(value: RecordValue): RecommendationRatingRecord {
  return value as RecommendationRatingRecord;
}

function asFeatureRecord(value: RecordValue): RecommendationFeatureRecord {
  return value as RecommendationFeatureRecord;
}

function buildUriIndex<T extends RecordValue>(
  rows: readonly T[],
): ReadonlyMap<string, T> {
  const index = new Map<string, T>();
  for (const row of rows) {
    const uri = getUri(row);
    if (uri) index.set(uri, selectStableRecord(index.get(uri), row));
  }
  return new Map(
    Array.from(index.entries()).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

function buildTmdbIndex<T extends RecordValue>(
  rows: readonly T[],
): ReadonlyMap<number, T> {
  const index = new Map<number, T>();
  for (const row of rows) {
    const tmdbId = getTmdbId(row);
    if (tmdbId !== null) {
      index.set(tmdbId, selectStableRecord(index.get(tmdbId), row));
    }
  }
  return new Map(
    Array.from(index.entries()).sort(([left], [right]) => left - right),
  );
}

function getRating(
  tuple: Pick<RecommendationFilmTuple, "rating">,
): number | null {
  return tuple.rating;
}

function buildDefaultInputHealth(
  sourceHealth: Readonly<
    Record<RecommendationContextSourceName, SourceHealth>
  >,
): RecommendationInputHealth {
  return Object.fromEntries(
    RECOMMENDATION_SOURCE_NAMES.map((sourceName) => {
      const health = sourceHealth[sourceName];
      if (health) return [sourceName, health];
      return [
        sourceName,
        REQUIRED_SOURCE_NAMES.has(sourceName)
          ? { health: "failed" as const, rowCount: 0 }
          : { health: "empty" as const, rowCount: 0 },
      ];
    }),
  ) as RecommendationInputHealth;
}

function copyInputHealth(inputHealth: RecommendationInputHealth): RecommendationInputHealth {
  return Object.fromEntries(
    RECOMMENDATION_SOURCE_NAMES.map((sourceName) => [
      sourceName,
      {
        health: inputHealth[sourceName].health,
        rowCount: boundedRowCount(inputHealth[sourceName].rowCount),
      },
    ]),
  ) as RecommendationInputHealth;
}

function emptySourceResult(): RecommendationContextSourceResult<RecordValue> {
  return { data: [] };
}

function getSourceResult(
  snapshot: RecommendationContextSourceSnapshot,
  sourceName: RecommendationContextSourceName,
): RecommendationContextSourceResult<RecordValue> | undefined {
  if (sourceName in snapshot) {
    const snapshotRecord = snapshot as Record<string, unknown>;
    return snapshotRecord[sourceName] as
      | RecommendationContextSourceResult<RecordValue>
      | undefined;
  }
  return snapshot.sources?.[sourceName] ?? emptySourceResult();
}

function normalizeLegacyContext(value: unknown): RecommendationContextSourceSnapshot {
  if (!isRecord(value)) throw new Error("Invalid legacy recommendation context");

  const films = Array.isArray(value.films) ? value.films : [];
  const filmRows = films.filter(isRecord);
  const mappings = Array.isArray(value.mappingsArray)
    ? value.mappingsArray
    : value.mappings instanceof Map
      ? Array.from(value.mappings.entries()).map(([uri, tmdbId]) => ({
          uri,
          tmdbId,
        }))
      : [];
  const blockedIds =
    value.blockedIds instanceof Set
      ? Array.from(value.blockedIds)
      : [];
  const feedbackRows = Array.isArray(value.feedback)
    ? value.feedback.filter(isRecord)
    : [];
  const adjacentGenreRows = Array.isArray(value.adjacentGenres)
    ? value.adjacentGenres.filter(isRecord)
    : [];
  const explorationRate =
    typeof value.explorationRate === "number" &&
    Number.isFinite(value.explorationRate)
      ? value.explorationRate
      : null;
  const exposureRows =
    value.recentExposures instanceof Map
      ? Array.from(value.recentExposures.entries())
          .filter(
            ([tmdbId, daysSince]) =>
              isPositiveSafeInteger(tmdbId) &&
              typeof daysSince === "number" &&
              Number.isFinite(daysSince),
          )
          .map(([tmdbId, daysSince]) => ({ tmdbId, daysSince }))
      : [];
  const blockedRows = blockedIds
    .filter(isPositiveSafeInteger)
    .map((tmdbId) => ({ tmdbId }));

  return {
    films: { data: films as RecommendationFilmRecord[] },
    mappings: {
      data: mappings as RecommendationMappingRecord[],
    },
    metadata: { data: [] },
    dates: {
      data: filmRows.flatMap((film) => {
        const uri = getUri(film);
        if (!uri) return [];
        const lastDate = film.last_date;
        return [
          {
            uri,
            last_date: typeof lastDate === "string" ? lastDate : null,
          },
        ];
      }),
    },
    ratings: {
      data: filmRows.flatMap((film) => {
        const uri = getUri(film);
        if (!uri) return [];
        return [
          {
            uri,
            rating: typeof film.rating === "number" ? film.rating : null,
          },
        ];
      }),
    },
    features: { data: [] },
    sources: {
      feedback: { data: feedbackRows },
      exploration: {
        data:
          explorationRate === null
            ? []
            : [
                {
                  ...(typeof value.explorationMarker === "string"
                    ? { sourceMarker: value.explorationMarker }
                    : {}),
                  explorationRate,
                },
              ],
      },
      adjacent_genres: { data: adjacentGenreRows },
      exposures: { data: exposureRows },
      blocked: { data: blockedRows },
    },
    inputHealth: value.inputHealth as RecommendationInputHealth | undefined,
    blockedTmdbIds: blockedIds.filter(isPositiveSafeInteger),
    hasPersonalizedEvidence:
      value.mode === "personalized" ? true : undefined,
  };
}

async function loadSnapshot(
  repository: RecommendationContextRepository,
  userId: string,
): Promise<RecommendationContextSourceSnapshot> {
  if (repository.load) return repository.load(userId);
  if (repository.loadSources) return repository.loadSources(userId);
  if (repository.loadUserContext) {
    return normalizeLegacyContext(await repository.loadUserContext(userId));
  }
  throw new Error("Recommendation context repository has no loader");
}

function buildSourceHealth(
  snapshot: RecommendationContextSourceSnapshot,
  inspected: Readonly<
    Record<
      "films" | "mappings" | "metadata" | "dates" | "ratings" | "features",
      InspectedRows<RecordValue>
    >
  >,
): Readonly<Record<RecommendationContextSourceName, SourceHealth>> {
  const entries = RECOMMENDATION_CONTEXT_SOURCE_NAMES.map((sourceName) => {
    const explicit = snapshot.sourceHealth?.[sourceName];
    const phase0Health = RECOMMENDATION_SOURCE_NAMES.includes(
      sourceName as RecommendationSourceName,
    )
      ? snapshot.inputHealth?.[sourceName as RecommendationSourceName]
      : undefined;
    if (phase0Health) {
      return [sourceName, normalizeHealth(phase0Health, phase0Health)];
    }
    const inspectedSource = inspected[sourceName as keyof typeof inspected];
    if (explicit) return [sourceName, normalizeHealth(explicit, explicit)];
    if (inspectedSource) return [sourceName, inspectedSource.health];

    const source = getSourceResult(snapshot, sourceName);
    if (source?.health) return [sourceName, normalizeHealth(source.health, source.health)];
    return [sourceName, { health: "empty" as const, rowCount: 0 }];
  });

  return Object.fromEntries(entries) as Readonly<
    Record<RecommendationContextSourceName, SourceHealth>
  >;
}

function buildRevisionMaterial(
  sourceRows: Readonly<Record<RecommendationContextSourceName, readonly RecordValue[]>>,
  sourceHealth: Readonly<
    Record<RecommendationContextSourceName, SourceHealth>
  >,
  inputHealth: RecommendationInputHealth,
): RecommendationInputRevisionMaterial {
  const sources = Object.fromEntries(
    RECOMMENDATION_CONTEXT_SOURCE_NAMES.map((sourceName) => [
      sourceName,
      canonicalize(sourceRows[sourceName] ?? []) as readonly RecordValue[],
    ]),
  ) as Readonly<
    Record<RecommendationContextSourceName, readonly RecordValue[]>
  >;

  return {
    sources,
    sourceHealth,
    inputHealth,
    ...sources,
  } as RecommendationInputRevisionMaterial;
}

function getContextRows(
  inspected: Readonly<
    Record<
      "films" | "mappings" | "metadata" | "dates" | "ratings" | "features",
      InspectedRows<RecordValue>
    >
  >,
  snapshot: RecommendationContextSourceSnapshot,
): Readonly<Record<RecommendationContextSourceName, readonly RecordValue[]>> {
  const rows: Partial<
    Record<RecommendationContextSourceName, readonly RecordValue[]>
  > = {};

  for (const sourceName of RECOMMENDATION_CONTEXT_SOURCE_NAMES) {
    const inspectedSource = inspected[sourceName as keyof typeof inspected];
    if (inspectedSource) {
      rows[sourceName] = inspectedSource.rows;
      continue;
    }

    const source = getSourceResult(snapshot, sourceName);
    rows[sourceName] = Array.isArray(source?.data)
      ? source.data.filter(isRecord)
      : [];
  }

  return rows as Readonly<
    Record<RecommendationContextSourceName, readonly RecordValue[]>
  >;
}

function isPersonalized(
  tuples: readonly RecommendationFilmTuple[],
  snapshot: RecommendationContextSourceSnapshot,
): boolean {
  if (snapshot.hasPersonalizedEvidence !== undefined) {
    return snapshot.hasPersonalizedEvidence;
  }

  return tuples.some((tuple) => {
    const rating = getRating(tuple);
    return (
      tuple.film.liked === true ||
      tuple.film.rewatch === true ||
      tuple.film.on_watchlist === true ||
      (rating !== null && (rating >= 3.5 || rating <= 1.5))
    );
  });
}

function emptyContext(
  userId: string,
  sourceHealth: Readonly<
    Record<RecommendationContextSourceName, SourceHealth>
  >,
  inputHealth: RecommendationInputHealth,
): RecommendationContext {
  const sourceRows = Object.fromEntries(
    RECOMMENDATION_CONTEXT_SOURCE_NAMES.map((sourceName) => [sourceName, []]),
  ) as unknown as Readonly<
    Record<RecommendationContextSourceName, readonly RecordValue[]>
  >;
  const revisionMaterial = buildRevisionMaterial(
    sourceRows,
    sourceHealth,
    inputHealth,
  );
  const failedSources = RECOMMENDATION_SOURCE_NAMES.filter(
    (sourceName) => inputHealth[sourceName].health === "failed",
  );

  return {
    userId,
    films: [],
    filmTuples: [],
    mappings: new Map(),
    metadata: new Map(),
    dates: new Map(),
    ratings: new Map(),
    features: new Map(),
    sourceHealth,
    inputHealth,
    failedSources,
    mode: deriveRecommendationMode({
      inputHealth,
      hasPersonalizedEvidence: false,
    }),
    hasPersonalizedEvidence: false,
    watchedTmdbIds: new Set(),
    blockedTmdbIds: new Set(),
    inputRevisionMaterial: revisionMaterial,
    revisionMaterial,
  };
}

export async function loadRecommendationContext(
  repository: RecommendationContextRepository,
  userId: string,
): Promise<RecommendationContext> {
  try {
    const snapshot = await loadSnapshot(repository, userId);
    const inspected = {
      films: inspectRows(snapshot.films, normalizeFilm),
      mappings: inspectRows(snapshot.mappings, normalizeMapping),
      metadata: inspectRows(snapshot.metadata, normalizeTmdbRecord),
      dates: inspectRows(snapshot.dates, normalizeKeyedRecord),
      ratings: inspectRows(snapshot.ratings, normalizeKeyedRecord),
      features: inspectRows(snapshot.features, normalizeTmdbRecord),
    } as const;
    const sourceHealth = buildSourceHealth(snapshot, inspected);
    const inputHealth = snapshot.inputHealth
      ? copyInputHealth(snapshot.inputHealth)
      : buildDefaultInputHealth(sourceHealth);

    const films = inspected.films.rows as readonly RecommendationFilmRecord[];
    const mappingsRows = inspected.mappings.rows;
    const metadataRows = inspected.metadata.rows;
    const dateRows = inspected.dates.rows;
    const ratingRows = inspected.ratings.rows;
    const featureRows = inspected.features.rows;

    const mappingsByUri = buildUriIndex(mappingsRows);
    const metadataByTmdbId = buildTmdbIndex(metadataRows);
    const datesByTmdbId = buildTmdbIndex(dateRows);
    const ratingsByTmdbId = buildTmdbIndex(ratingRows);
    const featuresByTmdbId = buildTmdbIndex(featureRows);
    const datesByUri = buildUriIndex(dateRows);
    const ratingsByUri = buildUriIndex(ratingRows);

    const mappedFilms = films.filter((film) => mappingsByUri.has(film.uri));
    const metadataById = new Map<number, RecommendationMetadataRecord | null>(
      Array.from(metadataByTmdbId.entries()).map(([tmdbId, row]) => [
        tmdbId,
        asMetadataRecord(row),
      ]),
    );
    const normalizedTuples = normalizeFilmTuples<
      RecommendationFilmRecord,
      RecommendationMetadataRecord,
      RecommendationFeatureRecord | null
    >({
      films: mappedFilms,
      getIdentity: (film) => {
        const mapping = asMappingRecord(mappingsByUri.get(film.uri)!);
        const date =
          datesByTmdbId.get(mapping.tmdbId) ?? datesByUri.get(film.uri);
        const rating =
          ratingsByTmdbId.get(mapping.tmdbId) ?? ratingsByUri.get(film.uri);
        const watchDate =
          date?.watchedAt ??
          date?.watched_at ??
          date?.lastDate ??
          date?.last_date ??
          film.lastDate ??
          film.last_date ??
          null;
        const ratingRecord = rating ? asRatingRecord(rating) : null;
        return {
          uri: film.uri,
          tmdbId: mapping.tmdbId,
          rating: ratingRecord?.rating ?? film.rating ?? null,
          watchDate: typeof watchDate === "string" ? watchDate : null,
        };
      },
      detailsById: metadataById,
      extractFeatures: (details) => {
        const feature = featuresByTmdbId.get(details.tmdbId);
        return feature ? asFeatureRecord(feature) : null;
      },
    });
    const orderedTuples: RecommendationFilmTuple[] = normalizedTuples.map(
      (tuple) => {
        const mapping = asMappingRecord(mappingsByUri.get(tuple.uri)!);
        const date =
          datesByTmdbId.get(tuple.tmdbId) ?? datesByUri.get(tuple.uri);
        const rating =
          ratingsByTmdbId.get(tuple.tmdbId) ?? ratingsByUri.get(tuple.uri);
        return {
          ...tuple,
          mapping,
          metadata: tuple.details,
          date: date ? asDateRecord(date) : null,
          ratingRecord: rating ? asRatingRecord(rating) : null,
        };
      },
    );
    const hasPersonalizedEvidence = isPersonalized(orderedTuples, snapshot);
    const failedSources = RECOMMENDATION_SOURCE_NAMES.filter(
      (sourceName) => inputHealth[sourceName].health === "failed",
    );
    const mode = deriveRecommendationMode({
      inputHealth,
      hasPersonalizedEvidence,
    });
    const blockedFromSource = getSourceResult(snapshot, "blocked");
    const blockedTmdbIds = new Set<number>([
      ...(snapshot.blockedTmdbIds ?? []),
      ...(Array.isArray(blockedFromSource?.data)
        ? blockedFromSource.data
            .filter(isRecord)
            .map(getTmdbId)
            .filter((tmdbId): tmdbId is number => tmdbId !== null)
        : []),
    ].filter(isPositiveSafeInteger).sort((left, right) => left - right));

    const sourceRows = getContextRows(inspected, snapshot);
    const revisionMaterial = buildRevisionMaterial(
      sourceRows,
      sourceHealth,
      inputHealth,
    );

    return {
      userId,
      films: orderedTuples,
      filmTuples: orderedTuples,
      mappings: new Map(
        Array.from(mappingsByUri.entries()).map(([uri, row]) => [
          uri,
          asMappingRecord(row),
        ]),
      ),
      metadata: new Map(
        Array.from(metadataByTmdbId.entries()).map(([tmdbId, row]) => [
          tmdbId,
          asMetadataRecord(row),
        ]),
      ),
      dates: new Map(
        Array.from(datesByTmdbId.entries()).map(([tmdbId, row]) => [
          tmdbId,
          asDateRecord(row),
        ]),
      ),
      ratings: new Map(
        Array.from(ratingsByTmdbId.entries()).map(([tmdbId, row]) => [
          tmdbId,
          asRatingRecord(row),
        ]),
      ),
      features: new Map(
        Array.from(featuresByTmdbId.entries()).map(([tmdbId, row]) => [
          tmdbId,
          asFeatureRecord(row),
        ]),
      ),
      sourceHealth,
      inputHealth,
      failedSources,
      mode,
      hasPersonalizedEvidence,
      watchedTmdbIds: new Set(
        orderedTuples.map((tuple) => tuple.tmdbId),
      ),
      blockedTmdbIds,
      inputRevisionMaterial: revisionMaterial,
      revisionMaterial,
    };
  } catch (error) {
    console.error("[RecommendationContext] load failed", {
      userId: userId.slice(0, 8),
      code: error instanceof Error ? error.name : "UNKNOWN_ERROR",
    });

    const sourceHealth = Object.fromEntries(
      RECOMMENDATION_CONTEXT_SOURCE_NAMES.map((sourceName) => [
        sourceName,
        { health: "failed" as const, rowCount: 0 },
      ]),
    ) as Readonly<Record<RecommendationContextSourceName, SourceHealth>>;
    const inputHealth = buildDefaultInputHealth(sourceHealth);
    return emptyContext(userId, sourceHealth, inputHealth);
  }
}
