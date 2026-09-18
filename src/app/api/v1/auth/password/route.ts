// CHANGE OWN PASSWORD (v0.17 spec 23–24): requires the CURRENT password;
// completes by revoking every OTHER session (this one stays signed in).

import { z } from "zod";
import { db } from "@/lib/db";
import { ok, badRequest, apiError, validate, parseJson } from "@/lib/leados/api";
import { getSession } from "@/lib/leados/context";
import { hashPassword, verifyPassword, validatePasswordPolicy } from "@/lib/leados/auth/password";
import { recordAudit, requestMeta, AUDIT_ACTIONS, AUDIT_ACTOR } from "@/lib/leados/auth/audit";

const ChangeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

export async function POST(req: Request) {
  const meta = requestMeta(req);
  try {
    const session = await getSession();
    const body = await parseJson(req);
    const v = validate(ChangeSchema, body);
    if (!v.ok) return v.error;
    const policy = validatePasswordPolicy(v.value.newPassword);
    if (policy) return badRequest(policy);

    const user = await db.user.findUnique({ where: { id: session.userId } });
    if (!user) return badRequest("Account not found.");
    if (!user.passwordHash) {
      // Demo users have no password — setting one claims the account for login.
      const passwordHash = await hashPassword(v.value.newPassword);
      await db.user.update({ where: { id: user.id }, data: { passwordHash } });
    } else {
      const okCurrent = await verifyPassword(v.value.currentPassword, user.passwordHash);
      if (!okCurrent) return badRequest("Current password is incorrect.");
      if (v.value.currentPassword === v.value.newPassword) {
        return badRequest("New password must differ from the current one.");
      }
      const passwordHash = await hashPassword(v.value.newPassword);
      await db.user.update({ where: { id: user.id }, data: { passwordHash } });
    }

    // Revoke every session EXCEPT the current one.
    const revoked = await db.session.updateMany({
      where: { userId: user.id, revokedAt: null, id: { not: session.sessionId ?? "" } },
      data: { revokedAt: new Date() },
    });

    await recordAudit({
      organizationId: session.orgId,
      actorUserId: user.id,
      actorType: AUDIT_ACTOR.USER,
      action: AUDIT_ACTIONS.PASSWORD_CHANGED,
      resourceType: "user",
      resourceId: user.id,
      metadata: { otherSessionsRevoked: revoked.count },
      ...meta,
    });
    return ok({ ok: true, otherSessionsRevoked: revoked.count });
  } catch (e) {
    return apiError("password-change-failed", e);
  }
}
