// GET  /api/v1/notifications/preferences — current user's in-app toggles AND
//        external channel matrix (v0.16 spec 38-40).
// PUT  /api/v1/notifications/preferences — validate + save (server 400 on
//        invalid input). Accepts BOTH shapes:
//          { FIRST_RESPONSE_BREACHED: true, ... }                       (types)
//          { types: {...}, channels: { EVENT: {email,telegram} } }     (v0.16)
//        External channels default OFF (spec 98) and toggle availability is
//        governed by channel configuration (Integrations, spec 40).
// User-scoped (Section 55) — persistent User-scoped Setting rows.
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError, parseJson } from "@/lib/leados/api";
import {
  getNotificationPreferences,
  getChannelPreferences,
  setNotificationPreferences,
  isValidPreferenceInput,
  isValidChannelPreferenceInput,
} from "@/lib/leados/notification-service";

export async function GET() {
  try {
    const session = await getSession();
    const [types, channels] = await Promise.all([
      getNotificationPreferences(session.orgId, session.userId),
      getChannelPreferences(session.orgId, session.userId),
    ]);
    return ok({ preferences: types, channels });
  } catch (e) {
    return serverError("notification-preferences-get-failed", e);
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot edit notification preferences");
    const body = (await parseJson(req)) as Record<string, unknown> | null;

    // v0.16 combined shape { types, channels } — or the legacy flat types map.
    const rawTypes = body?.types ?? body;
    const rawChannels = body?.channels ?? null;

    const v = isValidPreferenceInput(rawTypes);
    if (!v.ok) return badRequest(v.errors.join(" "), v.errors);

    let channels;
    if (rawChannels != null) {
      const c = isValidChannelPreferenceInput(rawChannels);
      if (!c.ok) return badRequest(c.errors.join(" "), c.errors);
      channels = c.channels!;
    }

    const saved = await setNotificationPreferences(session.orgId, session.userId, v.prefs!, channels);
    return ok({ ok: true, preferences: saved.types, channels: saved.channels });
  } catch (e) {
    return serverError("notification-preferences-save-failed", e);
  }
}
