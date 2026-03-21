import crypto from "node:crypto";

import { supabaseAdmin } from "@/app/api/v1/_lib/supabaseAdmin";

export const WEBHOOK_EVENTS = [
  "import.completed",
  "suggestions.generated",
  "feedback.created",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, unknown>;
}

interface WebhookSubscriptionRow {
  id: string;
  url: string;
  secret: string;
  events: WebhookEvent[];
}

function signPayload(payload: string, secret: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(payload).digest("hex")}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function dispatchWebhookEvent(
  userId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  const { data: webhooks, error } = await supabaseAdmin
    .from("webhooks")
    .select("id, url, secret, events")
    .eq("user_id", userId)
    .eq("active", true)
    .contains("events", [event]);

  if (error) {
    console.error("[WebhookDispatcher] Failed to load webhook subscriptions", {
      userId,
      event,
      error,
    });
    return;
  }

  const subscriptions = (webhooks as WebhookSubscriptionRow[] | null) ?? [];
  if (!subscriptions.length) {
    return;
  }

  const payload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    data,
  };
  const payloadStr = JSON.stringify(payload);

  await Promise.allSettled(
    subscriptions.map((webhook) =>
      deliverWebhook(webhook, payload, payloadStr),
    ),
  );
}

async function deliverWebhook(
  webhook: WebhookSubscriptionRow,
  payload: WebhookPayload,
  payloadStr: string,
  attempt = 1,
): Promise<void> {
  const signature = signPayload(payloadStr, webhook.secret);

  try {
    const parsedUrl = new URL(webhook.url);
    if (parsedUrl.protocol !== "https:") {
      console.error("[WebhookDispatcher] Refusing non-HTTPS webhook URL", {
        webhookId: webhook.id,
      });
      return;
    }

    const response = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-LettrSuggest-Signature": signature,
        "X-LettrSuggest-Event": payload.event,
      },
      body: payloadStr,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      if (attempt < 3) {
        await delay(2 ** attempt * 1000);
        return deliverWebhook(webhook, payload, payloadStr, attempt + 1);
      }

      console.error("[WebhookDispatcher] Webhook returned non-success status", {
        webhookId: webhook.id,
        url: webhook.url,
        status: response.status,
      });
    }
  } catch (error) {
    if (attempt < 3) {
      await delay(2 ** attempt * 1000);
      return deliverWebhook(webhook, payload, payloadStr, attempt + 1);
    }

    console.error(
      "[WebhookDispatcher] Failed to deliver webhook after 3 attempts:",
      {
        webhookId: webhook.id,
        url: webhook.url,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}
