export type FilmEvent = {
  uri: string;
  title: string;
  year: number | null;
  rating?: number;
  rewatch?: boolean;
  lastDate?: string;
  liked?: boolean;
  onWatchlist?: boolean;
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
    upd(uri, {}, { title: r['Name'], year: r['Year'] });
  }

  for (const r of raw.diary ?? []) {
    const uri = r['Letterboxd URI'];
    if (!uri) continue;
    const rewatch = (r['Rewatch'] ?? '').toLowerCase() === 'yes';
    const rating = toNumber(r['Rating']);
    upd(uri, { rewatch: (byURI.get(uri)?.rewatch || rewatch) || undefined, rating: rating ?? byURI.get(uri)?.rating, lastDate: r['Date'] ?? byURI.get(uri)?.lastDate }, { title: r['Name'], year: r['Year'] });
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
