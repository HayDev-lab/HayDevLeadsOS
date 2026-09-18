// POST /api/v1/integrations/meta/test-lead — send a DEMO Meta lead through
// the REAL processing contract (v0.19 spec 15/19):
//   demo provider sendDemoLead → persistLeadgenEvents (durable, unique
//   leadgenId) → worker → demo getLead → mapper → canonical ingestLead() →
//   Lead → LEAD_INGESTED → SLA/Automation/Notification.
// NO db.lead.create() here — the chain is the same as production webhooks.
// Requires demo mode; in REAL mode use the actual Meta Test Lead tool.
import { getSession, requirePermission } from "@/lib/leados/context";
import { ok, badRequest, apiError } from "@/lib/leados/api";
import { PERMISSIONS } from "@/lib/leados/auth/permissions";
import { sendDemoLead } from "@/lib/leados/meta-worker";
import { runMetaLeadWorker } from "@/lib/leados/meta-worker";

export async function POST(req: Request) {
  try {
    const session = await getSession();
    requirePermission(session, PERMISSIONS.INTEGRATION_MANAGE);
    let formId: string | undefined;
    let overrides: Record<string, string> | undefined;
    try {
      const body = (await req.json()) as { formId?: string; overrides?: Record<string, string> };
      if (typeof body?.formId === "string" && body.formId) formId = body.formId;
      if (body?.overrides && typeof body.overrides === "object") overrides = body.overrides;
    } catch { /* defaults below */ }
    if (!formId) return badRequest("formId is required (pick a connected demo form)");

    const sent = await sendDemoLead(session.orgId, formId, overrides);
    // Process immediately (demo UX) — same worker code path as the scheduler.
    const workerResult = await runMetaLeadWorker({ maxRunMs: 8_000 });
    return ok({
      ok: true,
      leadgenId: sent.leadgenId,
      persisted: sent.persisted,
      duplicates: sent.duplicates,
      worker: workerResult,
    });
  } catch (e) {
    return apiError("meta-test-lead-failed", e);
  }
}
