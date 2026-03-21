import { withApiAuth } from "../../_lib/apiKeyAuth";
import { extractRole, type ProfileWithRoleRow } from "../../_lib/adminHelpers";
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
        .select("id, email, created_at, suspended_at, user_roles(role)", {
          count: "exact",
        })
        .order("created_at", { ascending: false });

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

      const users = ((data as ProfileWithRoleRow[] | null) ?? []).map(
        (user) => ({
          id: user.id,
          email: user.email,
          created_at: user.created_at,
          suspended_at: user.suspended_at,
          role: extractRole(user.user_roles),
        }),
      );

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
