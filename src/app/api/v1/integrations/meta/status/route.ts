// GET /api/v1/integrations/meta/status — connection + pages + forms + health
// (v0.19). ORG-SCOPED: org A never sees org B's pages/forms/health. The
// access token is NEVER included (only its derived status).
import { getSession, requirePermission } from "@/lib/leados/context";
import { ok, apiError } from "@/lib/leados/api";
import { PERMISSIONS } from "@/lib/leados/auth/permissions";
import { getStatus, getFailedEvents } from "@/lib/leados/meta-service";

export async function GET() {
  try {
    const session = await getSession();
    requirePermission(session, PERMISSIONS.INTEGRATION_MANAGE);
    const [status, failedEvents] = await Promise.all([
      getStatus(session.orgId),
      getFailedEvents(session.orgId),
    ]);
    return ok({ ...status, failedEvents });
  } catch (e) {
    return apiError("meta-status-failed", e);
  }
}
