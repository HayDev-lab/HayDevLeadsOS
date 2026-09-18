// LOGOUT (v0.17 spec 24): revoke the current session, or every session of
// the authenticated user (logout everywhere).

import { z } from "zod";
import { ok, apiError, validate, parseJson } from "@/lib/leados/api";
import { getSessionOrNull } from "@/lib/leados/context";
import {
  readSessionCookie,
  revokeSessionToken,
  revokeAllUserSessions,
  clearSessionCookie,
} from "@/lib/leados/auth/session-store";
import { recordAudit, requestMeta, AUDIT_ACTIONS, AUDIT_ACTOR } from "@/lib/leados/auth/audit";

const LogoutSchema = z.object({ all: z.boolean().optional() });

export async function POST(req: Request) {
  const meta = requestMeta(req);
  try {
    const body = await parseJson(req);
    const v = validate(LogoutSchema, body);
    const token = await readSessionCookie();
    const session = await getSessionOrNull();
    let revoked = 0;

    if (v.ok && v.value.all && session?.authenticated) {
      revoked = await revokeAllUserSessions(session.userId);
    } else if (token) {
      revoked = (await revokeSessionToken(token)) ? 1 : 0;
    }
    await clearSessionCookie();

    if (session?.authenticated) {
      await recordAudit({
        organizationId: session.orgId,
        actorUserId: session.userId,
        actorType: AUDIT_ACTOR.USER,
        action: v.ok && v.value.all ? AUDIT_ACTIONS.LOGOUT_ALL : AUDIT_ACTIONS.LOGOUT,
        resourceType: "session",
        metadata: { revoked },
        ...meta,
      });
    }
    return ok({ ok: true, revoked });
  } catch (e) {
    return apiError("logout-failed", e);
  }
}
