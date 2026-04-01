import { NextRequest, NextResponse } from "next/server";

const TRAKT_API_BASE = "https://api.trakt.tv";
const TRAKT_API_VERSION = "2";

/**
 * Trakt API Route: Get Related Movies
 *
 * Fetches related movies from Trakt API based on a TMDB movie ID.
 * This endpoint proxies requests to Trakt to keep the Client ID server-side.
 *
 * Flow:
 * 1. Resolve TMDB ID → Trakt slug via /search/tmdb/{id}
 *    (KNOWN ISSUE: this endpoint often returns empty results; needs title-search fix)
 * 2. Fetch related movies via /movies/{slug}/related
 *
 * Query Parameters:
 * - id: TMDB movie ID (required)
 * - limit: Number of related movies to return (optional, default: 10)
 *
 * Returns:
 * - ok: boolean
 * - ids: number[] (array of TMDB IDs)
 * - error: string (if error occurred)
 */
export async function GET(req: NextRequest) {
  const tmdbId = req.nextUrl.searchParams.get("id");
  const limit = req.nextUrl.searchParams.get("limit") || "10";

  // Validate required parameters
  if (!tmdbId) {
    return NextResponse.json(
      { ok: false, error: "Missing required parameter: id" },
      { status: 400 },
    );
  }

  // Validate TMDB ID is a number
  const tmdbIdNum = parseInt(tmdbId, 10);
  if (isNaN(tmdbIdNum) || tmdbIdNum <= 0) {
    return NextResponse.json(
      { ok: false, error: "Invalid TMDB ID: must be a positive number" },
      { status: 400 },
    );
  }

  // Check for API key
  const clientId = process.env.TRAKT_CLIENT_ID;
  if (!clientId) {
    console.error("[Trakt] TRAKT_CLIENT_ID not configured");
    return NextResponse.json(
      { ok: false, error: "Trakt API not configured" },
      { status: 500 },
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "trakt-api-version": TRAKT_API_VERSION,
    "trakt-api-key": clientId,
  };

  try {
    // Step 1: Resolve TMDB ID to Trakt slug
    // NOTE: The /search/tmdb/{id} endpoint is known to return empty results for many
    // valid TMDB IDs. The proper fix is to use the title-search approach
    // (/search/movie?query={title}&limit=1) with a TMDB ID cross-validation guard,
    // as implemented in recommendationAggregator.ts. However, this route currently
    // only receives a TMDB ID (no movie title), so it cannot use the title-search
    // fallback. To fully fix this, a "title" query parameter must be added to this
    // route and its callers updated accordingly.
    console.log(`[Trakt] Looking up Trakt slug for TMDB ID: ${tmdbId}`);
    console.warn(
      `[Trakt] Using /search/tmdb/${tmdbId} endpoint which is known to return ` +
        `empty results for many valid TMDB IDs. This route needs a "title" query ` +
        `parameter to switch to the title-search approach with TMDB ID validation.`,
    );

    const lookupResponse = await fetch(
      `${TRAKT_API_BASE}/search/tmdb/${tmdbId}?type=movie`,
      { headers },
    );

    if (!lookupResponse.ok) {
      console.error(
        `[Trakt] Slug lookup failed: ${lookupResponse.status} ${lookupResponse.statusText}`,
      );
      return NextResponse.json(
        { ok: false, error: `Trakt lookup error: ${lookupResponse.status}` },
        { status: lookupResponse.status },
      );
    }

    const lookupData = await lookupResponse.json();
    const traktSlug = lookupData?.[0]?.movie?.ids?.slug;

    if (!traktSlug) {
      console.log(`[Trakt] No Trakt match found for TMDB ID: ${tmdbId}`);
      return NextResponse.json({
        ok: true,
        ids: [],
        count: 0,
      });
    }

    console.log(`[Trakt] Resolved TMDB ${tmdbId} → slug "${traktSlug}"`);

    // Step 2: Fetch related movies using the Trakt slug
    const response = await fetch(
      `${TRAKT_API_BASE}/movies/${traktSlug}/related?limit=${limit}`,
      {
        headers,
        next: { revalidate: 3600 }, // Cache for 1 hour
      },
    );

    if (!response.ok) {
      console.error(
        `[Trakt] API error: ${response.status} ${response.statusText}`,
      );
      return NextResponse.json(
        { ok: false, error: `Trakt API error: ${response.status}` },
        { status: response.status },
      );
    }

    const data = await response.json();

    // Extract TMDB IDs from Trakt response
    // Trakt returns: [{ ids: { tmdb: 123, trakt: 456, ... }, title: "...", ... }, ...]
    if (!Array.isArray(data)) {
      console.warn(
        `[Trakt] Related response is not an array for slug "${traktSlug}"`,
        {
          type: typeof data,
          preview: JSON.stringify(data)?.slice(0, 500),
        },
      );
      return NextResponse.json({ ok: true, ids: [], count: 0 });
    }

    const tmdbIds = data
      .map((movie: { ids?: { tmdb?: number } }) => movie.ids?.tmdb)
      .filter((id: number | undefined) => id != null && id > 0);

    console.log(
      `[Trakt] Found ${tmdbIds.length} related movies for TMDB ID: ${tmdbId} (slug: ${traktSlug})`,
    );

    return NextResponse.json({
      ok: true,
      ids: tmdbIds,
      count: tmdbIds.length,
    });
  } catch (error) {
    console.error("[Trakt] Exception fetching related movies:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to fetch related movies from Trakt" },
      { status: 500 },
    );
  }
}
