import { withApiAuth } from "../../../_lib/apiKeyAuth";
import { UUID_REGEX } from "../../../_lib/pagination";
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

      if (!UUID_REGEX.test(id)) {
        throw new ApiError(400, "BAD_REQUEST", "Invalid liked suggestion id");
      }

      const { data, error } = await supabaseAdmin
        .from("saved_suggestions")
        .delete()
        .eq("id", id)
        .eq("user_id", auth.userId)
        .eq("liked", true)
        .select("id")
        .maybeSingle();

      if (error) {
        throw new ApiError(
          500,
          "INTERNAL_ERROR",
          "Failed to delete liked suggestion",
        );
      }

      if (!data) {
        throw new ApiError(404, "NOT_FOUND", "Liked suggestion not found");
      }

      return apiSuccess({ unliked: true });
    } catch (error) {
      console.error("[v1/suggestions/liked/[id]] Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
