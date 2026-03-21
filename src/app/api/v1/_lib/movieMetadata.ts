import { supabaseAdmin } from "./supabaseAdmin";
import { fetchTmdb } from "./tmdb";
import { ApiError } from "./responseEnvelope";
import { isRecord } from "./pagination";

interface TmdbMovieRow {
  tmdb_id: number;
  data: unknown;
}

interface MovieSummary {
  title: string | null;
  year: string | null;
  poster_path: string | null;
}

interface TmdbMovieDetails {
  title?: string;
  release_date?: string;
  poster_path?: string | null;
}

function getStringValue(
  value: unknown,
  fallback: string | null = null,
): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

function toMovieSummary(data: unknown): MovieSummary {
  if (!isRecord(data)) {
    return {
      title: null,
      year: null,
      poster_path: null,
    };
  }

  const releaseDate = getStringValue(data.release_date);
  return {
    title: getStringValue(data.title) ?? getStringValue(data.name),
    year: releaseDate ? releaseDate.slice(0, 4) : null,
    poster_path: getStringValue(data.poster_path),
  };
}

export async function getMovieSummary(tmdbId: number): Promise<MovieSummary> {
  const { data, error } = await supabaseAdmin
    .from("tmdb_movies")
    .select("tmdb_id, data")
    .eq("tmdb_id", tmdbId)
    .maybeSingle();

  if (error) {
    console.error("[API v1] Failed to fetch cached TMDB movie", error);
    throw new ApiError(500, "INTERNAL_ERROR", "Failed to fetch movie cache");
  }

  if (data) {
    return toMovieSummary((data as TmdbMovieRow).data);
  }

  const movie = await fetchTmdb<TmdbMovieDetails>(`/movie/${tmdbId}`);
  return {
    title: movie.title ?? null,
    year: movie.release_date ? movie.release_date.slice(0, 4) : null,
    poster_path: movie.poster_path ?? null,
  };
}

export async function getMovieSummaryMap(
  tmdbIds: number[],
): Promise<Map<number, MovieSummary>> {
  const uniqueIds = Array.from(new Set(tmdbIds.filter((tmdbId) => tmdbId > 0)));
  const summaryMap = new Map<number, MovieSummary>();

  if (uniqueIds.length === 0) {
    return summaryMap;
  }

  const { data, error } = await supabaseAdmin
    .from("tmdb_movies")
    .select("tmdb_id, data")
    .in("tmdb_id", uniqueIds);

  if (error) {
    console.error("[API v1] Failed to fetch TMDB movie summaries", error);
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      "Failed to fetch movie summaries",
    );
  }

  for (const row of (data as TmdbMovieRow[] | null) ?? []) {
    summaryMap.set(row.tmdb_id, toMovieSummary(row.data));
  }

  return summaryMap;
}
