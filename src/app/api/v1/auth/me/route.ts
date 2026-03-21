import { withApiAuth } from "../../_lib/apiKeyAuth";
import { ApiError, apiSuccess } from "../../_lib/responseEnvelope";
import { supabaseAdmin } from "../../_lib/supabaseAdmin";

export async function GET(req: Request) {
  return withApiAuth(req, async (auth) => {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(
      auth.userId,
    );

    if (error) {
      console.error("[API v1] Failed to fetch authenticated user", error);
      throw new ApiError(500, "INTERNAL_ERROR", "Failed to fetch user");
    }

    if (!data.user) {
      throw new ApiError(404, "NOT_FOUND", "User not found");
    }

    return apiSuccess({
      userId: data.user.id,
      email: data.user.email ?? null,
      role: auth.userRole,
      keyType: auth.keyType,
      createdAt: data.user.created_at,
    });
  });
}
