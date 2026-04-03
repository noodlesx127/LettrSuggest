import { withApiAuth } from "../../_lib/apiKeyAuth";
import { buildPagination, getPaginationParams } from "../../_lib/pagination";
import { apiPaginated, ApiError } from "../../_lib/responseEnvelope";
import { supabaseAdmin } from "../../_lib/supabaseAdmin";

type FilmSort = "last_date" | "rating" | "title";
type SortOrder = "asc" | "desc";

interface FilmEventRow {
  uri: string;
  title: string;
  year: number | null;
  rating: number | null;
  rewatch: boolean | null;
  last_date: string | null;
  watch_count: number | null;
  liked: boolean | null;
  on_watchlist: boolean | null;
  updated_at: string | null;
}

function parseSort(searchParams: URLSearchParams): FilmSort {
  const sort = searchParams.get("sort");
  if (sort === "rating" || sort === "title" || sort === "last_date") {
    return sort;
  }

  return "last_date";
}

function parseOrder(searchParams: URLSearchParams): SortOrder {
  return searchParams.get("order") === "asc" ? "asc" : "desc";
}

export async function GET(req: Request) {
  return withApiAuth(req, async (auth) => {
    try {
      const { searchParams } = new URL(req.url);
      const { page, perPage, offset } = getPaginationParams(searchParams);
      const sort = parseSort(searchParams);
      const order = parseOrder(searchParams);

      const { data, error, count } = await supabaseAdmin
        .from("film_events")
        .select(
          "uri, title, year, rating, rewatch, last_date, watch_count, liked, on_watchlist, updated_at",
          { count: "exact" },
        )
        .eq("user_id", auth.userId)
        .order(sort, { ascending: order === "asc", nullsFirst: false })
        .range(offset, offset + perPage - 1);

      if (error) {
        // On range error (offset beyond total rows), fall back to a count-only
        // query to return an empty paginated response instead of crashing.
        const { count: totalCount, error: countError } = await supabaseAdmin
          .from("film_events")
          .select("*", { count: "exact", head: true })
          .eq("user_id", auth.userId);

        if (!countError && (totalCount ?? 0) <= offset) {
          return apiPaginated(
            [],
            buildPagination(page, perPage, totalCount ?? 0),
          );
        }

        throw new ApiError(500, "INTERNAL_ERROR", "Failed to fetch films");
      }

      const coerced = ((data as FilmEventRow[] | null) ?? []).map((row) => ({
        ...row,
        liked: row.liked ?? false,
        rewatch: row.rewatch ?? false,
        watch_count: row.watch_count ?? 0,
        on_watchlist: row.on_watchlist ?? false,
      }));

      return apiPaginated(coerced, buildPagination(page, perPage, count ?? 0));
    } catch (error) {
      console.error("[v1/profile/films] Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
