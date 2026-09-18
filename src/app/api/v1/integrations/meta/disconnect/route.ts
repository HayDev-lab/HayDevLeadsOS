// POST /api/v1/integrations/meta/disconnect — stop NEW leads and CLEAR token
// material; historical leads, attribution, forms and mappings survive
// (spec 18). Tenant-scoped to session.orgId.
import { getSession, requirePermission } from "@/lib/leados/context";
import { ok, apiError } from "@/lib/leados/api";
import { PERMISSIONS } from "@/lib/leados/auth/permissions";
import { disconnect } from "@/lib/leados/meta-service";

export async function POST() {
  try {
    const session = await getSession();
    requirePermission(session, PERMISSIONS.INTEGRATION_MANAGE);
    await disconnect(session.orgId);
    return ok({ ok: true });
  } catch (e) {
    return apiError("meta-disconnect-failed", e);
  }
}
