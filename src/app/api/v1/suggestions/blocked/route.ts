import { withApiAuth } from "../../_lib/apiKeyAuth";
import { getMovieSummaryMap } from "../../_lib/movieMetadata";
import {
  buildPagination,
  getPaginationParams,
  isRecord,
  parsePositiveInteger,
} from "../../_lib/pagination";
import {
  apiPaginated,
  apiSuccess,
  ApiError,
} from "../../_lib/responseEnvelope";
import { supabaseAdmin } from "../../_lib/supabaseAdmin";

interface BlockedSuggestionRow {
  tmdb_id: number;
  blocked_at: string;
}

interface BlockedSuggestionBody {
  tmdb_id: number;
  title?: string;
}

async function parseBlockedSuggestionBody(
  req: Request,
): Promise<BlockedSuggestionBody> {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "Invalid JSON body");
  }

  if (!isRecord(body)) {
    throw new ApiError(400, "BAD_REQUEST", "Request body must be an object");
  }

  const tmdbId = parsePositiveInteger(String(body.tmdb_id ?? ""), "tmdb_id");
  const title = typeof body.title === "string" ? body.title.trim() : undefined;

  return {
    tmdb_id: tmdbId,
    ...(title ? { title } : {}),
  };
}

async function enrichBlockedSuggestions(rows: BlockedSuggestionRow[]) {
  const movieSummaryMap = await getMovieSummaryMap(
    rows.map((row) => row.tmdb_id),
  );

  return rows.map((row) => {
    const summary = movieSummaryMap.get(row.tmdb_id);
    return {
      ...row,
      title: summary?.title ?? null,
      year: summary?.year ?? null,
      poster_path: summary?.poster_path ?? null,
    };
  });
}

export async function GET(req: Request) {
  return withApiAuth(req, async (auth) => {
    try {
      const { searchParams } = new URL(req.url);
      const { page, perPage, offset } = getPaginationParams(searchParams);

      const { data, error, count } = await supabaseAdmin
        .from("blocked_suggestions")
        .select("tmdb_id, blocked_at", { count: "exact" })
        .eq("user_id", auth.userId)
        .order("blocked_at", { ascending: false })
        .range(offset, offset + perPage - 1);

      if (error) {
        throw new ApiError(
          500,
          "INTERNAL_ERROR",
          "Failed to fetch blocked suggestions",
        );
      }

      const rows = (data as BlockedSuggestionRow[] | null) ?? [];
      const enrichedRows = await enrichBlockedSuggestions(rows);

      return apiPaginated(
        enrichedRows,
        buildPagination(page, perPage, count ?? 0),
      );
    } catch (error) {
      console.error("[v1/suggestions/blocked] Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}

export async function POST(req: Request) {
  return withApiAuth(req, async (auth) => {
    try {
      const body = await parseBlockedSuggestionBody(req);

      const { data, error } = await supabaseAdmin
        .from("blocked_suggestions")
        .upsert(
          {
            user_id: auth.userId,
            tmdb_id: body.tmdb_id,
          },
          {
            onConflict: "user_id,tmdb_id",
          },
        )
        .select("tmdb_id, blocked_at")
        .single();

      if (error) {
        throw new ApiError(
          500,
          "INTERNAL_ERROR",
          "Failed to save blocked suggestion",
        );
      }

      const row = data as BlockedSuggestionRow;
      const summaryMap = await getMovieSummaryMap([row.tmdb_id]);
      const summary = summaryMap.get(row.tmdb_id);

      return apiSuccess({
        blocked: true,
        ...row,
        title: body.title ?? summary?.title ?? null,
        year: summary?.year ?? null,
        poster_path: summary?.poster_path ?? null,
      });
    } catch (error) {
      console.error("[v1/suggestions/blocked] Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
