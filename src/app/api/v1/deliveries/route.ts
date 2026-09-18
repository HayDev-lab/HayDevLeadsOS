// GET /api/v1/deliveries — external delivery history (v0.16 spec 62).
// Filters: ?status=SENT&channel=EMAIL&limit=50. The response is SAFE for
// managers (channel, status, timestamps); technical details (errorCode,
// attempts, providerMessageId) are OWNER/ADMIN-only — a manager just sees
// "Email: sent / failed" without the provider stack trace (spec 118).
import { db } from "@/lib/db";
import { getSession, canManage } from "@/lib/leados/context";
import { ok, apiError } from "@/lib/leados/api";

const VALID_STATUSES = new Set(["PENDING", "SENDING", "SENT", "FAILED_RETRYABLE", "FAILED", "SKIPPED"]);
const VALID_CHANNELS = new Set(["EMAIL", "TELEGRAM", "WEBHOOK"]);

export async function GET(req: Request) {
  try {
    const session = await getSession();
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const channel = url.searchParams.get("channel");
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 50)));

    const rows = await db.notificationDelivery.findMany({
      where: {
        organizationId: session.orgId,
        ...(status && VALID_STATUSES.has(status) ? { status } : {}),
        ...(channel && VALID_CHANNELS.has(channel) ? { channel } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true, channel: true, status: true, createdAt: true, updatedAt: true,
        sentAt: true, failedAt: true, attemptCount: true, nextAttemptAt: true,
        errorCode: true, errorMessage: true, providerMessageId: true,
        notificationId: true, eventId: true, recipient: true,
        automationExecutionId: true, automationActionIndex: true,
        payload: true,
      },
    });

    const counts = await db.notificationDelivery.groupBy({
      by: ["channel", "status"],
      where: { organizationId: session.orgId },
      _count: { _all: true },
    });

    const technical = canManage(session.role);
    return ok({
      rows: rows.map((r) => ({
        ...r,
        // PAYLOAD SANITIZATION: never leak rendered email/chat content in lists.
        payload: undefined,
        ...(technical
          ? {}
          : { errorCode: null, errorMessage: null, providerMessageId: null, attemptCount: 0, automationExecutionId: null, automationActionIndex: null }),
      })),
      counts: counts.map((c) => ({ channel: c.channel, status: c.status, count: c._count._all })),
      technical,
    });
  } catch (e) {
    return apiError("deliveries-list-failed", e);
  }
}
