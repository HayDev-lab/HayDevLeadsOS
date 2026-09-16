// Webhook delivery service — delivers IntegrationEvents to registered WebhookEndpoints.
// In production this would run as a background worker; for MVP it's called on-demand
// from the test endpoint + can be triggered manually. HMAC signing for security.

import { db } from "@/lib/db";
import { createHmac } from "crypto";

/**
 * Get enabled endpoints for an org that match the given event.
 */
async function getMatchingEndpoints(orgId: string, event: string) {
  const endpoints = await db.webhookEndpoint.findMany({
    where: { organizationId: orgId, enabled: true },
  });
  return endpoints.filter((ep) => {
    if (ep.events === "*") return true;
    const events = ep.events.split(",").map((e) => e.trim());
    return events.includes(event);
  });
}

/**
 * Sign a payload with the endpoint secret using HMAC-SHA256.
 */
function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Deliver a single event to a single endpoint. Returns success/failure.
 */
async function deliver(endpoint: { id: string; url: string; secret: string | null }, event: { id: string; event: string; payload: unknown; leadId?: string | null; createdAt: Date }): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const body = JSON.stringify({
      id: event.id,
      event: event.event,
      leadId: event.leadId ?? null,
      timestamp: event.createdAt.toISOString(),
      data: event.payload ?? {},
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Leados-Event": event.event,
      "X-Leados-Delivery": event.id,
    };
    if (endpoint.secret) {
      headers["X-Leados-Signature"] = signPayload(body, endpoint.secret);
    }
    const res = await fetch(endpoint.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(10000),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}

/**
 * Deliver undelivered events to matching endpoints. Returns count delivered.
 * In production this runs on a schedule; for MVP it's on-demand.
 */
export async function deliverPendingEvents(orgId: string, limit = 50): Promise<{ delivered: number; failed: number; skipped: number }> {
  const events = await db.integrationEvent.findMany({
    where: { organizationId: orgId, published: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  let delivered = 0, failed = 0, skipped = 0;
  for (const ev of events) {
    const endpoints = await getMatchingEndpoints(orgId, ev.event);
    if (!endpoints.length) { skipped++; continue; }
    for (const ep of endpoints) {
      const result = await deliver(ep, ev);
      if (result.ok) {
        delivered++;
        await db.webhookEndpoint.update({
          where: { id: ep.id },
          data: { lastDeliveryAt: new Date(), lastStatus: "OK", failCount: 0 },
        });
      } else {
        failed++;
        await db.webhookEndpoint.update({
          where: { id: ep.id },
          data: { lastDeliveryAt: new Date(), lastStatus: "FAILED", failCount: { increment: 1 } },
        });
      }
    }
  }
  return { delivered, failed, skipped };
}

/**
 * Send a test event to a specific endpoint. Returns the result.
 */
export async function testEndpoint(endpointId: string, orgId: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  const ep = await db.webhookEndpoint.findUnique({ where: { id: endpointId } });
  if (!ep || ep.organizationId !== orgId) throw new Error("ENDPOINT_NOT_FOUND");
  const testEvent = {
    id: `test_${Date.now()}`,
    event: "webhook.test",
    leadId: null,
    createdAt: new Date(),
    payload: { message: "Test event from HayDev LeadOS", endpoint: ep.name, timestamp: new Date().toISOString() },
  };
  const result = await deliver(ep, testEvent);
  await db.webhookEndpoint.update({
    where: { id: endpointId },
    data: { lastDeliveryAt: new Date(), lastStatus: result.ok ? "OK" : "FAILED", failCount: result.ok ? 0 : { increment: 1 } },
  });
  return result;
}
