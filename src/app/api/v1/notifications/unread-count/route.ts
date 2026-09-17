// GET /api/v1/notifications/unread-count — server-side unread badge count
// (Section 38: never computed in the browser from a partial list).
import { getSession } from "@/lib/leados/context";
import { ok, serverError } from "@/lib/leados/api";
import { countUnreadNotifications } from "@/lib/leados/notification-service";

export async function GET() {
  try {
    const session = await getSession();
    const count = await countUnreadNotifications(session.orgId, session.userId);
    return ok({ count });
  } catch (e) {
    return serverError("notifications-unread-count-failed", e);
  }
}
