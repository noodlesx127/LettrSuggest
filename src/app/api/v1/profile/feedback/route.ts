import { withApiAuth } from "../../_lib/apiKeyAuth";
import { apiSuccess, ApiError } from "../../_lib/responseEnvelope";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin";

export async function GET(req: Request) {
  return withApiAuth(req, async (auth) => {
    try {
      const db = getSupabaseAdmin();

      const { data, error } = await db
        .from("user_feature_feedback")
        .select(
          "feature_id, feature_name, feature_type, inferred_preference, positive_count, negative_count, last_updated",
        )
        .eq("user_id", auth.userId)
        .order("last_updated", { ascending: false });

      if (error)
        throw new ApiError(500, "INTERNAL_ERROR", "Failed to fetch feedback");

      const rows = (data ?? []) as any[];

      // Group by type and direction
      const grouped: Record<string, { prefer: any[]; avoid: any[] }> = {};
      const types = [
        "actor",
        "director",
        "genre",
        "keyword",
        "franchise",
        "collection",
        "subgenre",
      ];
      for (const t of types) grouped[t] = { prefer: [], avoid: [] };

      for (const row of rows) {
        const type = row.feature_type ?? "unknown";
        if (!grouped[type]) grouped[type] = { prefer: [], avoid: [] };

        // inferred_preference is 0-1 scale (confirmed in migrations)
        // Fallback uses 0.8/0.2 to stay on same scale; threshold 0.5 as midpoint
        const pref =
          typeof row.inferred_preference === "number"
            ? row.inferred_preference
            : row.positive_count > row.negative_count
              ? 0.8
              : 0.2;

        const entry = {
          id: row.feature_id,
          name: row.feature_name,
          positive: row.positive_count,
          negative: row.negative_count,
          preference: Math.round((pref ?? 0) * 100) / 100,
          last_updated: row.last_updated,
        };

        if (pref >= 0.5) grouped[type].prefer.push(entry);
        else grouped[type].avoid.push(entry);
      }

      return apiSuccess({
        total_signals: rows.length,
        by_type: grouped,
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error("[v1/profile/feedback] Unexpected error:", error);
      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
