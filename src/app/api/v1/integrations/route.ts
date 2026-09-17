// GET /api/v1/integrations — channel availability + connection status
// (v0.16 spec 40, 90–93). Powers the Settings → Integrations cards:
//   email    → REAL | DEMO | UNAVAILABLE (+ configured from-address)
//   telegram → REAL | DEMO | UNAVAILABLE, is the CURRENT user connected
//   webhook  → org endpoints (id/name/enabled only — NEVER the secret, spec 89)
import { db } from "@/lib/db";
import { getSession } from "@/lib/leados/context";
import { ok, serverError } from "@/lib/leados/api";
import { getChannelAvailability } from "@/lib/leados/delivery/providers";

export async function GET() {
  try {
    const session = await getSession();
    const [availability, user, endpoints] = await Promise.all([
      Promise.resolve(getChannelAvailability()),
      db.user.findUnique({
        where: { id: session.userId },
        select: { telegramChatId: true, telegramConnectedAt: true, email: true },
      }),
      db.webhookEndpoint.findMany({
        where: { organizationId: session.orgId },
        select: { id: true, name: true, enabled: true, events: true, lastDeliveryAt: true, lastStatus: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return ok({
      channels: availability,
      telegram: {
        connected: Boolean(user?.telegramChatId),
        connectedAt: user?.telegramConnectedAt ?? null,
      },
      user: { email: user?.email ?? null, id: session.userId },
      webhookEndpoints: endpoints,
      appUrl: process.env.APP_URL ?? null,
    });
  } catch (e) {
    return serverError("integrations-status-failed", e);
  }
}
