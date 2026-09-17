import { NextResponse } from "next/server";
import { getSession } from "@/lib/leados/context";
import { ok, badRequest, serverError, parseJson } from "@/lib/leados/api";
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  recentNotifications,
  type NotificationFilter,
} from "@/lib/leados/notification-service";

/**
 * GET /api/v1/notifications
 *   ?filter=all|unread|critical|resolved  (default: all)
 *   ?page=1&limit=20                      (server pagination — Section 73)
 *   ?recent=8                             (bell popover shortcut, last N)
 * Always tenant-scoped + recipient-scoped (session user + org broadcasts).
 */
export async function GET(req: Request) {
  try {
    const session = await getSession();
    const url = new URL(req.url);
    const filterRaw = url.searchParams.get("filter") ?? "all";
    const filter: NotificationFilter = (["all", "unread", "critical", "resolved"] as const).includes(
      filterRaw as NotificationFilter
    )
      ? (filterRaw as NotificationFilter)
      : "all";

    if (url.searchParams.get("recent")) {
      const take = Math.min(20, Math.max(1, Number(url.searchParams.get("recent")) || 8));
      const [rows, unread] = await Promise.all([
        recentNotifications(session.orgId, session.userId, take),
        countUnreadNotifications(session.orgId, session.userId),
      ]);
      return ok({ rows, unread, total: rows.length, page: 1, limit: take, pages: 1 });
    }

    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
    const result = await listNotifications(session.orgId, session.userId, { filter, page, limit });
    return ok(result);
  } catch (e) {
    return serverError("notifications-list-failed", e);
  }
}

/**
 * PATCH /api/v1/notifications — legacy-compatible read marking:
 *   { all: true }               → mark all read (current recipient only)
 *   { id: "<notification id>" } → mark one read
 * The canonical endpoints are POST /notifications/mark-all-read and
 * PATCH /notifications/:id/read; this one stays for backward compatibility.
 */
export async function PATCH(req: Request) {
  try {
    const session = await getSession();
    const body = await parseJson(req);
    const { id, all } = (body ?? {}) as { id?: string; all?: boolean };
    if (all) {
      const count = await markAllNotificationsRead(session.orgId, session.userId);
      return ok({ ok: true, count });
    }
    if (!id) return badRequest("id-required");
    const marked = await markNotificationRead(session.orgId, session.userId, id);
    return ok({ ok: marked });
  } catch (e) {
    return serverError("notification-update-failed", e);
  }
}
