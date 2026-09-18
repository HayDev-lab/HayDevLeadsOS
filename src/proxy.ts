// SECURITY PROXY (Next.js 16 convention — was middleware.ts; v0.17 spec 94–96).
//
// Authentication itself is enforced INSIDE every route via getSession()
// (DB-validated session + membership) — this middleware adds the two
// request-edge concerns:
//
// 1. CSRF ORIGIN CHECK — mutating requests to /api/v1 with an Origin header
//    must come from our own host (complements the SameSite=Lax cookie; spec 94).
//    Requests WITHOUT Origin (curl, Telegram, workers) pass through and are
//    authenticated by their own mechanisms (session cookie / secrets).
//
// 2. SECURITY HEADERS (spec 96 + v0.20 §13) — nosniff, frame protection,
//    referrer policy, permissions policy, CSP, HSTS in production.
//
//    CSP (v0.20 §13 hardening):
//      • PRODUCTION: per-request NONCE + 'strict-dynamic' — NO 'unsafe-eval',
//        NO 'unsafe-inline' for scripts. The nonce is set on the REQUEST
//        headers (Next.js convention): the framework detects it and stamps
//        its own bootstrap/hydration scripts with the same nonce.
//      • DEV: 'unsafe-inline' + 'unsafe-eval' remain — React Refresh HMR
//        requires them (documented, dev-only relaxation).
//      • style-src keeps 'unsafe-inline' in BOTH modes: React inline style
//        attributes and framework-injected <style> blocks (e.g. chart
//        theming) have no nonce support — documented residual risk, tested
//        by the browser E2E (no style-related CSP errors).
//
// No CORS headers are ever set (spec 95): authenticated APIs are same-origin.

import { NextResponse, type NextRequest } from "next/server";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Endpoints that legitimately accept cross-origin/secret-authenticated calls. */
const ORIGIN_EXEMPT = [
  "/api/v1/integrations/telegram/webhook", // secret-token verified
  "/api/v1/workers/run", // x-workers-secret verified
  "/api/v1/leads/ingest", // public lead capture (source-token authenticated + DB rate-limited)
  "/api/v1/seed", // first-run demo bootstrap
];

function isOriginAllowed(origin: string, host: string): boolean {
  try {
    const o = new URL(origin);
    if (o.host === host) return true;
    // APP_URL override (e.g. public domain behind the proxy).
    const appUrl = process.env.APP_URL;
    if (appUrl) {
      try {
        if (new URL(appUrl).host === o.host) return true;
      } catch {
        /* ignore malformed APP_URL */
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // --- 1. CSRF origin check (mutating API calls) ---------------------------
  if (MUTATING.has(req.method) && pathname.startsWith("/api/v1") && !ORIGIN_EXEMPT.some((p) => pathname.startsWith(p))) {
    const origin = req.headers.get("origin");
    if (origin && !isOriginAllowed(origin, req.headers.get("host") ?? req.nextUrl.host)) {
      return NextResponse.json(
        { error: "Cross-origin request rejected" },
        { status: 403 }
      );
    }
  }

  // --- 2. Security headers --------------------------------------------------
  const isProduction = process.env.NODE_ENV === "production";
  // v0.20 §13: fresh per-request nonce (hex — valid base64url chars).
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = isProduction
    ? [
        "default-src 'self'",
        // NONCE-based: no unsafe-inline, no unsafe-eval in production.
        // 'strict-dynamic' lets nonce'd loaders pull their own dependencies.
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ].join("; ")
    : [
        // DEV ONLY: React Refresh requires unsafe-inline + unsafe-eval for
        // its HMR runtime. Never shipped to production (documented §13).
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ].join("; ");

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next.js reads the CSP from the REQUEST headers, extracts the nonce and
  // stamps its own inline bootstrap scripts with it (App Router convention).
  requestHeaders.set("content-security-policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  const headers = res.headers;
  headers.set("Content-Security-Policy", csp);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (isProduction) {
    headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  return res;
}

export const config = {
  matcher: [
    // Everything except Next static internals.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
