// HAYDEV LEADOS — TELEGRAM INTEGRATION SERVICE (v0.16 spec 46–49, 92).
//
// CONNECT FLOW (spec 48):
//   1. POST /integrations/telegram/connect → a 6-char CODE bound to the user
//      (Setting row, 10-minute TTL);
//   2. the user sends the code to the bot in Telegram;
//   3. Telegram calls POST /integrations/telegram/webhook (verified by the
//      X-Telegram-Bot-Api-Secret-Token header) → the backend links the chat
//      id to the user → status CONNECTED.
//
// The full OAuth-like flow is intentionally NOT built in v0.16 (spec 48
// allows a safe manual/dev flow with a documented limitation): registering
// the Telegram webhook needs a public URL + bot token, which the demo
// deployment does not have. For demo/QA there is connect-demo (chat id entry,
// ONLY available while LEADOS_DEMO=true) — the real flow is fully implemented
// and activates when TELEGRAM_BOT_TOKEN + TELEGRAM_WEBHOOK_SECRET exist.

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { randomBytes } from "crypto";

const CODE_TTL_MS = 10 * 60_000;

function connectKey(userId: string): string {
  return `telegram_connect:${userId}`;
}

export interface TelegramConnectCode {
  code: string;
  userId: string;
  expiresAt: Date;
}

export async function issueTelegramConnectCode(orgId: string, userId: string): Promise<TelegramConnectCode> {
  const code = randomBytes(4).toString("hex").toUpperCase().slice(0, 8);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await db.setting.upsert({
    where: { organizationId_key: { organizationId: orgId, key: connectKey(userId) } },
    create: { organizationId: orgId, key: connectKey(userId), value: { code, expiresAt: expiresAt.toISOString() } as Prisma.InputJsonValue },
    update: { value: { code, expiresAt: expiresAt.toISOString() } as Prisma.InputJsonValue },
  });
  return { code, userId, expiresAt };
}

/** Find a user by connect code (and burn it). Returns userId or null. */
export async function consumeTelegramConnectCode(orgId: string, code: string): Promise<string | null> {
  const rows = await db.setting.findMany({
    where: { organizationId: orgId, key: { startsWith: "telegram_connect:" } },
  });
  const now = Date.now();
  for (const row of rows) {
    const value = (row.value ?? {}) as { code?: string; expiresAt?: string };
    if (value.code !== code.toUpperCase()) continue;
    if (value.expiresAt && new Date(value.expiresAt).getTime() < now) continue;
    await db.setting.delete({ where: { id: row.id } });
    return row.key.slice("telegram_connect:".length);
  }
  return null;
}

export async function linkTelegramChat(orgId: string, userId: string, chatId: string): Promise<boolean> {
  // TENANT SAFETY (spec 102): the user must belong to THIS org.
  const user = await db.user.findFirst({ where: { id: userId, organizationId: orgId }, select: { id: true } });
  if (!user) return false;
  await db.user.update({
    where: { id: userId },
    data: { telegramChatId: chatId, telegramConnectedAt: new Date() },
  });
  return true;
}

export async function unlinkTelegram(orgId: string, userId: string): Promise<void> {
  const user = await db.user.findFirst({ where: { id: userId, organizationId: orgId }, select: { id: true } });
  if (!user) return;
  await db.user.update({
    where: { id: userId },
    data: { telegramChatId: null, telegramConnectedAt: null },
  });
}

/** Register the Telegram webhook on the real bot (deployment-time operation). */
export async function registerTelegramWebhook(publicBaseUrl: string): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !secret) return { ok: false, error: "TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET must be configured." };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: `${publicBaseUrl.replace(/\/+$/, "")}/api/v1/integrations/telegram/webhook`,
        secret_token: secret,
        allowed_updates: ["message"],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (res.ok && body.ok) return { ok: true };
    return { ok: false, error: body.description ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e) };
  }
}
