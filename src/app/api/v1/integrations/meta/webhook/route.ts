/**
 * Meta Lead Ads Webhook Endpoint
 *
 * Handles Meta webhook verification (GET) and lead notifications (POST).
 * This endpoint is called by Meta when a new lead is generated.
 *
 * Security:
 * - GET: Verifies webhook subscription using verify_token
 * - POST: Validates X-Hub-Signature-256 header for authenticity
 * - Fast acknowledgment: Persists event and returns 200 quickly
 * - Worker processes events asynchronously
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  verifyWebhookSubscription,
  verifyWebhookSignature,
  parseWebhookPayload,
} from "@/lib/integrations/meta/meta-webhooks";
import { metaConfig } from "@/lib/integrations/meta/meta-config";
import { constantTimeCompare } from "@/lib/leados/auth/tokens";

/**
 * GET /api/v1/integrations/meta/webhook
 * Meta verification handshake
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    
    const mode = searchParams.get("hub.mode");
    const verifyToken = searchParams.get("hub.verify_token");
    const challenge = searchParams.get("hub.challenge");

    if (!mode || !verifyToken || !challenge) {
      return new NextResponse("Missing required parameters", { status: 400 });
    }

    // Validate verify token using constant-time comparison
    const expectedToken = metaConfig.webhookVerifyToken;
    if (!expectedToken) {
      console.error("[Meta Webhook] Verify token not configured");
      return new NextResponse("Service unavailable", { status: 503 });
    }

    const isValid = constantTimeCompare(verifyToken, expectedToken);
    if (!isValid) {
      console.warn("[Meta Webhook] Invalid verify token");
      return new NextResponse("Forbidden", { status: 403 });
    }

    if (mode === "subscribe") {
      console.log("[Meta Webhook] Subscription verified successfully");
      return new NextResponse(challenge, { status: 200 });
    }

    return new NextResponse("Mode not supported", { status: 400 });
  } catch (error) {
    console.error("[Meta Webhook] Verification error:", error);
    return new NextResponse("Internal server error", { status: 500 });
  }
}

/**
 * POST /api/v1/integrations/meta/webhook
 * Receive lead notifications from Meta
 */
export async function POST(request: NextRequest) {
  try {
    const signature = request.headers.get("x-hub-signature-256");
    const rawBody = await request.text();

    // Verify signature if provided (Meta should always send it)
    if (signature) {
      const isValid = await verifyWebhookSignature(rawBody, signature);
      if (!isValid) {
        console.warn("[Meta Webhook] Invalid signature");
        return new NextResponse("Invalid signature", { status: 401 });
      }
    } else {
      console.warn("[Meta Webhook] No signature provided");
      // In demo mode, we might accept without signature
      if (process.env.LEADOS_DEMO !== "true") {
        return new NextResponse("Signature required", { status: 401 });
      }
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      console.error("[Meta Webhook] Invalid JSON payload");
      return new NextResponse("Invalid JSON", { status: 400 });
    }

    // Parse and validate webhook payload
    const validationResult = parseWebhookPayload(payload);
    
    if (!validationResult.valid) {
      console.warn("[Meta Webhook] Invalid payload:", validationResult.error);
      return new NextResponse("Invalid payload", { status: 400 });
    }

    const changes = validationResult.payload.entry?.flatMap(e => e.changes || []) || [];
    
    if (changes.length === 0) {
      // No leadgen changes, acknowledge anyway
      return new NextResponse("OK", { status: 200 });
    }

    // Process each change (typically one per request)
    const processedEvents: string[] = [];
    
    for (const entry of validationResult.payload.entry || []) {
      const pageId = entry.id;
      
      for (const change of entry.changes || []) {
        if (change.field !== "leadgen") {
          // Ignore non-leadgen fields
          continue;
        }

        const value = change.value;
        const leadgenId = value.leadgen_id;
        const formId = value.form_id;
        const createdTime = value.created_time;

        if (!leadgenId) {
          console.warn("[Meta Webhook] Missing leadgen_id in payload");
          continue;
        }

        // Check for idempotency - skip if already processed
        const existingEvent = await db.metaWebhookEvent.findFirst({
          where: { leadgenId },
        });

        if (existingEvent) {
          console.log(`[Meta Webhook] Duplicate event for leadgen_id: ${leadgenId}`);
          processedEvents.push(leadgenId);
          continue;
        }

        // Persist webhook event for async processing
        const event = await db.metaWebhookEvent.create({
          data: {
            pageId,
            formId,
            leadgenId,
            createdTime: createdTime ? new Date(createdTime) : new Date(),
            receivedAt: new Date(),
            payload: payload,
            status: "RECEIVED",
            attemptCount: 0,
          },
        });

        console.log(`[Meta Webhook] Event persisted: ${event.id} for leadgen_id: ${leadgenId}`);
        processedEvents.push(leadgenId);
      }
    }

    // Fast acknowledgment - worker will process asynchronously
    return new NextResponse("OK", { status: 200 });
  } catch (error) {
    console.error("[Meta Webhook] Processing error:", error);
    // Still return 200 to prevent Meta retry storms for transient errors
    // The event will be retried by the worker
    return new NextResponse("Accepted with errors", { status: 200 });
  }
}
