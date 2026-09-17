// POST /api/v1/events/reconcile — protected, tenant-scoped reconciliation
// trigger (spec Section 23, Option B). Idempotent: safe to call repeatedly
// and concurrently — the deterministic dedup keys + DB unique constraints
// guarantee zero duplicate events/notifications.
//
// Background execution note: there is no production scheduler in this
// deployment, so the app triggers this endpoint on load and every 5 minutes
// while open (client tick) — plus this endpoint works as the manual/dev
// runner target. A real cron/worker can call it unchanged later.
import { getSession } from "@/lib/leados/context";
import { ok, apiError } from "@/lib/leados/api";
import { runEventReconciliation } from "@/lib/leados/event-reconciler";

export async function POST() {
  try {
    const session = await getSession();
    const summary = await runEventReconciliation(session.orgId);
    return ok({ ok: true, summary });
  } catch (e) {
    return apiError("event-reconciliation-failed", e);
  }
}
