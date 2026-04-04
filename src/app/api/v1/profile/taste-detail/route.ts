import { withApiAuth } from "../../_lib/apiKeyAuth";
import { apiSuccess, ApiError } from "../../_lib/responseEnvelope";
import { getSupabaseAdmin } from "../../_lib/supabaseAdmin";

export async function GET(req: Request) {
  return withApiAuth(req, async (auth) => {
    try {
      const db = getSupabaseAdmin();

      const { data: cacheRow, error } = await db
        .from("user_taste_profile_cache")
        .select("profile, film_count, computed_at")
        .eq("user_id", auth.userId)
        .maybeSingle();

      if (error)
        throw new ApiError(
          500,
          "INTERNAL_ERROR",
          "Failed to read taste profile cache",
        );

      if (!cacheRow) {
        return apiSuccess({
          cached: false,
          message:
            "No taste profile cached yet. Run a suggestion first to generate one.",
        });
      }

      const profile = cacheRow.profile as any;
      const computedAt = cacheRow.computed_at;
      const ageMinutes = Math.round(
        (Date.now() - new Date(computedAt).getTime()) / 60000,
      );

      return apiSuccess({
        cached: true,
        computed_at: computedAt,
        age_minutes: ageMinutes,
        film_count: cacheRow.film_count,
        // Top genres (central taste signal)
        top_genres: (profile.topGenres ?? []).slice(0, 15).map((g: any) => ({
          name: g.name,
          weight: Math.round((g.weight ?? 0) * 100) / 100,
          id: g.id ?? null,
        })),
        // Top directors (full list, not just top 5)
        top_directors: (profile.topDirectors ?? [])
          .slice(0, 20)
          .map((d: any) => ({
            name: d.name,
            weight: Math.round((d.weight ?? 0) * 100) / 100,
            count: d.count ?? null,
          })),
        // Top keywords with TF-IDF scores
        top_keywords: (profile.topKeywords ?? [])
          .slice(0, 20)
          .map((k: any) => ({
            name: k.name,
            weight: Math.round((k.weight ?? 0) * 100) / 100,
            tfidf: k.tfidfScore ? Math.round(k.tfidfScore * 1000) / 1000 : null,
            count: k.count ?? null,
          })),
        // Top actors
        top_actors: (profile.topActors ?? []).slice(0, 15).map((a: any) => ({
          name: a.name,
          weight: Math.round((a.weight ?? 0) * 100) / 100,
        })),
        // Top studios
        top_studios: (profile.topStudios ?? []).slice(0, 10).map((s: any) => ({
          name: s.name,
          count: s.count ?? null,
        })),
        // Preferred decades
        top_decades: (profile.topDecades ?? []).slice(0, 6).map((dec: any) => ({
          decade: dec.decade,
          weight: Math.round((dec.weight ?? 0) * 100) / 100,
        })),
        // Avoid signals
        avoid_genres: (profile.avoidGenres ?? [])
          .slice(0, 10)
          .map((g: any) => ({
            name: g.name,
            id: g.id,
          })),
        avoid_keywords: (profile.avoidKeywords ?? [])
          .slice(0, 10)
          .map((k: any) => ({
            name: k.name,
          })),
        user_stats: profile.userStats ?? null,
        taste_bins: profile.tasteBins ?? null,
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error("[v1/profile/taste-detail] Unexpected error:", error);
      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
