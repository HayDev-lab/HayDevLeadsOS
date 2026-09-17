// POST /api/v1/integrations/telegram/connect — issue a connection code
// (v0.16 spec 48 step 1). The user then sends the code to the bot; the
// webhook links the chat. No secret ever travels to the client.
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError } from "@/lib/leados/api";
import { issueTelegramConnectCode } from "@/lib/leados/telegram-service";

export async function POST() {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot connect Telegram");
    const code = await issueTelegramConnectCode(session.orgId, session.userId);
    return ok({
      ok: true,
      code: code.code,
      expiresAt: code.expiresAt,
      instructions: "Send this code as a message to the LeadOS bot in Telegram.",
      botUsername: process.env.TELEGRAM_BOT_USERNAME ?? null,
    });
  } catch (e) {
    return serverError("telegram-connect-failed", e);
  }
}
