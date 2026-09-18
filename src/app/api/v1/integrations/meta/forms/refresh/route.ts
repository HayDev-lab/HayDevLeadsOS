// POST /api/v1/integrations/meta/forms/refresh — discover/refresh lead-gen
// forms for one page (or all org pages). NEWLY DISCOVERED FORMS START
// INACTIVE (never auto-activate). Tenant-scoped.
import { getSession, requirePermission } from "@/lib/leados/context";
import { ok, apiError } from "@/lib/leados/api";
import { PERMISSIONS } from "@/lib/leados/auth/permissions";
import { syncForms } from "@/lib/leados/meta-service";

export async function POST(req: Request) {
  try {
    const session = await getSession();
    requirePermission(session, PERMISSIONS.INTEGRATION_MANAGE);
    let pageId: string | undefined;
    try {
      const body = (await req.json()) as { pageId?: string };
      if (typeof body?.pageId === "string" && body.pageId) pageId = body.pageId;
    } catch { /* refresh all pages */ }
    const result = await syncForms(session.orgId, pageId);
    return ok({ ok: true, ...result });
  } catch (e) {
    return apiError("meta-forms-refresh-failed", e);
  }
}
