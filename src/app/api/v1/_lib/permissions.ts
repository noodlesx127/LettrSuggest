import { ApiError } from "./responseEnvelope";

export interface ApiAuthContext {
  userId: string;
  keyId: string;
  keyType: "user" | "admin" | "developer";
  userRole: string;
  scopes: string[];
}

export function requireAdmin(auth: ApiAuthContext): void {
  if (auth.keyType !== "admin" || auth.userRole !== "admin") {
    throw new ApiError(403, "FORBIDDEN", "Admin API key required");
  }
}

export function requireSelfOrAdmin(
  auth: ApiAuthContext,
  targetUserId: string,
): void {
  if (auth.keyType !== "admin" && auth.userId !== targetUserId) {
    throw new ApiError(403, "FORBIDDEN", "Access denied");
  }
}
