import { withApiAuth } from "../../_lib/apiKeyAuth";
import {
  extractRole,
  type ProfileWithRoleRow,
  type UserRoleRelationRow,
} from "../../_lib/adminHelpers";
import {
  buildPagination,
  parsePage,
  parsePerPage,
} from "../../_lib/pagination";
import { requireAdmin } from "../../_lib/permissions";
import { apiPaginated, ApiError } from "../../_lib/responseEnvelope";
import { supabaseAdmin } from "../../_lib/supabaseAdmin";

function escapeLikePattern(input: string): string {
  return input.replace(/[%_\\]/g, (char) => `\\${char}`);
}

export async function GET(req: Request) {
  return withApiAuth(req, async (auth) => {
    requireAdmin(auth);

    try {
      const { searchParams } = new URL(req.url);
      const page = parsePage(searchParams);
      const perPage = parsePerPage(searchParams);
      const offset = (page - 1) * perPage;
      const query = searchParams.get("q")?.trim() ?? "";

      let usersQuery = supabaseAdmin
        .from("profiles")
        .select("id, email, created_at, suspended_at", {
          count: "exact",
        })
        .order("created_at", { ascending: false, nullsFirst: false });

      if (query) {
        usersQuery = usersQuery.ilike("email", `%${escapeLikePattern(query)}%`);
      }

      const { data, error, count } = await usersQuery.range(
        offset,
        offset + perPage - 1,
      );

      if (error) {
        console.error("[API v1] Failed to list admin users", error);
        throw new ApiError(500, "INTERNAL_ERROR", "Failed to fetch users");
      }

      const profiles =
        ((data as Omit<ProfileWithRoleRow, "user_roles">[] | null) ?? []);
      const rolesByUserId = new Map<string, UserRoleRelationRow>();

      if (profiles.length > 0) {
        const { data: roleRows, error: rolesError } = await supabaseAdmin
          .from("user_roles")
          .select("user_id, role")
          .in(
            "user_id",
            profiles.map((profile) => profile.id),
          );

        if (rolesError) {
          console.error("[API v1] Failed to list admin user roles", rolesError);
          throw new ApiError(500, "INTERNAL_ERROR", "Failed to fetch users");
        }

        for (const row of (roleRows as Array<
          UserRoleRelationRow & { user_id: string }
        > | null) ?? []) {
          rolesByUserId.set(row.user_id, row);
        }
      }

      const users = profiles.map((user) => ({
          id: user.id,
          email: user.email,
          created_at: user.created_at,
          suspended_at: user.suspended_at,
          role: extractRole(rolesByUserId.get(user.id) ?? null),
        }));

      return apiPaginated(users, buildPagination(page, perPage, count ?? 0));
    } catch (error) {
      console.error("[v1/admin/users] Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
