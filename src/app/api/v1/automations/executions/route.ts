// GET /api/v1/automations/executions — org-wide execution history (spec 50).
// Filters: ?ruleId=&status=&page=&limit= — Members may view history (spec 73).
import { getSession } from "@/lib/leados/context";
import { ok, serverError } from "@/lib/leados/api";
import { listAutomationExecutions } from "@/lib/leados/automation-rule-service";

export async function GET(req: Request) {
  try {
    const session = await getSession();
    const url = new URL(req.url);
    const ruleId = url.searchParams.get("ruleId");
    const status = url.searchParams.get("status");
    const page = parseInt(url.searchParams.get("page") ?? "1", 10) || 1;
    const limit = parseInt(url.searchParams.get("limit") ?? "20", 10) || 20;
    const result = await listAutomationExecutions(session.orgId, {
      ruleId: ruleId || undefined,
      status: status || undefined,
      page,
      limit,
    });
    return ok(result);
  } catch (e) {
    return serverError("automations-executions-failed", e);
  }
}
