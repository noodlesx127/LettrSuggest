import { withApiAuth } from "../../_lib/apiKeyAuth";
import { ApiError, apiSuccess } from "../../_lib/responseEnvelope";
import { supabaseAdmin } from "../../_lib/supabaseAdmin";

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

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function getOwnedKeyOrThrow(
  userId: string,
  keyId: string,
): Promise<ApiKeySummaryRow> {
  const { data, error } = await supabaseAdmin
    .from("api_keys")
    .select(
      "id, key_prefix, label, key_type, created_at, last_used_at, expires_at, revoked_at",
    )
    .eq("id", keyId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[API v1] Failed to fetch API key", error);
    throw new ApiError(500, "INTERNAL_ERROR", "Failed to fetch API key");
  }

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "API key not found");
  }

  return data as ApiKeySummaryRow;
}

export async function GET(
  req: Request,
  { params }: { params: { keyId: string } },
) {
  return withApiAuth(req, async (auth) => {
    if (!UUID_REGEX.test(params.keyId)) {
      throw new ApiError(400, "BAD_REQUEST", "Invalid key ID format");
    }

    const key = await getOwnedKeyOrThrow(auth.userId, params.keyId);
    return apiSuccess(toKeyResponse(key));
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: { keyId: string } },
) {
  return withApiAuth(req, async (auth) => {
    if (!UUID_REGEX.test(params.keyId)) {
      throw new ApiError(400, "BAD_REQUEST", "Invalid key ID format");
    }

    const existingKey = await getOwnedKeyOrThrow(auth.userId, params.keyId);

    if (existingKey.revoked_at) {
      return apiSuccess(toKeyResponse(existingKey));
    }

    const revokedAt = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("api_keys")
      .update({ revoked_at: revokedAt })
      .eq("id", params.keyId)
      .eq("user_id", auth.userId)
      .select(
        "id, key_prefix, label, key_type, created_at, last_used_at, expires_at, revoked_at",
      )
      .single();

    if (error) {
      console.error("[API v1] Failed to revoke API key", error);
      throw new ApiError(500, "INTERNAL_ERROR", "Failed to revoke API key");
    }

    return apiSuccess(toKeyResponse(data as ApiKeySummaryRow));
  });
}
