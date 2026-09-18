// GET /api/v1/notifications/:id/deliveries — per-channel delivery status for
// ONE notification (v0.16 spec 62): "In-app delivered · Email sent · Telegram
// failed". The recipient identity comes from the session — a manager sees the
// channel outcomes; technical errorCode details stay OWNER/ADMIN-only (118).
import { db } from "@/lib/db";
import { getSession, canManage } from "@/lib/leados/context";
import { ok, notFound, apiError } from "@/lib/leados/api";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await ctx.params;
    const notification = await db.notification.findFirst({
      where: { id, organizationId: session.orgId },
      select: { id: true, userId: true },
    });
    if (!notification) return notFound("Notification not found");

    const rows = await db.notificationDelivery.findMany({
      where: {
        notificationId: id,
        // TENANT + RECIPIENT SAFETY (spec 102-103): only the user's own
        // deliveries, always inside the caller's org.
        organizationId: session.orgId,
        recipient: session.userId,
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, channel: true, status: true, sentAt: true, failedAt: true,
        attemptCount: true, errorCode: true, errorMessage: true, createdAt: true,
      },
    });
    const technical = canManage(session.role);
    return ok({
      rows: rows.map((r) => (technical ? r : { ...r, errorCode: null, errorMessage: null, attemptCount: 0 })),
      technical,
    });
  } catch (e) {
    return apiError("notification-deliveries-failed", e);
  }
}
