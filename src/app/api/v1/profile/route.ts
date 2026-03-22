import { withApiAuth } from "../_lib/apiKeyAuth";
import { apiSuccess, ApiError } from "../_lib/responseEnvelope";
import { supabaseAdmin } from "../_lib/supabaseAdmin";

interface ProfileRow {
  id: string;
  email: string | null;
  created_at: string | null;
  suspended_at: string | null;
}

interface GenreFeedbackRow {
  feature_id: number;
  feature_name: string | null;
  inferred_preference: number | null;
  positive_count: number;
  negative_count: number;
  last_updated: string;
}

export async function GET(req: Request) {
  return withApiAuth(req, async (auth) => {
    try {
      const [profileResult, filmCountResult, topGenresResult] =
        await Promise.all([
          supabaseAdmin
            .from("profiles")
            .select("id, email, created_at, suspended_at")
            .eq("id", auth.userId)
            .maybeSingle(),
          supabaseAdmin
            .from("film_events")
            .select("*", { count: "exact", head: true })
            .eq("user_id", auth.userId),
          supabaseAdmin
            .from("user_feature_feedback")
            .select(
              "feature_id, feature_name, inferred_preference, positive_count, negative_count, last_updated",
            )
            .eq("user_id", auth.userId)
            .eq("feature_type", "genre")
            .order("inferred_preference", {
              ascending: false,
              nullsFirst: false,
            })
            .limit(10),
        ]);

      if (profileResult.error) {
        throw new ApiError(500, "INTERNAL_ERROR", "Failed to fetch profile");
      }

      if (!profileResult.data) {
        throw new ApiError(404, "NOT_FOUND", "Profile not found");
      }

      if (filmCountResult.error) {
        throw new ApiError(500, "INTERNAL_ERROR", "Failed to fetch film count");
      }

      if (topGenresResult.error) {
        throw new ApiError(500, "INTERNAL_ERROR", "Failed to fetch top genres");
      }

      return apiSuccess({
        profile: profileResult.data as ProfileRow,
        stats: {
          filmCount: filmCountResult.count ?? 0,
          topGenres: (topGenresResult.data as GenreFeedbackRow[] | null) ?? [],
        },
      });
    } catch (error) {
      console.error("[v1/profile] Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
