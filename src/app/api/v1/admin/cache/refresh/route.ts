import { withApiAuth } from "../../../_lib/apiKeyAuth";
import {
  clearCacheTables,
  CLEARABLE_TABLES,
  isClearableCacheTable,
  type ClearableCacheTable,
} from "../../../_lib/adminCache";
import { requireAdmin } from "../../../_lib/permissions";
import { apiSuccess, ApiError } from "../../../_lib/responseEnvelope";

interface RefreshCacheBody {
  tables?: ClearableCacheTable[];
}

async function parseRefreshBody(req: Request): Promise<RefreshCacheBody> {
  const contentLength = req.headers.get("content-length");
  if (contentLength === "0") {
    return {};
  }

  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return {};
  }

  if (!body || typeof body !== "object") {
    throw new ApiError(400, "BAD_REQUEST", "Request body must be an object");
  }

  const payload = body as Record<string, unknown>;
  if (payload.tables === undefined) {
    return {};
  }

  if (!Array.isArray(payload.tables)) {
    throw new ApiError(400, "BAD_REQUEST", "tables must be an array");
  }

  const tables = payload.tables.map((table) => {
    if (typeof table !== "string" || !isClearableCacheTable(table)) {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        `Invalid cache table: ${String(table)}`,
      );
    }

    return table;
  });

  return {
    tables,
  };
}

export async function POST(req: Request) {
  return withApiAuth(req, async (auth) => {
    requireAdmin(auth);

    try {
      const body = await parseRefreshBody(req);
      const tablesToClear = body.tables?.length
        ? body.tables
        : [...CLEARABLE_TABLES];
      const cleared = await clearCacheTables(tablesToClear);

      return apiSuccess({ cleared });
    } catch (error) {
      console.error("[v1/admin/cache/refresh] Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
