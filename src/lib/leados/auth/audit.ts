// SECURITY AUDIT LOG SERVICE (v0.17 spec 52–55).
//
// Append-only trail for security-sensitive events, separate from Lead
// Activity. Insertion is best-effort: an audit failure must never break the
// business operation — it is logged to the server console instead.
//
// Actors are typed (spec 39–41): USER, AUTOMATION, WORKER, SYSTEM, ANONYMOUS.
// Workers/automations are NEVER fake users — they act under their own
// actorType with actorUserId null.

import { db } from "@/lib/db";

export const AUDIT_ACTOR = {
  USER: "USER",
  AUTOMATION: "AUTOMATION",
  WORKER: "WORKER",
  SYSTEM: "SYSTEM",
  ANONYMOUS: "ANONYMOUS",
} as const;
export type AuditActorType = (typeof AUDIT_ACTOR)[keyof typeof AUDIT_ACTOR];

export const AUDIT_ACTIONS = {
  LOGIN_SUCCESS: "LOGIN_SUCCESS",
  LOGIN_FAILED: "LOGIN_FAILED",
  LOGIN_LOCKED: "LOGIN_LOCKED",
  LOGOUT: "LOGOUT",
  LOGOUT_ALL: "LOGOUT_ALL",
  PASSWORD_SET: "PASSWORD_SET",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
  PASSWORD_RESET_REQUESTED: "PASSWORD_RESET_REQUESTED",
  PASSWORD_RESET_COMPLETED: "PASSWORD_RESET_COMPLETED",
  BOOTSTRAP_COMPLETED: "BOOTSTRAP_COMPLETED",
  ORG_SWITCHED: "ORG_SWITCHED",
  MEMBER_INVITED: "MEMBER_INVITED",
  INVITE_RESENT: "INVITE_RESENT",
  INVITE_REVOKED: "INVITE_REVOKED",
  INVITE_ACCEPTED: "INVITE_ACCEPTED",
  MEMBER_ROLE_CHANGED: "MEMBER_ROLE_CHANGED",
  MEMBER_REMOVED: "MEMBER_REMOVED",
  AUTOMATION_CREATED: "AUTOMATION_CREATED",
  AUTOMATION_UPDATED: "AUTOMATION_UPDATED",
  AUTOMATION_ENABLED: "AUTOMATION_ENABLED",
  AUTOMATION_DISABLED: "AUTOMATION_DISABLED",
  AUTOMATION_DELETED: "AUTOMATION_DELETED",
  INTEGRATION_CHANGED: "INTEGRATION_CHANGED",
  WEBHOOK_CREATED: "WEBHOOK_CREATED",
  WEBHOOK_UPDATED: "WEBHOOK_UPDATED",
  WEBHOOK_DELETED: "WEBHOOK_DELETED",
  WEBHOOK_SECRET_ROTATED: "WEBHOOK_SECRET_ROTATED",
  ORG_SETTINGS_CHANGED: "ORG_SETTINGS_CHANGED",
} as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditInput {
  organizationId?: string | null;
  actorUserId?: string | null;
  actorType: AuditActorType;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        organizationId: input.organizationId ?? null,
        actorUserId: input.actorUserId ?? null,
        actorType: input.actorType,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        metadata: (input.metadata ?? undefined) as never,
        ip: input.ip ?? null,
        userAgent: input.userAgent ? input.userAgent.slice(0, 300) : null,
      },
    });
  } catch (e) {
    console.error("[LEADOS][AUDIT] failed to record", input.action, e);
  }
}

/** Standard request metadata for audit rows issued from route handlers. */
export function requestMeta(req: Request): { ip: string; userAgent: string | null } {
  const fwd = req.headers.get("x-forwarded-for");
  return {
    ip: (fwd ? fwd.split(",")[0].trim() : null) ?? req.headers.get("x-real-ip") ?? "unknown",
    userAgent: req.headers.get("user-agent"),
  };
}
