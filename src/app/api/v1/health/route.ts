import { apiError, apiSuccess } from "../_lib/responseEnvelope";
import { supabaseAdmin } from "../_lib/supabaseAdmin";

export async function GET() {
  let db: "connected" | "error" = "connected";

  try {
    const { error } = await supabaseAdmin
      .from("user_roles")
      .select("user_id", { head: true, count: "exact" })
      .limit(1);

    if (error) {
      db = "error";
      console.error("[API v1] Health check database error", error);
    }
  } catch (error) {
    db = "error";
    console.error("[API v1] Health check unexpected database error", error);
  }

  if (db === "error") {
    return apiError(503, "SERVICE_UNAVAILABLE", "Database connectivity issue", {
      db,
    });
  }

  return apiSuccess({
    status: "ok",
    version: "v1",
    timestamp: new Date().toISOString(),
    db,
  });
}
