/**
 * Meta Lead Ads Webhook Endpoint
 * 
 * Handles webhook verification (GET) and webhook processing (POST).
 * This endpoint is called by Meta when a lead is submitted.
 * 
 * GET: Subscription verification challenge
 * POST: Webhook event notification
 */

import { NextRequest, NextResponse } from "next/server";
import {
  verifyWebhookSubscription,
  verifyWebhookSignature,
  parseWebhookPayload,
  processWebhookEvents,
} from "@/lib/integrations/meta/meta-webhooks";
import { metaConfig } from "@/lib/integrations/meta/meta-config";
import { z } from "zod";

const VerificationParamsSchema = z.object({
  "hub.mode": z.string().optional(),
  "hub.verify_token": z.string().optional(),
  "hub.challenge": z.string().optional(),
});

/**
 * GET: Handle subscription verification challenge.
 * Meta sends this to verify the callback URL before activating webhooks.
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const params = Object.fromEntries(searchParams.entries());

    const parsed = VerificationParamsSchema.safeParse(params);

    if (!parsed.success) {
      return new NextResponse("Invalid verification parameters", {
        status: 400,
      });
    }

    const challenge = verifyWebhookSubscription(parsed.data);

    if (challenge) {
      // Verification successful - return the challenge
      return new NextResponse(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Verification failed
    return new NextResponse("Verification failed: invalid verify_token", {
      status: 403,
    });
  } catch (error) {
    console.error("[Meta Webhook] GET error:", error);
    return new NextResponse("Internal server error", {
      status: 500,
    });
  }
}

/**
 * POST: Handle incoming webhook notifications.
 * Meta sends this when a lead is submitted.
 */
export async function POST(request: NextRequest) {
  try {
    // Get signature header
    const signature = request.headers.get("x-hub-signature-256");

    // Read raw body for signature verification
    const rawBody = await request.text();

    // Verify signature (skip in demo mode)
    if (process.env.LEADOS_DEMO !== "true") {
      const isValid = verifyWebhookSignature(rawBody, signature);

      if (!isValid) {
        return new NextResponse("Invalid signature", {
          status: 401,
        });
      }
    }

    // Parse JSON body
    let jsonBody: unknown;
    try {
      jsonBody = JSON.parse(rawBody);
    } catch {
      return new NextResponse("Invalid JSON payload", {
        status: 400,
      });
    }

    // Validate payload structure
    const parseResult = parseWebhookPayload(jsonBody);

    if (!parseResult.valid) {
      return new NextResponse(parseResult.error, {
        status: 400,
      });
    }

    // Process webhook events (persist for async processing)
    const { eventIds, errors } = await processWebhookEvents(parseResult.payload);

    // Log any errors but still return 200 to acknowledge receipt
    if (errors.length > 0) {
      console.error("[Meta Webhook] Processing errors:", errors);
    }

    // Return success - events will be processed asynchronously by worker
    return NextResponse.json({
      success: true,
      received: eventIds.length,
      errors: errors.length,
    });
  } catch (error) {
    console.error("[Meta Webhook] POST error:", error);
    return new NextResponse("Internal server error", {
      status: 500,
    });
  }
}
