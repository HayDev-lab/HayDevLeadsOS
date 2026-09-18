// HAYDEV LEADOS — FOLLOW-UP SLA engine (SINGLE SOURCE OF TRUTH for the
// second, independent SLA layer).
//
// This module is PURE: no DB, no React, no server-only imports. It is imported
// by API routes (server), UI components (client) and tests — every follow-up
// decision in the product is computed by the same code.
//
// It is deliberately SEPARATE from lib/sla.ts (FIRST RESPONSE SLA — verified,
// not to be touched): shared primitives are imported, logic never mixed.
//
// Semantics:
//   FOLLOW-UP SLA answers: "After the first contact, is the manager still
//   working this lead, or has the client been forgotten?"
//
//   It starts ONLY after the first qualifying first-response (CALL / MESSAGE /
//   EMAIL / MEETING) and runs against the CURRENT follow-up cycle, which is
//   task-based: the earliest open (TODO | IN_PROGRESS) task with
//   task.type = FOLLOW_UP. Task completion is the source of truth for closing
//   a cycle; scheduling a new follow-up task starts a new cycle. Final-stage
//   (WON / LOST) and archived leads are NOT_REQUIRED — no false overdue.

import { SLA_KIND, QUALIFYING_ACTIVITY_TYPES, humanizeDuration, humanizeHours } from "./sla";
import { TASK_STATUS, TASK_TYPE } from "./leados/constants";

// ---------------------------------------------------------------------------
// Types (shared, centralized)
// ---------------------------------------------------------------------------

export const FOLLOWUP_SLA_STATUS = {
  /** No active follow-up: unresponded lead, final/archived lead, or nothing scheduled. */
  NOT_REQUIRED: "NOT_REQUIRED",
  /** Open follow-up task exists, deadline beyond the warning window (or unset). */
  SCHEDULED: "SCHEDULED",
  /** Deadline within the warning window. */
  DUE_SOON: "DUE_SOON",
  /** Deadline passed and the follow-up is still open. */
  OVERDUE: "OVERDUE",
  /** Last cycle closed (task DONE) and nothing new scheduled yet. */
  COMPLETED: "COMPLETED",
} as const;
export type FollowUpSlaStatus = (typeof FOLLOWUP_SLA_STATUS)[keyof typeof FOLLOWUP_SLA_STATUS];

/** Follow-up SLA configuration (Setting key "followup_sla"). Hours. */
export interface FollowUpSlaConfig {
  /** Deadline enters DUE_SOON this many hours before dueAt. */
  warningBeforeHours: number;
  /** Default offset used by the "Standard" quick option when scheduling. */
  defaultFollowUpHours: number;
  /** When true, the first qualifying response auto-schedules a follow-up. Default OFF. */
  autoCreateAfterFirstResponse: boolean;
}

/** Minimal task shape the engine needs (a Task row or a UI replica). */
export interface FollowUpTaskInput {
  id: string;
  title?: string | null;
  dueAt?: Date | string | null;
  status?: string;
  completedAt?: Date | string | null;
  createdAt?: Date | string | null;
}

/** Full follow-up SLA result attached to a lead (API shape + client recompute). */
export interface FollowUpSlaResult {
  kind: typeof SLA_KIND.FOLLOW_UP;
  status: FollowUpSlaStatus;
  /** Current open follow-up task id (null when no active cycle). */
  taskId: string | null;
  taskTitle: string | null;
  /** When this cycle was scheduled (task.createdAt). */
  scheduledAt: Date | string | null;
  /** Deadline of the current cycle. */
  dueAt: Date | string | null;
  /** Minutes until the deadline (null when no deadline). Clamped >= 0 when OVERDUE. */
  remainingMinutes: number | null;
  /** Minutes past the deadline (null when not overdue). */
  overdueMinutes: number | null;
  /** When the last completed cycle was completed (null when never completed). */
  completedAt: Date | string | null;
  /** True when the lead has ever received a qualifying first response. */
  isResponded: boolean;
  /** True when status === OVERDUE (convenience for filters/tints). */
  isOverdue: boolean;
  /** True when an open follow-up task exists (SCHEDULED / DUE_SOON / OVERDUE). */
  hasOpenFollowUp: boolean;
}

// ---------------------------------------------------------------------------
// ONE fallback default — the ONLY place default numbers live.
// ---------------------------------------------------------------------------

export const DEFAULT_FOLLOWUP_SLA_CONFIG: FollowUpSlaConfig = {
  warningBeforeHours: 4,
  defaultFollowUpHours: 24,
  autoCreateAfterFirstResponse: false,
};

// Open task statuses that keep a follow-up cycle alive (CANCELLED / DONE close it).
export const OPEN_TASK_STATUSES: string[] = [TASK_STATUS.TODO, TASK_STATUS.IN_PROGRESS];
export const FOLLOW_UP_TASK_TYPE = TASK_TYPE.FOLLOW_UP;

// ---------------------------------------------------------------------------
// Config: parsing + validation (shared by Settings API and Settings UI)
// ---------------------------------------------------------------------------

export interface FollowUpConfigValidationResult {
  ok: boolean;
  errors: string[];
  config: FollowUpSlaConfig | null;
}

/**
 * Validate raw follow-up config input (numbers or numeric strings).
 * Rules: finite, > 0, warningBeforeHours < defaultFollowUpHours.
 * Used server-side (HTTP 400 on failure) AND client-side (inline errors).
 */
export function validateFollowUpConfig(raw: unknown): FollowUpConfigValidationResult {
  const errors: string[] = [];
  if (raw == null || typeof raw !== "object") {
    return { ok: false, errors: ["Follow-up configuration is required."], config: null };
  }
  const obj = raw as Record<string, unknown>;
  const num = (v: unknown): number | null => {
    const n = typeof v === "string" ? Number(v.trim()) : typeof v === "number" ? v : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const warning = num(obj.warningBeforeHours);
  const def = num(obj.defaultFollowUpHours);
  const autoRaw = obj.autoCreateAfterFirstResponse;
  const auto = autoRaw == null ? false : autoRaw === true || autoRaw === "true";

  if (warning == null) errors.push("Warning before deadline must be a numeric value.");
  if (def == null) errors.push("Default follow-up period must be a numeric value.");
  if (warning != null && warning <= 0) errors.push("Warning before deadline must be greater than zero.");
  if (def != null && def <= 0) errors.push("Default follow-up period must be greater than zero.");
  if (warning != null && def != null && warning >= def) {
    errors.push("Warning window must be shorter than the default follow-up period.");
  }
  if (errors.length || warning == null || def == null) {
    return { ok: false, errors, config: null };
  }
  return { ok: true, errors: [], config: { warningBeforeHours: warning, defaultFollowUpHours: def, autoCreateAfterFirstResponse: auto } };
}

/**
 * Parse a stored Setting value into a config. Returns null when absent or
 * invalid (callers fall back to DEFAULT_FOLLOWUP_SLA_CONFIG and log).
 * Backfills optional fields so older rows stay usable.
 */
export function parseFollowUpConfig(raw: unknown): FollowUpSlaConfig | null {
  if (raw == null) return null;
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  // Backfill defaults for the additive field so pre-existing rows parse.
  const merged = { ...DEFAULT_FOLLOWUP_SLA_CONFIG, ...(v as Partial<FollowUpSlaConfig>) };
  const result = validateFollowUpConfig(merged);
  return result.ok ? result.config : null;
}

// ---------------------------------------------------------------------------
// Engine: FOLLOW-UP SLA computation
// ---------------------------------------------------------------------------

/**
 * Compute FOLLOW-UP SLA for one lead.
 *
 * @param leadStatus  Lead.status (NEW | OPEN | ... | WON | LOST | ARCHIVED)
 * @param firstResponseAt Earliest qualifying first-response activity (from the
 *                    same single map the first-response SLA uses) or null.
 * @param openTask    Current open follow-up task (earliest dueAt) or null.
 * @param lastCompleted Last DONE follow-up task (most recent) or null.
 *
 * Semantics:
 *  - final/archived lead (WON/LOST/ARCHIVED)      → NOT_REQUIRED (no false overdue)
 *  - no qualifying first response yet             → NOT_REQUIRED (never starts before contact)
 *  - no open task + last completed exists         → COMPLETED
 *  - no open task at all                          → NOT_REQUIRED
 *  - open task without dueAt                      → SCHEDULED (indeterminate deadline)
 *  - dueAt <= now                                 → OVERDUE
 *  - dueAt <= now + warningBeforeHours            → DUE_SOON
 *  - otherwise                                    → SCHEDULED
 *
 * Edge cases:
 *  - future-clamped: remainingMinutes never negative; overdueMinutes >= 0
 *  - defensive: an open task on a WON/LOST/ARCHIVED lead is ignored (policy)
 */
export function computeFollowUpSla(
  input: {
    leadStatus: string;
    firstResponseAt?: Date | string | null;
    openTask?: FollowUpTaskInput | null;
    lastCompleted?: FollowUpTaskInput | null;
  },
  config: FollowUpSlaConfig = DEFAULT_FOLLOWUP_SLA_CONFIG,
  now: Date = new Date()
): FollowUpSlaResult {
  const isResponded = input.firstResponseAt != null;
  const isFinal =
    input.leadStatus === "WON" || input.leadStatus === "LOST" || input.leadStatus === "ARCHIVED";
  const openTask = input.openTask ?? null;

  // Follow-up SLA never runs on final/archived leads, even with leftover
  // open tasks (the cancel-on-finalize policy is enforced elsewhere, this
  // is the defensive layer so a stale row can never show false overdue).
  if (!isResponded || isFinal) {
    return {
      kind: SLA_KIND.FOLLOW_UP,
      status: FOLLOWUP_SLA_STATUS.NOT_REQUIRED,
      taskId: null,
      taskTitle: null,
      scheduledAt: null,
      dueAt: null,
      remainingMinutes: null,
      overdueMinutes: null,
      completedAt: null,
      isResponded,
      isOverdue: false,
      hasOpenFollowUp: false,
    };
  }

  if (!openTask) {
    const lastDone = input.lastCompleted ?? null;
    return {
      kind: SLA_KIND.FOLLOW_UP,
      status: lastDone ? FOLLOWUP_SLA_STATUS.COMPLETED : FOLLOWUP_SLA_STATUS.NOT_REQUIRED,
      taskId: null,
      taskTitle: null,
      scheduledAt: null,
      dueAt: null,
      remainingMinutes: null,
      overdueMinutes: null,
      completedAt: lastDone?.completedAt ?? null,
      isResponded,
      isOverdue: false,
      hasOpenFollowUp: false,
    };
  }

  const dueAt = openTask.dueAt ? new Date(openTask.dueAt) : null;
  const warningMs = config.warningBeforeHours * 3_600_000;
  let status: FollowUpSlaStatus;
  let remainingMinutes: number | null = null;
  let overdueMinutes: number | null = null;

  if (dueAt == null) {
    // Scheduled without a concrete deadline — active but never escalates.
    status = FOLLOWUP_SLA_STATUS.SCHEDULED;
  } else {
    const diffMin = Math.round((dueAt.getTime() - now.getTime()) / 60_000);
    if (diffMin <= 0) {
      status = FOLLOWUP_SLA_STATUS.OVERDUE;
      overdueMinutes = Math.max(0, -diffMin);
      remainingMinutes = 0;
    } else {
      remainingMinutes = diffMin;
      status = dueAt.getTime() - now.getTime() <= warningMs
        ? FOLLOWUP_SLA_STATUS.DUE_SOON
        : FOLLOWUP_SLA_STATUS.SCHEDULED;
    }
  }

  return {
    kind: SLA_KIND.FOLLOW_UP,
    status,
    taskId: openTask.id,
    taskTitle: openTask.title ?? null,
    scheduledAt: openTask.createdAt ?? null,
    dueAt,
    remainingMinutes,
    overdueMinutes,
    completedAt: null,
    isResponded,
    isOverdue: status === FOLLOWUP_SLA_STATUS.OVERDUE,
    hasOpenFollowUp: true,
  };
}

// ---------------------------------------------------------------------------
// Sorting: follow-up urgency (explicit sort option — never the default,
// first-response SLA priority stays the default order)
// ---------------------------------------------------------------------------

export const FOLLOWUP_SORT_RANK: Record<FollowUpSlaStatus, number> = {
  [FOLLOWUP_SLA_STATUS.OVERDUE]: 0,
  [FOLLOWUP_SLA_STATUS.DUE_SOON]: 1,
  [FOLLOWUP_SLA_STATUS.SCHEDULED]: 2,
  [FOLLOWUP_SLA_STATUS.COMPLETED]: 3,
  [FOLLOWUP_SLA_STATUS.NOT_REQUIRED]: 4,
};

/**
 * Follow-up urgency order: OVERDUE (most overdue first) → DUE_SOON (soonest
 * first) → SCHEDULED (soonest first) → COMPLETED → NOT_REQUIRED (newest first).
 */
export function compareLeadsByFollowUpUrgency(
  a: { id: string; createdAt: Date | string; followUp: FollowUpSlaResult },
  b: { id: string; createdAt: Date | string; followUp: FollowUpSlaResult }
): number {
  const ra = FOLLOWUP_SORT_RANK[a.followUp.status];
  const rb = FOLLOWUP_SORT_RANK[b.followUp.status];
  if (ra !== rb) return ra - rb;
  // Earliest deadline first everywhere: most-overdue first within OVERDUE,
  // soonest-deadline first within DUE_SOON / SCHEDULED.
  const dueA = a.followUp.dueAt ? new Date(a.followUp.dueAt).getTime() : Number.POSITIVE_INFINITY;
  const dueB = b.followUp.dueAt ? new Date(b.followUp.dueAt).getTime() : Number.POSITIVE_INFINITY;
  if (dueA !== dueB) return dueA - dueB;
  const ta = new Date(a.createdAt).getTime();
  const tb = new Date(b.createdAt).getTime();
  if (a.followUp.status === FOLLOWUP_SLA_STATUS.NOT_REQUIRED) return tb - ta; // newest first
  return ta - tb;
}

// ---------------------------------------------------------------------------
// Quick offsets (Schedule / Reschedule dialogs — shared client+server)
// ---------------------------------------------------------------------------

export const FOLLOWUP_QUICK_OPTIONS = [
  { key: "standard", hours: null as number | null }, // defaultFollowUpHours from config
  { key: "tomorrow", hours: 24 },
  { key: "3days", hours: 72 },
  { key: "1week", hours: 168 },
] as const;

/** Resolve a quick option into an absolute due date. */
export function followUpQuickDate(
  key: string,
  config: FollowUpSlaConfig = DEFAULT_FOLLOWUP_SLA_CONFIG,
  now: Date = new Date()
): Date {
  const hours =
    key === "tomorrow" ? 24 : key === "3days" ? 72 : key === "1week" ? 168 : config.defaultFollowUpHours;
  return new Date(now.getTime() + hours * 3_600_000);
}

// Re-exported for convenience so callers can build both SLA maps from one place.
export { QUALIFYING_ACTIVITY_TYPES, humanizeDuration, humanizeHours };
