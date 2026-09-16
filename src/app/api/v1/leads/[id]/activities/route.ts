import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError, notFound, validate, parseJson } from "@/lib/leados/api";
import { ActivityCreate } from "@/lib/schemas/lead";
import { ACTIVITY_TYPE, LEAD_EVENT } from "@/lib/leados/constants";
import { publishEvent } from "@/lib/leados/events";
import { suggestNextAction } from "@/lib/leados/followup";
import { Prisma } from "@prisma/client";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await ctx.params;
    const lead = await db.lead.findUnique({ where: { id }, select: { organizationId: true } });
    if (!lead || lead.organizationId !== session.orgId) return notFound("lead");
    const rows = await db.activity.findMany({
      where: { leadId: id },
      include: { user: { select: { id: true, name: true, avatarColor: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return ok({ rows });
  } catch (e) {
    return serverError("activities-list-failed", e);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot log activity");
    const { id } = await ctx.params;
    const lead = await db.lead.findUnique({ where: { id }, select: { organizationId: true, stageId: true } });
    if (!lead || lead.organizationId !== session.orgId) return notFound("lead");
    const body = await parseJson(req);
    const v = validate(ActivityCreate, body);
    if (!v.ok) return v.error;

    const activity = await db.activity.create({
      data: {
        organizationId: session.orgId,
        leadId: id,
        userId: session.userId,
        type: v.value.type,
        title: v.value.title,
        description: v.value.description ?? null,
      },
    });

    // any logged contact updates lastContactAt; suggest next follow-up if none set
    if (["CALL", "MESSAGE", "EMAIL", "MEETING", "FOLLOW_UP"].includes(v.value.type)) {
      const stage = lead.stageId ? await db.pipelineStage.findUnique({ where: { id: lead.stageId } }) : null;
      const existing = await db.lead.findUnique({ where: { id }, select: { nextActionAt: true } });
      const patch: Record<string, unknown> = { lastContactAt: new Date() };
      if (!existing?.nextActionAt && stage) {
        const s = suggestNextAction(stage.name);
        patch.nextActionAt = s.nextActionAt;
        patch.nextActionLabel = s.label;
      }
      await db.lead.update({ where: { id }, data: patch as Prisma.LeadUpdateInput });
    }

    await publishEvent({
      orgId: session.orgId,
      leadId: id,
      userId: session.userId,
      type: LEAD_EVENT.ACTIVITY_LOGGED,
      payload: { type: v.value.type, title: v.value.title } as never,
    });
    return ok({ activity });
  } catch (e) {
    return serverError("activity-create-failed", e);
  }
}
