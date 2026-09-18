// INVITE ACCEPTANCE (v0.17 spec 30–32, 78–79) — thin HTTP wrapper over
// auth-service.acceptInvite (token-bound, email-bound, expiring, single-use).

import { z } from "zod";
import { ok, badRequest, tooMany, apiError, validate, parseJson } from "@/lib/leados/api";
import { getSessionOrNull } from "@/lib/leados/context";
import { setSessionCookie } from "@/lib/leados/auth/session-store";
import { acceptInvite } from "@/lib/leados/auth/auth-service";
import { actionLimiter, clientIp } from "@/lib/leados/auth/rate-limit";

const AcceptSchema = z.object({
  token: z.string().min(10).max(200),
  name: z.string().min(1).max(120).optional(),
  password: z.string().min(8).max(200).optional(),
});

const FAILURE_MESSAGES: Record<string, string> = {
  INVALID: "Invalid invite link.",
  ALREADY_USED: "This invite was already used.",
  REVOKED: "This invite was revoked.",
  EXPIRED: "This invite has expired.",
  SIGN_IN_REQUIRED: "Sign in with the invited email first, then open this link again.",
  NAME_PASSWORD_REQUIRED: "Name and password are required to create your account.",
  WEAK_PASSWORD: "Password must be at least 8 characters with a letter and a digit.",
};

export async function POST(req: Request) {
  try {
    if (!actionLimiter.checkRateLimit(`invite-accept:${clientIp(req)}`)) {
      return tooMany("Too many attempts. Try again later.");
    }
    const body = await parseJson(req);
    const v = validate(AcceptSchema, body);
    if (!v.ok) return v.error;

    // Existing-user invites require the matching authenticated session.
    const session = await getSessionOrNull();
    const result = await acceptInvite({
      token: v.value.token,
      name: v.value.name,
      password: v.value.password,
      sessionUserId: session?.userId ?? null,
      meta: { ip: clientIp(req), userAgent: req.headers.get("user-agent") },
    });

    if (!result.ok) {
      return badRequest(FAILURE_MESSAGES[result.failure ?? "INVALID"] ?? "Invalid invite link.");
    }
    if (result.issued) {
      await setSessionCookie(result.issued.token, result.issued.expiresAt);
    }
    return ok({
      ok: true,
      joined: !result.alreadyMember,
      alreadyMember: result.alreadyMember ?? false,
      organization: result.organization ? { id: result.organization.id, name: result.organization.name } : undefined,
      userId: result.userId,
    });
  } catch (e) {
    return apiError("invite-accept-failed", e);
  }
}
