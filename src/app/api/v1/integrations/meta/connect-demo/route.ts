// POST /api/v1/integrations/meta/connect-demo — one-click demo connection
// (v0.19, LEADOS_DEMO=true ONLY). Uses the DemoMetaProvider: ZERO calls to
// graph.facebook.com — guaranteed by construction (the demo provider does
// not import the network client). Produces the HayDev Demo Meta Page with
// the three demo forms (Website Development / AI Automation / ERP/CRM leads).
import { getSession, requirePermission } from "@/lib/leados/context";
import { ok, badRequest, apiError } from "@/lib/leados/api";
import { PERMISSIONS } from "@/lib/leados/auth/permissions";
import { connectDemo } from "@/lib/leados/meta-service";
import { getMetaConfig } from "@/lib/integrations/meta/config";

export async function POST() {
  try {
    const session = await getSession();
    requirePermission(session, PERMISSIONS.INTEGRATION_MANAGE);
    if (getMetaConfig().demo !== true) {
      return badRequest("Demo connect requires LEADOS_DEMO=true");
    }
    const status = await connectDemo(session.orgId, session.userId);
    return ok({ ok: true, status });
  } catch (e) {
    return apiError("meta-connect-demo-failed", e);
  }
}
