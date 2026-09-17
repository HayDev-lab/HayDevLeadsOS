// POST /api/v1/integrations/telegram/disconnect — clear the linked chat
// (v0.16 spec 92: "Connected as ... / Disconnect").
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError } from "@/lib/leados/api";
import { unlinkTelegram } from "@/lib/leados/telegram-service";

export async function POST() {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot disconnect Telegram");
    await unlinkTelegram(session.orgId, session.userId);
    return ok({ ok: true });
  } catch (e) {
    return serverError("telegram-disconnect-failed", e);
  }
}
