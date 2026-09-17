// PATCH  /api/v1/integrations/webhooks/:id — toggle / edit endpoint (SSRF re-validated).
// POST   /api/v1/integrations/webhooks/:id — ROTATE the signing secret (v0.17
//         spec 58): a fresh HMAC secret replaces the old one immediately
//         (old signatures stop verifying); the secret itself never leaves
//         the server.
// DELETE /api/v1/integrations/webhooks/:id — remove endpoint (delivery rows keep history).
import { db } from "@/lib/db";
import { getSession, canManage } from "@/lib/leados/context";
import { ok, badRequest, notFound, forbidden, apiError, parseJson } from "@/lib/leados/api";
import { validateWebhookUrl } from "@/lib/leados/delivery/ssrf";
import { recordAudit, requestMeta, AUDIT_ACTIONS, AUDIT_ACTOR } from "@/lib/leados/auth/audit";
import { randomBytes } from "crypto";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const meta = requestMeta(req);
  try {
    const session = await getSession();
    if (!canManage(session.role)) return forbidden("Only owners and admins manage webhook endpoints");
    const { id } = await params;
    const endpoint = await db.webhookEndpoint.findFirst({ where: { id, organizationId: session.orgId } });
    if (!endpoint) return notFound("Endpoint not found");

    const body = (await parseJson(req)) as Record<string, unknown> | null;
    const data: { name?: string; url?: string; events?: string; enabled?: boolean } = {};
    if (typeof body?.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 80);
    if (typeof body?.events === "string") {
      if (body.events !== "*" && !body.events.split(",").every((e: string) => /^[A-Z_0-9]+$/i.test(e.trim()))) {
        return badRequest("events must be \"*\" or a comma-separated list of event names.");
      }
      data.events = body.events;
    }
    if (typeof body?.enabled === "boolean") data.enabled = body.enabled;
    if (typeof body?.url === "string" && body.url !== endpoint.url) {
      const ssrf = await validateWebhookUrl(body.url);
      if (!ssrf.ok) return badRequest(`Blocked by SSRF protection (${ssrf.error}).`, { code: ssrf.error });
      data.url = body.url;
    }
    const updated = await db.webhookEndpoint.update({
      where: { id },
      data,
      select: { id: true, name: true, url: true, events: true, enabled: true },
    });
    await recordAudit({
      organizationId: session.orgId,
      actorUserId: session.userId,
      actorType: AUDIT_ACTOR.USER,
      action: AUDIT_ACTIONS.WEBHOOK_UPDATED,
      resourceType: "webhook-endpoint",
      resourceId: id,
      metadata: { fields: Object.keys(data) },
      ...meta,
    });
    return ok({ endpoint: updated });
  } catch (e) {
    return apiError("integrations-webhooks-update-failed", e);
  }
}

/** SECRET ROTATION (spec 58): old secret stops working immediately. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const meta = requestMeta(req);
  try {
    const session = await getSession();
    if (!canManage(session.role)) return forbidden("Only owners and admins manage webhook endpoints");
    const { id } = await params;
    const endpoint = await db.webhookEndpoint.findFirst({ where: { id, organizationId: session.orgId } });
    if (!endpoint) return notFound("Endpoint not found");

    await db.webhookEndpoint.update({
      where: { id },
      data: { secret: randomBytes(24).toString("hex") },
    });
    await recordAudit({
      organizationId: session.orgId,
      actorUserId: session.userId,
      actorType: AUDIT_ACTOR.USER,
      action: AUDIT_ACTIONS.WEBHOOK_SECRET_ROTATED,
      resourceType: "webhook-endpoint",
      resourceId: id,
      metadata: { name: endpoint.name },
      ...meta,
    });
    return ok({ ok: true, secretNote: "A new signing secret was generated. Update the receiving side." });
  } catch (e) {
    return apiError("integrations-webhooks-rotate-failed", e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const meta = requestMeta(_req);
  try {
    const session = await getSession();
    if (!canManage(session.role)) return forbidden("Only owners and admins manage webhook endpoints");
    const { id } = await params;
    const endpoint = await db.webhookEndpoint.findFirst({ where: { id, organizationId: session.orgId } });
    if (!endpoint) return notFound("Endpoint not found");
    await db.webhookEndpoint.delete({ where: { id } });
    await recordAudit({
      organizationId: session.orgId,
      actorUserId: session.userId,
      actorType: AUDIT_ACTOR.USER,
      action: AUDIT_ACTIONS.WEBHOOK_DELETED,
      resourceType: "webhook-endpoint",
      resourceId: id,
      metadata: { name: endpoint.name, url: endpoint.url },
      ...meta,
    });
    return ok({ ok: true });
  } catch (e) {
    return apiError("integrations-webhooks-delete-failed", e);
  }
}
