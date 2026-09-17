// HAYDEV LEADOS — AUTOMATION ACTION DEFINITIONS (v0.15), PURE module.
//
// The action whitelist (spec 11–16, 17): CREATE_TASK, CREATE_NOTIFICATION,
// SET_LEAD_PRIORITY, ASSIGN_LEAD, ADD_NOTE. Everything NOT in this list —
// emails, telegrams, webhooks, custom JS, AI, stage auto-transition — is
// explicitly out of scope for v0.15 (spec 16) and rejected at validation.
//
// Structured params only — the user never writes code. Validation happens at
// rule SAVE time (HTTP 400 on invalid) and again defensively before execution.

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

export const AUTOMATION_ACTION = {
  CREATE_TASK: "CREATE_TASK",
  CREATE_NOTIFICATION: "CREATE_NOTIFICATION",
  SET_LEAD_PRIORITY: "SET_LEAD_PRIORITY",
  ASSIGN_LEAD: "ASSIGN_LEAD",
  ADD_NOTE: "ADD_NOTE",
} as const;
export type AutomationActionType = (typeof AUTOMATION_ACTION)[keyof typeof AUTOMATION_ACTION];

export const AUTOMATION_ACTION_TYPES: AutomationActionType[] = Object.values(AUTOMATION_ACTION);

/** Who an action targets (spec 11/14). */
export const ACTION_ASSIGNEE = {
  LEAD_OWNER: "LEAD_OWNER",
  EVENT_RECIPIENT: "EVENT_RECIPIENT",
  SPECIFIC_USER: "SPECIFIC_USER",
  ORGANIZATION_OWNER: "ORGANIZATION_OWNER",
} as const;
export type ActionAssignee = (typeof ACTION_ASSIGNEE)[keyof typeof ACTION_ASSIGNEE];

// ---------------------------------------------------------------------------
// Action shapes (structured params)
// ---------------------------------------------------------------------------

export interface CreateTaskActionParams {
  title: string;
  description?: string;
  dueInHours?: number;
  priority?: string;
  assignTo: ActionAssignee;
  /** Required when assignTo = SPECIFIC_USER. */
  userId?: string;
}

export interface CreateNotificationActionParams {
  message: string;
  recipient: ActionAssignee;
  /** Required when recipient = SPECIFIC_USER. */
  userId?: string;
}

export interface SetLeadPriorityActionParams {
  priority: string;
}

export interface AssignLeadActionParams {
  assignTo: Extract<ActionAssignee, "SPECIFIC_USER" | "ORGANIZATION_OWNER">;
  /** Required when assignTo = SPECIFIC_USER. */
  userId?: string;
}

export interface AddNoteActionParams {
  content: string;
}

export interface AutomationAction {
  type: AutomationActionType;
  params: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Validation (spec 67) — used at save time AND defensively before execution
// ---------------------------------------------------------------------------

export interface ActionValidationContext {
  userIds?: string[];
}

export interface ActionValidationResult {
  ok: boolean;
  errors: string[];
}

const PRIORITY_VALUES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

function validAssignee(v: unknown, allowed: ActionAssignee[]): v is ActionAssignee {
  return typeof v === "string" && (allowed as string[]).includes(v);
}

function validateUserRef(
  who: ActionAssignee | undefined,
  userId: unknown,
  ctx: ActionValidationContext,
  label: string
): string | null {
  if (who !== ACTION_ASSIGNEE.SPECIFIC_USER) return null;
  if (typeof userId !== "string" || userId.length === 0) {
    return `${label}: a specific user must be selected.`;
  }
  if (ctx.userIds && !ctx.userIds.includes(userId)) {
    return `${label}: unknown user "${userId}".`;
  }
  return null;
}

export function validateAutomationActions(raw: unknown, ctx: ActionValidationContext = {}): ActionValidationResult {
  const errors: string[] = [];
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, errors: ["At least one action is required."] };
  }
  if (raw.length > 5) {
    errors.push("A rule may contain at most 5 actions.");
  }
  raw.forEach((item, i) => {
    const prefix = `Action ${i + 1}`;
    if (typeof item !== "object" || item == null || Array.isArray(item)) {
      errors.push(`${prefix}: must be an object.`);
      return;
    }
    const a = item as Record<string, unknown>;
    if (typeof a.type !== "string" || !AUTOMATION_ACTION_TYPES.includes(a.type as AutomationActionType)) {
      errors.push(`${prefix}: unknown action type "${String(a.type)}".`);
      return;
    }
    const p = (a.params ?? {}) as Record<string, unknown>;
    switch (a.type as AutomationActionType) {
      case AUTOMATION_ACTION.CREATE_TASK: {
        if (typeof p.title !== "string" || p.title.trim().length === 0 || p.title.length > 160) {
          errors.push(`${prefix} (Create task): title is required (max 160 chars).`);
        }
        if (p.description != null && (typeof p.description !== "string" || p.description.length > 2000)) {
          errors.push(`${prefix} (Create task): description too long (max 2000 chars).`);
        }
        if (p.dueInHours != null) {
          const h = typeof p.dueInHours === "number" ? p.dueInHours : Number(p.dueInHours);
          if (!Number.isFinite(h) || h <= 0 || h > 24 * 90) {
            errors.push(`${prefix} (Create task): due in hours must be between 0 and 2160.`);
          }
        }
        if (p.priority != null && (!PRIORITY_VALUES.includes(String(p.priority)))) {
          errors.push(`${prefix} (Create task): invalid priority.`);
        }
        if (!validAssignee(p.assignTo, Object.values(ACTION_ASSIGNEE))) {
          errors.push(`${prefix} (Create task): assignTo must be LEAD_OWNER, EVENT_RECIPIENT, SPECIFIC_USER or ORGANIZATION_OWNER.`);
        } else {
          const err = validateUserRef(p.assignTo as ActionAssignee, p.userId, ctx, `${prefix} (Create task)`);
          if (err) errors.push(err);
        }
        break;
      }
      case AUTOMATION_ACTION.CREATE_NOTIFICATION: {
        if (typeof p.message !== "string" || p.message.trim().length === 0 || p.message.length > 500) {
          errors.push(`${prefix} (Notify): message is required (max 500 chars).`);
        }
        if (!validAssignee(p.recipient, Object.values(ACTION_ASSIGNEE))) {
          errors.push(`${prefix} (Notify): recipient must be LEAD_OWNER, EVENT_RECIPIENT, SPECIFIC_USER or ORGANIZATION_OWNER.`);
        } else {
          const err = validateUserRef(p.recipient as ActionAssignee, p.userId, ctx, `${prefix} (Notify)`);
          if (err) errors.push(err);
        }
        break;
      }
      case AUTOMATION_ACTION.SET_LEAD_PRIORITY: {
        if (!PRIORITY_VALUES.includes(String(p.priority))) {
          errors.push(`${prefix} (Set priority): priority must be LOW, MEDIUM, HIGH or URGENT.`);
        }
        break;
      }
      case AUTOMATION_ACTION.ASSIGN_LEAD: {
        if (!validAssignee(p.assignTo, [ACTION_ASSIGNEE.SPECIFIC_USER, ACTION_ASSIGNEE.ORGANIZATION_OWNER])) {
          errors.push(`${prefix} (Assign lead): assignTo must be SPECIFIC_USER or ORGANIZATION_OWNER.`);
        } else {
          const err = validateUserRef(p.assignTo as ActionAssignee, p.userId, ctx, `${prefix} (Assign lead)`);
          if (err) errors.push(err);
        }
        break;
      }
      case AUTOMATION_ACTION.ADD_NOTE: {
        if (typeof p.content !== "string" || p.content.trim().length === 0 || p.content.length > 2000) {
          errors.push(`${prefix} (Add note): content is required (max 2000 chars).`);
        }
        break;
      }
    }
  });
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Interpolation — {leadName} / {stageName} / {eventLabel} placeholders in
// task titles and notification messages (demo template 3 style).
// ---------------------------------------------------------------------------

export function interpolate(text: string, vars: Record<string, string | null | undefined>): string {
  return text.replace(/\{(\w+)\}/g, (m, key: string) => {
    const v = vars[key];
    return v == null || v === "" ? m : v;
  });
}
