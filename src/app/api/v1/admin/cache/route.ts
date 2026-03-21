import { withApiAuth } from "../../_lib/apiKeyAuth";
import { getCacheTableStats } from "../../_lib/adminCache";
import { requireAdmin } from "../../_lib/permissions";
import { apiSuccess, ApiError } from "../../_lib/responseEnvelope";

export async function GET(req: Request) {
  return withApiAuth(req, async (auth) => {
    requireAdmin(auth);

    try {
      const tables = await getCacheTableStats();
      return apiSuccess({ tables });
    } catch (error) {
      console.error("[v1/admin/cache] Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
