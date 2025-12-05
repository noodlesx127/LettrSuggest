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
  watchlistAddedAt?: string;
};

export function toNumber(n?: string) {
  // Empty strings or whitespace-only should return undefined, not 0
  if (n == null || n.trim() === '') return undefined;
  const x = Number(n);
  return Number.isFinite(x) ? x : undefined;
}

export function toYear(s?: string) {
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
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
  const diaryCount = new Map<string, number>();
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
    const uri = r['Letterboxd URI'];
    if (!uri) continue;
    const rewatch = (r['Rewatch'] ?? '').toLowerCase() === 'yes';
    const rating = toNumber(r['Rating']);
    // Use 'Watched Date' if available (the actual watch date), fallback to 'Date' (log date)
    const d = r['Watched Date'] || r['Date'];
    // Count diary entries per URI
    diaryCount.set(uri, (diaryCount.get(uri) ?? 0) + 1);
    // Track latest date lexicographically (YYYY-MM-DD works as string compare)
    if (d) {
      const prev = latestDate.get(uri);
      if (!prev || d > prev) latestDate.set(uri, d);
    }
    // Determine if this film is a rewatch: true if current entry is marked as rewatch OR previously marked
    const isRewatch = byURI.get(uri)?.rewatch === true || rewatch;
    upd(
      uri,
      {
        // Set rewatch explicitly to true or false (not undefined)
        rewatch: isRewatch,
        rating: rating ?? byURI.get(uri)?.rating,
        lastDate: d ?? byURI.get(uri)?.lastDate,
      },
      { title: r['Name'], year: r['Year'] }
    );
  }

  // Process reviews - these can have ratings too (process before ratings.csv to avoid overwrite)
  for (const r of raw.reviews ?? []) {
    const uri = r['Letterboxd URI'];
    if (!uri) continue;
    const rewatch = (r['Rewatch'] ?? '').toLowerCase() === 'yes';
    const rating = toNumber(r['Rating']);
    const d = r['Watched Date'] || r['Date'];
    
    // Reviews count as diary entries too
    diaryCount.set(uri, (diaryCount.get(uri) ?? 0) + 1);
    if (d) {
      const prev = latestDate.get(uri);
      if (!prev || d > prev) latestDate.set(uri, d);
    }
    
    const isRewatch = byURI.get(uri)?.rewatch === true || rewatch;
    upd(
      uri,
      {
        rewatch: isRewatch,
        rating: rating ?? byURI.get(uri)?.rating,
        lastDate: d ?? byURI.get(uri)?.lastDate,
      },
      { title: r['Name'], year: r['Year'] }
    );
  }

  for (const r of raw.ratings ?? []) {
    const uri = r['Letterboxd URI'];
    if (!uri) continue;
    const rating = toNumber(r['Rating']);
    if (rating != null) upd(uri, { rating }, { title: r['Name'], year: r['Year'] });
  }

  // Process watchlist with title/year
  for (const r of raw.watchlist ?? []) {
    const uri = r['Letterboxd URI'];
    if (!uri) continue;
    const addedAt = r['Date'] || r['Added'] || r['Added At'] || r['AddedAt'] || r['Added Date'];
    upd(
      uri,
      {
        onWatchlist: true,
        watchlistAddedAt: addedAt ?? byURI.get(uri)?.watchlistAddedAt
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
    let wc = diaryCount.get(uri) ?? 0;
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
