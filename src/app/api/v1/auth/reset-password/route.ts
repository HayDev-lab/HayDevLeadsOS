// PASSWORD RESET — complete (v0.17 spec 23): token check (expiry + single
// use) → new password → ALL sessions revoked → user must sign in again.

import { z } from "zod";
import { db } from "@/lib/db";
import { ok, badRequest, tooMany, apiError, validate, parseJson } from "@/lib/leados/api";
import { hashPassword, validatePasswordPolicy } from "@/lib/leados/auth/password";
import { revokeAllUserSessions } from "@/lib/leados/auth/session-store";
import { hashToken } from "@/lib/leados/auth/tokens";
import { actionLimiter, clientIp } from "@/lib/leados/auth/rate-limit";
import { recordAudit, requestMeta, AUDIT_ACTIONS, AUDIT_ACTOR } from "@/lib/leados/auth/audit";

const RESET_SCHEMA = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(8).max(200),
});

export async function POST(req: Request) {
  const meta = requestMeta(req);
  try {
    if (!actionLimiter.checkRateLimit(`reset-complete:${clientIp(req)}`)) {
      return tooMany("Too many attempts. Try again later.");
    }
    const body = await parseJson(req);
    const v = validate(RESET_SCHEMA, body);
    if (!v.ok) return v.error;
    const policy = validatePasswordPolicy(v.value.password);
    if (policy) return badRequest(policy);

    const tokenHash = hashToken(v.value.token);
    const row = await db.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!row) return badRequest("Invalid or expired reset link.");
    if (row.usedAt) return badRequest("This reset link was already used.");
    if (row.expiresAt <= new Date()) return badRequest("This reset link has expired.");

    // Single-use claim (atomic) + password swap.
    const claimed = await db.passwordResetToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) return badRequest("This reset link was already used.");

    const passwordHash = await hashPassword(v.value.password);
    const user = await db.user.update({
      where: { id: row.userId },
      data: { passwordHash },
    });
    const revoked = await revokeAllUserSessions(user.id);

    await recordAudit({
      organizationId: user.organizationId,
      actorUserId: user.id,
      actorType: AUDIT_ACTOR.USER,
      action: AUDIT_ACTIONS.PASSWORD_RESET_COMPLETED,
      resourceType: "user",
      resourceId: user.id,
      metadata: { sessionsRevoked: revoked },
      ...meta,
    });

    return ok({ ok: true, sessionsRevoked: revoked });
  } catch (e) {
    return apiError("reset-password-failed", e);
  }
}
