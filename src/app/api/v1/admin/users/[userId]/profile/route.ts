import {
  extractRole,
  type ProfileWithRoleRow,
  validateUserId,
} from "../../../../_lib/adminHelpers";
import { withApiAuth } from "../../../../_lib/apiKeyAuth";
import { requireAdmin } from "../../../../_lib/permissions";
import { apiSuccess, ApiError } from "../../../../_lib/responseEnvelope";
import { supabaseAdmin } from "../../../../_lib/supabaseAdmin";

type FeatureType = "genre" | "actor";

interface RouteContext {
  params: Promise<{
    userId: string;
  }>;
}

interface FeatureFeedbackRow {
  feature_type: FeatureType;
  feature_name: string | null;
  inferred_preference: number | null;
  positive_count: number | null;
  negative_count: number | null;
}

function getTopFeatureNames(
  rows: FeatureFeedbackRow[],
  featureType: FeatureType,
  limit = 10,
): string[] {
  return rows
    .filter((row) => row.feature_type === featureType && row.feature_name)
    .map((row) => ({
      name: row.feature_name ?? "",
      score:
        row.inferred_preference ??
        (row.positive_count ?? 0) - (row.negative_count ?? 0),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((row) => row.name);
}

export async function GET(req: Request, { params }: RouteContext) {
  return withApiAuth(req, async (auth) => {
    requireAdmin(auth);

    try {
      const { userId } = await params;
      validateUserId(userId);

      const [profileResult, featuresResult] = await Promise.all([
        supabaseAdmin
          .from("profiles")
          .select("id, email, created_at, suspended_at, user_roles(role)")
          .eq("id", userId)
          .maybeSingle(),
        supabaseAdmin
          .from("user_feature_feedback")
          .select(
            "feature_type, feature_name, inferred_preference, positive_count, negative_count",
          )
          .eq("user_id", userId)
          .in("feature_type", ["genre", "actor"]),
      ]);

      if (profileResult.error) {
        console.error(
          "[API v1] Failed to fetch admin user profile summary",
          profileResult.error,
        );
        throw new ApiError(
          500,
          "INTERNAL_ERROR",
          "Failed to fetch user profile",
        );
      }

      if (!profileResult.data) {
        throw new ApiError(404, "NOT_FOUND", "User not found");
      }

      if (featuresResult.error) {
        console.error(
          "[API v1] Failed to fetch user feature feedback",
          featuresResult.error,
        );
        throw new ApiError(
          500,
          "INTERNAL_ERROR",
          "Failed to fetch user profile",
        );
      }

      const featureRows =
        (featuresResult.data as FeatureFeedbackRow[] | null) ?? [];
      const profile = profileResult.data as ProfileWithRoleRow;

      return apiSuccess({
        profile: {
          id: profile.id,
          email: profile.email,
          created_at: profile.created_at,
          suspended_at: profile.suspended_at,
        },
        role: extractRole(profile.user_roles),
        topFeatures: {
          genres: getTopFeatureNames(featureRows, "genre"),
          actors: getTopFeatureNames(featureRows, "actor"),
        },
      });
    } catch (error) {
      console.error("[v1/admin/users/[userId]/profile] Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
