import { withApiAuth } from "../../_lib/apiKeyAuth";
import { UUID_REGEX } from "../../_lib/pagination";
import { requireAdmin } from "../../_lib/permissions";
import { apiSuccess, ApiError } from "../../_lib/responseEnvelope";
import { supabaseAdmin } from "../../_lib/supabaseAdmin";

interface RouteContext {
  params: Promise<{
    webhookId: string;
  }>;
}

interface WebhookRow {
  id: string;
  user_id: string;
  url: string;
  secret?: string;
  events: string[];
  active: boolean;
  created_at: string;
}

function sanitizeWebhook(webhook: WebhookRow) {
  return {
    id: webhook.id,
    user_id: webhook.user_id,
    url: webhook.url,
    events: webhook.events,
    active: webhook.active,
    created_at: webhook.created_at,
  };
}

function validateWebhookId(webhookId: string): void {
  if (!UUID_REGEX.test(webhookId)) {
    throw new ApiError(400, "BAD_REQUEST", "Invalid webhook ID format");
  }
}

async function getOwnedWebhookOrThrow(
  userId: string,
  webhookId: string,
): Promise<WebhookRow> {
  const { data, error } = await supabaseAdmin
    .from("webhooks")
    .select("id, user_id, url, events, active, created_at")
    .eq("id", webhookId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[API v1] Failed to fetch webhook", error);
    throw new ApiError(500, "INTERNAL_ERROR", "Failed to fetch webhook");
  }

  if (!data) {
    throw new ApiError(404, "NOT_FOUND", "Webhook not found");
  }

  return data as WebhookRow;
}

export async function GET(req: Request, { params }: RouteContext) {
  return withApiAuth(req, async (auth) => {
    requireAdmin(auth);

    try {
      const { webhookId } = await params;
      validateWebhookId(webhookId);

      const webhook = await getOwnedWebhookOrThrow(auth.userId, webhookId);
      return apiSuccess(sanitizeWebhook(webhook));
    } catch (error) {
      console.error("[v1/webhooks/[webhookId]] GET Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}

export async function DELETE(req: Request, { params }: RouteContext) {
  return withApiAuth(req, async (auth) => {
    requireAdmin(auth);

    try {
      const { webhookId } = await params;
      validateWebhookId(webhookId);

      const { data, error } = await supabaseAdmin
        .from("webhooks")
        .delete()
        .eq("id", webhookId)
        .eq("user_id", auth.userId)
        .select("id")
        .maybeSingle();

      if (error) {
        console.error("[API v1] Failed to delete webhook", error);
        throw new ApiError(500, "INTERNAL_ERROR", "Failed to delete webhook");
      }

      if (!data) {
        throw new ApiError(404, "NOT_FOUND", "Webhook not found");
      }

      return apiSuccess({ deleted: true });
    } catch (error) {
      console.error("[v1/webhooks/[webhookId]] DELETE Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
