// HAYDEV LEADOS — TASK SERVICE (v0.15).
//
// Extracted from POST /api/v1/tasks so BOTH the API route and the Automation
// Engine use ONE code path for task creation (spec 18: no raw DB mutations
// from action handlers — business services own events + audit trail).
// Automation attribution is picked up from the AsyncLocalStorage execution
// context (automation-context.ts) without parameter plumbing.

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { LEAD_EVENT, TASK_TYPE } from "./constants";
import { publishEvent } from "./events";
import {
  DOMAIN_EVENT,
  ENTITY_TYPE,
  displayName,
  taskAssignedDedupKey,
} from "@/lib/domain-events";
import { publishDomainEvent } from "./domain-event-service";
import { invalidateOrgCache } from "./api-cache";
import { getAutomationExecutionContext } from "./automation-context";

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  leadId?: string | null;
  assignedTo?: string | null;
  priority?: string | null;
  dueAt?: Date | null;
  type?: string | null;
  /** Who performed the action (null = automation/system). */
  actorUserId?: string | null;
  /** ACTION-LEVEL IDEMPOTENCY (v0.16 spec 15-16): set for automation-created
   *  tasks so a retry after a crash reuses the row (Task unique). */
  actionIndex?: number | null;
}

export async function createTask(orgId: string, input: CreateTaskInput) {
  if (input.leadId) {
    const lead = await db.lead.findUnique({ where: { id: input.leadId }, select: { organizationId: true } });
    if (!lead || lead.organizationId !== orgId) throw new Error("LEAD_NOT_FOUND");
  }

  // Automation attribution (spec 61/64): stamped from the execution context.
  const autoCtx = getAutomationExecutionContext();

  const task = await db.task.create({
    data: {
      organizationId: orgId,
      leadId: input.leadId ?? null,
      title: input.title,
      description: input.description ?? null,
      assignedTo: input.assignedTo ?? input.actorUserId ?? null,
      priority: input.priority ?? "MEDIUM",
      dueAt: input.dueAt ?? null,
      type: input.type ?? TASK_TYPE.TASK,
      automationRuleId: autoCtx?.ruleId ?? null,
      automationExecutionId: autoCtx?.executionId ?? null,
      automationActionIndex: input.actionIndex ?? null,
    },
  });

  if (task.leadId) {
    await publishEvent({
      orgId,
      leadId: task.leadId,
      userId: input.actorUserId ?? null,
      type: LEAD_EVENT.TASK_CREATED,
      payload: { taskId: task.id, title: task.title } as never,
    });
  }

  // EVENT ENGINE: assigning a generic task notifies its assignee — but never
  // the actor themselves, and never inside an automation for a self-assigned
  // task (the automation's own notification action covers that case).
  const selfAssigned = task.assignedTo === (input.actorUserId ?? null);
  if (task.type === TASK_TYPE.TASK && task.assignedTo && !selfAssigned) {
    const lead = task.leadId
      ? await db.lead.findUnique({ where: { id: task.leadId }, select: { firstName: true, lastName: true, company: true } })
      : null;
    const assignedAt = new Date();
    await publishDomainEvent(orgId, {
      type: DOMAIN_EVENT.TASK_ASSIGNED,
      entityType: ENTITY_TYPE.TASK,
      entityId: task.id,
      actorUserId: input.actorUserId ?? null,
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
  invalidateOrgCache(orgId);
  return task;
}
