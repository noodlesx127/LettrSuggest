import { withApiAuth } from "../_lib/apiKeyAuth";
import { apiSuccess, ApiError } from "../_lib/responseEnvelope";
import { supabaseAdmin } from "../_lib/supabaseAdmin";

interface ExplorationStatsRow {
  user_id: string;
  exploration_rate: number;
  exploratory_films_rated: number;
  exploratory_avg_rating: number;
  last_updated: string;
}

interface FilmStatsRow {
  total_films: number;
  total_rated: number;
  avg_rating: number;
  total_liked: number;
  on_watchlist: number;
}

export async function GET(req: Request) {
  return withApiAuth(req, async (auth) => {
    try {
      const [filmStatsResult, explorationStatsResult] = await Promise.all([
        supabaseAdmin.rpc("get_film_stats", {
          p_user_id: auth.userId,
        }),
        supabaseAdmin
          .from("user_exploration_stats")
          .select(
            "user_id, exploration_rate, exploratory_films_rated, exploratory_avg_rating, last_updated",
          )
          .eq("user_id", auth.userId)
          .maybeSingle(),
      ]);

      if (filmStatsResult.error) {
        throw new ApiError(500, "INTERNAL_ERROR", "Failed to fetch film stats");
      }

      if (explorationStatsResult.error) {
        throw new ApiError(
          500,
          "INTERNAL_ERROR",
          "Failed to fetch exploration stats",
        );
      }

      const filmStats = (filmStatsResult.data as FilmStatsRow | null) ?? {
        total_films: 0,
        total_rated: 0,
        avg_rating: 0,
        total_liked: 0,
        on_watchlist: 0,
      };

      const explorationStats =
        (explorationStatsResult.data as ExplorationStatsRow | null) ?? null;

      // Defensive cap: exploratory_films_rated cannot exceed total_rated
      const exploratoryFilmsRated = Math.min(
        explorationStats?.exploratory_films_rated ?? 0,
        filmStats.total_rated ?? 0,
      );

      return apiSuccess({
        filmStats,
        explorationStats: explorationStats
          ? {
              ...explorationStats,
              exploratory_films_rated: exploratoryFilmsRated,
            }
          : null,
      });
    } catch (error) {
      console.error("[v1/stats] Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
