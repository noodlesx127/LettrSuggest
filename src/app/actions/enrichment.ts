"use server";

import type { TMDBMovie } from "@/lib/enrich";
import { getMovieRatings, type MovieRatings } from "@/lib/ratingsAggregator";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  searchWatchmode,
  getStreamingSources,
  type WatchmodeSource,
} from "@/lib/watchmode";
import { getTuiMDBMovie, type TuiMDBMovie } from "@/lib/tuimdb";

type CacheActionResult = {
  error: string | null;
};

export type EnrichmentResult = {
  imdb_id?: string;
  ratings?: MovieRatings;
  watchmode_id?: number;
  streaming_sources?: Array<{
    source_id: number;
    name: string;
    type: "sub" | "buy" | "rent" | "free";
    region: string;
    web_url: string;
  }>;
  tuimdb_movie?: TuiMDBMovie | null;
  tmdbData?: any; // Full TMDB data for caching
};

/**
 * Server Action to enrich a movie with sensitive API data (Ratings, Watchmode, TuiMDB)
 * This runs on the server, so it can access private environment variables.
 */
export async function enrichMovieServerSide(
  tmdbId: number,
  tuimdbUid?: number,
): Promise<EnrichmentResult> {
  try {
    console.log(
      "[EnrichAction] Starting server-side enrichment for TMDB ID:",
      tmdbId,
    );

    // 1. Fetch TMDB details to get IMDb ID
    const tmdbApiKey =
      process.env.TMDB_API_KEY || process.env.NEXT_PUBLIC_TMDB_API_KEY;
    if (!tmdbApiKey) {
      console.error(
        "[EnrichAction] TMDB_API_KEY (or NEXT_PUBLIC_) not configured",
      );
      return {};
    }

    // Include credits, keywords, videos, images, release_dates for full enrichment
    const tmdbRes = await fetch(
      `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${tmdbApiKey}&append_to_response=credits,keywords,videos,images,release_dates`,
      {
        next: { revalidate: 3600 }, // Cache for 1 hour
      },
    );

    if (!tmdbRes.ok) {
      console.error("[EnrichAction] TMDB fetch failed:", tmdbRes.status);
      return {};
    }

    const tmdbData = await tmdbRes.json();
    const imdbId = tmdbData.imdb_id;
    const voteAverage = tmdbData.vote_average;
    const voteCount = tmdbData.vote_count;

    console.log("[EnrichAction] Got TMDB details:", { imdbId, voteAverage });

    // 2. Get Ratings (OMDb -> TMDB -> Watchmode)
    // Now we have the IMDb ID, so OMDb fetch can actually work!
    const ratings = await getMovieRatings(
      tmdbId,
      imdbId,
      voteAverage,
      voteCount,
    );

    // 3. Get Watchmode Data
    let watchmodeId: number | undefined;
    let streamingSources: EnrichmentResult["streaming_sources"] = undefined;

    try {
      const watchmodeResults = await searchWatchmode(String(tmdbId), {
        searchField: "tmdb_id",
      });

      if (watchmodeResults.length > 0) {
        const watchmodeTitle = watchmodeResults[0];
        watchmodeId = watchmodeTitle.id;

        // Get streaming sources
        const sources = await getStreamingSources(watchmodeTitle.id, {
          region: "US",
        });
        if (sources.length > 0) {
          streamingSources = sources.map((s) => ({
            source_id: s.source_id,
            name: s.name,
            type: s.type,
            region: s.region,
            web_url: s.web_url,
          }));
        }
      }
    } catch (e) {
      console.warn("[EnrichAction] Watchmode fetch failed:", e);
    }

    // 4. Get TuiMDB Data (if UID provided)
    let tuimdbMovie: TuiMDBMovie | null = null;
    if (tuimdbUid) {
      try {
        tuimdbMovie = await getTuiMDBMovie(tuimdbUid);
      } catch (e) {
        console.warn("[EnrichAction] TuiMDB fetch failed:", e);
      }
    }

    return {
      imdb_id: imdbId,
      ratings,
      watchmode_id: watchmodeId,
      streaming_sources: streamingSources,
      tuimdb_movie: tuimdbMovie,
      tmdbData: tmdbData, // Return full data
    };
  } catch (error) {
    console.error("[EnrichAction] Server enrichment failed:", error);
    return {};
  }
}

export async function upsertTmdbCacheAction(
  movie: TMDBMovie,
): Promise<CacheActionResult> {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { error } = await supabaseAdmin
      .from("tmdb_movies")
      .upsert({ tmdb_id: movie.id, data: movie }, { onConflict: "tmdb_id" });

    if (error) {
      console.error("[EnrichAction] Failed to upsert tmdb_movies cache", {
        tmdbId: movie.id,
        error,
      });
      return { error: error.message };
    }

    console.log("[EnrichAction] Upserted tmdb_movies cache", {
      tmdbId: movie.id,
    });
    return { error: null };
  } catch (error) {
    console.error("[EnrichAction] Exception upserting tmdb_movies cache", {
      tmdbId: movie.id,
      error,
    });
    return {
      error:
        error instanceof Error
          ? error.message
          : "Failed to upsert tmdb_movies cache",
    };
  }
}

export async function refreshTmdbCacheForIdsAction(
  ids: number[],
): Promise<CacheActionResult> {
  const distinctIds = Array.from(new Set(ids.filter(Boolean)));

  if (distinctIds.length === 0) {
    return { error: null };
  }

  try {
    const tmdbApiKey =
      process.env.TMDB_API_KEY || process.env.NEXT_PUBLIC_TMDB_API_KEY;

    if (!tmdbApiKey) {
      console.error("[EnrichAction] TMDB API key missing for cache refresh");
      return { error: "TMDB API key not configured" };
    }

    const supabaseAdmin = getSupabaseAdmin();

    for (const tmdbId of distinctIds) {
      try {
        const response = await fetch(
          `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${tmdbApiKey}&append_to_response=credits,keywords`,
          {
            cache: "no-store",
          },
        );

        if (!response.ok) {
          console.error("[EnrichAction] Failed to refresh TMDB movie", {
            tmdbId,
            status: response.status,
          });
          continue;
        }

        const movie = (await response.json()) as TMDBMovie;
        const { error } = await supabaseAdmin
          .from("tmdb_movies")
          .upsert(
            { tmdb_id: movie.id, data: movie },
            { onConflict: "tmdb_id" },
          );

        if (error) {
          console.error(
            "[EnrichAction] Failed to upsert refreshed tmdb_movies cache",
            {
              tmdbId,
              error,
            },
          );
        }
      } catch (error) {
        console.error("[EnrichAction] Exception refreshing TMDB cache entry", {
          tmdbId,
          error,
        });
      }
    }

    return { error: null };
  } catch (error) {
    console.error("[EnrichAction] Exception refreshing tmdb_movies cache", {
      error,
    });
    return {
      error:
        error instanceof Error
          ? error.message
          : "Failed to refresh tmdb_movies cache",
    };
  }
}

export async function setCachedTMDBSimilarAction(
  tmdbId: number,
  similar: number[],
  recommendations: number[],
): Promise<CacheActionResult> {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { error } = await supabaseAdmin.from("tmdb_similar_cache").upsert(
      {
        tmdb_id: tmdbId,
        similar_ids: similar,
        recommendations_ids: recommendations,
        cached_at: new Date().toISOString(),
      },
      { onConflict: "tmdb_id" },
    );

    if (error) {
      console.error("[EnrichAction] Failed to upsert tmdb_similar_cache", {
        tmdbId,
        error,
      });
      return { error: error.message };
    }

    console.log("[EnrichAction] Upserted tmdb_similar_cache", {
      tmdbId,
      similarCount: similar.length,
      recommendationCount: recommendations.length,
    });
    return { error: null };
  } catch (error) {
    console.error("[EnrichAction] Exception upserting tmdb_similar_cache", {
      tmdbId,
      error,
    });
    return {
      error:
        error instanceof Error
          ? error.message
          : "Failed to upsert tmdb_similar_cache",
    };
  }
}
