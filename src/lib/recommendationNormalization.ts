export type DetailsHealth = "failed" | "ok";

export type FilmTupleIdentity = {
  uri: string;
  tmdbId: number;
  rating?: number | null;
  watchDate?: string | null;
};

export type GenuineWatchSignals = Readonly<{
  watchDate?: string | null;
  rating?: number | null;
  liked?: boolean | null;
  rewatch?: boolean | null;
  watched?: boolean | null;
  watchCount?: number | null;
}>;

export type NormalizedFilmTuple<TFilm, TDetails, TFeatures> = {
  uri: string;
  tmdbId: number;
  film: TFilm;
  rating: number | null;
  watchDate: string | null;
  detailsHealth: DetailsHealth;
  details: TDetails | null;
  features: TFeatures | null;
};

function parseWatchDate(value: string | null | undefined): number | null {
  if (!value?.trim()) return null;

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function hasGenuineWatchEvidence(
  signals: GenuineWatchSignals,
): boolean {
  return (
    parseWatchDate(signals.watchDate) !== null ||
    signals.watched === true ||
    signals.liked === true ||
    signals.rewatch === true ||
    (typeof signals.rating === "number" &&
      Number.isFinite(signals.rating) &&
      signals.rating > 0) ||
    (typeof signals.watchCount === "number" &&
      Number.isFinite(signals.watchCount) &&
      signals.watchCount > 0)
  );
}

export function sortByFilmRecency<T>(
  films: readonly T[],
  getIdentity: (film: T) => FilmTupleIdentity,
): T[] {
  return [...films].sort((left, right) => {
    const leftIdentity = getIdentity(left);
    const rightIdentity = getIdentity(right);
    const leftDate = parseWatchDate(leftIdentity.watchDate);
    const rightDate = parseWatchDate(rightIdentity.watchDate);

    if (leftDate !== null && rightDate !== null && leftDate !== rightDate) {
      return rightDate - leftDate;
    }
    if (leftDate !== null && rightDate === null) return -1;
    if (leftDate === null && rightDate !== null) return 1;
    if (leftIdentity.tmdbId !== rightIdentity.tmdbId) {
      return leftIdentity.tmdbId - rightIdentity.tmdbId;
    }

    return leftIdentity.uri.localeCompare(rightIdentity.uri);
  });
}

export function selectRecentFilmsWithPinned<T>(params: {
  films: readonly T[];
  pinned: readonly T[];
  limit: number;
  getIdentity: (film: T) => FilmTupleIdentity;
}): T[] {
  const limit = Math.max(0, Math.floor(params.limit));
  const pinned = [...params.pinned]
    .sort((left, right) => {
      const leftIdentity = params.getIdentity(left);
      const rightIdentity = params.getIdentity(right);
      return (
        leftIdentity.tmdbId - rightIdentity.tmdbId ||
        leftIdentity.uri.localeCompare(rightIdentity.uri)
      );
    });
  const recentLimit = Math.max(0, limit - pinned.length);

  return [
    ...sortByFilmRecency(params.films, params.getIdentity).slice(
      0,
      recentLimit,
    ),
    ...pinned,
  ];
}

export function selectRecentFeatures<TFeatures>(
  tuples: readonly { tmdbId: number; features: TFeatures | null }[],
  limit: number,
): TFeatures[] {
  const features: TFeatures[] = [];
  const seenIds = new Set<number>();
  const distinctLimit = Math.max(0, Math.floor(limit));
  if (distinctLimit === 0) return features;

  for (const tuple of tuples) {
    if (seenIds.has(tuple.tmdbId)) continue;
    seenIds.add(tuple.tmdbId);
    if (tuple.features !== null) features.push(tuple.features);
    if (seenIds.size >= distinctLimit) break;
  }

  return features;
}

export function normalizeFilmTuples<TFilm, TDetails, TFeatures>(params: {
  films: readonly TFilm[];
  getIdentity: (film: TFilm) => FilmTupleIdentity;
  detailsById: ReadonlyMap<number, TDetails | null>;
  extractFeatures: (details: TDetails) => TFeatures;
}): NormalizedFilmTuple<TFilm, TDetails, TFeatures>[] {
  const tuples = params.films.map((film) => {
    const identity = params.getIdentity(film);
    const details = params.detailsById.get(identity.tmdbId) ?? null;

    return {
      uri: identity.uri,
      tmdbId: identity.tmdbId,
      film,
      rating: identity.rating ?? null,
      watchDate: identity.watchDate ?? null,
      detailsHealth: details === null ? ("failed" as const) : ("ok" as const),
      details,
      features: details === null ? null : params.extractFeatures(details),
    };
  });

  return sortByFilmRecency(tuples, (tuple) => tuple);
}
