// GET  /api/v1/automations        — list rules (with metrics) + org summary
// POST /api/v1/automations        — create rule (OWNER/ADMIN only, spec 73/110)
import { NextResponse } from "next/server";
import { getSession, canManage } from "@/lib/leados/context";
import { ok, apiError, forbidden, parseJson } from "@/lib/leados/api";
import {
  RuleValidationError,
  createAutomationRule,
  listAutomationRules,
  automationSummary,
} from "@/lib/leados/automation-rule-service";

export async function GET() {
  try {
    const session = await getSession();
    const [rules, summary] = await Promise.all([
      listAutomationRules(session.orgId),
      automationSummary(session.orgId),
    ]);
    return ok({ rows: rules, summary, canManage: canManage(session.role) });
  } catch (e) {
    return apiError("automations-list-failed", e);
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!canManage(session.role)) {
      return forbidden("Only owners and admins can create automations");
    }
    const body = await parseJson(req);
    const rule = await createAutomationRule(session.orgId, session.userId, (body ?? {}) as never);
    return ok({ rule });
  } catch (e) {
    if (e instanceof RuleValidationError) {
      return NextResponse.json({ error: "Validation failed", details: e.errors }, { status: 400 });
    }
    return apiError("automation-create-failed", e);
  }
}
