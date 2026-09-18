// POST /api/v1/integrations/meta/retry — manual retry of a FAILED webhook
// event (v0.19 spec 8/17). Tenant-scoped: the event must belong to
// session.orgId (forged foreign IDs → 404-equivalent error).
import { getSession, requirePermission } from "@/lib/leados/context";
import { ok, badRequest, apiError } from "@/lib/leados/api";
import { PERMISSIONS } from "@/lib/leados/auth/permissions";
import { retryEvent } from "@/lib/leados/meta-service";

export async function POST(req: Request) {
  try {
    const session = await getSession();
    requirePermission(session, PERMISSIONS.INTEGRATION_MANAGE);
    const body = (await req.json().catch(() => null)) as { eventId?: string } | null;
    if (!body?.eventId) return badRequest("eventId is required");
    await retryEvent(session.orgId, body.eventId);
    return ok({ ok: true });
  } catch (e) {
    return apiError("meta-retry-failed", e);
  }
}
