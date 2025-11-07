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
};

export function toNumber(n?: string) {
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
    const d = r['Date'];
    // Count diary entries per URI
    diaryCount.set(uri, (diaryCount.get(uri) ?? 0) + 1);
    // Track latest date lexicographically (YYYY-MM-DD works as string compare)
    if (d) {
      const prev = latestDate.get(uri);
      if (!prev || d > prev) latestDate.set(uri, d);
    }
    upd(
      uri,
      {
        rewatch: (byURI.get(uri)?.rewatch || rewatch) || undefined,
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

  const wl = new Set((raw.watchlist ?? []).map((r) => r['Letterboxd URI']).filter(Boolean));
  const likes = new Set((raw.likesFilms ?? []).map((r) => r['Letterboxd URI']).filter(Boolean));

  for (const uri of wl) upd(uri, { onWatchlist: true });
  for (const uri of likes) upd(uri, { liked: true });

  // Finalize watchCount and lastDate
  for (const [uri, f] of byURI.entries()) {
    let wc = diaryCount.get(uri) ?? 0;
    if (wc === 0) {
      // Fallback: at least 1 if present in watched export or has a rating
      if (watchedSet.has(uri) || (f.rating != null)) wc = 1;
    }
    const ld = latestDate.get(uri) ?? f.lastDate;
    byURI.set(uri, { ...f, watchCount: wc, lastDate: ld });
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
    },
  };
}
