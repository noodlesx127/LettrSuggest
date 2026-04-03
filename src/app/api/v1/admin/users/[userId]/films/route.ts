import { validateUserId } from "../../../../_lib/adminHelpers";
import { withApiAuth } from "../../../../_lib/apiKeyAuth";
import {
  buildPagination,
  parsePage,
  parsePerPage,
} from "../../../../_lib/pagination";
import { requireAdmin } from "../../../../_lib/permissions";
import { apiPaginated, ApiError } from "../../../../_lib/responseEnvelope";
import { supabaseAdmin } from "../../../../_lib/supabaseAdmin";

type FilmSort = "last_date" | "rating" | "title";
type SortOrder = "asc" | "desc";

interface RouteContext {
  params: Promise<{
    userId: string;
  }>;
}

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

export async function GET(req: Request, { params }: RouteContext) {
  return withApiAuth(req, async (auth) => {
    requireAdmin(auth);

    try {
      const { userId } = await params;
      validateUserId(userId);

      const { searchParams } = new URL(req.url);
      const page = parsePage(searchParams);
      const perPage = parsePerPage(searchParams);
      const offset = (page - 1) * perPage;
      const sort = parseSort(searchParams);
      const order = parseOrder(searchParams);

      const { data, error, count } = await supabaseAdmin
        .from("film_events")
        .select(
          "uri, title, year, rating, rewatch, last_date, watch_count, liked, on_watchlist, updated_at",
          { count: "exact" },
        )
        .eq("user_id", userId)
        .order(sort, { ascending: order === "asc", nullsFirst: false })
        .order("uri", { ascending: true })
        .range(offset, offset + perPage - 1);

      if (error) {
        console.error("[v1/admin/users/[userId]/films] Query error:", error);
        throw new ApiError(500, "INTERNAL_ERROR", "Failed to fetch films");
      }

      return apiPaginated(
        (data as FilmEventRow[] | null) ?? [],
        buildPagination(page, perPage, count ?? 0),
      );
    } catch (error) {
      console.error("[v1/admin/users/[userId]/films] Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
