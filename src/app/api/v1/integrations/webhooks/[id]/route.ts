// PATCH  /api/v1/integrations/webhooks/:id — toggle / edit endpoint (SSRF re-validated).
// DELETE /api/v1/integrations/webhooks/:id — remove endpoint (delivery rows keep history).
import { db } from "@/lib/db";
import { getSession, canManage } from "@/lib/leados/context";
import { ok, badRequest, notFound, forbidden, serverError, parseJson } from "@/lib/leados/api";
import { validateWebhookUrl } from "@/lib/leados/delivery/ssrf";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
    return ok({ endpoint: updated });
  } catch (e) {
    return serverError("integrations-webhooks-update-failed", e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canManage(session.role)) return forbidden("Only owners and admins manage webhook endpoints");
    const { id } = await params;
    const endpoint = await db.webhookEndpoint.findFirst({ where: { id, organizationId: session.orgId } });
    if (!endpoint) return notFound("Endpoint not found");
    await db.webhookEndpoint.delete({ where: { id } });
    return ok({ ok: true });
  } catch (e) {
    return serverError("integrations-webhooks-delete-failed", e);
  }
}
