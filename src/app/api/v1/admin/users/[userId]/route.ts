import {
  extractRole,
  type ProfileWithRoleRow,
  type UserRole,
  validateUserId,
} from "../../../_lib/adminHelpers";
import { withApiAuth } from "../../../_lib/apiKeyAuth";
import { requireAdmin } from "../../../_lib/permissions";
import { apiSuccess, ApiError } from "../../../_lib/responseEnvelope";
import { supabaseAdmin } from "../../../_lib/supabaseAdmin";

interface RouteContext {
  params: Promise<{
    userId: string;
  }>;
}

interface UpdateUserRoleBody {
  role: UserRole;
}

async function getProfileOrThrow(userId: string): Promise<ProfileWithRoleRow> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, email, created_at, suspended_at, user_roles(role)")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("[API v1] Failed to fetch admin user profile", error);
    throw new ApiError(500, "INTERNAL_ERROR", "Failed to fetch user");
  }

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "User not found");
  }

  return data as ProfileWithRoleRow;
}

async function parseUpdateUserRoleBody(
  req: Request,
): Promise<UpdateUserRoleBody> {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "Invalid JSON body");
  }

  if (!body || typeof body !== "object") {
    throw new ApiError(400, "BAD_REQUEST", "Request body must be an object");
  }

  const payload = body as Record<string, unknown>;
  if (
    payload.role !== "user" &&
    payload.role !== "developer" &&
    payload.role !== "admin"
  ) {
    throw new ApiError(400, "BAD_REQUEST", "Invalid role");
  }

  return {
    role: payload.role,
  };
}

export async function GET(req: Request, { params }: RouteContext) {
  return withApiAuth(req, async (auth) => {
    requireAdmin(auth);

    try {
      const { userId } = await params;
      validateUserId(userId);

      const profile = await getProfileOrThrow(userId);
      const [apiKeysResult, filmEventsResult] = await Promise.all([
        supabaseAdmin
          .from("api_keys")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId),
        supabaseAdmin
          .from("film_events")
          .select("*", { count: "exact", head: true })
          .eq("user_id", userId),
      ]);

      if (apiKeysResult.error || filmEventsResult.error) {
        console.error("[API v1] Failed to fetch admin user stats", {
          apiKeysError: apiKeysResult.error,
          filmEventsError: filmEventsResult.error,
        });
        throw new ApiError(500, "INTERNAL_ERROR", "Failed to fetch user stats");
      }

      return apiSuccess({
        profile: {
          id: profile.id,
          email: profile.email,
          created_at: profile.created_at,
          suspended_at: profile.suspended_at,
        },
        role: extractRole(profile.user_roles),
        stats: {
          apiKeyCount: apiKeysResult.count ?? 0,
          filmCount: filmEventsResult.count ?? 0,
        },
      });
    } catch (error) {
      console.error("[v1/admin/users/[userId]] Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}

export async function PATCH(req: Request, { params }: RouteContext) {
  return withApiAuth(req, async (auth) => {
    requireAdmin(auth);

    try {
      const { userId } = await params;
      validateUserId(userId);
      const body = await parseUpdateUserRoleBody(req);

      await getProfileOrThrow(userId);

      const { error } = await supabaseAdmin.from("user_roles").upsert(
        {
          user_id: userId,
          role: body.role,
          granted_by: auth.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

      if (error) {
        console.error("[API v1] Failed to update user role", error);
        throw new ApiError(500, "INTERNAL_ERROR", "Failed to update user role");
      }

      return apiSuccess({ userId, role: body.role });
    } catch (error) {
      console.error("[v1/admin/users/[userId]] PATCH Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
