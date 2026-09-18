import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, apiError, notFound, validate, parseJson } from "@/lib/leados/api";
import { TaskCreate } from "@/lib/schemas/lead";
import { LEAD_EVENT, TASK_TYPE } from "@/lib/leados/constants";
import { publishEvent } from "@/lib/leados/events";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await ctx.params;
    const lead = await db.lead.findUnique({ where: { id }, select: { organizationId: true } });
    if (!lead || lead.organizationId !== session.orgId) return notFound("lead");
    const rows = await db.task.findMany({
      where: { leadId: id },
      include: { assignee: { select: { id: true, name: true, avatarColor: true } } },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }],
    });
    return ok({ rows });
  } catch (e) {
    return apiError("tasks-list-failed", e);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot create tasks");
    const { id } = await ctx.params;
    const lead = await db.lead.findUnique({ where: { id }, select: { organizationId: true } });
    if (!lead || lead.organizationId !== session.orgId) return notFound("lead");
    const body = await parseJson(req);
    const v = validate(TaskCreate, body);
    if (!v.ok) return v.error;
    const task = await db.task.create({
      data: {
        organizationId: session.orgId,
        leadId: id,
        title: v.value.title,
        description: v.value.description ?? null,
        assignedTo: v.value.assignedTo ?? session.userId,
        priority: v.value.priority ?? "MEDIUM",
        dueAt: v.value.dueAt ? new Date(v.value.dueAt) : null,
        type: v.value.type ?? TASK_TYPE.TASK,
      },
    });
    await publishEvent({
      orgId: session.orgId,
      leadId: id,
      userId: session.userId,
      type: LEAD_EVENT.TASK_CREATED,
      payload: { taskId: task.id, title: task.title } as never,
    });
    return ok({ task });
  } catch (e) {
    return apiError("task-create-failed", e);
  }
}
