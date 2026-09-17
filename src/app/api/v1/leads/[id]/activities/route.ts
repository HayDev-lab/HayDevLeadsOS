import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, apiError, notFound, validate, parseJson } from "@/lib/leados/api";
import { ActivityCreate } from "@/lib/schemas/lead";
import { ACTIVITY_TYPE, LEAD_EVENT } from "@/lib/leados/constants";
import { publishEvent } from "@/lib/leados/events";
import { suggestNextAction } from "@/lib/leados/followup";
import { QUALIFYING_ACTIVITY_TYPES } from "@/lib/sla";
import {
  findOpenFollowUpTask,
  getFollowUpConfig,
  scheduleFollowUp,
} from "@/lib/leados/followup-sla-service";
import { resolveFirstResponseNotifications } from "@/lib/leados/notification-service";
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
    return apiError("activities-list-failed", e);
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

    // Optional policy (Settings → Follow-up SLA, default OFF): when the FIRST
    // qualifying response is logged and no open follow-up exists yet, auto-
    // schedule one at now + defaultFollowUpHours. Explicitly opt-in — never blind.
    if (QUALIFYING_ACTIVITY_TYPES.includes(v.value.type)) {
      const config = await getFollowUpConfig(session.orgId);
      if (config.autoCreateAfterFirstResponse) {
        const prior = await db.activity.findFirst({
          where: { leadId: id, organizationId: session.orgId, type: { in: QUALIFYING_ACTIVITY_TYPES }, createdAt: { lt: activity.createdAt } },
          select: { id: true },
        });
        if (!prior) {
          const open = await findOpenFollowUpTask(session.orgId, id);
          if (!open) {
            await scheduleFollowUp(session.orgId, id, session.userId, {
              dueAt: new Date(Date.now() + config.defaultFollowUpHours * 3_600_000),
            });
          }
        }
      }
    }

    await publishEvent({
      orgId: session.orgId,
      leadId: id,
      userId: session.userId,
      type: LEAD_EVENT.ACTIVITY_LOGGED,
      payload: { type: v.value.type, title: v.value.title } as never,
    });

    // EVENT ENGINE (Sections 40/66): a qualifying response moves First Response
    // to RESPONDED — every active breach notification for this lead resolves.
    if (QUALIFYING_ACTIVITY_TYPES.includes(v.value.type)) {
      await resolveFirstResponseNotifications(session.orgId, id);
    }
    return ok({ activity });
  } catch (e) {
    return apiError("activity-create-failed", e);
  }
}
