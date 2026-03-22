import crypto from "node:crypto";

import { withApiAuth } from "../_lib/apiKeyAuth";
import { ApiError, apiSuccess } from "../_lib/responseEnvelope";
import { supabaseAdmin } from "../_lib/supabaseAdmin";

type ApiKeyType = "user" | "developer" | "admin";

interface ApiKeySummaryRow {
  id: string;
  key_prefix: string;
  label: string | null;
  key_type: ApiKeyType;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

interface CreateApiKeyBody {
  label?: string;
  key_type: ApiKeyType;
  expires_at?: string;
}

function isApiKeyType(value: unknown): value is ApiKeyType {
  return value === "user" || value === "developer" || value === "admin";
}

function getKeyStatus(
  key: Pick<ApiKeySummaryRow, "expires_at" | "revoked_at">,
): "active" | "expired" | "revoked" {
  if (key.revoked_at) {
    return "revoked";
  }

  if (key.expires_at && new Date(key.expires_at).getTime() < Date.now()) {
    return "expired";
  }

  return "active";
}

function toKeyResponse(key: ApiKeySummaryRow) {
  return {
    id: key.id,
    key_prefix: key.key_prefix,
    label: key.label,
    key_type: key.key_type,
    created_at: key.created_at,
    last_used_at: key.last_used_at,
    expires_at: key.expires_at,
    revoked_at: key.revoked_at,
    status: getKeyStatus(key),
  };
}

async function parseCreateApiKeyBody(req: Request): Promise<CreateApiKeyBody> {
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
  if (!isApiKeyType(payload.key_type)) {
    throw new ApiError(400, "BAD_REQUEST", "Invalid key_type");
  }

  if (payload.label !== undefined && typeof payload.label !== "string") {
    throw new ApiError(400, "BAD_REQUEST", "label must be a string");
  }

  if (
    payload.expires_at !== undefined &&
    typeof payload.expires_at !== "string"
  ) {
    throw new ApiError(400, "BAD_REQUEST", "expires_at must be a string");
  }

  if (typeof payload.expires_at === "string") {
    const expiresAt = new Date(payload.expires_at);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        "expires_at must be a valid ISO date",
      );
    }

    if (expiresAt.getTime() <= Date.now()) {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        "expires_at must be in the future",
      );
    }
  }

  return {
    key_type: payload.key_type,
    label:
      typeof payload.label === "string"
        ? payload.label.trim() || undefined
        : undefined,
    expires_at:
      typeof payload.expires_at === "string" ? payload.expires_at : undefined,
  };
}

export async function GET(req: Request) {
  return withApiAuth(req, async (auth) => {
    const { data, error } = await supabaseAdmin
      .from("api_keys")
      .select(
        "id, key_prefix, label, key_type, created_at, last_used_at, expires_at, revoked_at",
      )
      .eq("user_id", auth.userId)
      .order("created_at", { ascending: false, nullsFirst: false });

    if (error) {
      console.error("[API v1] Failed to list API keys", error);
      throw new ApiError(500, "INTERNAL_ERROR", "Failed to list API keys");
    }

    const keys = ((data as ApiKeySummaryRow[] | null) ?? []).map(toKeyResponse);
    return apiSuccess(keys);
  });
}

export async function POST(req: Request) {
  return withApiAuth(req, async (auth) => {
    const body = await parseCreateApiKeyBody(req);

    if (body.key_type === "admin" && auth.userRole !== "admin") {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Admin key type requires admin role",
      );
    }

    if (
      body.key_type === "developer" &&
      auth.userRole !== "developer" &&
      auth.userRole !== "admin"
    ) {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Developer key type requires developer or admin role",
      );
    }

    const prefix =
      body.key_type === "user"
        ? "ls_u_"
        : body.key_type === "admin"
          ? "ls_a_"
          : "ls_d_";
    const rawKey = prefix + crypto.randomBytes(32).toString("hex");
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.slice(0, 10);

    const { data, error } = await supabaseAdmin
      .from("api_keys")
      .insert({
        user_id: auth.userId,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        key_type: body.key_type,
        label: body.label ?? null,
        expires_at: body.expires_at ?? null,
      })
      .select(
        "id, key_prefix, label, key_type, created_at, last_used_at, expires_at, revoked_at",
      )
      .single();

    if (error) {
      console.error("[API v1] Failed to create API key", error);
      throw new ApiError(500, "INTERNAL_ERROR", "Failed to create API key");
    }

    const key = data as ApiKeySummaryRow;
    return apiSuccess({
      ...toKeyResponse(key),
      rawKey,
    });
  });
}
