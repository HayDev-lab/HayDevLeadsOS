// GET  /api/v1/notifications/preferences — current user's delivery toggles
// PUT  /api/v1/notifications/preferences — validate + save (server 400 on
//        invalid input). User-scoped (Section 55) — a persistent User model
//        exists, so preferences are per-user Setting rows.
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError, parseJson } from "@/lib/leados/api";
import {
  getNotificationPreferences,
  isValidPreferenceInput,
  setNotificationPreferences,
} from "@/lib/leados/notification-service";

export async function GET() {
  try {
    const session = await getSession();
    const prefs = await getNotificationPreferences(session.orgId, session.userId);
    return ok({ preferences: prefs });
  } catch (e) {
    return serverError("notification-preferences-get-failed", e);
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot edit notification preferences");
    const body = await parseJson(req);
    const v = isValidPreferenceInput(body);
    if (!v.ok) return badRequest(v.errors.join(" "), v.errors);
    const prefs = await setNotificationPreferences(session.orgId, session.userId, v.prefs!);
    return ok({ ok: true, preferences: prefs });
  } catch (e) {
    return serverError("notification-preferences-save-failed", e);
  }
}
