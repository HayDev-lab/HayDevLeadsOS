// GET  /api/v1/notifications/preferences — current user's in-app toggles AND
//        external channel matrix (v0.16 spec 38-40).
// PUT  /api/v1/notifications/preferences — validate + save (server 400 on
//        invalid input). Accepts BOTH shapes:
//          { FIRST_RESPONSE_BREACHED: true, ... }                       (types)
//          { types: {...}, channels: { EVENT: {email,telegram} } }     (v0.16)
//        External channels default OFF (spec 98) and toggle availability is
//        governed by channel configuration (Integrations, spec 40).
// v0.17: PERSONAL preferences — user-owned UserNotificationPreference rows
// (moved out of org Settings; migrated losslessly by the backfill script).
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, apiError, parseJson } from "@/lib/leados/api";
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
      getNotificationPreferences(session.userId),
      getChannelPreferences(session.userId),
    ]);
    return ok({ preferences: types, channels });
  } catch (e) {
    return apiError("notification-preferences-get-failed", e);
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

    const saved = await setNotificationPreferences(session.userId, v.prefs!, channels);
    return ok({ ok: true, preferences: saved.types, channels: saved.channels });
  } catch (e) {
    return apiError("notification-preferences-save-failed", e);
  }
}
