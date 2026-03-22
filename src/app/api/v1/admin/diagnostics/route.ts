import { withApiAuth } from "../../_lib/apiKeyAuth";
import { getCacheTableStats } from "../../_lib/adminCache";
import { requireAdmin } from "../../_lib/permissions";
import { apiSuccess, ApiError } from "../../_lib/responseEnvelope";
import { supabaseAdmin } from "../../_lib/supabaseAdmin";

interface ApiKeyUsageRow {
  user_id: string;
}

export async function GET(req: Request) {
  return withApiAuth(req, async (auth) => {
    requireAdmin(auth);

    try {
      const now = new Date();
      const activeUserCutoff = new Date(
        now.getTime() - 30 * 24 * 60 * 60 * 1000,
      ).toISOString();

      const [
        usersResult,
        activeKeysResult,
        filmEventsResult,
        activeUserRows,
        cacheTables,
      ] = await Promise.all([
        supabaseAdmin
          .from("profiles")
          .select("id", { count: "exact", head: true }),
        supabaseAdmin
          .from("api_keys")
          .select("*", { count: "exact", head: true })
          .is("revoked_at", null),
        supabaseAdmin
          .from("film_events")
          .select("*", { count: "exact", head: true }),
        supabaseAdmin
          .from("api_keys")
          .select("user_id")
          .is("revoked_at", null)
          .gte("last_used_at", activeUserCutoff),
        getCacheTableStats(),
      ]);

      const dbStatus = usersResult.error ? "error" : "ok";
      if (
        usersResult.error ||
        activeKeysResult.error ||
        filmEventsResult.error ||
        activeUserRows.error
      ) {
        console.error("[API v1] Failed to fetch admin diagnostics", {
          usersError: usersResult.error,
          activeKeysError: activeKeysResult.error,
          filmEventsError: filmEventsResult.error,
          activeUsersError: activeUserRows.error,
        });
      }

      const activeUsers = new Set(
        ((activeUserRows.data as ApiKeyUsageRow[] | null) ?? []).map(
          (row) => row.user_id,
        ),
      ).size;
      const cacheTableRows = cacheTables.reduce(
        (sum, table) => sum + table.count,
        0,
      );

      return apiSuccess({
        db: dbStatus,
        timestamp: now.toISOString(),
        stats: {
          totalUsers: usersResult.count ?? 0,
          activeUsers,
          activeKeys: activeKeysResult.count ?? 0,
          cacheTableRows,
          totalFilmEvents: filmEventsResult.count ?? 0,
        },
      });
    } catch (error) {
      console.error("[v1/admin/diagnostics] Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
