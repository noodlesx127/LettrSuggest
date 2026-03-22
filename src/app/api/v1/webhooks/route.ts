import crypto from "node:crypto";

import { WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/webhookDispatcher";

import { withApiAuth } from "../_lib/apiKeyAuth";
import { buildPagination, parsePage, parsePerPage } from "../_lib/pagination";
import { requireAdmin } from "../_lib/permissions";
import { apiPaginated, apiSuccess, ApiError } from "../_lib/responseEnvelope";
import { supabaseAdmin } from "../_lib/supabaseAdmin";

interface WebhookRow {
  id: string;
  user_id: string;
  url: string;
  secret?: string;
  events: WebhookEvent[];
  active: boolean;
  created_at: string;
}

interface CreateWebhookBody {
  url: string;
  events: WebhookEvent[];
  active?: boolean;
}

function isWebhookEvent(value: unknown): value is WebhookEvent {
  return (
    typeof value === "string" && WEBHOOK_EVENTS.includes(value as WebhookEvent)
  );
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

function validateHttpsUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new ApiError(400, "BAD_REQUEST", "url must be a valid HTTPS URL");
  }

  if (url.protocol !== "https:") {
    throw new ApiError(400, "BAD_REQUEST", "url must be a valid HTTPS URL");
  }

  return url.toString();
}

async function parseCreateWebhookBody(
  req: Request,
): Promise<CreateWebhookBody> {
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
  if (typeof payload.url !== "string") {
    throw new ApiError(400, "BAD_REQUEST", "url is required");
  }

  if (!Array.isArray(payload.events) || payload.events.length === 0) {
    throw new ApiError(400, "BAD_REQUEST", "events must be a non-empty array");
  }

  const events = Array.from(new Set(payload.events)).map((event) => {
    if (!isWebhookEvent(event)) {
      throw new ApiError(
        400,
        "BAD_REQUEST",
        `Invalid webhook event: ${String(event)}`,
      );
    }

    return event;
  });

  if (payload.active !== undefined && typeof payload.active !== "boolean") {
    throw new ApiError(400, "BAD_REQUEST", "active must be a boolean");
  }

  return {
    url: validateHttpsUrl(payload.url),
    events,
    active: typeof payload.active === "boolean" ? payload.active : true,
  };
}

export async function GET(req: Request) {
  return withApiAuth(req, async (auth) => {
    requireAdmin(auth);

    try {
      const { searchParams } = new URL(req.url);
      const page = parsePage(searchParams);
      const perPage = parsePerPage(searchParams);
      const offset = (page - 1) * perPage;

      const { data, error, count } = await supabaseAdmin
        .from("webhooks")
        .select("id, user_id, url, events, active, created_at", {
          count: "exact",
        })
        .eq("user_id", auth.userId)
        .order("created_at", { ascending: false, nullsFirst: false })
        .range(offset, offset + perPage - 1);

      if (error) {
        console.error("[API v1] Failed to list webhooks", error);
        throw new ApiError(500, "INTERNAL_ERROR", "Failed to fetch webhooks");
      }

      const webhooks = ((data as WebhookRow[] | null) ?? []).map(
        sanitizeWebhook,
      );

      return apiPaginated(webhooks, buildPagination(page, perPage, count ?? 0));
    } catch (error) {
      console.error("[v1/webhooks] GET Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}

export async function POST(req: Request) {
  return withApiAuth(req, async (auth) => {
    requireAdmin(auth);

    try {
      const body = await parseCreateWebhookBody(req);
      const secret = crypto.randomBytes(32).toString("hex");

      const { data, error } = await supabaseAdmin
        .from("webhooks")
        .insert({
          user_id: auth.userId,
          url: body.url,
          secret,
          events: body.events,
          active: body.active ?? true,
        })
        .select("id, user_id, url, secret, events, active, created_at")
        .single();

      if (error) {
        console.error("[API v1] Failed to create webhook", error);
        throw new ApiError(500, "INTERNAL_ERROR", "Failed to create webhook");
      }

      const webhook = data as WebhookRow;
      return apiSuccess({
        id: webhook.id,
        url: webhook.url,
        events: webhook.events,
        active: webhook.active,
        secret: webhook.secret,
        created_at: webhook.created_at,
      });
    } catch (error) {
      console.error("[v1/webhooks] POST Error:", error);
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(500, "INTERNAL_ERROR", "Unexpected error");
    }
  });
}
