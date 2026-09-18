// HAYDEV LEADOS — AUTOMATION CONDITION ENGINE (v0.15), PURE module.
//
// Structured WHEN → IF → THEN conditions (spec Sections 6–10):
//   - NO raw code: conditions are structured JSON, never JS.
//   - Field WHITELIST — arbitrary DB field traversal is impossible.
//   - Operator allow-list per field type; enum values validated.
//   - ALL / ANY boolean groups (no infinite nesting in v1).
//   - Evaluation returns a structured TRACE (spec 53) for debugging.
//
// This module has NO imports (no DB, no React) so it is shared by API
// routes, the automation engine, the dry-run preview and unit tests.

import type { DomainEventType } from "./domain-events";

// ---------------------------------------------------------------------------
// Condition DSL types
// ---------------------------------------------------------------------------

export const CONDITION_OPERATOR = {
  EQUALS: "equals",
  NOT_EQUALS: "not_equals",
  IN: "in",
  NOT_IN: "not_in",
  EXISTS: "exists",
  NOT_EXISTS: "not_exists",
  GREATER_THAN: "greater_than",
  LESS_THAN: "less_than",
} as const;
export type ConditionOperator = (typeof CONDITION_OPERATOR)[keyof typeof CONDITION_OPERATOR];

export const CONDITION_MODE = {
  ALL: "all",
  ANY: "any",
} as const;
export type ConditionMode = (typeof CONDITION_MODE)[keyof typeof CONDITION_MODE];

export interface ConditionItem {
  /** Whitelisted field path, e.g. "lead.priority". */
  field: string;
  operator: ConditionOperator;
  /** Value to compare against (not used by exists / not_exists). */
  value?: unknown;
}

/** { all: [...] } | { any: [...] } — one level, no nested trees (spec 8). */
export interface ConditionGroup {
  all?: ConditionItem[];
  any?: ConditionItem[];
}

// ---------------------------------------------------------------------------
// Field whitelist (spec 9) — types + enum domains
// ---------------------------------------------------------------------------

export type ConditionFieldType = "string" | "number" | "enum" | "boolean";

export const PRIORITY_VALUES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export const LEAD_STATUS_VALUES = ["NEW", "OPEN", "CONTACTED", "QUALIFIED", "WON", "LOST", "ARCHIVED"] as const;
export const STAGE_TYPE_VALUES = ["open", "won", "lost"] as const;
export const TASK_STATUS_VALUES = ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
export const DOMAIN_EVENT_VALUES: readonly string[] = [
  "FIRST_RESPONSE_BREACHED",
  "FOLLOW_UP_DUE_SOON",
  "FOLLOW_UP_OVERDUE",
  "STAGE_AGING",
  "STAGE_BECAME_STALE",
  "LEAD_ASSIGNED",
  "TASK_ASSIGNED",
  "TASK_DUE_SOON",
  "TASK_OVERDUE",
];

export interface ConditionFieldDef {
  /** i18n label key for the UI. */
  labelKey: string;
  type: ConditionFieldType;
  /** Allowed operators for this field. */
  operators: ConditionOperator[];
  /** For enum fields: valid values (static list). */
  enumValues?: readonly string[];
  /** For enum fields: values resolved against org data (sourceId / stageId / userId). */
  dynamicRef?: "sourceId" | "stageId" | "userId";
  /** Only available when the automation context contains a task (task-scoped events). */
  requiresTask?: boolean;
}

const STRING_OPS: ConditionOperator[] = [
  CONDITION_OPERATOR.EQUALS,
  CONDITION_OPERATOR.NOT_EQUALS,
  CONDITION_OPERATOR.IN,
  CONDITION_OPERATOR.NOT_IN,
  CONDITION_OPERATOR.EXISTS,
  CONDITION_OPERATOR.NOT_EXISTS,
];
const NUMBER_OPS: ConditionOperator[] = [
  CONDITION_OPERATOR.EQUALS,
  CONDITION_OPERATOR.NOT_EQUALS,
  CONDITION_OPERATOR.GREATER_THAN,
  CONDITION_OPERATOR.LESS_THAN,
  CONDITION_OPERATOR.EXISTS,
  CONDITION_OPERATOR.NOT_EXISTS,
];
const ENUM_OPS: ConditionOperator[] = [
  CONDITION_OPERATOR.EQUALS,
  CONDITION_OPERATOR.NOT_EQUALS,
  CONDITION_OPERATOR.IN,
  CONDITION_OPERATOR.NOT_IN,
];

/**
 * THE whitelist (spec 9). Anything not listed here is rejected at validation
 * time — no arbitrary DB traversal is ever possible.
 */
export const CONDITION_FIELDS: Record<string, ConditionFieldDef> = {
  "lead.priority": { labelKey: "auto.field.lead_priority", type: "enum", enumValues: PRIORITY_VALUES, operators: ENUM_OPS },
  "lead.status": { labelKey: "auto.field.lead_status", type: "enum", enumValues: LEAD_STATUS_VALUES, operators: ENUM_OPS },
  "lead.stageId": { labelKey: "auto.field.lead_stage", type: "enum", dynamicRef: "stageId", operators: ENUM_OPS },
  "lead.stage.type": { labelKey: "auto.field.lead_stage_type", type: "enum", enumValues: STAGE_TYPE_VALUES, operators: ENUM_OPS },
  "lead.source": { labelKey: "auto.field.lead_source", type: "enum", dynamicRef: "sourceId", operators: ENUM_OPS },
  "lead.ownerId": { labelKey: "auto.field.lead_owner", type: "string", operators: STRING_OPS },
  "lead.estimatedValue": { labelKey: "auto.field.lead_value", type: "number", operators: NUMBER_OPS },
  "lead.leadScore": { labelKey: "auto.field.lead_score", type: "number", operators: NUMBER_OPS },
  "event.type": { labelKey: "auto.field.event_type", type: "enum", enumValues: DOMAIN_EVENT_VALUES, operators: ENUM_OPS },
  "event.payload.overdueMinutes": { labelKey: "auto.field.overdue_minutes", type: "number", operators: NUMBER_OPS },
  "event.payload.remainingMinutes": { labelKey: "auto.field.remaining_minutes", type: "number", operators: NUMBER_OPS },
  "task.assignedTo": { labelKey: "auto.field.task_assignee", type: "string", operators: STRING_OPS, requiresTask: true },
  "task.status": { labelKey: "auto.field.task_status", type: "enum", enumValues: TASK_STATUS_VALUES, operators: ENUM_OPS, requiresTask: true },
};

// ---------------------------------------------------------------------------
// Validation (spec 10) — used at rule SAVE time; invalid rule → HTTP 400.
// ---------------------------------------------------------------------------

export interface ConditionValidationContext {
  /** Org-specific valid values for dynamicRef fields (sourceIds, stageIds, userIds). */
  sourceIds?: string[];
  stageIds?: string[];
  userIds?: string[];
}

export interface ConditionValidationResult {
  ok: boolean;
  errors: string[];
}

function validateValueForField(
  field: string,
  def: ConditionFieldDef,
  operator: ConditionOperator,
  value: unknown,
  ctx: ConditionValidationContext
): string | null {
  if (operator === CONDITION_OPERATOR.EXISTS || operator === CONDITION_OPERATOR.NOT_EXISTS) return null;

  if (def.type === "number") {
    const num = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
    if (!Number.isFinite(num)) return `Field "${field}" requires a numeric value.`;
    return null;
  }

  const oneValue = (v: unknown): string | null => {
    if (typeof v !== "string" || v.length === 0) return `Field "${field}" requires a string value.`;
    if (def.dynamicRef === "sourceId" && ctx.sourceIds && !ctx.sourceIds.includes(v))
      return `Unknown source id: ${v}`;
    if (def.dynamicRef === "stageId" && ctx.stageIds && !ctx.stageIds.includes(v))
      return `Unknown stage id: ${v}`;
    if (def.dynamicRef === "userId" && ctx.userIds && !ctx.userIds.includes(v))
      return `Unknown user id: ${v}`;
    if (def.enumValues && def.dynamicRef == null && !def.enumValues.includes(v))
      return `Invalid value for "${field}": ${v}. Allowed: ${def.enumValues.join(", ")}`;
    return null;
  };

  if (operator === CONDITION_OPERATOR.IN || operator === CONDITION_OPERATOR.NOT_IN) {
    if (!Array.isArray(value) || value.length === 0) return `Operator "${operator}" on "${field}" requires a non-empty array value.`;
    for (const v of value) {
      const err = oneValue(v);
      if (err) return err;
    }
    return null;
  }

  return oneValue(value);
}

export function validateConditionGroup(
  raw: unknown,
  ctx: ConditionValidationContext = {}
): ConditionValidationResult {
  const errors: string[] = [];
  if (raw == null) return { ok: true, errors: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["Conditions must be an object with an \"all\" or \"any\" array."] };
  }
  const group = raw as Record<string, unknown>;
  const modes = Object.keys(group).filter((k) => k === "all" || k === "any");
  if (modes.length === 0) {
    return { ok: false, errors: ["Conditions must contain either \"all\" or \"any\"."] };
  }
  if (modes.length > 1) {
    return { ok: false, errors: ["Conditions cannot mix \"all\" and \"any\" in one group."] };
  }
  const mode = modes[0] as "all" | "any";
  const items = group[mode];
  if (!Array.isArray(items)) {
    return { ok: false, errors: [`"${mode}" must be an array of conditions.`] };
  }
  if (items.length > 10) {
    errors.push("A condition group may contain at most 10 conditions.");
  }
  items.forEach((item, i) => {
    const prefix = `Condition ${i + 1}`;
    if (typeof item !== "object" || item == null || Array.isArray(item)) {
      errors.push(`${prefix}: must be an object.`);
      return;
    }
    const c = item as Record<string, unknown>;
    const field = c.field;
    if (typeof field !== "string" || !(field in CONDITION_FIELDS)) {
      errors.push(`${prefix}: unknown field "${String(field)}".`);
      return;
    }
    const def = CONDITION_FIELDS[field];
    const operator = c.operator;
    if (typeof operator !== "string" || !def.operators.includes(operator as ConditionOperator)) {
      errors.push(`${prefix}: operator "${String(operator)}" is not allowed for field "${field}".`);
      return;
    }
    const valueErr = validateValueForField(field, def, operator as ConditionOperator, c.value, ctx);
    if (valueErr) errors.push(`${prefix}: ${valueErr}`);
  });
  return { ok: errors.length === 0, errors };
}

/** Normalize a raw group into a canonical shape (null when no conditions). */
export function normalizeConditionGroup(raw: unknown): ConditionGroup | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const group = raw as Record<string, unknown>;
  if (Array.isArray(group.all)) return { all: group.all as ConditionItem[] };
  if (Array.isArray(group.any)) return { any: group.any as ConditionItem[] };
  return null;
}

// ---------------------------------------------------------------------------
// Evaluation (spec 7–8, 53) — CURRENT STATE context, structured trace
// ---------------------------------------------------------------------------

/** Flattened CURRENT state the conditions evaluate against (spec 54–55). */
export interface ConditionEvalContext {
  lead?: {
    priority?: string | null;
    status?: string | null;
    stageId?: string | null;
    stageType?: string | null;
    ownerId?: string | null;
    sourceId?: string | null;
    estimatedValue?: number | null;
    leadScore?: number | null;
  } | null;
  event: {
    type: DomainEventType | string;
    payload?: Record<string, unknown>;
  };
  task?: {
    assignedTo?: string | null;
    status?: string | null;
  } | null;
}

export interface ConditionTraceItem {
  field: string;
  operator: ConditionOperator;
  expected: unknown;
  actual: unknown;
  passed: boolean;
}

export interface ConditionEvalResult {
  matched: boolean;
  trace: ConditionTraceItem[];
}

function resolveFieldValue(field: string, ctx: ConditionEvalContext): { ok: boolean; value: unknown } {
  const payload = ctx.event.payload ?? {};
  switch (field) {
    case "lead.priority":
      return { ok: true, value: ctx.lead?.priority ?? null };
    case "lead.status":
      return { ok: true, value: ctx.lead?.status ?? null };
    case "lead.stageId":
      return { ok: true, value: ctx.lead?.stageId ?? null };
    case "lead.stage.type":
      return { ok: true, value: ctx.lead?.stageType ?? null };
    case "lead.source":
      return { ok: true, value: ctx.lead?.sourceId ?? null };
    case "lead.ownerId":
      return { ok: true, value: ctx.lead?.ownerId ?? null };
    case "lead.estimatedValue":
      return { ok: true, value: ctx.lead?.estimatedValue ?? null };
    case "lead.leadScore":
      return { ok: true, value: ctx.lead?.leadScore ?? null };
    case "event.type":
      return { ok: true, value: ctx.event.type };
    case "event.payload.overdueMinutes":
      return { ok: true, value: payload.overdueMinutes ?? null };
    case "event.payload.remainingMinutes":
      return { ok: true, value: payload.remainingMinutes ?? null };
    case "task.assignedTo":
      return { ok: true, value: ctx.task?.assignedTo ?? null };
    case "task.status":
      return { ok: true, value: ctx.task?.status ?? null };
    default:
      return { ok: false, value: null };
  }
}

function isLooseEqual(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) {
    return (a ?? null) === (b ?? null);
  }
  if (typeof a === "number" || typeof b === "number") {
    const na = typeof a === "number" ? a : Number(a);
    const nb = typeof b === "number" ? b : Number(b);
    return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
  }
  return String(a) === String(b);
}

function evaluateItem(item: ConditionItem, ctx: ConditionEvalContext): ConditionTraceItem {
  const def = CONDITION_FIELDS[item.field];
  const resolved = resolveFieldValue(item.field, ctx);
  const actual = resolved.ok ? resolved.value : null;

  let passed = false;
  switch (item.operator) {
    case CONDITION_OPERATOR.EXISTS:
      passed = actual !== null && actual !== undefined && actual !== "" && !(def?.type === "number" && actual === null);
      break;
    case CONDITION_OPERATOR.NOT_EXISTS:
      passed = actual === null || actual === undefined || actual === "";
      break;
    case CONDITION_OPERATOR.EQUALS:
      passed = isLooseEqual(actual, item.value);
      break;
    case CONDITION_OPERATOR.NOT_EQUALS:
      passed = !isLooseEqual(actual, item.value);
      break;
    case CONDITION_OPERATOR.IN:
      passed = Array.isArray(item.value) && item.value.some((v) => isLooseEqual(actual, v));
      break;
    case CONDITION_OPERATOR.NOT_IN:
      passed = Array.isArray(item.value) && !item.value.some((v) => isLooseEqual(actual, v));
      break;
    case CONDITION_OPERATOR.GREATER_THAN: {
      const a = typeof actual === "number" ? actual : Number(actual);
      const b = typeof item.value === "number" ? item.value : Number(item.value);
      passed = Number.isFinite(a) && Number.isFinite(b) && a > b;
      break;
    }
    case CONDITION_OPERATOR.LESS_THAN: {
      const a = typeof actual === "number" ? actual : Number(actual);
      const b = typeof item.value === "number" ? item.value : Number(item.value);
      passed = Number.isFinite(a) && Number.isFinite(b) && a < b;
      break;
    }
    default:
      passed = false;
  }

  return {
    field: item.field,
    operator: item.operator,
    expected: item.operator === CONDITION_OPERATOR.EXISTS || item.operator === CONDITION_OPERATOR.NOT_EXISTS
      ? null
      : item.value ?? null,
    actual,
    passed,
  };
}

/**
 * Evaluate a condition group against CURRENT state. Returns the full trace
 * (spec 53) so SKIPPED executions can explain exactly which field failed.
 * Empty / null groups match everything.
 */
export function evaluateConditionGroup(
  group: ConditionGroup | null,
  ctx: ConditionEvalContext
): ConditionEvalResult {
  if (!group) return { matched: true, trace: [] };
  const items = group.all ?? group.any ?? [];
  if (!items.length) return { matched: true, trace: [] };
  const trace = items.map((item) => evaluateItem(item, ctx));
  const matched = group.all ? trace.every((t) => t.passed) : trace.some((t) => t.passed);
  return { matched, trace };
}

// ---------------------------------------------------------------------------
// Human-readable trace line for UI / history (English snapshot; the UI
// renders localized labels from field/operator i18n keys instead).
// ---------------------------------------------------------------------------

export function traceLine(t: ConditionTraceItem): string {
  if (t.operator === CONDITION_OPERATOR.EXISTS) return `${t.field} exists → ${t.passed ? "pass" : "fail"}`;
  if (t.operator === CONDITION_OPERATOR.NOT_EXISTS) return `${t.field} is empty → ${t.passed ? "pass" : "fail"}`;
  const expected = Array.isArray(t.expected) ? `[${t.expected.join(", ")}]` : String(t.expected);
  const actual = t.actual === null || t.actual === undefined ? "—" : String(t.actual);
  return `${t.field} ${t.operator} ${expected} (actual: ${actual}) → ${t.passed ? "pass" : "fail"}`;
}
