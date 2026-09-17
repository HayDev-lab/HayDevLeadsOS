// POST /api/v1/automations/:id/dry-run — TEST RULE (spec 36–37).
// Evaluates trigger + conditions + action previews against an existing lead
// (or the newest active lead). Creates NOTHING: no task, no notification,
// no assignment, no execution row.
import { getSession } from "@/lib/leados/context";
import { ok, serverError, notFound, badRequest, parseJson } from "@/lib/leados/api";
import { getAutomationRule } from "@/lib/leados/automation-rule-service";
import { dryRunAutomationRule } from "@/lib/leados/automation-engine";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const session = await getSession();
    const { id } = await ctx.params;
    const rule = await getAutomationRule(session.orgId, id);
    if (!rule) return notFound("automation");
    const body = (await parseJson(req).catch(() => null)) as { leadId?: string } | null;
    if (body && typeof body.leadId === "string" && body.leadId.length === 0) {
      return badRequest("Invalid leadId");
    }
    const result = await dryRunAutomationRule(rule, { leadId: body?.leadId ?? null });
    if (!result.ok) return badRequest(result.error ?? "dry-run-failed");
    return ok({ result: result.result });
  } catch (e) {
    return serverError("automation-dry-run-failed", e);
  }
}
