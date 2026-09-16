import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError, notFound, parseJson } from "@/lib/leados/api";
import { z } from "zod";

const Update = z.object({
  name: z.string().min(1).max(80).optional(),
  url: z.string().url().optional(),
  secret: z.string().max(120).nullable().optional(),
  events: z.string().optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot edit webhook endpoints");
    const { id } = await ctx.params;
    const ep = await db.webhookEndpoint.findUnique({ where: { id } });
    if (!ep || ep.organizationId !== session.orgId) return notFound("endpoint");
    const body = await parseJson(req);
    const v = Update.safeParse(body);
    if (!v.success) return badRequest("validation", v.error.flatten());
    const data: Record<string, unknown> = {};
    if (v.data.name !== undefined) data.name = v.data.name;
    if (v.data.url !== undefined) data.url = v.data.url;
    if (v.data.secret !== undefined) data.secret = v.data.secret;
    if (v.data.events !== undefined) data.events = v.data.events;
    if (v.data.enabled !== undefined) data.enabled = v.data.enabled;
    const updated = await db.webhookEndpoint.update({ where: { id }, data });
    return ok({ endpoint: updated });
  } catch (e) {
    return serverError("webhook-endpoint-update-failed", e);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot delete webhook endpoints");
    const { id } = await ctx.params;
    const ep = await db.webhookEndpoint.findUnique({ where: { id } });
    if (!ep || ep.organizationId !== session.orgId) return notFound("endpoint");
    await db.webhookEndpoint.delete({ where: { id } });
    return ok({ ok: true });
  } catch (e) {
    return serverError("webhook-endpoint-delete-failed", e);
  }
}
