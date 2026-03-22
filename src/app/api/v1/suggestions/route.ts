import { withApiAuth } from "../_lib/apiKeyAuth";
import { buildPagination, getPaginationParams } from "../_lib/pagination";
import { apiPaginated, ApiError } from "../_lib/responseEnvelope";
import { supabaseAdmin } from "../_lib/supabaseAdmin";

interface SavedSuggestionRow {
  id: string;
  tmdb_id: number;
  title: string;
  year: string | null;
  poster_path: string | null;
  order_index: number | null;
  created_at: string;
}

export async function GET(req: Request) {
  return withApiAuth(req, async (auth) => {
    try {
      const { searchParams } = new URL(req.url);
      const { page, perPage, offset } = getPaginationParams(searchParams);

      const { data, error, count } = await supabaseAdmin
        .from("saved_suggestions")
        .select(
          "id, tmdb_id, title, year, poster_path, order_index, created_at",
          {
            count: "exact",
          },
        )
        .eq("user_id", auth.userId)
        .eq("liked", false)
        .order("created_at", { ascending: false })
        .range(offset, offset + perPage - 1);

      if (error) {
        console.error("[v1/suggestions] Error:", error);
        throw new ApiError(
          500,
          "INTERNAL_ERROR",
          "Failed to fetch suggestions",
        );
      }

      return apiPaginated(
        (data as SavedSuggestionRow[] | null) ?? [],
        buildPagination(page, perPage, count ?? 0),
      );
    } catch (error) {
      console.error("[v1/suggestions] Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
