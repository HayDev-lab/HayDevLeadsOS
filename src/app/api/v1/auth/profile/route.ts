// PERSONAL PROFILE (v0.17 spec 47, 48–50): name, personal locale (drives
// delivery rendering), personal timezone. Own account only.

import { z } from "zod";
import { db } from "@/lib/db";
import { ok, badRequest, apiError, validate, parseJson } from "@/lib/leados/api";
import { getSession } from "@/lib/leados/context";
import { recordAudit, requestMeta, AUDIT_ACTIONS, AUDIT_ACTOR } from "@/lib/leados/auth/audit";
import { LOCALES } from "@/lib/leados/constants";

const ProfileSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  locale: z.enum(LOCALES).optional(),
  timezone: z.string().min(1).max(64).optional(),
});

export async function GET() {
  try {
    const session = await getSession();
    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: { id: true, name: true, email: true, locale: true, timezone: true, title: true, phone: true },
    });
    return ok({ user });
  } catch (e) {
    return apiError("profile-get-failed", e);
  }
}

export async function PUT(req: Request) {
  const meta = requestMeta(req);
  try {
    const session = await getSession();
    const body = await parseJson(req);
    const v = validate(ProfileSchema, body);
    if (!v.ok) return v.error;
    if (!v.value.name && !v.value.locale && !v.value.timezone) {
      return badRequest("Nothing to update.");
    }
    const user = await db.user.update({
      where: { id: session.userId },
      data: {
        ...(v.value.name != null ? { name: v.value.name } : {}),
        ...(v.value.locale != null ? { locale: v.value.locale } : {}),
        ...(v.value.timezone != null ? { timezone: v.value.timezone } : {}),
      },
    });
    await recordAudit({
      organizationId: session.orgId,
      actorUserId: user.id,
      actorType: AUDIT_ACTOR.USER,
      action: AUDIT_ACTIONS.ORG_SETTINGS_CHANGED,
      resourceType: "user-profile",
      resourceId: user.id,
      metadata: { updated: Object.keys(v.value) },
      ...meta,
    });
    return ok({ ok: true, user: { name: user.name, locale: user.locale, timezone: user.timezone } });
  } catch (e) {
    return apiError("profile-update-failed", e);
  }
}
