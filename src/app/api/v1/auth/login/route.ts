// LOGIN (v0.17 spec 19–22, 100) — thin HTTP wrapper over auth-service.
// Business logic (rate limits, lockout, audit, session rotation) is testable
// in auth-service.ts; this route only does parsing + cookie plumbing.

import { NextResponse } from "next/server";
import { z } from "zod";
import { ok, unauthorized, tooMany, apiError, validate, parseJson } from "@/lib/leados/api";
import { setSessionCookie } from "@/lib/leados/auth/session-store";
import { performLogin } from "@/lib/leados/auth/auth-service";
import { clientIp } from "@/lib/leados/auth/rate-limit";

const LoginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  try {
    const body = await parseJson(req);
    const v = validate(LoginSchema, body);
    if (!v.ok) return v.error;

    const result = await performLogin(v.value.email, v.value.password, {
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    if (!result.ok) {
      if (result.failure === "RATE_LIMITED") {
        return tooMany("Too many login attempts. Please wait a minute.");
      }
      if (result.failure === "LOCKED") {
        return tooMany("Too many failed attempts. Try again later.", result.retryAfterSec);
      }
      if (result.failure === "NO_ORGANIZATION") {
        // Account exists but belongs to no organization (e.g. removed from
        // the only org) — a clear 403 instead of a session that 401s.
        return NextResponse.json(
          { error: "Your account is not a member of any organization. Ask for a new invite." },
          { status: 403 }
        );
      }
      // ENUMERATION-SAFE (spec 22): identical error for wrong email/password.
      return unauthorized("Invalid email or password");
    }

    await setSessionCookie(result.issued!.token, result.issued!.expiresAt);
    return ok({
      ok: true,
      user: { id: result.user!.id, name: result.user!.name, email: result.user!.email, role: result.user!.role },
      organizationId: result.user!.organizationId,
    });
  } catch (e) {
    return apiError("login-failed", e);
  }
}
