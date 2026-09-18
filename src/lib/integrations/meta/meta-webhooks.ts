/**
 * Meta Lead Ads Integration — Webhook Handler
 * 
 * Handles Meta webhook verification and processing.
 * Implements signature verification per current Meta documentation.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { metaConfig } from "./meta-config";
import { MetaIntegrationError } from "./meta-errors";

export interface WebhookVerificationParams {
  "hub.mode"?: string;
  "hub.verify_token"?: string;
  "hub.challenge"?: string;
}

export interface WebhookEntry {
  id: string; // Page ID
  time: number;
  changes?: WebhookChange[];
}

export interface WebhookChange {
  field: string;
  value: {
    page_id?: string;
    form_id?: string;
    leadgen_id?: string;
    created_time?: number;
  };
}

export interface ProcessedWebhookChange {
  field: string;
  pageId: string;
  formId: string;
  leadgenId: string;
  createdTime?: number;
}

export interface WebhookPayload {
  object: string;
  entry: WebhookEntry[];
}

/**
 * Verify webhook subscription challenge (GET request).
 * Meta sends this to verify the callback URL.
 */
export function verifyWebhookSubscription(
  params: WebhookVerificationParams
): string | null {
  if (
    params["hub.mode"] === "subscribe" &&
    params["hub.verify_token"] === metaConfig.webhookVerifyToken
  ) {
    // Use constant-time comparison for security
    const providedToken = params["hub.verify_token"] || "";
    const expectedToken = metaConfig.webhookVerifyToken || "";

    if (
      providedToken.length === expectedToken.length &&
      timingSafeEqual(
        Buffer.from(providedToken),
        Buffer.from(expectedToken)
      )
    ) {
      return params["hub.challenge"] || null;
    }
  }

  return null;
}

/**
 * Verify webhook request signature (POST request).
 * Meta signs webhooks with X-Hub-Signature header.
 * Format: sha256=<hex_signature>
 */
export function verifyWebhookSignature(
  body: string,
  signature: string | null
): boolean {
  if (!signature || !signature.startsWith("sha256=")) {
    return false;
  }

  const providedSignature = signature.slice(7); // Remove "sha256=" prefix
  const appSecret = metaConfig.appSecret;

  if (!appSecret) {
    console.error("[Meta Webhook] App secret not configured");
    return false;
  }

  // Calculate expected signature
  const expectedSignature = createHmac("sha256", appSecret)
    .update(body, "utf8")
    .digest("hex");

  // Constant-time comparison
  try {
    return timingSafeEqual(
      Buffer.from(providedSignature, "hex"),
      Buffer.from(expectedSignature, "hex")
    );
  } catch {
    return false;
  }
}

/**
 * Parse and validate webhook payload.
 */
export function parseWebhookPayload(
  rawBody: unknown
): { valid: true; payload: WebhookPayload } | { valid: false; error: string } {
  if (!rawBody || typeof rawBody !== "object") {
    return { valid: false, error: "Invalid webhook payload: not an object" };
  }

  const payload = rawBody as Record<string, unknown>;

  if (payload.object !== "page") {
    return { valid: false, error: `Unexpected object type: ${payload.object}` };
  }

  if (!Array.isArray(payload.entry)) {
    return { valid: false, error: "Missing or invalid entry array" };
  }

  // Validate each entry
  for (const entry of payload.entry) {
    if (!entry || typeof entry !== "object") {
      return { valid: false, error: "Invalid entry: not an object" };
    }

    const entryObj = entry as Record<string, unknown>;

    if (typeof entryObj.id !== "string") {
      return { valid: false, error: "Entry missing page ID" };
    }

    if (typeof entryObj.time !== "number") {
      return { valid: false, error: "Entry missing timestamp" };
    }

    if (Array.isArray(entryObj.changes)) {
      for (const change of entryObj.changes) {
        if (!change || typeof change !== "object") {
          return { valid: false, error: "Invalid change: not an object" };
        }

        const changeObj = change as Record<string, unknown>;

        if (changeObj.field !== "leadgen") {
          continue; // Ignore non-leadgen fields
        }

        const value = changeObj.value as Record<string, unknown> | undefined;
        if (!value) {
          return { valid: false, error: "Change missing value" };
        }

        if (typeof value.page_id !== "string") {
          return { valid: false, error: "Change missing page_id" };
        }

        if (typeof value.form_id !== "string") {
          return { valid: false, error: "Change missing form_id" };
        }

        if (typeof value.leadgen_id !== "string") {
          return { valid: false, error: "Change missing leadgen_id" };
        }
      }
    }
  }

  return { valid: true, payload: payload as unknown as WebhookPayload };
}

/**
 * Process incoming webhook and persist events for async processing.
 * Returns list of persisted event IDs.
 */
export async function processWebhookEvents(
  payload: WebhookPayload
): Promise<{ eventIds: string[]; errors: string[] }> {
  const eventIds: string[] = [];
  const errors: string[] = [];

  for (const entry of payload.entry) {
    const pageId = entry.id;
    const timestamp = new Date(entry.time * 1000);

    // Process each change in the entry
    const changes = entry.changes || [];

    for (const change of changes) {
      // Only process leadgen events
      if (change.field !== "leadgen") {
        continue;
      }

      const value = change.value;
      const leadgenId = value.leadgen_id;

      if (!leadgenId) {
        errors.push(`Missing leadgen_id in change`);
        continue;
      }

      try {
        // Check for duplicate (idempotency)
        const existing = await db.metaWebhookEvent.findUnique({
          where: { leadgenId },
        });

        if (existing) {
          // Duplicate webhook - already processed or processing
          eventIds.push(existing.id);
          continue;
        }

        // Persist new event
        const event = await db.metaWebhookEvent.create({
          data: {
            pageId,
            formId: value.form_id || "",
            leadgenId,
            createdTime: value.created_time
              ? new Date(value.created_time * 1000)
              : timestamp,
            payload: {
              page_id: pageId,
              form_id: value.form_id,
              created_time: value.created_time,
            },
            status: "RECEIVED",
          },
        });

        eventIds.push(event.id);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        errors.push(`Failed to persist event ${leadgenId}: ${errorMessage}`);
      }
    }
  }

  return { eventIds, errors };
}

/**
 * Get the webhook endpoint URL for this deployment.
 */
export function getWebhookUrl(): string {
  const baseUrl = process.env.APP_URL || "http://localhost:3000";
  return `${baseUrl}/api/integrations/meta/webhook`;
}
