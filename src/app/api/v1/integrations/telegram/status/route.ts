// GET /api/v1/integrations/telegram/status — connection state for the
// CURRENT user (v0.16 spec 92). Never exposes the chat id to other users.
import { db } from "@/lib/db";
import { getSession } from "@/lib/leados/context";
import { ok, serverError } from "@/lib/leados/api";
import { getTelegramProvider } from "@/lib/leados/delivery/providers";

export async function GET() {
  try {
    const session = await getSession();
    const [user, provider] = await Promise.all([
      db.user.findUnique({ where: { id: session.userId }, select: { telegramChatId: true, telegramConnectedAt: true } }),
      Promise.resolve(getTelegramProvider()),
    ]);
    return ok({
      mode: provider?.mode ?? "UNAVAILABLE",
      connected: Boolean(user?.telegramChatId),
      connectedAt: user?.telegramConnectedAt ?? null,
      chatIdMasked: user?.telegramChatId ? `${user.telegramChatId.slice(0, 3)}…` : null,
    });
  } catch (e) {
    return serverError("telegram-status-failed", e);
  }
}
