import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, apiError, notFound, validate, parseJson } from "@/lib/leados/api";
import { z } from "zod";
import { normalizePhone, normalizeEmail } from "@/lib/leados/normalize";
import { createLead } from "@/lib/leados/lead-service";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await ctx.params;
    const msg = await db.incomingMessage.findUnique({
      where: { id },
      include: { lead: { include: { stage: true, owner: { select: { id: true, name: true, avatarColor: true } } } } },
    });
    if (!msg || msg.organizationId !== session.orgId) return notFound("message");
    return ok({ message: msg });
  } catch (e) {
    return apiError("inbox-get-failed", e);
  }
}

const LinkBody = z.object({
  leadId: z.string().min(1),
});

// Link an incoming message to a lead (after creating/finding one).
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot link messages");
    const { id } = await ctx.params;
    const msg = await db.incomingMessage.findUnique({ where: { id }, include: { lead: true } });
    if (!msg || msg.organizationId !== session.orgId) return notFound("message");
    const body = await parseJson(req);
    const v = validate(LinkBody, body);
    if (!v.ok) return v.error;
    const lead = await db.lead.findUnique({ where: { id: v.value.leadId } });
    if (!lead || lead.organizationId !== session.orgId) return notFound("lead");
    // If conversationId empty, propagate a stable one
    const conversationId = msg.conversationId || `conv:${v.value.leadId}`;
    await db.incomingMessage.update({
      where: { id },
      data: { leadId: v.value.leadId, conversationId },
    });
    // also update all sibling messages with the same handle/source to this lead
    if (msg.fromHandle) {
      await db.incomingMessage.updateMany({
        where: { organizationId: session.orgId, source: msg.source, fromHandle: msg.fromHandle, leadId: null },
        data: { leadId: v.value.leadId, conversationId },
      });
    }
    return ok({ ok: true });
  } catch (e) {
    return apiError("inbox-link-failed", e);
  }
}

// Create a lead from an unlinked incoming message, then link it.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot create leads from messages");
    const { id } = await ctx.params;
    const msg = await db.incomingMessage.findUnique({ where: { id } });
    if (!msg || msg.organizationId !== session.orgId) return notFound("message");
    if (msg.leadId) return badRequest("message-already-linked");

    const res = await createLead(session.orgId, session.userId, {
      firstName: msg.fromHandle ? msg.fromHandle.split(/[ @]/)[0] : "New",
      company: null,
      sourceType: msg.source,
      summary: `Created from ${msg.source} message`,
      note: msg.content.slice(0, 1000),
      force: true,
    } as any);

    await db.incomingMessage.update({
      where: { id },
      data: { leadId: res.lead?.id ?? null, conversationId: msg.conversationId || `conv:${res.lead?.id}` },
    });
    return ok({ leadId: res.lead?.id ?? null });
  } catch (e) {
    return apiError("inbox-create-lead-failed", e);
  }
}
