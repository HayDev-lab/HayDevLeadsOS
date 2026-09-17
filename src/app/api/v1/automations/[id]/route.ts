// GET    /api/v1/automations/:id  — rule detail
// PATCH  /api/v1/automations/:id  — edit rule (OWNER/ADMIN) — also serves the
//                                   enable/pause toggle (spec 34)
// DELETE /api/v1/automations/:id  — soft delete (OWNER/ADMIN, spec 68)
import { NextResponse } from "next/server";
import { getSession, canManage } from "@/lib/leados/context";
import { ok, serverError, forbidden, notFound, parseJson } from "@/lib/leados/api";
import {
  RuleValidationError,
  getAutomationRule,
  updateAutomationRule,
  deleteAutomationRule,
} from "@/lib/leados/automation-rule-service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await getSession();
    const { id } = await ctx.params;
    const rule = await getAutomationRule(session.orgId, id);
    if (!rule) return notFound("automation");
    return ok({ rule });
  } catch (e) {
    return serverError("automation-get-failed", e);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!canManage(session.role)) {
      return forbidden("Only owners and admins can edit automations");
    }
    const { id } = await ctx.params;
    const body = await parseJson(req);
    const rule = await updateAutomationRule(session.orgId, id, session.userId, (body ?? {}) as never);
    return ok({ rule });
  } catch (e) {
    if (e instanceof RuleValidationError) {
      return NextResponse.json({ error: "Validation failed", details: e.errors }, { status: 400 });
    }
    if ((e as Error)?.message === "RULE_NOT_FOUND") return notFound("automation");
    return serverError("automation-update-failed", e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!canManage(session.role)) {
      return forbidden("Only owners and admins can delete automations");
    }
    const { id } = await ctx.params;
    const rule = await deleteAutomationRule(session.orgId, id);
    return ok({ rule });
  } catch (e) {
    if ((e as Error)?.message === "RULE_NOT_FOUND") return notFound("automation");
    return serverError("automation-delete-failed", e);
  }
}
