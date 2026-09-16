// HAYDEV LEADOS — SLA engine (SINGLE SOURCE OF TRUTH).
//
// This module is PURE: no DB, no React, no server-only imports.
// It is imported by API routes (server), UI components (client) and tests,
// so every SLA decision in the product is computed by the same code.
//
// Current scope: FIRST RESPONSE SLA — time from lead creation to the first
// qualifying manager action. Future SLA kinds (FOLLOW_UP, STAGE_INACTIVITY,
// TASK_OVERDUE) will extend SLA_KIND; naming below is future-ready.

import { ACTIVITY_TYPE } from "./leados/constants";

// ---------------------------------------------------------------------------
// Types (shared, centralized — no magic strings across the project)
// ---------------------------------------------------------------------------

export const SLA_KIND = {
  FIRST_RESPONSE: "FIRST_RESPONSE",
  FOLLOW_UP: "FOLLOW_UP",
} as const;
export type SlaKind = (typeof SLA_KIND)[keyof typeof SLA_KIND];

export const SLA_STATUS = {
  TARGET: "TARGET",
  WARNING: "WARNING",
  BREACH: "BREACH",
  RESPONDED: "RESPONDED",
} as const;
export type SlaStatus = (typeof SLA_STATUS)[keyof typeof SLA_STATUS];

/** Thresholds in HOURS. Storage format of Setting "sla_thresholds". */
export interface SlaThresholds {
  target: number;
  warning: number;
  breach: number;
}

/** Full SLA result attached to a lead (API response shape + client recompute). */
export interface SlaResult {
  kind: SlaKind;
  status: SlaStatus;
  /** Elapsed since createdAt (or until first response) in minutes, clamped >= 0. */
  elapsedMinutes: number;
  /** Elapsed in hours, fractional (derived from elapsedMinutes). */
  elapsedHours: number;
  /** Time of the first qualifying response, null when unanswered. */
  firstResponseAt: Date | string | null;
  /** Minutes from creation to first response (only when responded). */
  responseMinutes: number | null;
  /** Absolute deadline dates derived from createdAt + thresholds. */
  targetAt: Date;
  warningAt: Date;
  breachAt: Date;
  createdAt: Date | string;
  /** True when elapsed has passed the warning threshold (still WARNING state). */
  escalated: boolean;
  isBreached: boolean;
  isResponded: boolean;
}

// ---------------------------------------------------------------------------
// ONE fallback default — the ONLY place default numbers live.
// ---------------------------------------------------------------------------

export const DEFAULT_SLA_THRESHOLDS: SlaThresholds = {
  target: 1,
  warning: 4,
  breach: 24,
};

// ---------------------------------------------------------------------------
// Qualifying activities: a manager ACTION toward the lead.
// System events, imports, assignments and internal stage changes NEVER
// close the first-response SLA. NOTE is an internal memo, not a response.
// ---------------------------------------------------------------------------

export const QUALIFYING_ACTIVITY_TYPES: string[] = [
  ACTIVITY_TYPE.CALL,
  ACTIVITY_TYPE.MESSAGE,
  ACTIVITY_TYPE.EMAIL,
  ACTIVITY_TYPE.MEETING,
];

export function isQualifyingActivity(type: string): boolean {
  return QUALIFYING_ACTIVITY_TYPES.includes(type);
}

// ---------------------------------------------------------------------------
// Thresholds: parsing + validation (shared by Settings API and Settings UI)
// ---------------------------------------------------------------------------

export interface SlaValidationResult {
  ok: boolean;
  errors: string[];
  thresholds: SlaThresholds | null;
}

/**
 * Validate raw threshold input (accepts hours numbers or numeric strings).
 * Rules: finite, > 0, target < warning < breach.
 * Used server-side (HTTP 400 on failure) AND client-side (inline errors).
 */
export function validateSlaThresholds(raw: unknown): SlaValidationResult {
  const errors: string[] = [];
  if (raw == null || typeof raw !== "object") {
    return { ok: false, errors: ["SLA thresholds are required."], thresholds: null };
  }
  const obj = raw as Record<string, unknown>;
  const num = (v: unknown): number | null => {
    const n = typeof v === "string" ? Number(v.trim()) : typeof v === "number" ? v : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const target = num(obj.target);
  const warning = num(obj.warning);
  const breach = num(obj.breach);

  if (target == null || warning == null || breach == null) {
    errors.push("Target, Warning and Breach must be numeric values.");
  }
  if (target != null && target <= 0) errors.push("Target must be greater than zero.");
  if (warning != null && warning <= 0) errors.push("Warning must be greater than zero.");
  if (breach != null && breach <= 0) errors.push("Breach must be greater than zero.");
  if (target != null && warning != null && target >= warning) {
    errors.push("Target must be lower than Warning.");
  }
  if (warning != null && breach != null && warning >= breach) {
    errors.push("Warning must be lower than Breach.");
  }
  if (errors.length || target == null || warning == null || breach == null) {
    return { ok: false, errors, thresholds: null };
  }
  return { ok: true, errors: [], thresholds: { target, warning, breach } };
}

/**
 * Parse a stored Setting value into thresholds. Returns null when absent or
 * invalid (callers fall back to DEFAULT_SLA_THRESHOLDS and log the anomaly).
 */
export function parseSlaThresholds(raw: unknown): SlaThresholds | null {
  if (raw == null) return null;
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const v = validateSlaThresholds(value);
  return v.ok ? v.thresholds : null;
}

// ---------------------------------------------------------------------------
// Engine: FIRST RESPONSE SLA computation
// ---------------------------------------------------------------------------

/**
 * Compute FIRST RESPONSE SLA for one lead.
 *
 * Semantics:
 *  - firstResponseAt present  → RESPONDED (elapsed frozen at response time)
 *  - elapsed <= target        → TARGET
 *  - target < elapsed < breach → WARNING (escalated visual once elapsed >= warning)
 *  - elapsed >= breach        → BREACH
 *
 * Edge cases:
 *  - future createdAt (bad data) → elapsed clamped to 0 (never negative)
 *  - firstResponseAt before createdAt (merge artifacts) → elapsed clamped to 0
 */
export function computeFirstResponseSla(
  input: {
    createdAt: Date | string;
    firstResponseAt?: Date | string | null;
  },
  thresholds: SlaThresholds = DEFAULT_SLA_THRESHOLDS,
  now: Date = new Date()
): SlaResult {
  const createdAt = new Date(input.createdAt);
  const firstResponseAt = input.firstResponseAt ? new Date(input.firstResponseAt) : null;

  const targetMs = thresholds.target * 3_600_000;
  const warningMs = thresholds.warning * 3_600_000;
  const breachMs = thresholds.breach * 3_600_000;

  // Elapsed runs until the first response, then freezes.
  const until = firstResponseAt && firstResponseAt < now ? firstResponseAt : now;
  const elapsedMs = Math.max(0, until.getTime() - createdAt.getTime());
  const elapsedMinutes = Math.round(elapsedMs / 60_000);
  const elapsedHours = elapsedMs / 3_600_000;

  const isResponded = firstResponseAt != null;
  const responseMinutes = isResponded
    ? Math.max(0, Math.round((firstResponseAt!.getTime() - createdAt.getTime()) / 60_000))
    : null;

  let status: SlaStatus;
  if (isResponded) {
    status = SLA_STATUS.RESPONDED;
  } else if (elapsedHours <= thresholds.target) {
    status = SLA_STATUS.TARGET;
  } else if (elapsedHours < thresholds.breach) {
    status = SLA_STATUS.WARNING;
  } else {
    status = SLA_STATUS.BREACH;
  }

  return {
    kind: SLA_KIND.FIRST_RESPONSE,
    status,
    elapsedMinutes,
    elapsedHours,
    firstResponseAt,
    responseMinutes,
    targetAt: new Date(createdAt.getTime() + targetMs),
    warningAt: new Date(createdAt.getTime() + warningMs),
    breachAt: new Date(createdAt.getTime() + breachMs),
    createdAt,
    escalated: !isResponded && elapsedHours >= thresholds.warning,
    isBreached: status === SLA_STATUS.BREACH,
    isResponded,
  };
}

// ---------------------------------------------------------------------------
// Sorting: SLA priority rank (default sort — user's explicit sort overrides)
// ---------------------------------------------------------------------------

export const SLA_SORT_RANK: Record<SlaStatus, number> = {
  [SLA_STATUS.BREACH]: 0,
  [SLA_STATUS.WARNING]: 1,
  [SLA_STATUS.TARGET]: 2,
  [SLA_STATUS.RESPONDED]: 3,
};

/**
 * Default SLA priority order: BREACH → WARNING → TARGET → RESPONDED.
 * Inside BREACH / WARNING / TARGET: oldest first (most overdue / closest to
 * breach / about to slip). Inside RESPONDED: newest first (default order).
 */
export function compareLeadsBySlaPriority(
  a: { id: string; createdAt: Date | string; sla: SlaResult },
  b: { id: string; createdAt: Date | string; sla: SlaResult }
): number {
  const ra = SLA_SORT_RANK[a.sla.status];
  const rb = SLA_SORT_RANK[b.sla.status];
  if (ra !== rb) return ra - rb;
  const ta = new Date(a.createdAt).getTime();
  const tb = new Date(b.createdAt).getTime();
  if (a.sla.status === SLA_STATUS.RESPONDED) return tb - ta; // newest first
  return ta - tb; // oldest first
}

// ---------------------------------------------------------------------------
// Human-readable durations (no raw "163 minutes")
// ---------------------------------------------------------------------------

/** 42m · 1h 18m · 6h · 1d 4h (>=48h always switches to day notation) */
export function humanizeDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 1) return "0m";
  if (m < 60) return `${m}m`;
  const totalHours = Math.floor(m / 60);
  const remMin = m % 60;
  if (totalHours < 48) {
    return remMin ? `${totalHours}h ${remMin}m` : `${totalHours}h`;
  }
  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

/** Compact hours label for thresholds: 0.5 → "30m", 1 → "1h", 36 → "1d 12h" */
export function humanizeHours(hours: number): string {
  return humanizeDuration(hours * 60);
}
