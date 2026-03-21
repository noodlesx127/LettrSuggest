import { ApiError } from "./responseEnvelope";

const TMDB_API_BASE_URL = "https://api.themoviedb.org/3";

interface TmdbErrorPayload {
  status_message?: string;
}

function getSafeUpstreamMessage(body: unknown): string | undefined {
  if (
    typeof body === "object" &&
    body !== null &&
    "status_message" in body &&
    typeof body.status_message === "string"
  ) {
    return body.status_message;
  }

  return undefined;
}

function getTmdbApiKey(): string {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    throw new ApiError(500, "INTERNAL_ERROR", "TMDB API key is not configured");
  }

  return apiKey;
}

async function parseErrorPayload(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as TmdbErrorPayload;
  } catch {
    return null;
  }
}

export async function fetchTmdb<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(`${TMDB_API_BASE_URL}${path}`);
  url.searchParams.set("api_key", getTmdbApiKey());

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await parseErrorPayload(response);
    const upstreamMessage = getSafeUpstreamMessage(body);

    console.error("[v1/tmdb] Upstream error:", {
      status: response.status,
      body,
    });

    const details = upstreamMessage
      ? { upstream_message: upstreamMessage }
      : undefined;

    if (response.status === 404) {
      throw new ApiError(404, "NOT_FOUND", "Movie not found", details);
    }

    throw new ApiError(
      response.status >= 500 ? 502 : response.status,
      "UPSTREAM_ERROR",
      "TMDB request failed",
      details,
    );
  }

  return (await response.json()) as T;
}
