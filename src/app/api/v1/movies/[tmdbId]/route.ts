import { withApiAuth } from "../../_lib/apiKeyAuth";
import { parsePositiveInteger } from "../../_lib/pagination";
import { apiSuccess, ApiError } from "../../_lib/responseEnvelope";
import { fetchTmdb } from "../../_lib/tmdb";

interface RouteContext {
  params: Promise<{
    tmdbId: string;
  }>;
}

export async function GET(req: Request, { params }: RouteContext) {
  return withApiAuth(req, async () => {
    try {
      const { tmdbId: rawTmdbId } = await params;
      const tmdbId = parsePositiveInteger(rawTmdbId, "tmdbId");
      const movie = await fetchTmdb<Record<string, unknown>>(
        `/movie/${tmdbId}`,
        {
          append_to_response: "credits,keywords,videos,similar,recommendations",
        },
      );

      return apiSuccess(movie);
    } catch (error) {
      console.error("[v1/movies/[tmdbId]] Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
