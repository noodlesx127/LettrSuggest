import { TECHNICAL_METADATA_KEYWORDS } from "@/lib/feedbackConstants";
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
import { fetchTmdb } from "../../_lib/tmdb";

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

async function writeNegativeFeedback(
  userId: string,
  tmdbId: number,
): Promise<void> {
  try {
    const movie = await fetchTmdb<{
      id: number;
      title: string;
      genres?: Array<{ id: number; name: string }>;
      credits?: {
        cast?: Array<{ id: number; name: string }>;
        crew?: Array<{ id: number; job: string; name: string }>;
      };
      keywords?: {
        keywords?: Array<{ id: number; name: string }>;
        results?: Array<{ id: number; name: string }>;
      };
      belongs_to_collection?: { id: number; name: string } | null;
    }>(`/movie/${tmdbId}`, {
      append_to_response: "credits,keywords",
    });

    if (!movie) return;

    const cast = (movie.credits?.cast ?? []).slice(0, 3);
    const directors = (movie.credits?.crew ?? []).filter(
      (c) => c.job === "Director",
    );
    const genres = movie.genres ?? [];
    const keywordList = [
      ...(movie.keywords?.keywords ?? []),
      ...(movie.keywords?.results ?? []),
    ].filter((k) => !TECHNICAL_METADATA_KEYWORDS.has(k.name.toLowerCase()));
    const collection = movie.belongs_to_collection ?? null;

    type FeedbackRow = {
      feature_type: string;
      feature_id: number;
      feature_name: string;
    };

    const features: FeedbackRow[] = [
      ...cast.map((a) => ({
        feature_type: "actor",
        feature_id: a.id,
        feature_name: a.name,
      })),
      ...directors.map((d) => ({
        feature_type: "director",
        feature_id: d.id,
        feature_name: d.name,
      })),
      ...genres.map((g) => ({
        feature_type: "genre",
        feature_id: g.id,
        feature_name: g.name,
      })),
      ...keywordList.slice(0, 10).map((k) => ({
        feature_type: "keyword",
        feature_id: k.id,
        feature_name: k.name,
      })),
      ...(collection
        ? [
            {
              feature_type: "collection",
              feature_id: collection.id,
              feature_name: collection.name,
            },
          ]
        : []),
    ];

    for (const feat of features) {
      const { data: existing } = await supabaseAdmin
        .from("user_feature_feedback")
        .select("positive_count, negative_count")
        .eq("user_id", userId)
        .eq("feature_type", feat.feature_type)
        .eq("feature_id", feat.feature_id)
        .maybeSingle();

      const positiveCount = existing?.positive_count ?? 0;
      const negativeCount = (existing?.negative_count ?? 0) + 1;
      const total = positiveCount + negativeCount;
      const inferredPreference = (positiveCount + 1) / (total + 2);

      await supabaseAdmin.from("user_feature_feedback").upsert(
        {
          user_id: userId,
          feature_type: feat.feature_type,
          feature_id: feat.feature_id,
          feature_name: feat.feature_name,
          positive_count: positiveCount,
          negative_count: negativeCount,
          inferred_preference: inferredPreference,
          last_updated: new Date().toISOString(),
        },
        { onConflict: "user_id,feature_type,feature_id" },
      );
    }

    console.log("[BlockFeedback] Wrote negative feedback", {
      userId: userId.slice(0, 8),
      tmdbId,
      featuresUpdated: features.length,
    });
  } catch (error) {
    console.error("[BlockFeedback] Failed to write negative feedback", {
      tmdbId,
      error,
    });
  }
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
        .order("blocked_at", { ascending: false, nullsFirst: false })
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

      // Write negative feedback features asynchronously (best-effort, non-blocking)
      writeNegativeFeedback(auth.userId, body.tmdb_id).catch((err) => {
        console.error("[BlockFeedback] Background feedback failed", err);
      });

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
