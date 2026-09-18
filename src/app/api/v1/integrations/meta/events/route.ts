// GET /api/v1/integrations/meta/events — failed/parked webhook events for
// the UI (v0.19 spec 17). SAFE FIELDS ONLY: error code/time/status/attempts
// — never payloads (PII) and never tokens. Org-scoped.
// POST on ./retry (see retry route) requeues one event manually.
import { getSession, requirePermission } from "@/lib/leados/context";
import { ok, apiError } from "@/lib/leados/api";
import { PERMISSIONS } from "@/lib/leados/auth/permissions";
import { getFailedEvents } from "@/lib/leados/meta-service";

export async function GET() {
  try {
    const session = await getSession();
    requirePermission(session, PERMISSIONS.INTEGRATION_MANAGE);
    const events = await getFailedEvents(session.orgId);
    return ok({ rows: events });
  } catch (e) {
    return apiError("meta-events-failed", e);
  }
}
