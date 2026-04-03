import { withApiAuth } from "../../_lib/apiKeyAuth";
import { buildPagination, getPaginationParams } from "../../_lib/pagination";
import { apiPaginated, ApiError } from "../../_lib/responseEnvelope";
import { supabaseAdmin } from "../../_lib/supabaseAdmin";

interface WatchlistFilmRow {
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

export async function GET(req: Request) {
  return withApiAuth(req, async (auth) => {
    try {
      const { searchParams } = new URL(req.url);
      const { page, perPage, offset } = getPaginationParams(searchParams);

      const { data, error, count } = await supabaseAdmin
        .from("film_events")
        .select(
          "uri, title, year, rating, rewatch, last_date, watch_count, liked, on_watchlist, updated_at",
          { count: "exact" },
        )
        .eq("user_id", auth.userId)
        .eq("on_watchlist", true)
        .order("last_date", { ascending: false, nullsFirst: false })
        .order("uri", { ascending: true })
        .range(offset, offset + perPage - 1);

      if (error) {
        console.error("[v1/profile/watchlist] Query error:", error);
        const { count: totalCount, error: countError } = await supabaseAdmin
          .from("film_events")
          .select("*", { count: "exact", head: true })
          .eq("user_id", auth.userId)
          .eq("on_watchlist", true);

        if (!countError && (totalCount ?? 0) <= offset) {
          return apiPaginated(
            [],
            buildPagination(page, perPage, totalCount ?? 0),
          );
        }

        throw new ApiError(500, "INTERNAL_ERROR", "Failed to fetch watchlist");
      }

      return apiPaginated(
        (data as WatchlistFilmRow[] | null) ?? [],
        buildPagination(page, perPage, count ?? 0),
      );
    } catch (error) {
      console.error("[v1/profile/watchlist] Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
