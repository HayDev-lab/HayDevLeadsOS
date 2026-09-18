// POST /api/v1/integrations/meta/connect — start the REAL OAuth flow (v0.19).
// Returns the authorize URL; the browser redirects; the callback exchanges
// the code. Demo deployments (LEADOS_DEMO=true) must use connect-demo.
import { getSession, requirePermission } from "@/lib/leados/context";
import { ok, badRequest, apiError } from "@/lib/leados/api";
import { PERMISSIONS } from "@/lib/leados/auth/permissions";
import { startOAuth } from "@/lib/leados/meta-service";
import { getMetaConfig } from "@/lib/integrations/meta/config";

export async function POST(req: Request) {
  try {
    const session = await getSession();
    requirePermission(session, PERMISSIONS.INTEGRATION_MANAGE);
    const cfg = getMetaConfig();
    if (cfg.demo) return badRequest("Demo mode is on — use the demo connect action");
    let redirectTo: string | undefined;
    try {
      const body = (await req.json()) as { redirectTo?: string };
      if (typeof body?.redirectTo === "string" && body.redirectTo.startsWith("#/")) redirectTo = body.redirectTo;
    } catch { /* no body is fine */ }
    const { authorizeUrl } = await startOAuth(session.orgId, session.userId, redirectTo);
    return ok({ ok: true, authorizeUrl });
  } catch (e) {
    return apiError("meta-connect-failed", e);
  }
}
