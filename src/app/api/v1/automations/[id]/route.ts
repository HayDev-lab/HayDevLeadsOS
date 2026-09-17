// GET    /api/v1/automations/:id  — rule detail
// PATCH  /api/v1/automations/:id  — edit rule (OWNER/ADMIN) — also serves the
//                                   enable/pause toggle (spec 34); audited
// DELETE /api/v1/automations/:id  — soft delete (OWNER/ADMIN, spec 68); audited
import { NextResponse } from "next/server";
import { getSession, canManage } from "@/lib/leados/context";
import { ok, apiError, forbidden, notFound, parseJson } from "@/lib/leados/api";
import {
  RuleValidationError,
  getAutomationRule,
  updateAutomationRule,
  deleteAutomationRule,
} from "@/lib/leados/automation-rule-service";
import { recordAudit, requestMeta, AUDIT_ACTIONS, AUDIT_ACTOR } from "@/lib/leados/auth/audit";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await getSession();
    const { id } = await ctx.params;
    const rule = await getAutomationRule(session.orgId, id);
    if (!rule) return notFound("automation");
    return ok({ rule });
  } catch (e) {
    return apiError("automation-get-failed", e);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const meta = requestMeta(req);
  try {
    const session = await getSession();
    if (!canManage(session.role)) {
      return forbidden("Only owners and admins can edit automations");
    }
    const { id } = await ctx.params;
    const body = (await parseJson(req)) as Record<string, unknown> | null;
    const before = await getAutomationRule(session.orgId, id);
    const rule = await updateAutomationRule(session.orgId, id, session.userId, (body ?? {}) as never);
    // v0.17 audit (spec 52): enable/disable are security-relevant.
    const enabledChanged = typeof body?.enabled === "boolean" && before?.enabled !== body.enabled;
    await recordAudit({
      organizationId: session.orgId,
      actorUserId: session.userId,
      actorType: AUDIT_ACTOR.USER,
      action: enabledChanged ? (body.enabled ? AUDIT_ACTIONS.AUTOMATION_ENABLED : AUDIT_ACTIONS.AUTOMATION_DISABLED) : AUDIT_ACTIONS.AUTOMATION_UPDATED,
      resourceType: "automation",
      resourceId: id,
      metadata: { name: rule.name, enabled: rule.enabled },
      ...meta,
    });
    return ok({ rule });
  } catch (e) {
    if (e instanceof RuleValidationError) {
      return NextResponse.json({ error: "Validation failed", details: e.errors }, { status: 400 });
    }
    if ((e as Error)?.message === "RULE_NOT_FOUND") return notFound("automation");
    return apiError("automation-update-failed", e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const meta = requestMeta(_req);
  try {
    const session = await getSession();
    if (!canManage(session.role)) {
      return forbidden("Only owners and admins can delete automations");
    }
    const { id } = await ctx.params;
    const rule = await deleteAutomationRule(session.orgId, id);
    await recordAudit({
      organizationId: session.orgId,
      actorUserId: session.userId,
      actorType: AUDIT_ACTOR.USER,
      action: AUDIT_ACTIONS.AUTOMATION_DELETED,
      resourceType: "automation",
      resourceId: id,
      metadata: { name: rule.name },
      ...meta,
    });
    return ok({ rule });
  } catch (e) {
    if ((e as Error)?.message === "RULE_NOT_FOUND") return notFound("automation");
    return apiError("automation-delete-failed", e);
  }
}
