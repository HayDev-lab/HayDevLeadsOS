// HAYDEV LEADOS — AUTOMATION ACTION DEFINITIONS (v0.15 + v0.16), PURE module.
//
// The action whitelist: CREATE_TASK, CREATE_NOTIFICATION, SET_LEAD_PRIORITY,
// ASSIGN_LEAD, ADD_NOTE + the EXTERNAL DELIVERY actions added in v0.16 once
// the channel infrastructure existed (spec 64): SEND_EMAIL, SEND_TELEGRAM,
// SEND_WEBHOOK. Everything NOT in this list — custom JS, AI, stage
// auto-transition — stays rejected at validation.
//
// External-action SAFETY (spec 65–66): recipients are ALWAYS resolved users
// (LEAD_OWNER / TASK_ASSIGNEE / EVENT_RECIPIENT / SPECIFIC_USER) — never a
// free-text email/phone string. Webhooks may only target an
// organization-configured endpoint id — never an arbitrary URL inside a rule.
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
  // External delivery (v0.16 spec 64): create a durable NotificationDelivery
  // row — the delivery worker owns the actual send, retries and providers.
  SEND_EMAIL: "SEND_EMAIL",
  SEND_TELEGRAM: "SEND_TELEGRAM",
  SEND_WEBHOOK: "SEND_WEBHOOK",
} as const;
export type AutomationActionType = (typeof AUTOMATION_ACTION)[keyof typeof AUTOMATION_ACTION];

export const AUTOMATION_ACTION_TYPES: AutomationActionType[] = Object.values(AUTOMATION_ACTION);

/** Who an action targets (spec 11/14 + v0.16 spec 65). */
export const ACTION_ASSIGNEE = {
  LEAD_OWNER: "LEAD_OWNER",
  EVENT_RECIPIENT: "EVENT_RECIPIENT",
  TASK_ASSIGNEE: "TASK_ASSIGNEE",
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

/** External delivery actions (v0.16 spec 64–67) — SAFE recipients only. */
export interface SendEmailActionParams {
  subject: string;
  body: string;
  recipient: Extract<
    ActionAssignee,
    "LEAD_OWNER" | "TASK_ASSIGNEE" | "EVENT_RECIPIENT" | "SPECIFIC_USER"
  >;
  userId?: string;
}

export interface SendTelegramActionParams {
  message: string;
  recipient: Extract<
    ActionAssignee,
    "LEAD_OWNER" | "TASK_ASSIGNEE" | "EVENT_RECIPIENT" | "SPECIFIC_USER"
  >;
  userId?: string;
}

export interface SendWebhookActionParams {
  /** Organization-configured endpoint ONLY (spec 66) — validated at save AND run time. */
  endpointId: string;
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
  /** Enabled WebhookEndpoint ids of the org (spec 66 — no arbitrary URLs). */
  webhookEndpointIds?: string[];
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
      case AUTOMATION_ACTION.SEND_EMAIL: {
        if (typeof p.subject !== "string" || p.subject.trim().length === 0 || p.subject.length > 200) {
          errors.push(`${prefix} (Send email): subject is required (max 200 chars).`);
        }
        if (typeof p.body !== "string" || p.body.trim().length === 0 || p.body.length > 2000) {
          errors.push(`${prefix} (Send email): body is required (max 2000 chars).`);
        }
        const allowed = [ACTION_ASSIGNEE.LEAD_OWNER, ACTION_ASSIGNEE.TASK_ASSIGNEE, ACTION_ASSIGNEE.EVENT_RECIPIENT, ACTION_ASSIGNEE.SPECIFIC_USER];
        if (!validAssignee(p.recipient, allowed)) {
          errors.push(`${prefix} (Send email): recipient must be LEAD_OWNER, TASK_ASSIGNEE, EVENT_RECIPIENT or SPECIFIC_USER.`);
        } else {
          const err = validateUserRef(p.recipient as ActionAssignee, p.userId, ctx, `${prefix} (Send email)`);
          if (err) errors.push(err);
        }
        break;
      }
      case AUTOMATION_ACTION.SEND_TELEGRAM: {
        if (typeof p.message !== "string" || p.message.trim().length === 0 || p.message.length > 900) {
          errors.push(`${prefix} (Send Telegram): message is required (max 900 chars).`);
        }
        const allowed = [ACTION_ASSIGNEE.LEAD_OWNER, ACTION_ASSIGNEE.TASK_ASSIGNEE, ACTION_ASSIGNEE.EVENT_RECIPIENT, ACTION_ASSIGNEE.SPECIFIC_USER];
        if (!validAssignee(p.recipient, allowed)) {
          errors.push(`${prefix} (Send Telegram): recipient must be LEAD_OWNER, TASK_ASSIGNEE, EVENT_RECIPIENT or SPECIFIC_USER.`);
        } else {
          const err = validateUserRef(p.recipient as ActionAssignee, p.userId, ctx, `${prefix} (Send Telegram)`);
          if (err) errors.push(err);
        }
        break;
      }
      case AUTOMATION_ACTION.SEND_WEBHOOK: {
        if (typeof p.endpointId !== "string" || p.endpointId.length === 0) {
          errors.push(`${prefix} (Send webhook): an organization endpoint must be selected.`);
        } else if (ctx.webhookEndpointIds && !ctx.webhookEndpointIds.includes(p.endpointId)) {
          errors.push(`${prefix} (Send webhook): unknown or disabled endpoint "${p.endpointId}".`);
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
