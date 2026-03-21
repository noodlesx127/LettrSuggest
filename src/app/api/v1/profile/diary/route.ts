import { withApiAuth } from "../../_lib/apiKeyAuth";
import {
  buildPagination,
  getPaginationParams,
  parseOptionalPositiveInteger,
} from "../../_lib/pagination";
import { apiPaginated, ApiError } from "../../_lib/responseEnvelope";
import { supabaseAdmin } from "../../_lib/supabaseAdmin";

interface DiaryEntryRow {
  tmdb_id: number;
  watched_at: string | null;
  rating: number | null;
}

interface FilmDiaryFallbackRow {
  uri: string;
  title: string;
  year: number | null;
  rating: number | null;
  rewatch: boolean | null;
  last_date: string | null;
  watch_count: number | null;
  liked: boolean | null;
  on_watchlist: boolean | null;
}

async function fetchFromDiaryView(
  userId: string,
  page: number,
  perPage: number,
  offset: number,
  year?: number,
) {
  let query = supabaseAdmin
    .from("film_diary_events_enriched")
    .select("tmdb_id, watched_at, rating", { count: "exact" })
    .eq("user_id", userId);

  if (year) {
    query = query
      .gte("watched_at", `${year}-01-01`)
      .lt("watched_at", `${year + 1}-01-01`);
  }

  const { data, error, count } = await query
    .order("watched_at", { ascending: false })
    .range(offset, offset + perPage - 1);

  if (error) {
    throw error;
  }

  return {
    data: (data as DiaryEntryRow[] | null) ?? [],
    count: count ?? 0,
    pagination: buildPagination(page, perPage, count ?? 0),
  };
}

async function fetchFromFilmEvents(
  userId: string,
  page: number,
  perPage: number,
  offset: number,
  year?: number,
) {
  let query = supabaseAdmin
    .from("film_events")
    .select(
      "uri, title, year, rating, rewatch, last_date, watch_count, liked, on_watchlist",
      { count: "exact" },
    )
    .eq("user_id", userId)
    .gt("watch_count", 0);

  if (year) {
    query = query.eq("year", year);
  }

  const { data, error, count } = await query
    .order("last_date", { ascending: false })
    .range(offset, offset + perPage - 1);

  if (error) {
    throw new ApiError(500, "INTERNAL_ERROR", "Failed to fetch diary entries");
  }

  const entries = ((data as FilmDiaryFallbackRow[] | null) ?? []).map(
    (row) => ({
      uri: row.uri,
      title: row.title,
      year: row.year,
      rating: row.rating,
      watched_at: row.last_date,
      watch_count: row.watch_count,
      rewatch: row.rewatch,
      liked: row.liked,
      on_watchlist: row.on_watchlist,
    }),
  );

  return {
    data: entries,
    count: count ?? 0,
    pagination: buildPagination(page, perPage, count ?? 0),
  };
}

export async function GET(req: Request) {
  return withApiAuth(req, async (auth) => {
    try {
      const { searchParams } = new URL(req.url);
      const { page, perPage, offset } = getPaginationParams(searchParams);
      const year = parseOptionalPositiveInteger(
        searchParams.get("year"),
        "year",
      );

      try {
        const result = await fetchFromDiaryView(
          auth.userId,
          page,
          perPage,
          offset,
          year,
        );

        return apiPaginated(result.data, result.pagination);
      } catch (viewError: unknown) {
        const msg =
          viewError instanceof Error ? viewError.message : String(viewError);

        if (!msg.includes("42P01") && !msg.includes("does not exist")) {
          throw viewError;
        }

        console.warn(
          "[v1/profile/diary] Diary view unavailable, using film_events fallback",
        );

        const fallback = await fetchFromFilmEvents(
          auth.userId,
          page,
          perPage,
          offset,
          year,
        );

        return apiPaginated(fallback.data, fallback.pagination);
      }
    } catch (error) {
      console.error("[v1/profile/diary] Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
