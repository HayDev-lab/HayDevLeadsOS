// HAYDEV LEADOS — AUTOMATION ENGINE (v0.15), server service.
//
// The SECOND independent consumer of the DomainEvent store:
//
//   DomainEvent ── Notification Projector (processedAt — projector-owned)
//              └─ Automation Engine     (AutomationExecution unique(ruleId,eventId))
//
// Algorithm (spec 19): per (event × enabled rule):
//   1. tenant check        — rule.organizationId === event.organizationId
//   2. unique execution    — unique(ruleId, eventId): ONE event + ONE rule =
//                            max ONE automatic execution (spec 25)
//   3. actionability guard — is the problem STILL real? (spec 56–58, 96)
//   4. loop guard          — automation chain depth (spec 27–28)
//   5. conditions          — structured DSL on CURRENT state, with trace
//   6. actions             — ordered, STOP on failure (spec 23), results kept
//   7. persist result      — minimal action results (spec 21)
//
// Actions call EXISTING business services (spec 18) — never raw Prisma
// mutations — so activities, events and audit trails stay coherent.
// NO giant transaction across the pipeline (spec 80): durable events give
// eventual consistency, a failed automation never blocks notifications.

import { db } from "@/lib/db";
import type { DomainEvent, AutomationRule, AutomationExecution, Lead, Task, PipelineStage, User } from "@prisma/client";
import {
  DOMAIN_EVENT,
  ENTITY_TYPE,
  displayName,
  leadDeepLink,
  taskDeepLink,
  type DomainEventType,
} from "@/lib/domain-events";
import {
  evaluateConditionGroup,
  normalizeConditionGroup,
  traceLine,
  type ConditionEvalContext,
  type ConditionGroup,
  type ConditionTraceItem,
} from "@/lib/automation-conditions";
import {
  ACTION_ASSIGNEE,
  AUTOMATION_ACTION,
  interpolate,
  type ActionAssignee,
  type AutomationAction,
} from "@/lib/automation-actions";
import { runWithAutomationContext, getAutomationExecutionContext } from "./automation-context";
import { createTask } from "./task-service";
import { createNote } from "./note-service";
import { updateLead, assignLead } from "./lead-service";
import { getOrgFallbackRecipient } from "./domain-event-service";
import { QUALIFYING_ACTIVITY_TYPES } from "@/lib/sla";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const AUTOMATION_EXECUTION_STATUS = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  SUCCESS: "SUCCESS",
  SKIPPED: "SKIPPED",
  FAILED: "FAILED",
} as const;
export type AutomationExecutionStatus = (typeof AUTOMATION_EXECUTION_STATUS)[keyof typeof AUTOMATION_EXECUTION_STATUS];

export const SKIP_REASON = {
  CONDITIONS_NOT_MATCHED: "CONDITIONS_NOT_MATCHED",
  EVENT_NO_LONGER_ACTIONABLE: "EVENT_NO_LONGER_ACTIONABLE",
  AUTOMATION_DEPTH_EXCEEDED: "AUTOMATION_DEPTH_EXCEEDED",
} as const;

/** Max automation chain depth (spec 28 — recommended 5). */
export const MAX_AUTOMATION_DEPTH = 5;

export interface ActionResultItem {
  type: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  entityId?: string | null;
  /** Human-readable failure cause (spec 52) — never a stack trace. */
  error?: string | null;
}

export interface ExecutionResultPayload {
  trigger: {
    eventType: string;
    eventId: string;
    occurredAt: string;
    entityId: string;
    entityType: string;
  };
  conditions?: ConditionTraceItem[];
  conditionMode?: "all" | "any";
  actions: ActionResultItem[];
  /** Duration of the action phase in ms. */
  durationMs?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Context loader (spec 54) — CURRENT Lead / Stage / Owner / Task
// ---------------------------------------------------------------------------

export interface AutomationContext {
  event: DomainEvent;
  lead: (Lead & { stage: PipelineStage | null; owner: User | null }) | null;
  task: (Task & { lead: Lead | null }) | null;
  orgId: string;
}

function eventPayload(event: DomainEvent): Record<string, unknown> {
  return (event.payload ?? {}) as Record<string, unknown>;
}

/**
 * Load the CURRENT state the conditions and actions operate on (spec 55:
 * conditions evaluate CURRENT state, not the event-time snapshot).
 */
export async function buildAutomationContext(event: DomainEvent): Promise<AutomationContext> {
  const payload = eventPayload(event);
  let lead: AutomationContext["lead"] = null;
  let task: AutomationContext["task"] = null;

  if (event.entityType === ENTITY_TYPE.TASK) {
    task = await db.task.findUnique({
      where: { id: event.entityId },
      include: { lead: true },
    });
    const leadId = task?.leadId ?? (typeof payload.leadId === "string" ? payload.leadId : null);
    if (leadId && (!task || task.leadId !== leadId)) {
      const alt = await db.lead.findUnique({ where: { id: leadId }, include: { stage: true, owner: true } });
      lead = alt as AutomationContext["lead"];
    } else if (task?.lead) {
      const full = await db.lead.findUnique({ where: { id: task.lead.id }, include: { stage: true, owner: true } });
      lead = full as AutomationContext["lead"];
    }
  } else {
    const leadId = typeof payload.leadId === "string" ? payload.leadId : event.entityId;
    if (leadId) {
      const found = await db.lead.findUnique({ where: { id: leadId }, include: { stage: true, owner: true } });
      if (found && found.organizationId === event.organizationId) lead = found;
    }
  }

  return { event, lead, task, orgId: event.organizationId };
}

// ---------------------------------------------------------------------------
// Actionability (spec 56–60, 96): "is this problem STILL real?"
// ---------------------------------------------------------------------------

export interface ActionabilityResult {
  actionable: boolean;
  reason: string | null;
}

/**
 * For SLA-related events, verify the problem still exists in current state
 * BEFORE running any action. Prevents:
 *   lead stale yesterday → manager fixed it → processor delayed →
 *   automation creates a useless task today (spec 57).
 */
export async function isDomainEventActionable(event: DomainEvent): Promise<ActionabilityResult> {
  const payload = eventPayload(event);

  switch (event.type as DomainEventType) {
    case DOMAIN_EVENT.FIRST_RESPONSE_BREACHED: {
      const lead = await db.lead.findUnique({ where: { id: event.entityId }, select: { id: true, status: true, createdAt: true } });
      if (!lead) return { actionable: false, reason: "LEAD_NOT_FOUND" };
      if (["WON", "LOST", "ARCHIVED"].includes(lead.status)) return { actionable: false, reason: "LEAD_FINAL" };
      const responded = await db.activity.findFirst({
        where: { leadId: lead.id, type: { in: QUALIFYING_ACTIVITY_TYPES } },
        select: { id: true },
      });
      if (responded) return { actionable: false, reason: "FIRST_RESPONSE_DONE" };
      return { actionable: true, reason: null };
    }

    case DOMAIN_EVENT.FOLLOW_UP_DUE_SOON:
    case DOMAIN_EVENT.FOLLOW_UP_OVERDUE: {
      const taskId = event.entityId;
      const task = await db.task.findUnique({ where: { id: taskId }, include: { lead: { select: { status: true } } } });
      if (!task || task.type !== "FOLLOW_UP") return { actionable: false, reason: "TASK_NOT_FOUND" };
      if (["DONE", "CANCELLED"].includes(task.status)) return { actionable: false, reason: "TASK_COMPLETED" };
      if (task.lead && ["WON", "LOST", "ARCHIVED"].includes(task.lead.status)) return { actionable: false, reason: "LEAD_FINAL" };
      return { actionable: true, reason: null };
    }

    case DOMAIN_EVENT.STAGE_AGING:
    case DOMAIN_EVENT.STAGE_BECAME_STALE: {
      const lead = await db.lead.findUnique({ where: { id: event.entityId }, select: { status: true, stageId: true, stageEnteredAt: true } });
      if (!lead) return { actionable: false, reason: "LEAD_NOT_FOUND" };
      if (["WON", "LOST", "ARCHIVED"].includes(lead.status)) return { actionable: false, reason: "LEAD_FINAL" };
      // The stage cycle the event describes must STILL be the current one.
      if (typeof payload.stageId === "string" && payload.stageId !== lead.stageId) {
        return { actionable: false, reason: "STAGE_CHANGED" };
      }
      const enteredIso = lead.stageEnteredAt ? new Date(lead.stageEnteredAt).toISOString() : null;
      if (typeof payload.stageEnteredAt === "string" && enteredIso && payload.stageEnteredAt !== enteredIso) {
        return { actionable: false, reason: "STAGE_TIMER_RESET" };
      }
      return { actionable: true, reason: null };
    }

    case DOMAIN_EVENT.TASK_DUE_SOON:
    case DOMAIN_EVENT.TASK_OVERDUE: {
      const task = await db.task.findUnique({ where: { id: event.entityId }, select: { status: true } });
      if (!task) return { actionable: false, reason: "TASK_NOT_FOUND" };
      if (["DONE", "CANCELLED"].includes(task.status)) return { actionable: false, reason: "TASK_COMPLETED" };
      return { actionable: true, reason: null };
    }

    case DOMAIN_EVENT.LEAD_ASSIGNED: {
      // Historical fact (spec 59): still actionable while the assignee from
      // the payload IS the current owner.
      const lead = await db.lead.findUnique({ where: { id: event.entityId }, select: { ownerId: true, status: true } });
      if (!lead) return { actionable: false, reason: "LEAD_NOT_FOUND" };
      if (["WON", "LOST", "ARCHIVED"].includes(lead.status)) return { actionable: false, reason: "LEAD_FINAL" };
      const assigneeId = typeof payload.assigneeId === "string" ? payload.assigneeId : null;
      if (!assigneeId || lead.ownerId !== assigneeId) return { actionable: false, reason: "ASSIGNEE_CHANGED" };
      return { actionable: true, reason: null };
    }

    case DOMAIN_EVENT.TASK_ASSIGNED: {
      const task = await db.task.findUnique({ where: { id: event.entityId }, select: { status: true, assignedTo: true } });
      if (!task) return { actionable: false, reason: "TASK_NOT_FOUND" };
      if (["DONE", "CANCELLED"].includes(task.status)) return { actionable: false, reason: "TASK_COMPLETED" };
      const assigneeId = typeof payload.assigneeId === "string" ? payload.assigneeId : null;
      if (!assigneeId || task.assignedTo !== assigneeId) return { actionable: false, reason: "ASSIGNEE_CHANGED" };
      return { actionable: true, reason: null };
    }

    default:
      return { actionable: true, reason: null };
  }
}

// ---------------------------------------------------------------------------
// Loop protection (spec 27–28): walk the automation causation chain
// ---------------------------------------------------------------------------

/**
 * Depth = how many automation executions produced this event, transitively.
 * event.automationExecutionId → execution → its event → ... (Section 29
 * causation metadata makes the chain walkable without payload pollution).
 */
export async function getAutomationChainDepth(event: DomainEvent): Promise<number> {
  let depth = 0;
  let current: { automationExecutionId: string | null } = { automationExecutionId: event.automationExecutionId };
  while (current.automationExecutionId && depth < MAX_AUTOMATION_DEPTH + 2) {
    const exec = await db.automationExecution.findUnique({
      where: { id: current.automationExecutionId },
      select: { eventId: true },
    });
    if (!exec) break;
    const parent = await db.domainEvent.findUnique({
      where: { id: exec.eventId },
      select: { automationExecutionId: true },
    });
    if (!parent) break;
    current = parent;
    depth++;
  }
  return depth;
}

// ---------------------------------------------------------------------------
// Recipient resolution (spec 11/14)
// ---------------------------------------------------------------------------

export async function resolveActionAssignee(
  ctx: AutomationContext,
  target: ActionAssignee,
  specificUserId: string | null | undefined
): Promise<{ userId: string | null; failure: string | null }> {
  const payload = eventPayload(ctx.event);
  switch (target) {
    case ACTION_ASSIGNEE.LEAD_OWNER: {
      if (!ctx.lead) return { userId: null, failure: "The lead no longer exists." };
      if (!ctx.lead.ownerId) return { userId: null, failure: "This lead has no owner to assign to." };
      return { userId: ctx.lead.ownerId, failure: null };
    }
    case ACTION_ASSIGNEE.EVENT_RECIPIENT: {
      const assigneeId = typeof payload.assigneeId === "string" ? payload.assigneeId : null;
      const ownerId = typeof payload.ownerId === "string" ? payload.ownerId : null;
      const userId = assigneeId ?? ownerId ?? null;
      if (!userId) return { userId: null, failure: "The event has no recipient." };
      return { userId, failure: null };
    }
    case ACTION_ASSIGNEE.SPECIFIC_USER: {
      if (!specificUserId) return { userId: null, failure: "No specific user was selected." };
      return { userId: specificUserId, failure: null };
    }
    case ACTION_ASSIGNEE.ORGANIZATION_OWNER: {
      const owner = await getOrgFallbackRecipient(ctx.orgId);
      if (!owner) return { userId: null, failure: "The organization has no active owner." };
      return { userId: owner, failure: null };
    }
    default:
      return { userId: null, failure: "Unknown assignee target." };
  }
}

// ---------------------------------------------------------------------------
// Action executors (spec 17) — every action = one handler, business services
// ---------------------------------------------------------------------------

export interface ActionExecutionOutcome {
  status: "SUCCESS" | "FAILED";
  entityId?: string | null;
  error?: string | null;
}

/** Human view variables for {leadName}-style interpolation. */
function interpolationVars(ctx: AutomationContext): Record<string, string> {
  const payload = eventPayload(ctx.event);
  return {
    leadName: ctx.lead ? displayName(ctx.lead) : String(payload.leadName ?? "the lead"),
    stageName: String(payload.stageName ?? ctx.lead?.stage?.name ?? ""),
    taskTitle: String(payload.taskTitle ?? "task"),
    eventLabel: String(ctx.event.type),
  };
}

async function executeAutomationAction(
  ctx: AutomationContext,
  action: AutomationAction
): Promise<ActionExecutionOutcome> {
  const p = action.params ?? {};
  const vars = interpolationVars(ctx);
  const payload = eventPayload(ctx.event);

  switch (action.type) {
    case AUTOMATION_ACTION.CREATE_TASK: {
      const target = await resolveActionAssignee(ctx, (p.assignTo as ActionAssignee) ?? ACTION_ASSIGNEE.LEAD_OWNER, typeof p.userId === "string" ? p.userId : null);
      if (!target.userId) return { status: "FAILED", error: target.failure };
      const dueInHours = typeof p.dueInHours === "number" ? p.dueInHours : null;
      const task = await createTask(ctx.orgId, {
        title: interpolate(String(p.title ?? "Automated task"), vars),
        description: p.description ? interpolate(String(p.description), vars) : null,
        leadId: ctx.lead?.id ?? null,
        assignedTo: target.userId,
        priority: typeof p.priority === "string" ? p.priority : "HIGH",
        dueAt: dueInHours ? new Date(Date.now() + dueInHours * 3_600_000) : null,
        type: "TASK",
        actorUserId: null,
      });
      return { status: "SUCCESS", entityId: task.id };
    }

    case AUTOMATION_ACTION.CREATE_NOTIFICATION: {
      const target = await resolveActionAssignee(ctx, (p.recipient as ActionAssignee) ?? ACTION_ASSIGNEE.LEAD_OWNER, typeof p.userId === "string" ? p.userId : null);
      if (!target.userId) return { status: "FAILED", error: target.failure };
      // Automation notifications use the EXISTING notification infrastructure
      // (spec 65) with their own identity: eventId = null (the projector's
      // unique(eventId,userId) never collides) + type "automation" (spec 66:
      // source = AUTOMATION, own dedup = the execution itself).
      const deepLink = ctx.lead ? leadDeepLink(ctx.lead.id) : typeof payload.taskId === "string" ? taskDeepLink(payload.taskId) : null;
      const autoCtx = getAutomationExecutionContext();
      const notification = await db.notification.create({
        data: {
          organizationId: ctx.orgId,
          userId: target.userId,
          eventId: null,
          leadId: ctx.lead?.id ?? null,
          type: "automation",
          templateKey: "automation.message",
          payload: { automationRuleId: autoCtx?.ruleId ?? null, automationExecutionId: autoCtx?.executionId ?? null, eventType: ctx.event.type } as object,
          severity: "WARNING",
          entityType: ctx.event.entityType,
          entityId: ctx.event.entityId,
          deepLink,
          title: "Automation",
          message: interpolate(String(p.message ?? ""), vars),
        },
      });
      return { status: "SUCCESS", entityId: notification.id };
    }

    case AUTOMATION_ACTION.SET_LEAD_PRIORITY: {
      if (!ctx.lead) return { status: "FAILED", error: "The lead no longer exists." };
      const nextPriority = String(p.priority ?? "") as "LOW" | "MEDIUM" | "HIGH" | "URGENT";
      if (ctx.lead.priority === nextPriority) {
        // Same value → nothing to do; the lead service would be a no-op too.
        return { status: "SUCCESS", entityId: ctx.lead.id };
      }
      await updateLead(ctx.orgId, ctx.lead.id, null, { priority: nextPriority });
      return { status: "SUCCESS", entityId: ctx.lead.id };
    }

    case AUTOMATION_ACTION.ASSIGN_LEAD: {
      if (!ctx.lead) return { status: "FAILED", error: "The lead no longer exists." };
      const target = await resolveActionAssignee(ctx, (p.assignTo as ActionAssignee) ?? ACTION_ASSIGNEE.ORGANIZATION_OWNER, typeof p.userId === "string" ? p.userId : null);
      if (!target.userId) return { status: "FAILED", error: target.failure };
      await assignLead(ctx.orgId, ctx.lead.id, null, target.userId);
      return { status: "SUCCESS", entityId: ctx.lead.id };
    }

    case AUTOMATION_ACTION.ADD_NOTE: {
      if (!ctx.lead) return { status: "FAILED", error: "The lead no longer exists." };
      const note = await createNote(ctx.orgId, ctx.lead.id, null, interpolate(String(p.content ?? ""), vars));
      return { status: "SUCCESS", entityId: note.id };
    }

    default:
      return { status: "FAILED", error: `Unknown action type: ${String(action.type)}` };
  }
}

// ---------------------------------------------------------------------------
// Condition evaluation against the automation context
// ---------------------------------------------------------------------------

function conditionContextFrom(ctx: AutomationContext): ConditionEvalContext {
  return {
    lead: ctx.lead
      ? {
          priority: ctx.lead.priority,
          status: ctx.lead.status,
          stageId: ctx.lead.stageId,
          stageType: ctx.lead.stage?.type ?? null,
          ownerId: ctx.lead.ownerId,
          sourceId: ctx.lead.sourceId,
          estimatedValue: ctx.lead.estimatedValue,
          leadScore: ctx.lead.leadScore,
        }
      : null,
    event: {
      type: ctx.event.type,
      payload: eventPayload(ctx.event),
    },
    task: ctx.task ? { assignedTo: ctx.task.assignedTo, status: ctx.task.status } : null,
  };
}

// ---------------------------------------------------------------------------
// Core: process ONE (event × rule) pair (spec 19)
// ---------------------------------------------------------------------------

export interface ProcessEventRuleResult {
  execution: AutomationExecution | null;
  /** null when a pair execution already existed (idempotent no-op). */
  created: boolean;
}

function conditionModeOf(group: ConditionGroup | null): "all" | "any" {
  if (group?.all) return "all";
  if (group?.any) return "any";
  return "all";
}

async function completeExecution(
  executionId: string,
  status: AutomationExecutionStatus,
  data: { error?: string | null; skipReason?: string | null; result?: ExecutionResultPayload }
): Promise<AutomationExecution> {
  return db.automationExecution.update({
    where: { id: executionId },
    data: {
      status,
      completedAt: new Date(),
      error: data.error ?? null,
      skipReason: data.skipReason ?? null,
      result: (data.result ?? undefined) as never,
    },
  });
}

/**
 * Run one rule against one event with FULL guarantees:
 * idempotency, backlog guard, actionability, loop protection, condition trace,
 * ordered actions with STOP-on-failure, and a persisted, minimal result.
 */
export async function processEventRule(
  event: DomainEvent,
  rule: AutomationRule,
  opts: { chainDepth?: number } = {}
): Promise<ProcessEventRuleResult> {
  // TENANT GUARD (spec 4/109): a rule NEVER crosses organizations.
  if (rule.organizationId !== event.organizationId) {
    return { execution: null, created: false };
  }

  // ENABLED GUARD (spec 44/91): paused or deleted rules never execute —
  // enforced in the ENGINE too, not only in the processor query.
  if (!rule.enabled || rule.deletedAt) {
    return { execution: null, created: false };
  }

  // BACKLOG GUARD (spec 92–93/95): only events that occurred at/after the
  // rule's activation are eligible — a new rule never replays old history.
  if (event.occurredAt.getTime() < new Date(rule.enabledAt ?? rule.createdAt).getTime()) {
    return { execution: null, created: false };
  }

  // IDEMPOTENCY (spec 25): claim the pair first. The unique constraint makes
  // concurrent/rerun processing a no-op instead of a duplicate.
  let execution: AutomationExecution;
  try {
    execution = await db.automationExecution.create({
      data: {
        organizationId: event.organizationId,
        ruleId: rule.id,
        eventId: event.id,
        status: AUTOMATION_EXECUTION_STATUS.PENDING,
        ruleVersion: rule.version,
      },
    });
  } catch {
    return { execution: null, created: false };
  }

  try {
    await db.automationExecution.update({
      where: { id: execution.id },
      data: { status: AUTOMATION_EXECUTION_STATUS.RUNNING, startedAt: new Date() },
    });
  } catch {
    return { execution, created: true };
  }

  const baseResult: ExecutionResultPayload = {
    trigger: {
      eventType: event.type,
      eventId: event.id,
      occurredAt: new Date(event.occurredAt).toISOString(),
      entityId: event.entityId,
      entityType: event.entityType,
    },
    actions: [],
  };

  // LOOP GUARD (spec 27–28): automation chains may not exceed depth 5.
  const depth = opts.chainDepth ?? (await getAutomationChainDepth(event));
  if (depth >= MAX_AUTOMATION_DEPTH) {
    const ex = await completeExecution(execution.id, AUTOMATION_EXECUTION_STATUS.SKIPPED, {
      skipReason: SKIP_REASON.AUTOMATION_DEPTH_EXCEEDED,
      result: { ...baseResult, chainDepth: depth },
    });
    return { execution: ex, created: true };
  }

  // ACTIONABILITY GUARD (spec 56–58): the problem must still be real.
  const actionability = await isDomainEventActionable(event);
  if (!actionability.actionable) {
    const ex = await completeExecution(execution.id, AUTOMATION_EXECUTION_STATUS.SKIPPED, {
      skipReason: SKIP_REASON.EVENT_NO_LONGER_ACTIONABLE,
      result: { ...baseResult, notActionableBecause: actionability.reason },
    });
    return { execution: ex, created: true };
  }

  // CONTEXT + CONDITIONS (spec 6–8, 53–55): CURRENT state, structured trace.
  const ctx = await buildAutomationContext(event);
  const group = normalizeConditionGroup(rule.conditions);
  const evaluation = evaluateConditionGroup(group, conditionContextFrom(ctx));
  if (!evaluation.matched) {
    const ex = await completeExecution(execution.id, AUTOMATION_EXECUTION_STATUS.SKIPPED, {
      skipReason: SKIP_REASON.CONDITIONS_NOT_MATCHED,
      result: { ...baseResult, conditions: evaluation.trace, conditionMode: conditionModeOf(group) },
    });
    return { execution: ex, created: true };
  }

  // ACTIONS (spec 22–23): ordered execution, STOP on failure, keep partials.
  const actions = (Array.isArray(rule.actions) ? rule.actions : []) as unknown as AutomationAction[];
  const startedAt = Date.now();
  const actionResults: ActionResultItem[] = [];
  let failed = false;
  let failureError: string | null = null;

  await runWithAutomationContext({ executionId: execution.id, ruleId: rule.id, eventDepth: depth }, async () => {
    for (let i = 0; i < actions.length; i++) {
      if (failed) {
        actionResults.push({ type: String(actions[i]?.type ?? "UNKNOWN"), status: "SKIPPED", error: null });
        continue;
      }
      try {
        const outcome = await executeAutomationAction(ctx, actions[i]);
        actionResults.push({
          type: actions[i].type,
          status: outcome.status,
          entityId: outcome.entityId ?? null,
          error: outcome.error ?? null,
        });
        if (outcome.status === "FAILED") {
          failed = true;
          failureError = outcome.error ?? "Action failed.";
        }
      } catch (e) {
        // Human message only (spec 52); the technical detail stays in server logs.
        console.error(`[AUTOMATION] execution=${execution.id} action=${actions[i].type} failed:`, e);
        actionResults.push({
          type: actions[i].type,
          status: "FAILED",
          error: "The action could not be completed. Check the entity and try again.",
        });
        failed = true;
        failureError = "The action could not be completed. Check the entity and try again.";
      }
    }
  });

  const durationMs = Date.now() - startedAt;
  const result: ExecutionResultPayload = {
    ...baseResult,
    conditions: evaluation.trace,
    conditionMode: conditionModeOf(group),
    actions: actionResults,
    durationMs,
    chainDepth: depth,
  };

  const ex = failed
    ? await completeExecution(execution.id, AUTOMATION_EXECUTION_STATUS.FAILED, { error: failureError, result })
    : await completeExecution(execution.id, AUTOMATION_EXECUTION_STATUS.SUCCESS, { result });
  return { execution: ex, created: true };
}

// ---------------------------------------------------------------------------
// Manual retry (spec 24, 26): FAILED executions only — SUCCESS is never
// replayed; already-SUCCESSFUL actions from the failed attempt are NOT
// re-executed (no duplicate tasks).
// ---------------------------------------------------------------------------

export async function retryAutomationExecution(
  orgId: string,
  executionId: string
): Promise<{ ok: boolean; error?: string; execution?: AutomationExecution }> {
  const execution = await db.automationExecution.findUnique({ where: { id: executionId }, include: { rule: true } });
  if (!execution || execution.organizationId !== orgId) return { ok: false, error: "Execution not found." };
  if (execution.status !== AUTOMATION_EXECUTION_STATUS.FAILED) {
    return { ok: false, error: "Only failed executions can be retried." };
  }
  const rule = execution.rule;
  if (!rule || rule.deletedAt || !rule.enabled) {
    return { ok: false, error: "The rule is deleted or paused." };
  }

  const event = await db.domainEvent.findUnique({ where: { id: execution.eventId } });
  if (!event || event.organizationId !== orgId) return { ok: false, error: "The source event no longer exists." };

  await db.automationExecution.update({
    where: { id: execution.id },
    data: { status: AUTOMATION_EXECUTION_STATUS.RUNNING, startedAt: new Date(), error: null, completedAt: null },
  });

  const previous = (execution.result ?? {}) as ExecutionResultPayload;
  const previousActions: ActionResultItem[] = Array.isArray(previous.actions) ? previous.actions : [];

  const actionability = await isDomainEventActionable(event);
  const baseResult: ExecutionResultPayload = {
    trigger: previous.trigger ?? {
      eventType: event.type,
      eventId: event.id,
      occurredAt: new Date(event.occurredAt).toISOString(),
      entityId: event.entityId,
      entityType: event.entityType,
    },
    actions: [],
    retriedAtExecution: true,
  };

  if (!actionability.actionable) {
    const ex = await completeExecution(execution.id, AUTOMATION_EXECUTION_STATUS.SKIPPED, {
      skipReason: SKIP_REASON.EVENT_NO_LONGER_ACTIONABLE,
      result: { ...baseResult, notActionableBecause: actionability.reason },
    });
    return { ok: true, execution: ex };
  }

  const ctx = await buildAutomationContext(event);
  const group = normalizeConditionGroup(rule.conditions);
  const evaluation = evaluateConditionGroup(group, conditionContextFrom(ctx));
  if (!evaluation.matched) {
    const ex = await completeExecution(execution.id, AUTOMATION_EXECUTION_STATUS.SKIPPED, {
      skipReason: SKIP_REASON.CONDITIONS_NOT_MATCHED,
      result: { ...baseResult, conditions: evaluation.trace, conditionMode: conditionModeOf(group) },
    });
    return { ok: true, execution: ex };
  }

  const actions = (Array.isArray(rule.actions) ? rule.actions : []) as unknown as AutomationAction[];
  const startedAt = Date.now();
  const actionResults: ActionResultItem[] = [];
  let failed = false;
  let failureError: string | null = null;

  await runWithAutomationContext({ executionId: execution.id, ruleId: rule.id, eventDepth: await getAutomationChainDepth(event) }, async () => {
    for (let i = 0; i < actions.length; i++) {
      // PARTIAL-EFFECT SAFETY (spec 97): actions that already succeeded in
      // the failed attempt are kept, never re-executed.
      const prev = previousActions[i];
      if (prev && prev.status === "SUCCESS") {
        actionResults.push(prev);
        continue;
      }
      if (failed) {
        actionResults.push({ type: String(actions[i]?.type ?? "UNKNOWN"), status: "SKIPPED", error: null });
        continue;
      }
      try {
        const outcome = await executeAutomationAction(ctx, actions[i]);
        actionResults.push({
          type: actions[i].type,
          status: outcome.status,
          entityId: outcome.entityId ?? null,
          error: outcome.error ?? null,
        });
        if (outcome.status === "FAILED") {
          failed = true;
          failureError = outcome.error ?? "Action failed.";
        }
      } catch (e) {
        console.error(`[AUTOMATION-RETRY] execution=${execution.id} action=${actions[i].type} failed:`, e);
        actionResults.push({
          type: actions[i].type,
          status: "FAILED",
          error: "The action could not be completed. Check the entity and try again.",
        });
        failed = true;
        failureError = "The action could not be completed. Check the entity and try again.";
      }
    }
  });

  const result: ExecutionResultPayload = {
    ...baseResult,
    conditions: evaluation.trace,
    conditionMode: conditionModeOf(group),
    actions: actionResults,
    durationMs: Date.now() - startedAt,
  };
  const ex = failed
    ? await completeExecution(execution.id, AUTOMATION_EXECUTION_STATUS.FAILED, { error: failureError, result })
    : await completeExecution(execution.id, AUTOMATION_EXECUTION_STATUS.SUCCESS, { result });
  return { ok: true, execution: ex };
}

// ---------------------------------------------------------------------------
// Dry run (spec 36–37): NOTHING is created — pure preview
// ---------------------------------------------------------------------------

export interface DryRunActionPreview {
  type: string;
  status: "PREVIEW";
  /** What would happen, resolved against the selected lead. */
  summary: string;
  entityId?: string | null;
}

export interface DryRunResult {
  triggerMatched: boolean;
  conditionsMatched: boolean;
  conditions: ConditionTraceItem[];
  conditionMode: "all" | "any";
  actions: DryRunActionPreview[];
  actionabilityNote: string | null;
  leadId: string | null;
  leadName: string | null;
}

/** English snapshot lines reused by the UI alongside localized labels. */
export function dryRunTraceLines(result: DryRunResult): string[] {
  return result.conditions.map(traceLine);
}

export async function dryRunAutomationRule(
  rule: AutomationRule,
  opts: { leadId?: string | null } = {}
): Promise<{ ok: boolean; error?: string; result?: DryRunResult }> {
  let leadId = opts.leadId ?? null;
  if (!leadId) {
    const first = await db.lead.findFirst({
      where: { organizationId: rule.organizationId, status: { notIn: ["WON", "LOST", "ARCHIVED"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    leadId = first?.id ?? null;
  }
  if (!leadId) return { ok: false, error: "No lead available for the test." };

  const lead = await db.lead.findUnique({ where: { id: leadId }, include: { stage: true, owner: true } });
  if (!lead || lead.organizationId !== rule.organizationId) return { ok: false, error: "Lead not found." };

  // A relevant open task for task-triggered rules (display only).
  const task = await db.task.findFirst({
    where: { organizationId: rule.organizationId, leadId: lead.id, status: { in: ["TODO", "IN_PROGRESS"] } },
    orderBy: { createdAt: "desc" },
    include: { lead: true },
  });

  // SYNTHETIC event of the rule's trigger type (spec 36: user picks a lead
  // or the engine uses a demo payload — nothing is really executed).
  const syntheticEvent = {
    id: "dry-run",
    organizationId: rule.organizationId,
    type: rule.triggerType,
    entityType: rule.triggerType.startsWith("TASK") || rule.triggerType.startsWith("FOLLOW_UP") ? "task" : "lead",
    entityId: task?.id ?? lead.id,
    actorUserId: null,
    occurredAt: new Date(),
    payload: {
      leadId: lead.id,
      leadName: displayName(lead),
      stageId: lead.stageId,
      stageName: lead.stage?.name ?? null,
      ownerId: lead.ownerId,
      assigneeId: task?.assignedTo ?? lead.ownerId,
      taskId: task?.id ?? null,
      taskTitle: task?.title ?? null,
    } as Record<string, unknown>,
    deduplicationKey: "dry-run",
    processedAt: null,
    automationExecutionId: null,
    createdAt: new Date(),
  } as unknown as DomainEvent;

  const ctx: AutomationContext = {
    event: syntheticEvent,
    lead: lead as AutomationContext["lead"],
    task,
    orgId: rule.organizationId,
  };

  const group = normalizeConditionGroup(rule.conditions);
  const evaluation = evaluateConditionGroup(group, conditionContextFrom(ctx));

  const vars = interpolationVars(ctx);
  const actions = (Array.isArray(rule.actions) ? rule.actions : []) as unknown as AutomationAction[];
  const previews: DryRunActionPreview[] = [];
  for (const a of actions) {
    const p = a.params ?? {};
    let summary = "";
    let resolvedUser = "";
    switch (a.type) {
      case AUTOMATION_ACTION.CREATE_TASK: {
        const target = (p.assignTo as ActionAssignee) ?? ACTION_ASSIGNEE.LEAD_OWNER;
        if (target === ACTION_ASSIGNEE.LEAD_OWNER) resolvedUser = lead.owner?.name ?? "lead owner (unassigned!)";
        else if (target === ACTION_ASSIGNEE.SPECIFIC_USER) {
          const u = lead.owner?.id === p.userId ? lead.owner : await db.user.findUnique({ where: { id: String(p.userId ?? "") }, select: { name: true } });
          resolvedUser = u?.name ?? "selected user";
        } else resolvedUser = "event recipient";
        summary = `Create task "${interpolate(String(p.title ?? ""), vars)}"${p.dueInHours ? ` (due in ${p.dueInHours}h)` : ""} for ${resolvedUser}`;
        break;
      }
      case AUTOMATION_ACTION.CREATE_NOTIFICATION: {
        const target = (p.recipient as ActionAssignee) ?? ACTION_ASSIGNEE.LEAD_OWNER;
        resolvedUser = target === ACTION_ASSIGNEE.LEAD_OWNER ? (lead.owner?.name ?? "lead owner (unassigned!)") : target === ACTION_ASSIGNEE.SPECIFIC_USER ? "selected user" : target === ACTION_ASSIGNEE.ORGANIZATION_OWNER ? "organization owner" : "event recipient";
        summary = `Notify ${resolvedUser}: "${interpolate(String(p.message ?? ""), vars)}"`;
        break;
      }
      case AUTOMATION_ACTION.SET_LEAD_PRIORITY:
        summary = `Set lead priority to ${String(p.priority ?? "")}`;
        break;
      case AUTOMATION_ACTION.ASSIGN_LEAD:
        summary = `Assign lead to ${p.assignTo === ACTION_ASSIGNEE.ORGANIZATION_OWNER ? "organization owner" : "selected user"}`;
        break;
      case AUTOMATION_ACTION.ADD_NOTE:
        summary = `Add note: "${interpolate(String(p.content ?? ""), vars).slice(0, 80)}"`;
        break;
      default:
        summary = String(a.type);
    }
    previews.push({ type: a.type, status: "PREVIEW", summary });
  }

  return {
    ok: true,
    result: {
      triggerMatched: true, // synthetic event of exactly this trigger type
      conditionsMatched: evaluation.matched,
      conditions: evaluation.trace,
      conditionMode: conditionModeOf(group),
      actions: previews,
      actionabilityNote:
        "Simulated run against the lead's current state. Nothing was created, notified or changed.",
      leadId: lead.id,
      leadName: displayName(lead),
    },
  };
}
