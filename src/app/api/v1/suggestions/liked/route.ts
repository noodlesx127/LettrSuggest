import { withApiAuth } from "../../_lib/apiKeyAuth";
import { getMovieSummary } from "../../_lib/movieMetadata";
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

interface SavedSuggestionRow {
  id: string;
  tmdb_id: number;
  title: string;
  year: string | null;
  poster_path: string | null;
  order_index: number | null;
  created_at: string;
}

interface LikedSuggestionBody {
  tmdb_id: number;
  title?: string;
}

interface ExistingLikedSuggestionRpcResult {
  already_exists: true;
  id: string;
}

interface NewLikedSuggestionRpcResult extends SavedSuggestionRow {
  already_exists: false;
}

type AddLikedSuggestionRpcResult =
  | ExistingLikedSuggestionRpcResult
  | NewLikedSuggestionRpcResult;

async function parseLikedSuggestionBody(
  req: Request,
): Promise<LikedSuggestionBody> {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "Invalid JSON body");
  }

  if (!isRecord(body)) {
    throw new ApiError(400, "BAD_REQUEST", "Request body must be an object");
  }

  return {
    tmdb_id: parsePositiveInteger(String(body.tmdb_id ?? ""), "tmdb_id"),
    ...(typeof body.title === "string" && body.title.trim() !== ""
      ? { title: body.title.trim() }
      : {}),
  };
}

function isSavedSuggestionRow(value: unknown): value is SavedSuggestionRow {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.tmdb_id === "number" &&
    typeof value.title === "string" &&
    (typeof value.year === "string" || value.year === null) &&
    (typeof value.poster_path === "string" || value.poster_path === null) &&
    (typeof value.order_index === "number" || value.order_index === null) &&
    typeof value.created_at === "string"
  );
}

function isExistingLikedSuggestionRpcResult(
  value: unknown,
): value is ExistingLikedSuggestionRpcResult {
  if (!isRecord(value)) {
    return false;
  }

  return value.already_exists === true && typeof value.id === "string";
}

function isNewLikedSuggestionRpcResult(
  value: unknown,
): value is NewLikedSuggestionRpcResult {
  if (!isRecord(value) || !isSavedSuggestionRow(value)) {
    return false;
  }

  return (
    typeof value.already_exists === "boolean" && value.already_exists === false
  );
}

async function fetchSavedSuggestionById(
  id: string,
  userId: string,
): Promise<SavedSuggestionRow> {
  const { data, error } = await supabaseAdmin
    .from("saved_suggestions")
    .select("id, tmdb_id, title, year, poster_path, order_index, created_at")
    .eq("id", id)
    .eq("user_id", userId)
    .eq("liked", true)
    .maybeSingle();

  if (error) {
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      "Failed to fetch liked suggestion",
    );
  }

  if (!isSavedSuggestionRow(data)) {
    throw new ApiError(500, "INTERNAL_ERROR", "Invalid liked suggestion data");
  }

  return data;
}

export async function GET(req: Request) {
  return withApiAuth(req, async (auth) => {
    try {
      const { searchParams } = new URL(req.url);
      const { page, perPage, offset } = getPaginationParams(searchParams);

      const { data, error, count } = await supabaseAdmin
        .from("saved_suggestions")
        .select(
          "id, tmdb_id, title, year, poster_path, order_index, created_at",
          {
            count: "exact",
          },
        )
        .eq("user_id", auth.userId)
        .eq("liked", true)
        .order("created_at", { ascending: false })
        .range(offset, offset + perPage - 1);

      if (error) {
        throw new ApiError(
          500,
          "INTERNAL_ERROR",
          "Failed to fetch liked suggestions",
        );
      }

      return apiPaginated(
        (data as SavedSuggestionRow[] | null) ?? [],
        buildPagination(page, perPage, count ?? 0),
      );
    } catch (error) {
      console.error("[v1/suggestions/liked] Error:", error);
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
      const body = await parseLikedSuggestionBody(req);

      // Attempt TMDB enrichment but fall back gracefully if the movie is not
      // found — the caller may have already provided a title in the body.
      let movieSummary: {
        title: string | null;
        year: string | null;
        poster_path: string | null;
      } = { title: null, year: null, poster_path: null };
      try {
        movieSummary = await getMovieSummary(body.tmdb_id);
      } catch (tmdbErr) {
        if (!(tmdbErr instanceof ApiError && tmdbErr.status === 404)) {
          throw tmdbErr;
        }
        console.warn(
          `[v1/suggestions/liked] TMDB movie ${body.tmdb_id} not found, using body-provided data`,
        );
      }

      const title = body.title ?? movieSummary.title;
      const year = movieSummary.year
        ? Number.parseInt(movieSummary.year, 10)
        : null;

      if (!title) {
        throw new ApiError(400, "BAD_REQUEST", "Unable to resolve movie title");
      }

      const { data, error } = await supabaseAdmin.rpc("add_liked_suggestion", {
        p_user_id: auth.userId,
        p_tmdb_id: body.tmdb_id,
        p_title: title,
        p_year: Number.isFinite(year) ? year : null,
        p_poster_path: movieSummary.poster_path,
      });

      if (error) {
        throw new ApiError(
          500,
          "INTERNAL_ERROR",
          "Failed to save liked suggestion",
        );
      }

      const result = data as AddLikedSuggestionRpcResult | null;

      if (!result) {
        throw new ApiError(
          500,
          "INTERNAL_ERROR",
          "Failed to save liked suggestion",
        );
      }

      if (isExistingLikedSuggestionRpcResult(result)) {
        const existing = await fetchSavedSuggestionById(result.id, auth.userId);
        return apiSuccess(existing);
      }

      if (!isNewLikedSuggestionRpcResult(result)) {
        throw new ApiError(
          500,
          "INTERNAL_ERROR",
          "Invalid liked suggestion data",
        );
      }

      return apiSuccess(result);
    } catch (error) {
      console.error("[v1/suggestions/liked] Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
