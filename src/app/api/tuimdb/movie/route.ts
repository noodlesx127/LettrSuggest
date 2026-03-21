import { NextResponse } from "next/server";
import { getTuiMDBMovie, searchTuiMDB, tuiMDBToTMDB } from "@/lib/tuimdb";
import { getCachedTuiMDBUid, setCachedTuiMDBUid } from "@/lib/apiCache";

/**
 * GET /api/tuimdb/movie
 *
 * Accepts either:
 *   ?uid=<tuimdb_uid>   — direct TuiMDB UID fetch
 *   ?id=<tmdb_id>       — resolve TuiMDB UID from TMDB ID (via cache or title search)
 *
 * Resolution flow for ?id=:
 *   1. Check tuimdb_uid_cache for this TMDB ID (admin client to bypass RLS)
 *   2. Cache miss → fetch TMDB to get title + year
 *   3. Search TuiMDB by "title (year)"
 *   4. Store resolved UID in cache (null if not found)
 *   5. Fetch full TuiMDB movie by resolved UID
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const uid = url.searchParams.get("uid");
    const tmdbId = url.searchParams.get("id");

    const apiKey = process.env.TUIMDB_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "TUIMDB_API_KEY not configured" },
        { status: 500 },
      );
    }

    // --- Direct UID path ---
    if (uid) {
      const movie = await getTuiMDBMovie(parseInt(uid, 10), apiKey);
      if (!movie) {
        return NextResponse.json({ error: "Movie not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, movie: tuiMDBToTMDB(movie) });
    }

    // --- TMDB ID resolution path ---
    if (tmdbId) {
      const tmdbIdNum = parseInt(tmdbId, 10);
      if (isNaN(tmdbIdNum)) {
        return NextResponse.json(
          { error: "Invalid id parameter" },
          { status: 400 },
        );
      }

      // 1. Check cache
      const cached = await getCachedTuiMDBUid(tmdbIdNum);

      if (cached === null) {
        // Cached as "not found in TuiMDB"
        return NextResponse.json(
          { error: "Movie not found in TuiMDB" },
          { status: 404 },
        );
      }

      let resolvedUid: number | null = cached ?? null;

      if (resolvedUid === null) {
        // Cache miss — resolve via TMDB title lookup + TuiMDB search
        const tmdbApiKey = process.env.TMDB_API_KEY;
        if (!tmdbApiKey) {
          return NextResponse.json(
            { error: "TMDB_API_KEY not configured" },
            { status: 500 },
          );
        }

        // 2. Fetch TMDB to get title + year
        let title: string | null = null;
        let year: number | null = null;

        try {
          const tmdbUrl = `https://api.themoviedb.org/3/movie/${tmdbIdNum}?api_key=${tmdbApiKey}`;
          const tmdbRes = await fetch(tmdbUrl, {
            headers: { Accept: "application/json" },
            cache: "no-store",
          });

          if (tmdbRes.ok) {
            const tmdbData = await tmdbRes.json();
            title = tmdbData.title ?? tmdbData.original_title ?? null;
            year = tmdbData.release_date
              ? new Date(tmdbData.release_date).getFullYear()
              : null;
          } else {
            console.warn(
              `[TuiMDB Route] TMDB lookup failed for ${tmdbIdNum}: ${tmdbRes.status}`,
            );
          }
        } catch (e) {
          console.error("[TuiMDB Route] Error fetching TMDB metadata:", e);
        }

        if (!title) {
          // Can't resolve without a title — cache as null to avoid repeated attempts
          await setCachedTuiMDBUid(tmdbIdNum, null);
          return NextResponse.json(
            { error: "Could not resolve movie title from TMDB" },
            { status: 404 },
          );
        }

        // 3. Search TuiMDB
        try {
          const searchResults = await searchTuiMDB(
            title,
            year ?? undefined,
            apiKey,
          );

          if (searchResults.length > 0) {
            // Pick the best match: prefer exact title + year match
            const titleLower = title.toLowerCase();
            const exactMatch = searchResults.find((r) => {
              const rTitleLower = r.Title?.toLowerCase();
              const rYear = r.ReleaseDate
                ? new Date(r.ReleaseDate).getFullYear()
                : null;
              const titleMatch = rTitleLower === titleLower;
              const yearMatch = !year || !rYear || year === rYear;
              return titleMatch && yearMatch;
            });

            resolvedUid = (exactMatch ?? searchResults[0]).UID;
            console.log(
              `[TuiMDB Route] Resolved TMDB ${tmdbIdNum} → TuiMDB UID ${resolvedUid} (title: "${title}")`,
            );
          } else {
            console.log(
              `[TuiMDB Route] No TuiMDB results for "${title}" (TMDB ${tmdbIdNum})`,
            );
            resolvedUid = null;
          }
        } catch (e) {
          console.error("[TuiMDB Route] TuiMDB search error:", e);
          resolvedUid = null;
        }

        // 4. Cache the resolved UID (or null = not found)
        await setCachedTuiMDBUid(tmdbIdNum, resolvedUid);
      }

      if (resolvedUid === null) {
        return NextResponse.json(
          { error: "Movie not found in TuiMDB" },
          { status: 404 },
        );
      }

      // 5. Fetch full TuiMDB movie
      const movie = await getTuiMDBMovie(resolvedUid, apiKey);
      if (!movie) {
        // UID resolved but movie fetch failed — invalidate cache entry
        await setCachedTuiMDBUid(tmdbIdNum, null);
        return NextResponse.json({ error: "Movie not found" }, { status: 404 });
      }

      return NextResponse.json({ ok: true, movie: tuiMDBToTMDB(movie) });
    }

    return NextResponse.json(
      { error: "Missing uid or id parameter" },
      { status: 400 },
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    console.error("[TuiMDB Route] Unhandled error:", e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
