// POST /api/v1/integrations/meta/pages/repair — re-subscribe a page to the
// leadgen webhook and CONFIRM the state through the provider where supported
// (spec 13). Tenant-scoped: the page must belong to session.orgId.
import { getSession, requirePermission } from "@/lib/leados/context";
import { ok, badRequest, apiError } from "@/lib/leados/api";
import { PERMISSIONS } from "@/lib/leados/auth/permissions";
import { repairSubscription } from "@/lib/leados/meta-service";

export async function POST(req: Request) {
  try {
    const session = await getSession();
    requirePermission(session, PERMISSIONS.INTEGRATION_MANAGE);
    const body = (await req.json().catch(() => null)) as { pageId?: string } | null;
    if (!body?.pageId) return badRequest("pageId is required");
    const result = await repairSubscription(session.orgId, body.pageId);
    return ok({ ok: true, ...result });
  } catch (e) {
    return apiError("meta-repair-failed", e);
  }
}
