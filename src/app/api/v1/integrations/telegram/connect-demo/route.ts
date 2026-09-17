// POST /api/v1/integrations/telegram/connect-demo — DEV/DEMO manual connect
// (v0.16 spec 48 documented limitation): enter the chat id directly. Available
// ONLY while LEADOS_DEMO=true — never in a real deployment.
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError, parseJson } from "@/lib/leados/api";
import { linkTelegramChat } from "@/lib/leados/telegram-service";

export async function POST(req: Request) {
  try {
    if (process.env.LEADOS_DEMO !== "true") {
      return badRequest("Manual chat-id connection is a demo-only flow. Use the bot code flow in production.");
    }
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot connect Telegram");
    const body = (await parseJson(req)) as Record<string, unknown> | null;
    const chatId = typeof body?.chatId === "string" ? body.chatId.trim() : "";
    if (!/^(-?\d{1,16})$/.test(chatId)) return badRequest("chatId must be a numeric Telegram chat id");
    const linked = await linkTelegramChat(session.orgId, session.userId, chatId);
    if (!linked) return badRequest("User not found in this organization");
    return ok({ ok: true, chatId });
  } catch (e) {
    return serverError("telegram-connect-demo-failed", e);
  }
}
