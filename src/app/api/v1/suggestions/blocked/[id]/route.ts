import { withApiAuth } from "../../../_lib/apiKeyAuth";
import { parsePositiveInteger } from "../../../_lib/pagination";
import { apiSuccess, ApiError } from "../../../_lib/responseEnvelope";
import { supabaseAdmin } from "../../../_lib/supabaseAdmin";

interface RouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function DELETE(req: Request, { params }: RouteContext) {
  return withApiAuth(req, async (auth) => {
    try {
      const { id } = await params;
      const tmdbId = parsePositiveInteger(id, "blocked suggestion id");

      const { data, error } = await supabaseAdmin
        .from("blocked_suggestions")
        .delete()
        .eq("user_id", auth.userId)
        .eq("tmdb_id", tmdbId)
        .select("tmdb_id")
        .maybeSingle();

      if (error) {
        throw new ApiError(
          500,
          "INTERNAL_ERROR",
          "Failed to delete blocked suggestion",
        );
      }

      if (!data) {
        throw new ApiError(404, "NOT_FOUND", "Blocked suggestion not found");
      }

      return apiSuccess({ deleted: true });
    } catch (error) {
      console.error("[v1/suggestions/blocked/[id]] Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
