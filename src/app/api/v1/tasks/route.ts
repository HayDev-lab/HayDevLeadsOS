import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, serverError, validate, parseJson, badRequest } from "@/lib/leados/api";
import { TaskCreate } from "@/lib/schemas/lead";
import { LEAD_EVENT, TASK_TYPE } from "@/lib/leados/constants";
import { publishEvent } from "@/lib/leados/events";
import {
  DOMAIN_EVENT,
  ENTITY_TYPE,
  displayName,
  taskAssignedDedupKey,
} from "@/lib/domain-events";
import { publishDomainEvent } from "@/lib/leados/domain-event-service";

export async function GET(req: Request) {
  try {
    const session = await getSession();
    const url = new URL(req.url);
    const status = url.searchParams.getAll("status");
    const where: Record<string, unknown> = { organizationId: session.orgId };
    if (status.length) where.status = { in: status };
    else where.status = { in: ["TODO", "IN_PROGRESS"] };
    const rows = await db.task.findMany({
      where,
      include: {
        lead: { select: { id: true, firstName: true, lastName: true, company: true } },
        assignee: { select: { id: true, name: true, avatarColor: true } },
      },
      orderBy: [{ createdAt: "desc" }],
    });
    return ok({ rows });
  } catch (e) {
    return serverError("tasks-list-failed", e);
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot create tasks");
    const body = await parseJson(req);
    const v = validate(TaskCreate, body);
    if (!v.ok) return v.error;
    if (v.value.leadId) {
      const lead = await db.lead.findUnique({ where: { id: v.value.leadId }, select: { organizationId: true } });
      if (!lead || lead.organizationId !== session.orgId) return badRequest("lead-not-in-org");
    }
    const task = await db.task.create({
      data: {
        organizationId: session.orgId,
        leadId: v.value.leadId ?? null,
        title: v.value.title,
        description: v.value.description ?? null,
        assignedTo: v.value.assignedTo ?? session.userId,
        priority: v.value.priority ?? "MEDIUM",
        dueAt: v.value.dueAt ? new Date(v.value.dueAt) : null,
        type: v.value.type ?? TASK_TYPE.TASK,
      },
    });
    if (v.value.leadId) {
      await publishEvent({
        orgId: session.orgId,
        leadId: v.value.leadId,
        userId: session.userId,
        type: LEAD_EVENT.TASK_CREATED,
        payload: { taskId: task.id, title: task.title } as never,
      });
    }

    // EVENT ENGINE: assigning a generic task notifies its assignee (Section 51).
    if (task.type === TASK_TYPE.TASK && task.assignedTo && task.assignedTo !== session.userId) {
      const lead = task.leadId
        ? await db.lead.findUnique({ where: { id: task.leadId }, select: { firstName: true, lastName: true, company: true } })
        : null;
      const assignedAt = new Date();
      await publishDomainEvent(session.orgId, {
        type: DOMAIN_EVENT.TASK_ASSIGNED,
        entityType: ENTITY_TYPE.TASK,
        entityId: task.id,
        actorUserId: session.userId,
        occurredAt: assignedAt,
        deduplicationKey: taskAssignedDedupKey(task.id, task.assignedTo, assignedAt),
        payload: {
          taskId: task.id,
          taskTitle: task.title,
          assigneeId: task.assignedTo,
          leadId: task.leadId,
          leadName: lead ? displayName(lead) : null,
          ownerId: null,
        },
      });
    }
    return ok({ task });
  } catch (e) {
    return serverError("task-create-failed", e);
  }
}
