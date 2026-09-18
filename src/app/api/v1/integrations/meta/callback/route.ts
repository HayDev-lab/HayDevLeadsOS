// GET /api/v1/integrations/meta/callback — OAuth callback (v0.19).
//
// The state row (created in-session) binds org+user; it is single-use,
// expiring (10 min), and replay-protected via an atomic claim. On success
// the browser lands on Settings → Lead Sources → Meta.
//
// NOTE: the callback is PUBLIC (Meta redirects here with code+state) — the
// STATE is the authority, not the session cookie. A state from org A can
// never mutate org B: the connection written is exactly the state's org.
import { NextResponse } from "next/server";
import { handleOAuthCallback } from "@/lib/leados/meta-service";
import { MetaError } from "@/lib/integrations/meta/errors";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const base = new URL(req.url).origin;
  if (errorParam || !code || !state) {
    return NextResponse.redirect(`${base}/#/settings?metaError=oauth_denied`);
  }
  try {
    const { redirectTo } = await handleOAuthCallback(code, state);
    const target = redirectTo?.startsWith("#/") ? redirectTo : "#/settings";
    return NextResponse.redirect(`${base}/${target}`);
  } catch (e) {
    const code2 = e instanceof MetaError ? e.code : "oauth_failed";
    return NextResponse.redirect(`${base}/#/settings?metaError=${encodeURIComponent(code2)}`);
  }
}
