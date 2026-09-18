// GET  /api/v1/integrations/webhooks — org endpoints (id/name/url/enabled —
//       NEVER the secret back to the client, v0.16 spec 89).
// POST /api/v1/integrations/webhooks — create with SSRF validation (spec 54)
//       and an AUTO-GENERATED signing secret when none is provided, so EVERY
//       delivery is HMAC-signed (spec 53). URLs are re-validated at send time
//       as defense in depth (providers.ts).
import { db } from "@/lib/db";
import { getSession, canManage, canMutate } from "@/lib/leados/context";
import { ok, badRequest, apiError, forbidden, validate, parseJson } from "@/lib/leados/api";
import { validateWebhookUrl } from "@/lib/leados/delivery/ssrf";
import { recordAudit, requestMeta, AUDIT_ACTIONS, AUDIT_ACTOR } from "@/lib/leados/auth/audit";
import { randomBytes } from "crypto";
import { z } from "zod";

export async function GET() {
  try {
    const session = await getSession();
    // SECRET NEVER LEAVES THE SERVER (spec 89): only a boolean "is it set".
    const rows = await db.webhookEndpoint.findMany({
      where: { organizationId: session.orgId },
      orderBy: [{ enabled: "desc" }, { createdAt: "desc" }],
      select: {
        id: true, name: true, url: true, events: true, enabled: true,
        lastDeliveryAt: true, lastStatus: true, failCount: true, createdAt: true,
        secret: true,
      },
    });
    return ok({
      rows: rows.map((r) => {
        const { secret, ...rest } = r;
        return { ...rest, secretConfigured: Boolean(secret) };
      }),
    });
  } catch (e) {
    return apiError("integrations-webhooks-list-failed", e);
  }
}

const Create = z.object({
  name: z.string().min(1).max(80),
  url: z.string().url(),
  events: z.string().default("*"),
  enabled: z.boolean().default(true),
  secret: z.string().max(240).optional(),
});

export async function POST(req: Request) {
  const meta = requestMeta(req);
  try {
    const session = await getSession();
    if (!canManage(session.role)) return forbidden("Only owners and admins manage webhook endpoints");
    if (!canMutate(session.role)) return badRequest("Viewers cannot create webhook endpoints");

    const body = await parseJson(req);
    const v = validate(Create, body);
    if (!v.ok) return v.error;

    // SSRF VALIDATION (spec 54) — reject before anything is stored.
    const ssrf = await validateWebhookUrl(v.value.url);
    if (!ssrf.ok) {
      return badRequest(`Blocked by SSRF protection (${ssrf.error}${ssrf.detail ? `: ${ssrf.detail}` : ""}). Public http(s) endpoints only.`, { code: ssrf.error });
    }
    if (v.value.events !== "*" && !v.value.events.split(",").every((e) => /^[A-Z_0-9]+$/i.test(e.trim()))) {
      return badRequest("events must be \"*\" or a comma-separated list of event names (letters, digits, underscores).");
    }

    const endpoint = await db.webhookEndpoint.create({
      data: {
        organizationId: session.orgId,
        name: v.value.name,
        url: v.value.url,
        // AUTO-SECRET (spec 53): every endpoint is HMAC-signed; a client-provided
        // secret is accepted but NEVER echoed back after save (spec 89).
        secret: v.value.secret?.trim() || randomBytes(24).toString("hex"),
        events: v.value.events,
        enabled: v.value.enabled,
      },
      select: { id: true, name: true, url: true, events: true, enabled: true, createdAt: true },
    });
    await recordAudit({
      organizationId: session.orgId,
      actorUserId: session.userId,
      actorType: AUDIT_ACTOR.USER,
      action: AUDIT_ACTIONS.WEBHOOK_CREATED,
      resourceType: "webhook-endpoint",
      resourceId: endpoint.id,
      metadata: { name: endpoint.name, url: endpoint.url, events: endpoint.events },
      ...meta,
    });
    return ok({ endpoint, secretNote: "A signing secret was generated. Use the Test button to verify delivery." });
  } catch (e) {
    return apiError("integrations-webhooks-create-failed", e);
  }
}
