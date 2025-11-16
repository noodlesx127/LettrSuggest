/**
 * TuiMDB API Client
 * https://tuimdb.com/api/docs/
 */

export type TuiMDBMovie = {
  id: number;
  title: string;
  original_title?: string;
  release_date?: string;
  poster?: string;
  backdrop?: string;
  overview?: string;
  rating?: number;
  vote_count?: number;
  runtime?: number;
  genres?: Array<{ id: number; name: string }>;
  keywords?: Array<{ id: number; name: string }>;
  cast?: Array<{ id: number; name: string; character?: string; order?: number }>;
  crew?: Array<{ id: number; name: string; job?: string; department?: string }>;
  videos?: Array<{ id: string; key: string; site: string; type: string; name: string }>;
  images?: {
    posters?: Array<{ file_path: string }>;
    backdrops?: Array<{ file_path: string }>;
  };
  original_language?: string;
  budget?: number;
  revenue?: number;
  status?: string;
  tagline?: string;
  homepage?: string;
  production_companies?: Array<{ id: number; name: string; logo_path?: string }>;
  production_countries?: Array<{ iso_3166_1: string; name: string }>;
  spoken_languages?: Array<{ iso_639_1: string; name: string }>;
};

export type TuiMDBSearchResult = {
  UID: number; // TuiMDB's internal ID
  Title: string;
  ReleaseDate?: string;
  Poster?: string;
  Overview?: string;
  Rating?: number;
};

export type TuiMDBGenre = {
  id: number;
  name: string;
};

const TUIMDB_BASE_URL = 'https://tuimdb.com/api';

/**
 * Search for movies by title
 */
export async function searchTuiMDB(
  query: string,
  year?: number,
  apiKey?: string
): Promise<TuiMDBSearchResult[]> {
  const key = apiKey || process.env.TUIMDB_API_KEY;
  if (!key) {
    throw new Error('TUIMDB_API_KEY not configured');
  }

  const url = new URL(`${TUIMDB_BASE_URL}/movies/search/`);
  let queryStr = query;
  if (year) {
    queryStr = `${query} (${year})`;
  }
  url.searchParams.set('queryString', queryStr);
  url.searchParams.set('language', 'en');

  const response = await fetch(url.toString(), {
    headers: {
      'apiKey': key,
      'Accept': 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`TuiMDB search failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.results || [];
}

/**
 * Get detailed movie information by ID
 */
export async function getTuiMDBMovie(
  id: number,
  apiKey?: string
): Promise<TuiMDBMovie | null> {
  const key = apiKey || process.env.TUIMDB_API_KEY;
  if (!key) {
    throw new Error('TUIMDB_API_KEY not configured');
  }

  const url = new URL(`${TUIMDB_BASE_URL}/movies/get/`);
  url.searchParams.set('uid', String(id));
  url.searchParams.set('language', 'en');

  const response = await fetch(url.toString(), {
    headers: {
      'apiKey': key,
      'Accept': 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    const text = await response.text().catch(() => '');
    throw new Error(`TuiMDB details failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data;
}

/**
 * Get all available movie genres
 */
export async function getTuiMDBGenres(apiKey?: string): Promise<TuiMDBGenre[]> {
  const key = apiKey || process.env.TUIMDB_API_KEY;
  if (!key) {
    throw new Error('TUIMDB_API_KEY not configured');
  }

  const url = new URL(`${TUIMDB_BASE_URL}/movies/genres/`);
  url.searchParams.set('language', 'en');

  const response = await fetch(url.toString(), {
    headers: {
      'apiKey': key,
      'Accept': 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`TuiMDB genres failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.genres || [];
}

/**
 * Convert TuiMDB movie to TMDB-compatible format for caching
 */
export function tuiMDBToTMDB(tuiMovie: TuiMDBMovie): any {
  return {
    id: tuiMovie.id,
    title: tuiMovie.title,
    original_title: tuiMovie.original_title,
    release_date: tuiMovie.release_date,
    poster_path: tuiMovie.poster?.replace('https://image.tmdb.org/t/p/w500', ''),
    backdrop_path: tuiMovie.backdrop?.replace('https://image.tmdb.org/t/p/w500', ''),
    overview: tuiMovie.overview,
    vote_average: tuiMovie.rating,
    vote_count: tuiMovie.vote_count,
    runtime: tuiMovie.runtime,
    genres: tuiMovie.genres,
    original_language: tuiMovie.original_language,
    budget: tuiMovie.budget,
    revenue: tuiMovie.revenue,
    status: tuiMovie.status,
    tagline: tuiMovie.tagline,
    homepage: tuiMovie.homepage,
    production_companies: tuiMovie.production_companies,
    production_countries: tuiMovie.production_countries,
    spoken_languages: tuiMovie.spoken_languages,
    credits: {
      cast: tuiMovie.cast,
      crew: tuiMovie.crew,
    },
    keywords: {
      keywords: tuiMovie.keywords,
    },
    videos: {
      results: tuiMovie.videos,
    },
    images: tuiMovie.images,
  };
}

/**
 * Convert TuiMDB search result to TMDB-compatible format
 */
export function tuiMDBSearchToTMDB(tuiResult: TuiMDBSearchResult): any {
  return {
    id: tuiResult.UID,
    title: tuiResult.Title,
    release_date: tuiResult.ReleaseDate,
    poster_path: tuiResult.Poster?.replace('https://image.tmdb.org/t/p/w500', ''),
    overview: tuiResult.Overview,
    vote_average: tuiResult.Rating,
  };
}
