// HAYDEV LEADOS — STAGE INACTIVITY engine (SINGLE SOURCE OF TRUTH for the
// third, independent SLA layer).
//
// This module is PURE: no DB, no React, no server-only imports. It is imported
// by API routes (server), UI components (client) and tests — every stage
// health decision in the product is computed by the same code.
//
// It is deliberately SEPARATE from lib/sla.ts (FIRST RESPONSE — verified, not
// to be touched) and lib/sla-followup.ts (FOLLOW-UP — verified): shared
// primitives are imported, business semantics never mixed.
//
// Semantics:
//   STAGE INACTIVITY answers: "Is this deal moving through the pipeline, or
//   has it been sitting on one stage for too long?"
//
//   stageAge = now - stageEnteredAt (the persisted entry timestamp, set on
//   create and reset ONLY on a real stage transition — never by notes, calls,
//   assignments or any other activity, never derived from updatedAt).
//
//   Thresholds are PER STAGE and come from Settings (key "stage_inactivity",
//   keyed by stage ID, never display name). Final stages (won / lost) and
//   Won/Lost/Archived leads are NOT_APPLICABLE — they can never go stale.
//
//   Dynamic status note (future automation): status is computed on read and
//   does not itself create a durable event. A future worker can detect the
//   AGING → STALE transition with detectStageInactivityTransition() without
//   rewriting this engine.

import { SLA_KIND, humanizeDuration, humanizeHours } from "./sla";

// ---------------------------------------------------------------------------
// Types (shared, centralized)
// ---------------------------------------------------------------------------

export const STAGE_INACTIVITY_STATUS = {
  /** Stage age is well below the threshold — nothing to do. */
  ON_TRACK: "ON_TRACK",
  /** Stage age is inside the warning window before the threshold. */
  AGING: "AGING",
  /** Stage age has passed the stage threshold — the deal has stalled. */
  STALE: "STALE",
  /** Won / Lost / Archived or no stage — stage health is not monitored. */
  NOT_APPLICABLE: "NOT_APPLICABLE",
} as const;
export type StageInactivityStatus =
  (typeof STAGE_INACTIVITY_STATUS)[keyof typeof STAGE_INACTIVITY_STATUS];

/** Per-stage threshold as stored in the Setting (keyed by stage ID). */
export interface StageThresholdEntry {
  thresholdHours: number;
}

/**
 * Stage inactivity configuration (Setting key "stage_inactivity").
 * `stages` is keyed by PIPELINE STAGE ID (survives renames, Section 42).
 */
export interface StageInactivityConfig {
  /** Global warning window: AGING starts this many hours before the threshold. */
  warningBeforeHours: number;
  stages: Record<string, StageThresholdEntry>;
}

/** Minimal lead shape the engine needs (a Lead row or a UI replica). */
export interface StageInactivityLeadInput {
  /** Lead.status — NEW | OPEN | ... | WON | LOST | ARCHIVED */
  leadStatus: string;
  /** Current pipeline stage ID (null when the lead has no stage). */
  stageId: string | null;
  /** PipelineStage.type — "open" | "won" | "lost". */
  stageType?: string | null;
  /** Persisted entry timestamp; the engine falls back to createdAt when null. */
  stageEnteredAt?: Date | string | null;
  createdAt: Date | string;
}

/** Full stage inactivity result attached to a lead (API shape + client recompute). */
export interface StageInactivityResult {
  kind: typeof SLA_KIND.STAGE_INACTIVITY;
  status: StageInactivityStatus;
  /** Effective entry timestamp (stageEnteredAt, falling back to createdAt). */
  stageEnteredAt: Date;
  stageAgeMinutes: number;
  thresholdMinutes: number | null;
  /** stageEnteredAt + (threshold - warning) — when AGING starts. Null when N/A. */
  warningAt: Date | null;
  /** stageEnteredAt + threshold — when the deal goes STALE. Null when N/A. */
  staleAt: Date | null;
  /** Minutes until STALE (ON_TRACK / AGING). Null otherwise. */
  remainingMinutes: number | null;
  /** Minutes past the threshold (STALE only). */
  overdueMinutes: number | null;
  isFinalStage: boolean;
  isStale: boolean;
  isAging: boolean;
  /** True when the stage had no configured threshold and the shared default was used. */
  usesFallbackThreshold: boolean;
}

// ---------------------------------------------------------------------------
// ONE fallback default — the ONLY place default numbers live (Section 14).
// ---------------------------------------------------------------------------

/** Fallback threshold for active stages without explicit configuration. */
export const DEFAULT_STAGE_INACTIVITY_HOURS = 72;
export const DEFAULT_WARNING_BEFORE_HOURS = 12;

export const DEFAULT_STAGE_INACTIVITY_CONFIG: StageInactivityConfig = {
  warningBeforeHours: DEFAULT_WARNING_BEFORE_HOURS,
  stages: {},
};

/** Resolve the effective threshold (hours) for a stage (config or fallback). */
export function resolveStageThresholdHours(
  config: StageInactivityConfig,
  stageId: string | null | undefined
): number {
  if (!stageId) return DEFAULT_STAGE_INACTIVITY_HOURS;
  const entry = config.stages?.[stageId];
  if (!entry || !Number.isFinite(entry.thresholdHours) || entry.thresholdHours <= 0) {
    return DEFAULT_STAGE_INACTIVITY_HOURS;
  }
  return entry.thresholdHours;
}

// ---------------------------------------------------------------------------
// Config: parsing + validation (shared by Settings API and Settings UI)
// ---------------------------------------------------------------------------

export interface StageInactivityValidationResult {
  ok: boolean;
  errors: string[];
  config: StageInactivityConfig | null;
}

/**
 * Validate raw stage inactivity config input.
 * Rules (Section 15): finite numeric values; every thresholdHours > 0;
 * warningBeforeHours > 0; warningBeforeHours < thresholdHours for EVERY
 * configured stage. Used server-side (HTTP 400) AND client-side (inline).
 */
export function validateStageInactivityConfig(raw: unknown): StageInactivityValidationResult {
  const errors: string[] = [];
  if (raw == null || typeof raw !== "object") {
    return { ok: false, errors: ["Stage inactivity configuration is required."], config: null };
  }
  const obj = raw as Record<string, unknown>;
  const num = (v: unknown): number | null => {
    const n = typeof v === "string" ? Number(v.trim()) : typeof v === "number" ? v : NaN;
    return Number.isFinite(n) ? n : null;
  };

  const warning = num(obj.warningBeforeHours);
  if (warning == null) errors.push("Warning before stale must be a numeric value.");
  if (warning != null && warning <= 0) errors.push("Warning before stale must be greater than zero.");

  const stages: Record<string, StageThresholdEntry> = {};
  const rawStages = obj.stages;
  if (rawStages != null) {
    if (typeof rawStages !== "object" || Array.isArray(rawStages)) {
      errors.push("Stages must be an object keyed by stage ID.");
    } else {
      for (const [stageId, entry] of Object.entries(rawStages as Record<string, unknown>)) {
        const hours =
          entry != null && typeof entry === "object"
            ? num((entry as Record<string, unknown>).thresholdHours)
            : num(entry);
        if (hours == null) {
          errors.push(`Threshold for stage ${stageId} must be a numeric value.`);
          continue;
        }
        if (hours <= 0) {
          errors.push(`Threshold for stage ${stageId} must be greater than zero.`);
          continue;
        }
        if (warning != null && warning >= hours) {
          errors.push(
            `Warning window must be shorter than the stage threshold (stage ${stageId}).`
          );
          continue;
        }
        stages[stageId] = { thresholdHours: hours };
      }
    }
  }

  if (errors.length || warning == null) {
    return { ok: false, errors, config: null };
  }
  return { ok: true, errors: [], config: { warningBeforeHours: warning, stages } };
}

/**
 * Parse a stored Setting value into a config. Returns null when absent or
 * invalid (callers fall back to DEFAULT_STAGE_INACTIVITY_CONFIG and log).
 * Backfills the warning window so older/partial rows stay usable.
 */
export function parseStageInactivityConfig(raw: unknown): StageInactivityConfig | null {
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
  const merged = {
    warningBeforeHours:
      v.warningBeforeHours != null ? v.warningBeforeHours : DEFAULT_WARNING_BEFORE_HOURS,
    stages: v.stages != null && typeof v.stages === "object" && !Array.isArray(v.stages) ? v.stages : {},
  };
  const result = validateStageInactivityConfig(merged);
  return result.ok ? result.config : null;
}

// ---------------------------------------------------------------------------
// Engine: STAGE INACTIVITY computation
// ---------------------------------------------------------------------------

const FINAL_LEAD_STATUSES = ["WON", "LOST", "ARCHIVED"];
const FINAL_STAGE_TYPES = ["won", "lost"];

/**
 * Compute STAGE INACTIVITY for one lead.
 *
 * @param input.leadStatus   Lead.status
 * @param input.stageId      Current pipeline stage ID (null = no stage)
 * @param input.stageType    PipelineStage.type ("open" | "won" | "lost")
 * @param input.stageEnteredAt Persisted entry timestamp (null → createdAt fallback)
 * @param input.createdAt    Lead creation date (final fallback, Section 140)
 *
 * Semantics (threshold T, warning W — both per stage / global):
 *  - final stage type (won/lost)            → NOT_APPLICABLE
 *  - lead status WON/LOST/ARCHIVED          → NOT_APPLICABLE (defensive parity)
 *  - no stage at all                        → NOT_APPLICABLE
 *  - age <  T - W                           → ON_TRACK
 *  - T - W <= age < T                       → AGING
 *  - age >= T                               → STALE
 *
 * Edge cases:
 *  - future stageEnteredAt (corrupted/imported data) → age clamped to 0
 *  - missing stageEnteredAt → createdAt fallback (engine-level, cheap)
 *  - warning >= threshold (corrupted config) → window clamped to 0 so the
 *    lead reads AGING from entry until STALE; validation prevents this anyway
 */
export function computeStageInactivity(
  input: StageInactivityLeadInput,
  config: StageInactivityConfig = DEFAULT_STAGE_INACTIVITY_CONFIG,
  now: Date = new Date()
): StageInactivityResult {
  const isFinalStage =
    input.stageType != null ? FINAL_STAGE_TYPES.includes(input.stageType) : false;
  const isFinalLead = FINAL_LEAD_STATUSES.includes(input.leadStatus);

  const entered = new Date(input.stageEnteredAt ?? input.createdAt);

  // Final / archived / stageless leads are never monitored — no false stale.
  if (isFinalStage || isFinalLead || !input.stageId) {
    return {
      kind: SLA_KIND.STAGE_INACTIVITY,
      status: STAGE_INACTIVITY_STATUS.NOT_APPLICABLE,
      stageEnteredAt: entered,
      stageAgeMinutes: Math.max(0, Math.round((now.getTime() - entered.getTime()) / 60_000)),
      thresholdMinutes: null,
      warningAt: null,
      staleAt: null,
      remainingMinutes: null,
      overdueMinutes: null,
      isFinalStage: isFinalStage || isFinalLead,
      isStale: false,
      isAging: false,
      usesFallbackThreshold: false,
    };
  }

  const configured = config.stages?.[input.stageId];
  const usesFallbackThreshold = !configured || !Number.isFinite(configured.thresholdHours) || configured.thresholdHours <= 0;
  const thresholdHours = resolveStageThresholdHours(config, input.stageId);
  const thresholdMinutes = Math.round(thresholdHours * 60);

  const warningHours = Number.isFinite(config.warningBeforeHours) && config.warningBeforeHours > 0
    ? config.warningBeforeHours
    : DEFAULT_WARNING_BEFORE_HOURS;
  // AGING window start (clamped >= 0 so a corrupted config cannot produce
  // negative boundaries).
  const warningWindowMinutes = Math.max(0, Math.round((thresholdHours - warningHours) * 60));

  const ageMs = Math.max(0, now.getTime() - entered.getTime()); // future → 0
  const stageAgeMinutes = Math.round(ageMs / 60_000);

  // Status decisions use EXACT milliseconds so the engine and the server-side
  // Prisma filters (stageHealthFilterWhere) agree at every boundary.
  let status: StageInactivityStatus;
  if (ageMs >= thresholdMinutes * 60_000) {
    status = STAGE_INACTIVITY_STATUS.STALE;
  } else if (ageMs >= warningWindowMinutes * 60_000) {
    status = STAGE_INACTIVITY_STATUS.AGING;
  } else {
    status = STAGE_INACTIVITY_STATUS.ON_TRACK;
  }

  const staleAt = new Date(entered.getTime() + thresholdMinutes * 60_000);
  const warningAt = new Date(entered.getTime() + warningWindowMinutes * 60_000);

  return {
    kind: SLA_KIND.STAGE_INACTIVITY,
    status,
    stageEnteredAt: entered,
    stageAgeMinutes,
    thresholdMinutes,
    warningAt,
    staleAt,
    remainingMinutes: status === STAGE_INACTIVITY_STATUS.STALE ? null : Math.max(0, Math.round((staleAt.getTime() - now.getTime()) / 60_000)),
    overdueMinutes: status === STAGE_INACTIVITY_STATUS.STALE ? Math.max(0, Math.round((now.getTime() - staleAt.getTime()) / 60_000)) : null,
    isFinalStage: false,
    isStale: status === STAGE_INACTIVITY_STATUS.STALE,
    isAging: status === STAGE_INACTIVITY_STATUS.AGING,
    usesFallbackThreshold,
  };
}

// ---------------------------------------------------------------------------
// Sorting: stage inactivity urgency (explicit sort — never the default;
// first-response SLA priority stays the default order)
// ---------------------------------------------------------------------------

export const STAGE_INACTIVITY_SORT_RANK: Record<StageInactivityStatus, number> = {
  [STAGE_INACTIVITY_STATUS.STALE]: 0,
  [STAGE_INACTIVITY_STATUS.AGING]: 1,
  [STAGE_INACTIVITY_STATUS.ON_TRACK]: 2,
  [STAGE_INACTIVITY_STATUS.NOT_APPLICABLE]: 3,
};

/**
 * Stage inactivity urgency order (Section 57):
 *   STALE (most overdue first) → AGING (closest to stale first) →
 *   ON_TRACK (oldest first) → NOT_APPLICABLE (newest first).
 * "Most overdue" / "closest to stale" compare the engine's overdue/remaining
 * minutes, so the order stays correct ACROSS stages with different thresholds.
 */
export function compareLeadsByStageInactivity(
  a: { id: string; createdAt: Date | string; stageInactivity: StageInactivityResult },
  b: { id: string; createdAt: Date | string; stageInactivity: StageInactivityResult }
): number {
  const ra = STAGE_INACTIVITY_SORT_RANK[a.stageInactivity.status];
  const rb = STAGE_INACTIVITY_SORT_RANK[b.stageInactivity.status];
  if (ra !== rb) return ra - rb;
  const A = a.stageInactivity;
  const B = b.stageInactivity;
  if (A.status === STAGE_INACTIVITY_STATUS.STALE) {
    // Largest overdue first (most stalled deal on top).
    const d = (B.overdueMinutes ?? 0) - (A.overdueMinutes ?? 0);
    if (d !== 0) return d;
  } else if (A.status === STAGE_INACTIVITY_STATUS.AGING) {
    // Closest to the threshold first (smallest remaining).
    const d = (A.remainingMinutes ?? 0) - (B.remainingMinutes ?? 0);
    if (d !== 0) return d;
  } else if (A.status === STAGE_INACTIVITY_STATUS.ON_TRACK) {
    // Oldest entry first (about to age next).
    const d = A.stageEnteredAt.getTime() - B.stageEnteredAt.getTime();
    if (d !== 0) return d;
  }
  // NOT_APPLICABLE (newest first) + stable tie-break everywhere.
  if (A.status === STAGE_INACTIVITY_STATUS.NOT_APPLICABLE) {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  }
  const ta = new Date(a.createdAt).getTime();
  const tb = new Date(b.createdAt).getTime();
  return ta !== tb ? ta - tb : a.id < b.id ? -1 : 1;
}

// ---------------------------------------------------------------------------
// Future automation contract (Section 118) — NO worker, NO notifications now.
// ---------------------------------------------------------------------------

export type StageInactivityTransition = "AGING_STARTED" | "STALE_STARTED" | "RECOVERED" | "NONE";

/**
 * Detect a status transition for a future Automation Engine / notification
 * worker (previous vs current computed status). Pure and side-effect free —
 * publishing durable events stays the worker's job (Section 120).
 */
export function detectStageInactivityTransition(
  previous: StageInactivityStatus | null | undefined,
  current: StageInactivityStatus
): StageInactivityTransition {
  if (previous === current) return "NONE";
  if (current === STAGE_INACTIVITY_STATUS.STALE) return "STALE_STARTED";
  if (current === STAGE_INACTIVITY_STATUS.AGING && previous !== STAGE_INACTIVITY_STATUS.STALE) return "AGING_STARTED";
  if (
    (previous === STAGE_INACTIVITY_STATUS.STALE || previous === STAGE_INACTIVITY_STATUS.AGING) &&
    (current === STAGE_INACTIVITY_STATUS.ON_TRACK || current === STAGE_INACTIVITY_STATUS.NOT_APPLICABLE)
  ) {
    return "RECOVERED";
  }
  return "NONE";
}

// Re-exported for convenience so surfaces can build all three SLA layers.
export { humanizeDuration, humanizeHours };
