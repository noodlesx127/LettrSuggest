import { withApiAuth } from "../../_lib/apiKeyAuth";
import { parseOptionalPositiveInteger, parsePage } from "../../_lib/pagination";
import { apiError, apiPaginated, ApiError } from "../../_lib/responseEnvelope";
import { fetchTmdb } from "../../_lib/tmdb";

interface TmdbMovieSearchResult {
  id: number;
  title?: string;
  release_date?: string;
  [key: string]: unknown;
}

interface TmdbMovieSearchResponse {
  page: number;
  results: TmdbMovieSearchResult[];
  total_pages: number;
  total_results: number;
}

export async function GET(req: Request) {
  return withApiAuth(req, async () => {
    try {
      const { searchParams } = new URL(req.url);
      const query = searchParams.get("q")?.trim();

      if (!query) {
        return apiError(400, "BAD_REQUEST", "Missing required parameter: q");
      }

      const page = parsePage(searchParams);
      const year = parseOptionalPositiveInteger(
        searchParams.get("year"),
        "year",
      );

      const data = await fetchTmdb<TmdbMovieSearchResponse>("/search/movie", {
        query,
        page,
        year,
      });

      return apiPaginated(data.results, {
        page,
        perPage: 20,
        total: data.total_results,
        totalPages: data.total_pages,
        hasNextPage: page < data.total_pages,
        hasPreviousPage: page > 1,
      });
    } catch (error) {
      console.error("[v1/movies/search] Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
