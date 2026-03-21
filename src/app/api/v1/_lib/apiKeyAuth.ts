import crypto from "node:crypto";

import { NextResponse } from "next/server";

import type { ApiAuthContext } from "./permissions";
import {
  checkRateLimit,
  rateLimitHeaders,
  type RateLimitResult,
} from "./rateLimiter";
import { ApiError, apiError } from "./responseEnvelope";
import { supabaseAdmin } from "./supabaseAdmin";

interface ApiKeyRow {
  id: string;
  user_id: string;
  key_hash: string;
  key_type: "user" | "admin" | "developer";
  scopes: string[] | null;
  expires_at: string | null;
}

interface UserRoleRow {
  role: string;
}

interface ApiAuthContextWithRateLimit extends ApiAuthContext {
  rateLimit: RateLimitResult | null;
}

function extractBearerToken(req: Request): string {
  const authorizationHeader = req.headers.get("authorization");
  if (!authorizationHeader) {
    throw new ApiError(401, "UNAUTHORIZED", "Missing Authorization header");
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new ApiError(401, "UNAUTHORIZED", "Invalid Authorization header");
  }

  return match[1].trim();
}

function isApiKeyFormat(token: string): boolean {
  return (
    token.startsWith("ls_u_") ||
    token.startsWith("ls_a_") ||
    token.startsWith("ls_d_")
  );
}

function hashesMatch(expectedHash: string, actualHash: string): boolean {
  const expectedBuffer = Buffer.from(expectedHash, "hex");
  const actualBuffer = Buffer.from(actualHash, "hex");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

async function getUserRole(userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[API v1] Failed to fetch user role", error);
    throw new ApiError(500, "INTERNAL_ERROR", "Failed to authenticate API key");
  }

  return (data as UserRoleRow | null)?.role ?? "user";
}

async function authenticateViaApiKey(
  rawKey: string,
): Promise<ApiAuthContextWithRateLimit> {
  if (rawKey.length !== 69) {
    throw new ApiError(401, "UNAUTHORIZED", "Invalid API key format");
  }

  const hashedKey = crypto.createHash("sha256").update(rawKey).digest("hex");

  const { data: apiKeyData, error: apiKeyError } = await supabaseAdmin
    .from("api_keys")
    .select("id, user_id, key_hash, key_type, scopes, expires_at")
    .eq("key_hash", hashedKey)
    .is("revoked_at", null)
    .maybeSingle();

  if (apiKeyError) {
    console.error("[API v1] Failed to fetch API key", apiKeyError);
    throw new ApiError(500, "INTERNAL_ERROR", "Failed to authenticate API key");
  }

  const apiKey = (apiKeyData as ApiKeyRow | null) ?? null;
  if (!apiKey || !hashesMatch(apiKey.key_hash, hashedKey)) {
    throw new ApiError(401, "UNAUTHORIZED", "Invalid API key");
  }

  if (apiKey.expires_at && new Date(apiKey.expires_at).getTime() < Date.now()) {
    throw new ApiError(401, "UNAUTHORIZED", "API key expired");
  }

  const userRole = await getUserRole(apiKey.user_id);
  const rateLimit = await checkRateLimit(apiKey.id, apiKey.key_type);
  if (rateLimit.exceeded) {
    throw new ApiError(429, "RATE_LIMITED", "Rate limit exceeded", {
      rateLimit,
    });
  }

  void (async () => {
    try {
      const { error } = await supabaseAdmin
        .from("api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", apiKey.id);

      if (error) {
        console.error("[API v1] Failed to update API key last_used_at", error);
      }
    } catch (error) {
      console.error("[API v1] Unexpected last_used_at update error", error);
    }
  })();

  return {
    userId: apiKey.user_id,
    keyId: apiKey.id,
    keyType: apiKey.key_type,
    userRole,
    scopes: apiKey.scopes ?? [],
    rateLimit,
  };
}

async function authenticateViaJwt(
  token: string,
): Promise<ApiAuthContextWithRateLimit> {
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    throw new ApiError(401, "UNAUTHORIZED", "Invalid or expired session token");
  }

  const userRole = await getUserRole(user.id);
  const keyType: ApiAuthContext["keyType"] =
    userRole === "admin"
      ? "admin"
      : userRole === "developer"
        ? "developer"
        : "user";

  return {
    userId: user.id,
    keyId: "",
    keyType,
    userRole,
    scopes: [],
    rateLimit: null,
  };
}

export async function authenticateApiKey(
  req: Request,
): Promise<ApiAuthContext> {
  const token = extractBearerToken(req);

  if (isApiKeyFormat(token)) {
    return authenticateViaApiKey(token);
  }

  return authenticateViaJwt(token);
}

function getRateLimitResult(details: unknown): RateLimitResult | undefined {
  if (!details || typeof details !== "object" || !("rateLimit" in details)) {
    return undefined;
  }

  const rateLimit = (details as { rateLimit?: RateLimitResult }).rateLimit;
  return rateLimit;
}

export async function withApiAuth(
  req: Request,
  handler: (auth: ApiAuthContext) => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    const auth = (await authenticateApiKey(req)) as ApiAuthContextWithRateLimit;
    const response = await handler(auth);

    if (auth.rateLimit) {
      for (const [headerName, headerValue] of Object.entries(
        rateLimitHeaders(auth.rateLimit),
      )) {
        response.headers.set(headerName, headerValue);
      }
    }

    return response;
  } catch (error) {
    if (error instanceof ApiError) {
      const response = apiError(
        error.status,
        error.code,
        error.message,
        error.details,
      );
      const rateLimit = getRateLimitResult(error.details);

      if (rateLimit) {
        if (rateLimit.retryAfter) {
          response.headers.set("Retry-After", String(rateLimit.retryAfter));
        }

        for (const [headerName, headerValue] of Object.entries(
          rateLimitHeaders(rateLimit),
        )) {
          response.headers.set(headerName, headerValue);
        }
      }

      return response;
    }

    console.error("[API v1] Unexpected API auth error", error);
    return apiError(500, "INTERNAL_ERROR", "Internal server error");
  }
}
