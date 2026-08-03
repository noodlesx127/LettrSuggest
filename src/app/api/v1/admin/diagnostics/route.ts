import { withApiAuth } from "../../_lib/apiKeyAuth";
import { getCacheTableStats } from "../../_lib/adminCache";
import { requireAdmin } from "../../_lib/permissions";
import { apiSuccess, ApiError } from "../../_lib/responseEnvelope";
import { supabaseAdmin } from "../../_lib/supabaseAdmin";
import { buildBoundedExposureDiagnostics } from "@/lib/recommendationTelemetry";
import { getBoundedTasteProfileCacheDiagnostics } from "@/lib/recommendationRevision";
import {
  DEFAULT_EXPERIMENT_BUCKET,
  RECOMMENDATION_ENGINE_VERSION,
} from "@/lib/recommendationTypes";

interface ApiKeyUsageRow {
  user_id: string;
}

interface BoundedExposureAggregateRow {
  total_count?: number | null;
  owner_count?: number | null;
  current_engine_count?: number | null;
  default_bucket_count?: number | null;
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
        tasteProfileResult,
        feedbackCountResult,
        exposureAggregateResult,
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
        supabaseAdmin
          .from("user_taste_profile_cache")
          .select(
            "user_id, film_count, computed_at, input_revision, profile_model_version",
          )
          .eq("user_id", auth.userId)
          .maybeSingle(),
        supabaseAdmin
          .from("user_feature_feedback")
          .select("*", { count: "exact", head: true })
          .eq("user_id", auth.userId),
        // The restricted RPC returns one fixed row of bounded aggregate counts;
        // no exposure rows, reasons, histories, or candidate arrays are fetched.
        supabaseAdmin.rpc("get_bounded_exposure_diagnostics", {
          p_owner_user_id: auth.userId,
        }),
      ]);

      const exposureAggregateRow = (Array.isArray(exposureAggregateResult.data)
        ? exposureAggregateResult.data[0]
        : exposureAggregateResult.data) as BoundedExposureAggregateRow | null;

      const dbStatus = usersResult.error ? "error" : "connected";
      if (
        usersResult.error ||
        activeKeysResult.error ||
        filmEventsResult.error ||
        activeUserRows.error ||
        tasteProfileResult.error ||
        feedbackCountResult.error ||
        exposureAggregateResult.error
      ) {
        console.error("[API v1] Failed to fetch admin diagnostics", {
          usersError: usersResult.error,
          activeKeysError: activeKeysResult.error,
          filmEventsError: filmEventsResult.error,
          activeUsersError: activeUserRows.error,
          tasteProfileError: tasteProfileResult.error,
          feedbackCountError: feedbackCountResult.error,
          exposureAggregateError: exposureAggregateResult.error,
        });
      }

      const tasteProfileRow = tasteProfileResult.data;
      const tasteProfileCacheDiagnostics =
        getBoundedTasteProfileCacheDiagnostics(tasteProfileRow);
      const feedbackCount = feedbackCountResult.count;
      const activeUsers = new Set(
        ((activeUserRows.data as ApiKeyUsageRow[] | null) ?? []).map(
          (row) => row.user_id,
        ),
      ).size;
      const cacheTableRows = cacheTables.reduce(
        (sum, table) => sum + table.count,
        0,
      );
      const exposureDiagnostics = buildBoundedExposureDiagnostics({
        totalCount: exposureAggregateRow?.total_count,
        countsByEngineVersion: {
          [RECOMMENDATION_ENGINE_VERSION]:
            exposureAggregateRow?.current_engine_count,
        },
        countsByExperimentBucket: {
          [DEFAULT_EXPERIMENT_BUCKET]:
            exposureAggregateRow?.default_bucket_count,
        },
      });

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
        engine_health: {
          taste_profile_cached: !!tasteProfileRow,
          taste_profile_age_hours: tasteProfileRow?.computed_at
            ? Math.round(
                (Date.now() - new Date(tasteProfileRow.computed_at).getTime()) /
                  3600000,
              )
            : null,
          taste_profile_film_count: tasteProfileRow?.film_count ?? null,
          taste_profile_input_revision: tasteProfileCacheDiagnostics.revision,
          taste_profile_model_version:
            tasteProfileCacheDiagnostics.modelVersion,
          feedback_signal_count: feedbackCount ?? 0,
          exposure_log_count: exposureAggregateRow?.owner_count ?? 0,
        },
        exposure_diagnostics: exposureDiagnostics,
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
