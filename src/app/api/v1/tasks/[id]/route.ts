import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError, notFound, parseJson } from "@/lib/leados/api";
import { z } from "zod";
import { TASK_TYPE } from "@/lib/leados/constants";
import {
  DOMAIN_EVENT,
  ENTITY_TYPE,
  displayName,
  taskAssignedDedupKey,
} from "@/lib/domain-events";
import { publishDomainEvent } from "@/lib/leados/domain-event-service";
import {
  resolveFollowUpNotifications,
  resolveTaskNotifications,
} from "@/lib/leados/notification-service";

const Patch = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "DONE", "CANCELLED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  assignedTo: z.string().nullable().optional(),
  dueAt: z.string().nullable().optional(),
});

/** Emit TASK_ASSIGNED for generic tasks (FOLLOW_UP tasks belong to the
 *  Follow-up engine — no double notifications, spec Section 6/52). */
async function emitTaskAssigned(
  orgId: string,
  task: { id: string; title: string; assignedTo: string | null; type: string; leadId: string | null },
  lead: { firstName?: string | null; lastName?: string | null; company?: string | null } | null,
  actorUserId: string | null
): Promise<void> {
  if (task.type !== TASK_TYPE.TASK || !task.assignedTo) return;
  const assignedAt = new Date();
  await publishDomainEvent(orgId, {
    type: DOMAIN_EVENT.TASK_ASSIGNED,
    entityType: ENTITY_TYPE.TASK,
    entityId: task.id,
    actorUserId,
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

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot edit tasks");
    const { id } = await ctx.params;
    const task = await db.task.findUnique({ where: { id }, select: { organizationId: true } });
    if (!task || task.organizationId !== session.orgId) return notFound("task");
    const body = await parseJson(req);
    const v = Patch.safeParse(body);
    if (!v.success) return badRequest("validation", v.error.flatten());
    const existing = await db.task.findUnique({
      where: { id },
      include: { lead: { select: { firstName: true, lastName: true, company: true } } },
    });
    if (!existing) return notFound("task");
    const data: Record<string, unknown> = {};
    if (v.data.title !== undefined) data.title = v.data.title;
    if (v.data.description !== undefined) data.description = v.data.description;
    if (v.data.status !== undefined) {
      data.status = v.data.status;
      if (v.data.status === "DONE") data.completedAt = new Date();
    }
    if (v.data.priority !== undefined) data.priority = v.data.priority;
    if (v.data.assignedTo !== undefined) data.assignedTo = v.data.assignedTo;
    if (v.data.dueAt !== undefined) data.dueAt = v.data.dueAt ? new Date(v.data.dueAt) : null;
    const updated = await db.task.update({ where: { id }, data });

    // EVENT ENGINE:
    //  - assignment change (generic tasks only) → TASK_ASSIGNED notification;
    //  - DONE / CANCELLED → the task's problems are resolved (Sections 40/116);
    //  - dueAt change → the old cycle's notifications resolve; a new cycle
    //    produces fresh events under new dedup keys when it passes.
    if (v.data.assignedTo != null && v.data.assignedTo !== existing.assignedTo) {
      await emitTaskAssigned(session.orgId, updated, existing.lead, session.userId);
    }
    if (
      (v.data.status === "DONE" || v.data.status === "CANCELLED") &&
      (existing.status === "TODO" || existing.status === "IN_PROGRESS")
    ) {
      if (existing.type === TASK_TYPE.FOLLOW_UP) {
        await resolveFollowUpNotifications(session.orgId, id);
      } else {
        await resolveTaskNotifications(session.orgId, id);
      }
    }
    if (v.data.dueAt !== undefined) {
      if (existing.type === TASK_TYPE.FOLLOW_UP) {
        await resolveFollowUpNotifications(session.orgId, id);
      } else {
        await resolveTaskNotifications(session.orgId, id);
      }
    }
    return ok({ task: updated });
  } catch (e) {
    return serverError("task-update-failed", e);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot delete tasks");
    const { id } = await ctx.params;
    const task = await db.task.findUnique({ where: { id }, select: { organizationId: true, type: true } });
    if (!task || task.organizationId !== session.orgId) return notFound("task");
    // EVENT ENGINE: deleting the task resolves its active problem notifications
    // (the entity is gone; history rows stay, stamped resolved).
    if (task.type === TASK_TYPE.FOLLOW_UP) {
      await resolveFollowUpNotifications(session.orgId, id);
    } else {
      await resolveTaskNotifications(session.orgId, id);
    }
    await db.task.delete({ where: { id } });
    return ok({ ok: true });
  } catch (e) {
    return serverError("task-delete-failed", e);
  }
}
