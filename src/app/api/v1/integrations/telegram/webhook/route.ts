// POST /api/v1/integrations/telegram/webhook — Telegram Bot API webhook
// (v0.16 spec 48 step 3). AUTH: the X-Telegram-Bot-Api-Secret-Token header
// must match TELEGRAM_WEBHOOK_SECRET (set at setWebhook time) — constant-time
// compared. The message text must contain the user's 8-char connect code;
// the backend then links chat id → user and replies in-band.
//
// This is a PUBLIC webhook endpoint (Telegram cannot carry a session) —
// the secret token IS the auth. With no bot configured it 404s harmlessly.
import { timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { ok, unauthorized } from "@/lib/leados/api";
import { consumeTelegramConnectCode } from "@/lib/leados/telegram-service";

interface TelegramUpdate {
  message?: {
    chat: { id: number | string };
    text?: string;
  };
}

function tokenMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

async function replyToBot(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    /* best-effort reply; the link itself already persisted */
  }
}

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || !process.env.TELEGRAM_BOT_TOKEN) {
    return unauthorized("Telegram bot is not configured");
  }
  if (!tokenMatches(req.headers.get("x-telegram-bot-api-secret-token"), secret)) {
    return unauthorized("Invalid secret token");
  }

  const update = (await req.json().catch(() => null)) as TelegramUpdate | null;
  const chat = update?.message?.chat;
  const text = update?.message?.text?.trim();
  if (!chat || !text) return ok({ ok: true }); // not a message update — ack

  // Accept "/start CODE" and bare "CODE".
  const code = text.replace(/^\/start\s+/i, "").trim();
  if (!/^[A-F0-9]{8}$/i.test(code)) {
    await replyToBot(String(chat.id), "Please send your 8-character LeadOS connection code.");
    return ok({ ok: true });
  }

  // Find the org that owns this code (codes are org-scoped Setting rows).
  const orgs = await db.organization.findMany({ select: { id: true } });
  for (const org of orgs) {
    const userId = await consumeTelegramConnectCode(org.id, code);
    if (userId) {
      const { linkTelegramChat } = await import("@/lib/leados/telegram-service");
      const linked = await linkTelegramChat(org.id, userId, String(chat.id));
      await replyToBot(
        String(chat.id),
        linked
          ? "✅ Connected! LeadOS will now send your notifications to this chat."
          : "⚠️ Could not link this code to your LeadOS user."
      );
      return ok({ ok: true, linked });
    }
  }
  await replyToBot(String(chat.id), "⚠️ Unknown or expired code. Generate a new one in LeadOS Settings → Integrations.");
  return ok({ ok: true, linked: false });
}
