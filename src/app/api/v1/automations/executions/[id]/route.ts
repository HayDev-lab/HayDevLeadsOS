// GET  /api/v1/automations/executions/:id — execution detail (spec 51):
// event, conditions trace, actions, result, error, duration.
// POST /api/v1/automations/executions/:id — MANUAL RETRY of a FAILED
// execution (spec 24, 26). SUCCESS is never replayable. OWNER/ADMIN only.
import { getSession, canManage } from "@/lib/leados/context";
import { ok, apiError, forbidden, notFound, badRequest } from "@/lib/leados/api";
import { getAutomationExecution } from "@/lib/leados/automation-rule-service";
import { retryAutomationExecution } from "@/lib/leados/automation-engine";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await getSession();
    const { id } = await ctx.params;
    const execution = await getAutomationExecution(session.orgId, id);
    if (!execution) return notFound("execution");
    return ok({ execution });
  } catch (e) {
    return apiError("automation-execution-get-failed", e);
  }
}

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!canManage(session.role)) {
      return forbidden("Only owners and admins can retry automations");
    }
    const { id } = await ctx.params;
    const result = await retryAutomationExecution(session.orgId, id);
    if (!result.ok) return badRequest(result.error ?? "retry-failed");
    return ok({ execution: result.execution });
  } catch (e) {
    return apiError("automation-retry-failed", e);
  }
}
