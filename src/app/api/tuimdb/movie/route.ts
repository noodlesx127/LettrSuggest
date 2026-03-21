import { NextResponse } from "next/server";
import { getTuiMDBMovie, searchTuiMDB, tuiMDBToTMDB } from "@/lib/tuimdb";
import { getCachedTuiMDBUid, setCachedTuiMDBUid } from "@/lib/apiCache";

/**
 * Resolve a TuiMDB UID from a TMDB ID.
 * Strategy:
 *  1. Check Supabase tuimdb_uid_cache
 *  2. If not cached, fetch the movie title/year from TMDB, search TuiMDB, cache result
 */
async function resolveTuiMDBUid(
  tmdbId: number,
  apiKey: string,
): Promise<number | null> {
  // 1. Cache lookup
  const cached = await getCachedTuiMDBUid(tmdbId);
  if (cached !== undefined) {
    // cached can be a number (found) or null (previously confirmed not in TuiMDB)
    return cached;
  }

  // 2. Fetch TMDB title/year so we can search TuiMDB
  const tmdbApiKey = process.env.TMDB_API_KEY;
  if (!tmdbApiKey) {
    console.warn(
      "[TuiMDB/movie] TMDB_API_KEY not set; cannot resolve TMDB ID to TuiMDB UID",
    );
    return null;
  }

  let title: string | null = null;
  let year: number | undefined;

  try {
    const tmdbUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${tmdbApiKey}&language=en-US`;
    const tmdbRes = await fetch(tmdbUrl, { cache: "no-store" });
    if (tmdbRes.ok) {
      const tmdbData = (await tmdbRes.json()) as {
        title?: string;
        release_date?: string;
      };
      title = tmdbData.title ?? null;
      if (tmdbData.release_date) {
        year = new Date(tmdbData.release_date).getFullYear();
      }
    } else {
      console.warn(
        `[TuiMDB/movie] TMDB fetch for ${tmdbId} returned ${tmdbRes.status}`,
      );
    }
  } catch (e) {
    console.error("[TuiMDB/movie] Error fetching TMDB details:", e);
  }

  if (!title) {
    await setCachedTuiMDBUid(tmdbId, null);
    return null;
  }

  // 3. Search TuiMDB by title/year
  try {
    const results = await searchTuiMDB(title, year, apiKey);
    if (results.length > 0) {
      // Prefer an exact title match + year match, then fall back to first result
      const titleLower = title.toLowerCase();
      const exactMatch = results.find((r) => {
        const rTitle = r.Title?.toLowerCase();
        const rYear = r.ReleaseDate
          ? new Date(r.ReleaseDate).getFullYear()
          : null;
        return rTitle === titleLower && (!year || !rYear || rYear === year);
      });

      const best = exactMatch ?? results[0];
      const uid = best.UID;
      await setCachedTuiMDBUid(tmdbId, uid);
      console.log(
        `[TuiMDB/movie] Resolved TMDB ${tmdbId} -> TuiMDB UID ${uid}`,
      );
      return uid;
    }
  } catch (e) {
    console.error("[TuiMDB/movie] TuiMDB search error:", e);
  }

  // Not found in TuiMDB – cache the negative result
  await setCachedTuiMDBUid(tmdbId, null);
  return null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const apiKey = process.env.TUIMDB_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "TUIMDB_API_KEY not configured" },
        { status: 500 },
      );
    }

    // Support both ?tmdb_id= (preferred, new callers) and ?uid= (legacy direct UID)
    const tmdbIdParam = url.searchParams.get("tmdb_id");
    const uidParam = url.searchParams.get("uid");

    let tuiUid: number | null = null;

    if (tmdbIdParam) {
      const tmdbId = parseInt(tmdbIdParam, 10);
      if (isNaN(tmdbId)) {
        return NextResponse.json(
          { error: "Invalid tmdb_id parameter" },
          { status: 400 },
        );
      }
      tuiUid = await resolveTuiMDBUid(tmdbId, apiKey);
    } else if (uidParam) {
      tuiUid = parseInt(uidParam, 10);
      if (isNaN(tuiUid)) {
        return NextResponse.json(
          { error: "Invalid uid parameter" },
          { status: 400 },
        );
      }
    } else {
      return NextResponse.json(
        { error: "Missing required parameter: tmdb_id or uid" },
        { status: 400 },
      );
    }

    if (tuiUid === null) {
      return NextResponse.json(
        { error: "Movie not found in TuiMDB" },
        { status: 404 },
      );
    }

    const movie = await getTuiMDBMovie(tuiUid, apiKey);

    if (!movie) {
      return NextResponse.json({ error: "Movie not found" }, { status: 404 });
    }

    // Convert to TMDB-compatible format for consistency
    const tmdbFormat = tuiMDBToTMDB(movie);

    return NextResponse.json({ ok: true, movie: tmdbFormat });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
