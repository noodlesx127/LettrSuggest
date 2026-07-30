export type FilmEvent = {
  uri: string;
  title: string;
  year: number | null;
  rating?: number;
  rewatch?: boolean;
  lastDate?: string;
  liked?: boolean;
  onWatchlist?: boolean;
  watchCount?: number;
  watchlistAddedAt?: string | null;
};

export type WatchEvent = {
  uri: string;
  watchedDate: string | null;
  rating: number | null;
  rewatch: boolean;
};

export type FilmEventCloudRow = {
  user_id: string;
  uri: string;
  title: string;
  year: number | null;
  rating: number | null;
  rewatch: boolean | null;
  last_date: string | null;
  watch_count: number | null;
  liked: boolean;
  on_watchlist: boolean;
  watchlist_added_at: string | null;
};

export function toNumber(n?: string) {
  // Empty strings or whitespace-only should return undefined, not 0
  if (n == null || n.trim() === '') return undefined;
  const x = Number(n);
  return Number.isFinite(x) ? x : undefined;
}

export function toYear(s?: string | null) {
  const value = s?.trim();
  if (!value) return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeDate(value?: string): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

const ISO_WATCHLIST_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

function isGregorianDate(year: number, month: number, day: number): boolean {
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
}

function normalizeWatchlistTimestamp(value?: string): string | null {
  if (!value?.trim()) return null;

  const match = ISO_WATCHLIST_TIMESTAMP.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isGregorianDate(year, month, day)) return null;
  if (!Number.isFinite(Date.parse(value))) return null;

  return value;
}

function getWatchlistAddedAt(row: Record<string, string>): string | null {
  const value = [
    row["Date"],
    row["Added"],
    row["Added At"],
    row["AddedAt"],
    row["Added Date"],
  ].find((candidate) => candidate?.trim());

  return normalizeWatchlistTimestamp(value);
}

function getWatchedDate(row: Record<string, string>): string | null {
  return normalizeDate(row["Watched Date"]) ?? normalizeDate(row["Date"]);
}

function getWatchEventFromRow(row: Record<string, string>): WatchEvent | null {
  const uri = row["Letterboxd URI"]?.trim();
  if (!uri) return null;

  return {
    uri,
    watchedDate: getWatchedDate(row),
    rating: toNumber(row["Rating"]) ?? null,
    rewatch: (row["Rewatch"] ?? "").trim().toLowerCase() === "yes",
  };
}

function watchEventIdentity(event: WatchEvent): string {
  // Keep these fields in lockstep with film_diary_events_raw_unique:
  // (user_id, uri, watched_date, rewatch), including NULL date identity.
  return JSON.stringify([event.uri, event.watchedDate, event.rewatch]);
}

function mergeWatchEvent(previous: WatchEvent, next: WatchEvent): WatchEvent {
  if (previous.rating === null && next.rating !== null) {
    return { ...previous, rating: next.rating };
  }
  if (
    previous.rating !== null &&
    next.rating !== null &&
    next.rating > previous.rating
  ) {
    return { ...previous, rating: next.rating };
  }
  return previous;
}

function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareWatchEvents(a: WatchEvent, b: WatchEvent): number {
  const uriComparison = compareCodeUnits(a.uri, b.uri);
  if (uriComparison !== 0) return uriComparison;

  if (a.watchedDate === null && b.watchedDate !== null) return -1;
  if (a.watchedDate !== null && b.watchedDate === null) return 1;
  if (a.watchedDate !== b.watchedDate) {
    return compareCodeUnits(a.watchedDate ?? "", b.watchedDate ?? "");
  }

  return Number(a.rewatch) - Number(b.rewatch);
}

export function deduplicateWatchEvents(events: WatchEvent[]): WatchEvent[] {
  const byIdentity = new Map<string, WatchEvent>();
  for (const event of events) {
    const identity = watchEventIdentity(event);
    const previous = byIdentity.get(identity);
    byIdentity.set(
      identity,
      previous ? mergeWatchEvent(previous, event) : event,
    );
  }

  return [...byIdentity.values()].sort(compareWatchEvents);
}

function normalizeWatchEventRows(rows: Record<string, string>[]): WatchEvent[] {
  const candidates = rows
    .map(getWatchEventFromRow)
    .filter((event): event is WatchEvent => event !== null);

  return deduplicateWatchEvents(candidates);
}

function mergeReviewWatchEvent(
  diaryEvent: WatchEvent,
  reviewEvent: WatchEvent,
): WatchEvent {
  return {
    ...diaryEvent,
    // Reviews were processed after diary rows before this checkpoint. Keep
    // that source precedence for one persisted event without exposing source
    // metadata in the persisted row.
    rating: reviewEvent.rating ?? diaryEvent.rating,
  };
}

export function normalizeWatchEvents(raw: {
  diary?: Record<string, string>[];
  reviews?: Record<string, string>[];
}): WatchEvent[] {
  const diaryEvents = normalizeWatchEventRows(raw.diary ?? []);
  const reviewEvents = normalizeWatchEventRows(raw.reviews ?? []);
  const byIdentity = new Map<string, WatchEvent>();

  for (const event of diaryEvents) {
    byIdentity.set(watchEventIdentity(event), event);
  }
  for (const event of reviewEvents) {
    const identity = watchEventIdentity(event);
    const diaryEvent = byIdentity.get(identity);
    byIdentity.set(
      identity,
      diaryEvent ? mergeReviewWatchEvent(diaryEvent, event) : event,
    );
  }

  return [...byIdentity.values()].sort(compareWatchEvents);
}

export function serializeFilmEventsForCloud(
  userId: string,
  films: FilmEvent[],
): FilmEventCloudRow[] {
  return films.map((film) => ({
    user_id: userId,
    uri: film.uri,
    title: film.title,
    year: film.year ?? null,
    rating: film.rating ?? null,
    rewatch: film.rewatch ?? null,
    last_date: film.lastDate ?? null,
    watch_count: film.watchCount ?? null,
    liked: film.liked === true,
    on_watchlist: film.onWatchlist === true,
    watchlist_added_at: film.watchlistAddedAt ?? null,
  }));
}

export function normalizeData(raw: {
  watched?: Record<string, string>[];
  diary?: Record<string, string>[];
  ratings?: Record<string, string>[];
  watchlist?: Record<string, string>[];
  likesFilms?: Record<string, string>[];
  reviews?: Record<string, string>[];  // Reviews can have ratings too
}) {
  const byURI = new Map<string, FilmEvent>();
  const watchedSet = new Set<string>();
  const watchEvents = normalizeWatchEvents(raw);
  const eventsByURI = new Map<string, WatchEvent[]>();
  const latestDate = new Map<string, string>();

  const upd = (uri: string, patch: Partial<FilmEvent>, seed?: { title?: string; year?: string }) => {
    const prev = byURI.get(uri) ?? {
      uri,
      title: seed?.title ?? '',
      year: toYear(seed?.year),
    };
    byURI.set(uri, { ...prev, ...patch });
  };

  for (const r of raw.watched ?? []) {
    const uri = r['Letterboxd URI'];
    if (!uri) continue;
    watchedSet.add(uri);
    upd(uri, {}, { title: r['Name'], year: r['Year'] });
  }

  for (const r of raw.diary ?? []) {
    const uri = r['Letterboxd URI']?.trim();
    if (!uri) continue;
    const rating = toNumber(r['Rating']);
    upd(
      uri,
      {
        rating: rating ?? byURI.get(uri)?.rating,
      },
      { title: r['Name'], year: r['Year'] }
    );
  }

  // Process reviews - these can have ratings too (process before ratings.csv to avoid overwrite)
  for (const r of raw.reviews ?? []) {
    const uri = r['Letterboxd URI']?.trim();
    if (!uri) continue;
    const rating = toNumber(r['Rating']);
    upd(
      uri,
      {
        rating: rating ?? byURI.get(uri)?.rating,
      },
      { title: r['Name'], year: r['Year'] }
    );
  }

  for (const event of watchEvents) {
    const events = eventsByURI.get(event.uri) ?? [];
    events.push(event);
    eventsByURI.set(event.uri, events);

    if (event.watchedDate) {
      const previous = latestDate.get(event.uri);
      if (!previous || event.watchedDate > previous) {
        latestDate.set(event.uri, event.watchedDate);
      }
    }

    const previous = byURI.get(event.uri);
    upd(event.uri, {
      rewatch: previous?.rewatch === true || event.rewatch,
    });
  }

  for (const r of raw.ratings ?? []) {
    const uri = r['Letterboxd URI'];
    if (!uri) continue;
    const rating = toNumber(r['Rating']);
    if (rating != null) upd(uri, { rating }, { title: r['Name'], year: r['Year'] });
  }

  // Process watchlist with title/year
  for (const r of raw.watchlist ?? []) {
    const uri = r['Letterboxd URI']?.trim();
    if (!uri) continue;
    const addedAt = getWatchlistAddedAt(r);
    upd(
      uri,
      {
        onWatchlist: true,
        watchlistAddedAt:
          addedAt ?? byURI.get(uri)?.watchlistAddedAt ?? null,
      },
      { title: r['Name'], year: r['Year'] }
    );
  }

  // Process likes
  for (const r of raw.likesFilms ?? []) {
    const uri = r['Letterboxd URI'];
    if (!uri) continue;
    upd(uri, { liked: true }, { title: r['Name'], year: r['Year'] });
  }

  // Finalize watchCount and lastDate
  for (const [uri, f] of byURI.entries()) {
    let wc = eventsByURI.get(uri)?.length ?? 0;
    if (wc === 0) {
      // Fallback: at least 1 if present in watched export or has a rating
      if (watchedSet.has(uri) || (f.rating != null)) wc = 1;
    }
    const ld = latestDate.get(uri) ?? f.lastDate;

    // Mark as rewatch if watch count > 1 (appeared multiple times in diary)
    // OR if already marked as rewatch from diary entry
    const isRewatch = f.rewatch === true || wc > 1;

    byURI.set(uri, { ...f, watchCount: wc, lastDate: ld, rewatch: isRewatch });
  }

  const films = [...byURI.values()];
  return {
    films,
    watchEvents,
    distinctFilms: films.length,
    counts: {
      watched: raw.watched?.length ?? 0,
      diary: raw.diary?.length ?? 0,
      ratings: raw.ratings?.length ?? 0,
      watchlist: raw.watchlist?.length ?? 0,
      likes: raw.likesFilms?.length ?? 0,
      reviews: raw.reviews?.length ?? 0,
    },
  };
}
