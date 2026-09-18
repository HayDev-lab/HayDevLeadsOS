// POST /api/v1/integrations/meta/connect — start the REAL OAuth flow (v0.19).
// Returns the authorize URL; the browser redirects; the callback exchanges
// the code. Demo deployments (LEADOS_DEMO=true) must use connect-demo.
// v0.19.1: unconfigured real OAuth → explicit 503 blocker listing the exact
// missing env vars (spec: report the blocker — NEVER fake success).
import { NextResponse } from "next/server";
import { getSession, requirePermission } from "@/lib/leados/context";
import { ok, badRequest, apiError } from "@/lib/leados/api";
import { PERMISSIONS } from "@/lib/leados/auth/permissions";
import { startOAuth } from "@/lib/leados/meta-service";
import { getMetaConfig, oauthConfigured } from "@/lib/integrations/meta/config";

export async function POST(req: Request) {
  try {
    const session = await getSession();
    requirePermission(session, PERMISSIONS.INTEGRATION_MANAGE);
    const cfg = getMetaConfig();
    if (cfg.demo) return badRequest("Demo mode is on — use the demo connect action");
    // Explicit, actionable blocker when real Meta credentials are absent.
    if (!oauthConfigured(cfg)) {
      return NextResponse.json(
        {
          error: "meta-not-configured",
          code: "META_CONFIG_ERROR",
          message:
            "Meta OAuth is not configured on this deployment. Set META_APP_ID, META_APP_SECRET and META_REDIRECT_URI (see .env.example), then retry Connect Meta.",
          requiredEnv: ["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI"],
        },
        { status: 503 }
      );
    }
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
