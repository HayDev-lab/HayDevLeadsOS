// POST /api/v1/notifications/mark-all-read — mark ALL read for the CURRENT
// recipient only (Section 69: never the whole organization).
import { getSession } from "@/lib/leados/context";
import { ok, apiError } from "@/lib/leados/api";
import { markAllNotificationsRead } from "@/lib/leados/notification-service";

export async function POST() {
  try {
    const session = await getSession();
    const count = await markAllNotificationsRead(session.orgId, session.userId);
    return ok({ ok: true, count });
  } catch (e) {
    return apiError("notifications-mark-all-failed", e);
  }
}
