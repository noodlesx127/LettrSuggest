import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    // ── Secret gate (fail closed) ──────────────────────────────────────
    const secret = searchParams.get("secret") ?? "";
    const debugSecret = process.env.DEBUG_SECRET ?? "";

    if (!secret || secret !== debugSecret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ── Params ─────────────────────────────────────────────────────────
    const tmdbIdParam = searchParams.get("tmdbId") ?? "238"; // The Godfather
    if (!/^\d+$/.test(tmdbIdParam)) {
      return NextResponse.json(
        { error: "tmdbId must be numeric" },
        { status: 400 },
      );
    }
    const tmdbId = tmdbIdParam;

    const traktClientId = process.env.TRAKT_CLIENT_ID ?? "";
    const traktClientIdConfigured = traktClientId.length > 0;

    // ── Exact same call the aggregator makes ───────────────────────────
    const traktUrl = `https://api.trakt.tv/search/tmdb/${tmdbId}`;
    const timestamp = new Date().toISOString();

    const traktResp = await fetch(traktUrl, {
      headers: {
        "Content-Type": "application/json",
        "trakt-api-version": "2",
        "trakt-api-key": traktClientId,
      },
    });

    // ── Collect response headers ───────────────────────────────────────
    const responseHeaders: Record<string, string> = {};
    traktResp.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    // ── Read body (cap at 2 000 chars) ─────────────────────────────────
    const rawBody = await traktResp.text();
    const body = rawBody.slice(0, 2000);

    return NextResponse.json({
      status: traktResp.status,
      ok: traktResp.ok,
      traktClientIdConfigured,
      responseHeaders,
      body,
      bodyTruncated: rawBody.length > 2000,
      tmdbIdTested: tmdbId,
      timestamp,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
