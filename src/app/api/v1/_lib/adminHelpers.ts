import { UUID_REGEX } from "./pagination";
import { ApiError } from "./responseEnvelope";

export type UserRole = "user" | "developer" | "admin";

export interface UserRoleRelationRow {
  role: string;
}

export interface ProfileWithRoleRow {
  id: string;
  email: string | null;
  created_at: string | null;
  suspended_at: string | null;
  user_roles: UserRoleRelationRow | UserRoleRelationRow[] | null;
}

export function extractRole(
  userRoles: ProfileWithRoleRow["user_roles"],
): UserRole {
  const relation = Array.isArray(userRoles) ? userRoles[0] : userRoles;

  if (
    relation?.role === "user" ||
    relation?.role === "developer" ||
    relation?.role === "admin"
  ) {
    return relation.role;
  }

  return "user";
}

export function validateUserId(userId: string): void {
  if (!UUID_REGEX.test(userId)) {
    throw new ApiError(400, "BAD_REQUEST", "Invalid user ID format");
  }
}
