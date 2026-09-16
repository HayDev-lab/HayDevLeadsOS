// FOLLOW-UP SLA operations on a lead: schedule / complete / reschedule / cancel.
// Task-based source of truth (Task.type = FOLLOW_UP) + timeline activities +
// published LeadEvents. All actions are org-scoped and role-checked.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError, notFound, parseJson } from "@/lib/leados/api";
import { z } from "zod";
import {
  cancelFollowUp,
  completeFollowUp,
  rescheduleFollowUp,
  scheduleFollowUp,
} from "@/lib/leados/followup-sla-service";

const Schedule = z.object({
  dueAt: z.string().min(1), // ISO datetime
  note: z.string().max(500).optional(),
});

const Action = z.object({
  action: z.enum(["complete", "reschedule", "cancel"]),
  taskId: z.string().optional(),
  dueAt: z.string().optional(), // required for reschedule
  note: z.string().max(500).optional(),
});

async function leadInOrg(orgId: string, id: string) {
  const lead = await db.lead.findUnique({ where: { id }, select: { id: true, status: true, organizationId: true } });
  return lead && lead.organizationId === orgId ? lead : null;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot schedule follow-ups");
    const { id } = await ctx.params;
    if (!(await leadInOrg(session.orgId, id))) return notFound("lead");
    const v = Schedule.safeParse(await parseJson(req));
    if (!v.success) return badRequest("validation", v.error.flatten());
    const dueAt = new Date(v.data.dueAt);
    if (Number.isNaN(dueAt.getTime())) return badRequest("Invalid due date");
    if (dueAt.getTime() <= Date.now() - 60_000) return badRequest("Due date must be in the future");
    const task = await scheduleFollowUp(session.orgId, id, session.userId, {
      dueAt,
      note: v.data.note ?? null,
    });
    return ok({ task });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "LEAD_NOT_FOUND" || msg === "LEAD_FINAL_STAGE") return badRequest(msg === "LEAD_FINAL_STAGE" ? "Lead is in a final stage (Won/Lost)" : "lead-not-in-org");
    if (msg === "OPEN_FOLLOW_UP_EXISTS") return badRequest("An open follow-up already exists — reschedule it instead");
    return serverError("followup-schedule-failed", e);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot edit follow-ups");
    const { id } = await ctx.params;
    if (!(await leadInOrg(session.orgId, id))) return notFound("lead");
    const v = Action.safeParse(await parseJson(req));
    if (!v.success) return badRequest("validation", v.error.flatten());

    if (v.data.action === "complete") {
      const task = await completeFollowUp(session.orgId, id, session.userId, v.data.taskId);
      return ok({ task });
    }
    if (v.data.action === "cancel") {
      const task = await cancelFollowUp(session.orgId, id, session.userId, v.data.taskId);
      return ok({ task });
    }
    // reschedule
    if (!v.data.dueAt) return badRequest("A new due date is required to reschedule");
    const dueAt = new Date(v.data.dueAt);
    if (Number.isNaN(dueAt.getTime())) return badRequest("Invalid due date");
    const task = await rescheduleFollowUp(session.orgId, id, session.userId, {
      dueAt,
      taskId: v.data.taskId,
      note: v.data.note ?? null,
    });
    return ok({ task });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "NO_OPEN_FOLLOW_UP") return badRequest("No open follow-up on this lead");
    if (msg === "FOLLOW_UP_ALREADY_CLOSED") return badRequest("This follow-up is already closed");
    return serverError("followup-action-failed", e);
  }
}
