// HAYDEV LEADOS — DOMAIN EVENT ENGINE (v0.14), single source of truth.
//
// This module is PURE: no DB, no React, no server-only imports. It is imported
// by API routes (server), UI components (client) and tests.
//
// DISTINCTION (spec Section 4):
//   Activity Timeline = human-facing history of actions around a lead
//     (CALL / MESSAGE / NOTE / STAGE_CHANGE ...).
//   DomainEvent = machine-readable business FACT:
//     FIRST_RESPONSE_BREACHED / FOLLOW_UP_OVERDUE / STAGE_BECAME_STALE ...
//
// This engine NEVER reimplements SLA logic. Event conditions are derived from
// the three existing pure engines (computeFirstResponseSla, computeFollowUpSla,
// computeStageInactivity) — the engines stay the source of truth.
//
// IDEMPOTENCY (spec Sections 11–13): one state transition = one event.
// Deterministic deduplication keys + DB unique(organizationId, deduplicationKey)
// guarantee no duplicates even under races / repeated reconciliation runs.

import { SLA_STATUS, type SlaResult, type SlaThresholds } from "./sla";
import {
  FOLLOWUP_SLA_STATUS,
  type FollowUpSlaConfig,
  type FollowUpSlaResult,
} from "./sla-followup";
import {
  STAGE_INACTIVITY_STATUS,
  type StageInactivityConfig,
  type StageInactivityResult,
} from "./sla-stage-inactivity";

// ---------------------------------------------------------------------------
// Event types — v0.14 (centralized, no magic strings anywhere else)
// ---------------------------------------------------------------------------

export const DOMAIN_EVENT = {
  FIRST_RESPONSE_BREACHED: "FIRST_RESPONSE_BREACHED",
  FOLLOW_UP_DUE_SOON: "FOLLOW_UP_DUE_SOON",
  FOLLOW_UP_OVERDUE: "FOLLOW_UP_OVERDUE",
  STAGE_AGING: "STAGE_AGING",
  STAGE_BECAME_STALE: "STAGE_BECAME_STALE",
  LEAD_ASSIGNED: "LEAD_ASSIGNED",
  LEAD_INGESTED: "LEAD_INGESTED",
  TASK_ASSIGNED: "TASK_ASSIGNED",
  TASK_DUE_SOON: "TASK_DUE_SOON",
  TASK_OVERDUE: "TASK_OVERDUE",
} as const;
export type DomainEventType = (typeof DOMAIN_EVENT)[keyof typeof DOMAIN_EVENT];

export const DOMAIN_EVENT_TYPES: DomainEventType[] = Object.values(DOMAIN_EVENT);

export const ENTITY_TYPE = {
  LEAD: "lead",
  TASK: "task",
} as const;
export type DomainEntityType = (typeof ENTITY_TYPE)[keyof typeof ENTITY_TYPE];

export const SEVERITY = {
  INFO: "INFO",
  WARNING: "WARNING",
  CRITICAL: "CRITICAL",
} as const;
export type Severity = (typeof SEVERITY)[keyof typeof SEVERITY];

/** Recommended severity per event type (spec Section 19). */
export const EVENT_SEVERITY: Record<DomainEventType, Severity> = {
  [DOMAIN_EVENT.LEAD_ASSIGNED]: SEVERITY.INFO,
  [DOMAIN_EVENT.TASK_ASSIGNED]: SEVERITY.INFO,
  [DOMAIN_EVENT.LEAD_INGESTED]: SEVERITY.INFO,
  [DOMAIN_EVENT.FOLLOW_UP_DUE_SOON]: SEVERITY.WARNING,
  [DOMAIN_EVENT.STAGE_AGING]: SEVERITY.WARNING,
  [DOMAIN_EVENT.TASK_DUE_SOON]: SEVERITY.WARNING,
  [DOMAIN_EVENT.FIRST_RESPONSE_BREACHED]: SEVERITY.CRITICAL,
  [DOMAIN_EVENT.FOLLOW_UP_OVERDUE]: SEVERITY.CRITICAL,
  [DOMAIN_EVENT.STAGE_BECAME_STALE]: SEVERITY.CRITICAL,
  [DOMAIN_EVENT.TASK_OVERDUE]: SEVERITY.CRITICAL,
};

// ---------------------------------------------------------------------------
// Deduplication keys (deterministic — spec Sections 12, 26–28)
// ---------------------------------------------------------------------------

const iso = (d: Date | string) => new Date(d).toISOString();

/** Stage / first-response cycles are anchored to a stable per-lead timestamp. */
export function stageAgingDedupKey(leadId: string, stageEnteredAt: Date | string): string {
  return `${DOMAIN_EVENT.STAGE_AGING}:${leadId}:${iso(stageEnteredAt)}`;
}
export function stageStaleDedupKey(leadId: string, stageEnteredAt: Date | string): string {
  return `${DOMAIN_EVENT.STAGE_BECAME_STALE}:${leadId}:${iso(stageEnteredAt)}`;
}
export function firstResponseBreachedDedupKey(leadId: string, createdAt: Date | string): string {
  return `${DOMAIN_EVENT.FIRST_RESPONSE_BREACHED}:${leadId}:${iso(createdAt)}`;
}
/** Follow-up and task cycles are task-based — a new dueAt is a new cycle. */
export function followUpDueSoonDedupKey(taskId: string, dueAt: Date | string | null): string {
  return `${DOMAIN_EVENT.FOLLOW_UP_DUE_SOON}:${taskId}:${dueAt ? iso(dueAt) : "none"}`;
}
export function followUpOverdueDedupKey(taskId: string, dueAt: Date | string | null): string {
  return `${DOMAIN_EVENT.FOLLOW_UP_OVERDUE}:${taskId}:${dueAt ? iso(dueAt) : "none"}`;
}
export function taskDueSoonDedupKey(taskId: string, dueAt: Date | string | null): string {
  return `${DOMAIN_EVENT.TASK_DUE_SOON}:${taskId}:${dueAt ? iso(dueAt) : "none"}`;
}
export function taskOverdueDedupKey(taskId: string, dueAt: Date | string | null): string {
  return `${DOMAIN_EVENT.TASK_OVERDUE}:${taskId}:${dueAt ? iso(dueAt) : "none"}`;
}
/** Assignment events are emitted inline at action time — anchor to the action instant. */
export function leadAssignedDedupKey(leadId: string, assigneeId: string, assignedAt: Date | string): string {
  return `${DOMAIN_EVENT.LEAD_ASSIGNED}:${leadId}:${assigneeId}:${iso(assignedAt)}`;
}
export function taskAssignedDedupKey(taskId: string, assigneeId: string, assignedAt: Date | string): string {
  return `${DOMAIN_EVENT.TASK_ASSIGNED}:${taskId}:${assigneeId}:${iso(assignedAt)}`;
}

// ---------------------------------------------------------------------------
// Notification templates (spec Sections 43–47)
// ---------------------------------------------------------------------------

/**
 * templateKey + payload are stored on the notification; the UI renders
 * t(templateKey, payload) so localization happens at display time in the
 * viewer's locale. `titleKey`/`messageKey` name the i18n entries; the
 * stored `title`/`message` columns keep an English snapshot for exports
 * and non-UI consumers.
 */
export interface NotificationTemplate {
  titleKey: string;
  messageKey: string;
}

export const NOTIFICATION_TEMPLATES: Record<DomainEventType, NotificationTemplate> = {
  [DOMAIN_EVENT.FIRST_RESPONSE_BREACHED]: {
    titleKey: "notif.fr_breached.title",
    messageKey: "notif.fr_breached.message",
  },
  [DOMAIN_EVENT.FOLLOW_UP_DUE_SOON]: {
    titleKey: "notif.fu_due_soon.title",
    messageKey: "notif.fu_due_soon.message",
  },
  [DOMAIN_EVENT.FOLLOW_UP_OVERDUE]: {
    titleKey: "notif.fu_overdue.title",
    messageKey: "notif.fu_overdue.message",
  },
  [DOMAIN_EVENT.STAGE_AGING]: {
    titleKey: "notif.stage_aging.title",
    messageKey: "notif.stage_aging.message",
  },
  [DOMAIN_EVENT.STAGE_BECAME_STALE]: {
    titleKey: "notif.stage_stale.title",
    messageKey: "notif.stage_stale.message",
  },
  [DOMAIN_EVENT.LEAD_ASSIGNED]: {
    titleKey: "notif.lead_assigned.title",
    messageKey: "notif.lead_assigned.message",
  },
  [DOMAIN_EVENT.TASK_ASSIGNED]: {
    titleKey: "notif.task_assigned.title",
    messageKey: "notif.task_assigned.message",
  },
  [DOMAIN_EVENT.TASK_DUE_SOON]: {
    titleKey: "notif.task_due_soon.title",
    messageKey: "notif.task_due_soon.message",
  },
  [DOMAIN_EVENT.TASK_OVERDUE]: {
    titleKey: "notif.task_overdue.title",
    messageKey: "notif.task_overdue.message",
  },
  [DOMAIN_EVENT.LEAD_INGESTED]: {
    titleKey: "notif.lead_ingested.title",
    messageKey: "notif.lead_ingested.message",
  },
};

/** Human label i18n key for Settings toggles (one per event type). */
export const EVENT_LABEL_KEYS: Record<DomainEventType, string> = {
  [DOMAIN_EVENT.FIRST_RESPONSE_BREACHED]: "notif.prefs.fr_breached",
  [DOMAIN_EVENT.FOLLOW_UP_DUE_SOON]: "notif.prefs.fu_due_soon",
  [DOMAIN_EVENT.FOLLOW_UP_OVERDUE]: "notif.prefs.fu_overdue",
  [DOMAIN_EVENT.STAGE_AGING]: "notif.prefs.stage_aging",
  [DOMAIN_EVENT.STAGE_BECAME_STALE]: "notif.prefs.stage_stale",
  [DOMAIN_EVENT.LEAD_ASSIGNED]: "notif.prefs.lead_assigned",
  [DOMAIN_EVENT.TASK_ASSIGNED]: "notif.prefs.task_assigned",
  [DOMAIN_EVENT.TASK_DUE_SOON]: "notif.prefs.task_due_soon",
  [DOMAIN_EVENT.TASK_OVERDUE]: "notif.prefs.task_overdue",
  [DOMAIN_EVENT.LEAD_INGESTED]: "notif.prefs.lead_ingested",
};

// ---------------------------------------------------------------------------
// Deep links (spec Section 32) — hash-route based, resolved by the UI
// ---------------------------------------------------------------------------

export function leadDeepLink(leadId: string, focus?: "activity" | "followup" | "stage" | "tasks"): string {
  return focus ? `lead/${leadId}?focus=${focus}` : `lead/${leadId}`;
}
export function taskDeepLink(taskId: string): string {
  return `tasks?task=${taskId}`;
}

// ---------------------------------------------------------------------------
// Notification preferences (spec Sections 54–56, 99)
// ---------------------------------------------------------------------------

/** Per-user toggles. Default: everything ON (MVP — critical toggles too, Section 56). */
export type NotificationPreferences = Record<DomainEventType, boolean>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  [DOMAIN_EVENT.FIRST_RESPONSE_BREACHED]: true,
  [DOMAIN_EVENT.FOLLOW_UP_DUE_SOON]: true,
  [DOMAIN_EVENT.FOLLOW_UP_OVERDUE]: true,
  [DOMAIN_EVENT.STAGE_AGING]: true,
  [DOMAIN_EVENT.STAGE_BECAME_STALE]: true,
  [DOMAIN_EVENT.LEAD_ASSIGNED]: true,
  [DOMAIN_EVENT.TASK_ASSIGNED]: true,
  [DOMAIN_EVENT.TASK_DUE_SOON]: true,
  [DOMAIN_EVENT.TASK_OVERDUE]: true,
  [DOMAIN_EVENT.LEAD_INGESTED]: true,
};

/** Parse a stored preference row, backfilling unknown types with ON (Section 99: event ≠ delivery preference). */
export function parseNotificationPreferences(raw: unknown): NotificationPreferences {
  const result = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  if (raw == null) return result;
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return result;
    }
  }
  if (typeof value !== "object" || value == null) return result;
  const obj = (value as Record<string, unknown>).types ?? value;
  if (typeof obj !== "object" || obj == null) return result;
  for (const type of DOMAIN_EVENT_TYPES) {
    const v = (obj as Record<string, unknown>)[type];
    if (typeof v === "boolean") result[type] = v;
  }
  return result;
}

/** Validate + normalize raw preference input (server-side, HTTP 400 on failure). */
export function validateNotificationPreferences(raw: unknown): { ok: boolean; errors: string[]; prefs: NotificationPreferences | null } {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["Notification preferences must be an object keyed by event type."], prefs: null };
  }
  const obj = raw as Record<string, unknown>;
  const errors: string[] = [];
  const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  for (const [k, v] of Object.entries(obj)) {
    if (!(k in DEFAULT_NOTIFICATION_PREFERENCES)) {
      errors.push(`Unknown notification type: ${k}`);
      continue;
    }
    if (typeof v !== "boolean") {
      errors.push(`Preference for ${k} must be a boolean.`);
      continue;
    }
    prefs[k as DomainEventType] = v;
  }
  if (errors.length) return { ok: false, errors, prefs: null };
  return { ok: true, errors: [], prefs };
}

// ---------------------------------------------------------------------------
// Task event configuration (spec Section 53 — ONE centralized default, no
// per-task settings)
// ---------------------------------------------------------------------------

export interface TaskEventConfig {
  /** TASK_DUE_SOON fires this many hours before dueAt. */
  warningBeforeHours: number;
}

export const DEFAULT_TASK_EVENT_CONFIG: TaskEventConfig = { warningBeforeHours: 4 };

export function parseTaskEventConfig(raw: unknown): TaskEventConfig {
  if (raw == null) return { ...DEFAULT_TASK_EVENT_CONFIG };
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { ...DEFAULT_TASK_EVENT_CONFIG };
    }
  }
  if (typeof value !== "object" || value == null) return { ...DEFAULT_TASK_EVENT_CONFIG };
  const n = (value as Record<string, unknown>).warningBeforeHours;
  const hours = typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN;
  return {
    warningBeforeHours: Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_TASK_EVENT_CONFIG.warningBeforeHours,
  };
}

export function validateTaskEventConfig(raw: unknown): { ok: boolean; errors: string[]; config: TaskEventConfig | null } {
  if (raw == null || typeof raw !== "object") {
    return { ok: false, errors: ["Task event configuration is required."], config: null };
  }
  const n = (raw as Record<string, unknown>).warningBeforeHours;
  const num = typeof n === "string" ? Number(n.trim()) : typeof n === "number" ? n : NaN;
  if (!Number.isFinite(num) || num <= 0) {
    return { ok: false, errors: ["Task due-soon window must be a numeric value greater than zero."], config: null };
  }
  return { ok: true, errors: [], config: { warningBeforeHours: num } };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Display name for payloads/notifications ("Anna Petrosyan" | company | "Lead"). */
export function displayName(lead: {
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
}): string {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim();
  return name || lead.company || "Lead";
}

// ---------------------------------------------------------------------------
// Event plan (pure reconciler core — spec Section 21, NO SLA reimplementation)
// ---------------------------------------------------------------------------

/**
 * A pending DomainEvent the reconciler wants to exist. The server service
 * creates it only when its deduplicationKey is absent (idempotent insert).
 */
export interface PlannedEvent {
  type: DomainEventType;
  entityType: DomainEntityType;
  entityId: string;
  /** When the condition became true (engine-derived boundary, not scan time). */
  occurredAt: Date;
  deduplicationKey: string;
  /** Minimal payload for notification + audit + future automation. */
  payload: Record<string, unknown>;
  /** Recipient hints the projector can use without re-querying the lead. */
  ownerId?: string | null;
  /** Follow-up/task events carry the task assignee as the primary recipient. */
  assigneeId?: string | null;
}

/** Lead row shape the planner needs (server passes real Prisma rows). */
export interface LeadEventInput {
  id: string;
  createdAt: Date | string;
  status: string;
  stageId: string | null;
  stageType?: string | null;
  stageName?: string | null;
  stageEnteredAt?: Date | string | null;
  ownerId: string | null;
  leadName: string;
  firstResponseAt?: Date | string | null;
}

/** Minimal task row shape (FOLLOW_UP tasks come from the FU engine's map). */
export interface TaskEventInput {
  id: string;
  title: string;
  dueAt: Date | string | null;
  status: string;
  type: string;
  assignedTo: string | null;
  leadId?: string | null;
  leadName?: string | null;
  leadOwnerId?: string | null;
}

/**
 * Plan TIME-BASED events for one lead from the three engine results.
 * Deterministic dedup keys make repeated planning + idempotent inserts safe:
 * "if the event already exists → no-op" replaces status snapshots (Section 26).
 */
export function planLeadEvents(
  lead: LeadEventInput,
  engines: {
    firstResponse: SlaResult;
    followUp: FollowUpSlaResult;
    stageInactivity: StageInactivityResult;
  },
  opts: { followUpWarningBeforeHours?: number; followUpAssigneeId?: string | null } = {}
): PlannedEvent[] {
  const events: PlannedEvent[] = [];
  const fuWarningHours = opts.followUpWarningBeforeHours ?? 4;

  // FIRST RESPONSE → BREACH
  if (engines.firstResponse.status === SLA_STATUS.BREACH) {
    events.push({
      type: DOMAIN_EVENT.FIRST_RESPONSE_BREACHED,
      entityType: ENTITY_TYPE.LEAD,
      entityId: lead.id,
      occurredAt: engines.firstResponse.breachAt,
      deduplicationKey: firstResponseBreachedDedupKey(lead.id, lead.createdAt),
      payload: {
        leadId: lead.id,
        leadName: lead.leadName,
        overdueMinutes: engines.firstResponse.elapsedMinutes,
        ownerId: lead.ownerId,
      },
      ownerId: lead.ownerId,
    });
  }

  // FOLLOW-UP → DUE_SOON / OVERDUE (cycle anchored to task + dueAt)
  if (engines.followUp.taskId) {
    const base = {
      leadId: lead.id,
      leadName: lead.leadName,
      taskId: engines.followUp.taskId,
      taskTitle: engines.followUp.taskTitle,
      dueAt: engines.followUp.dueAt ? new Date(engines.followUp.dueAt).toISOString() : null,
    };
    if (engines.followUp.status === FOLLOWUP_SLA_STATUS.DUE_SOON) {
      const dueAtMs = new Date(engines.followUp.dueAt!).getTime();
      events.push({
        type: DOMAIN_EVENT.FOLLOW_UP_DUE_SOON,
        entityType: ENTITY_TYPE.TASK,
        entityId: engines.followUp.taskId,
        // The moment the cycle entered the warning window: dueAt - warning.
        occurredAt: new Date(dueAtMs - fuWarningHours * 3_600_000),
        deduplicationKey: followUpDueSoonDedupKey(engines.followUp.taskId, engines.followUp.dueAt),
        payload: { ...base, remainingMinutes: engines.followUp.remainingMinutes, assigneeId: opts.followUpAssigneeId ?? null },
        ownerId: lead.ownerId,
        assigneeId: opts.followUpAssigneeId ?? null,
      });
    } else if (engines.followUp.status === FOLLOWUP_SLA_STATUS.OVERDUE) {
      events.push({
        type: DOMAIN_EVENT.FOLLOW_UP_OVERDUE,
        entityType: ENTITY_TYPE.TASK,
        entityId: engines.followUp.taskId,
        occurredAt: new Date(engines.followUp.dueAt ?? lead.createdAt),
        deduplicationKey: followUpOverdueDedupKey(engines.followUp.taskId, engines.followUp.dueAt),
        payload: { ...base, overdueMinutes: engines.followUp.overdueMinutes, assigneeId: opts.followUpAssigneeId ?? null },
        ownerId: lead.ownerId,
        assigneeId: opts.followUpAssigneeId ?? null,
      });
    }
  }

  // STAGE → AGING / STALE (cycle anchored to stageEnteredAt)
  const si = engines.stageInactivity;
  const stagePayload = {
    leadId: lead.id,
    leadName: lead.leadName,
    stageId: lead.stageId,
    stageName: lead.stageName,
    stageEnteredAt: si.stageEnteredAt.toISOString(),
    ownerId: lead.ownerId,
  };
  if (si.status === STAGE_INACTIVITY_STATUS.AGING && si.warningAt) {
    events.push({
      type: DOMAIN_EVENT.STAGE_AGING,
      entityType: ENTITY_TYPE.LEAD,
      entityId: lead.id,
      occurredAt: si.warningAt,
      deduplicationKey: stageAgingDedupKey(lead.id, si.stageEnteredAt),
      payload: { ...stagePayload, thresholdMinutes: si.thresholdMinutes, remainingMinutes: si.remainingMinutes },
      ownerId: lead.ownerId,
    });
  } else if (si.status === STAGE_INACTIVITY_STATUS.STALE && si.staleAt) {
    events.push({
      type: DOMAIN_EVENT.STAGE_BECAME_STALE,
      entityType: ENTITY_TYPE.LEAD,
      entityId: lead.id,
      occurredAt: si.staleAt,
      deduplicationKey: stageStaleDedupKey(lead.id, si.stageEnteredAt),
      payload: { ...stagePayload, thresholdMinutes: si.thresholdMinutes, overdueMinutes: si.overdueMinutes },
      ownerId: lead.ownerId,
    });
  }

  return events;
}

/**
 * Plan time-based events for one generic task (Task.type = "TASK" ONLY —
 * FOLLOW_UP tasks belong to the Follow-up engine, so a late follow-up never
 * produces two notifications, spec Section 6/52).
 * Simple event detection around the existing dueAt — NOT a new Task SLA engine.
 */
export function planTaskEvents(task: TaskEventInput, config: TaskEventConfig, now: Date = new Date()): PlannedEvent[] {
  if (task.type !== "TASK") return [];
  if (task.status !== "TODO" && task.status !== "IN_PROGRESS") return [];
  if (!task.dueAt) return [];

  const dueAt = new Date(task.dueAt);
  const payload = {
    taskId: task.id,
    taskTitle: task.title,
    dueAt: dueAt.toISOString(),
    leadId: task.leadId ?? null,
    leadName: task.leadName ?? null,
    // Recipient chain hints (projector reads them from the payload).
    assigneeId: task.assignedTo,
    ownerId: task.leadOwnerId ?? null,
  };
  const base = {
    ownerId: task.leadOwnerId ?? null,
    assigneeId: task.assignedTo,
  };

  if (dueAt.getTime() <= now.getTime()) {
    return [
      {
        type: DOMAIN_EVENT.TASK_OVERDUE,
        entityType: ENTITY_TYPE.TASK,
        entityId: task.id,
        occurredAt: dueAt,
        deduplicationKey: taskOverdueDedupKey(task.id, task.dueAt),
        payload: { ...payload, overdueMinutes: Math.max(0, Math.round((now.getTime() - dueAt.getTime()) / 60_000)) },
        ...base,
      },
    ];
  }

  const warningMs = config.warningBeforeHours * 3_600_000;
  if (dueAt.getTime() - now.getTime() <= warningMs) {
    return [
      {
        type: DOMAIN_EVENT.TASK_DUE_SOON,
        entityType: ENTITY_TYPE.TASK,
        entityId: task.id,
        occurredAt: new Date(dueAt.getTime() - warningMs),
        deduplicationKey: taskDueSoonDedupKey(task.id, task.dueAt),
        payload: { ...payload, remainingMinutes: Math.max(0, Math.round((dueAt.getTime() - now.getTime()) / 60_000)) },
        ...base,
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// English snapshot rendering (stored on the notification as a fallback for
// exports / non-UI consumers; the UI renders templateKey + payload with t()).
// ---------------------------------------------------------------------------

export function renderEnglishSnapshot(
  type: DomainEventType,
  payload: Record<string, unknown>
): { title: string; message: string } {
  const minutes = (v: unknown) => Number(v ?? 0);
  const leadName = String(payload.leadName ?? payload.taskTitle ?? "Lead");
  switch (type) {
    case DOMAIN_EVENT.FIRST_RESPONSE_BREACHED:
      return {
        title: "First response overdue",
        message: `${leadName} has been waiting ${Math.round(minutes(payload.overdueMinutes) / 60)}h without a first response.`,
      };
    case DOMAIN_EVENT.FOLLOW_UP_DUE_SOON:
      return {
        title: "Follow-up due soon",
        message: `Follow-up for ${leadName} is due in ${Math.round(minutes(payload.remainingMinutes) / 60)}h.`,
      };
    case DOMAIN_EVENT.FOLLOW_UP_OVERDUE:
      return {
        title: "Follow-up overdue",
        message: `${leadName}: follow-up overdue by ${Math.round(minutes(payload.overdueMinutes) / 60)}h.`,
      };
    case DOMAIN_EVENT.STAGE_AGING:
      return {
        title: "Deal is aging",
        message: `${leadName} has been in ${payload.stageName ?? "its stage"} for a while — approaching the limit.`,
      };
    case DOMAIN_EVENT.STAGE_BECAME_STALE:
      return {
        title: "Deal has stalled",
        message: `${leadName} has been in ${payload.stageName ?? "its stage"} too long. Expected maximum: ${Math.round(minutes(payload.thresholdMinutes) / 60)}h.`,
      };
    case DOMAIN_EVENT.LEAD_ASSIGNED:
      return { title: "Lead assigned to you", message: `${leadName} was assigned to you.` };
    case DOMAIN_EVENT.TASK_ASSIGNED:
      return { title: "Task assigned to you", message: `"${payload.taskTitle ?? "Task"}"${payload.leadName ? ` for ${payload.leadName}` : ""} was assigned to you.` };
    case DOMAIN_EVENT.TASK_DUE_SOON:
      return {
        title: "Task due soon",
        message: `"${payload.taskTitle ?? "Task"}" is due in ${Math.round(minutes(payload.remainingMinutes) / 60)}h.`,
      };
    case DOMAIN_EVENT.TASK_OVERDUE:
      return {
        title: "Task overdue",
        message: `"${payload.taskTitle ?? "Task"}" is overdue by ${Math.round(minutes(payload.overdueMinutes) / 60)}h.`,
      };
    default:
      return { title: type, message: "" };
  }
}

// Re-exports for the projector/services (single import point).
export { SLA_STATUS, FOLLOWUP_SLA_STATUS, STAGE_INACTIVITY_STATUS };
export type { SlaThresholds, FollowUpSlaConfig, StageInactivityConfig };
