// HAYDEV LEADOS — DELIVERY PROVIDERS (v0.16, spec 41–43, 46–57, 99–101).
//
// Provider abstraction: business logic NEVER binds to a concrete email/telegram
// service. Providers are selected by env config (spec 42):
//
//   EMAIL_PROVIDER=resend + RESEND_API_KEY + EMAIL_FROM   → RealResendEmailProvider
//   TELEGRAM_BOT_TOKEN                                     → RealTelegramProvider
//   Webhook                                                → signed HTTP POST (real)
//
// DEMO SAFETY (spec 99–101): when LEADOS_DEMO=true the Demo* providers
// SIMULATE every external send (no real email/telegram/webhook leaves the
// system) and demo mode OVERRIDES real credentials, so a public demo can
// never leak real messages even if env vars are present. When credentials are
// absent and demo is off, the channel is UNAVAILABLE (spec 43) — the worker
// marks the delivery SKIPPED, it never crashes the run.
//
// SECRETS: providers read env at CALL time; secrets are never logged and never
// returned to the client bundle (spec 87–88, 101).

import { createHmac, randomUUID } from "crypto";
import { AUTO_ERROR, classifyAutomationError } from "../automation-errors";
import { validateWebhookUrl } from "./ssrf";

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export interface ProviderSendResult {
  ok: boolean;
  /** Provider message id when the send succeeded (spec 61). */
  messageId?: string;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
  /** HTTP status from the provider (for tests + logging). */
  status?: number;
}

// ---------------------------------------------------------------------------
// Demo mode (spec 99)
// ---------------------------------------------------------------------------

export function isDemoDeliveryMode(): boolean {
  return process.env.LEADOS_DEMO === "true";
}

// ---------------------------------------------------------------------------
// EMAIL (spec 41–45)
// ---------------------------------------------------------------------------

export interface EmailProvider {
  mode: "REAL" | "DEMO";
  send(input: { to: string; subject: string; text: string; html?: string | null }): Promise<ProviderSendResult>;
}

export function getEmailProvider(): EmailProvider | null {
  if (isDemoDeliveryMode()) return demoEmailProvider;
  const provider = process.env.EMAIL_PROVIDER?.toLowerCase();
  if (provider === "resend" && process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
    return resendEmailProvider;
  }
  return null; // UNAVAILABLE (spec 43)
}

const demoEmailProvider: EmailProvider = {
  mode: "DEMO",
  async send(input) {
    return { ok: true, messageId: `demo-email-${randomUUID().slice(0, 12)}` };
  },
};

const resendEmailProvider: EmailProvider = {
  mode: "REAL",
  async send(input) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM,
          to: [input.to],
          subject: input.subject,
          text: input.text,
          html: input.html ?? undefined,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { id?: string };
        return { ok: true, messageId: body.id ?? undefined };
      }
      const text = await res.text().catch(() => "");
      const facts = classifyAutomationError({ message: text, status: res.status });
      return {
        ok: false,
        status: res.status,
        errorCode: facts.code,
        errorMessage: facts.message,
        retryable: facts.retryable,
      };
    } catch (e) {
      const facts = classifyAutomationError({ message: (e as Error)?.message ?? String(e) });
      return { ok: false, errorCode: facts.code, errorMessage: facts.message, retryable: facts.retryable };
    }
  },
};

// ---------------------------------------------------------------------------
// TELEGRAM (spec 46–49)
// ---------------------------------------------------------------------------

export interface TelegramProvider {
  mode: "REAL" | "DEMO";
  send(input: { chatId: string; text: string }): Promise<ProviderSendResult>;
}

export function getTelegramProvider(): TelegramProvider | null {
  if (isDemoDeliveryMode()) return demoTelegramProvider;
  if (process.env.TELEGRAM_BOT_TOKEN) return realTelegramProvider;
  return null;
}

const demoTelegramProvider: TelegramProvider = {
  mode: "DEMO",
  async send() {
    return { ok: true, messageId: `demo-telegram-${randomUUID().slice(0, 12)}` };
  },
};

const realTelegramProvider: TelegramProvider = {
  mode: "REAL",
  async send(input) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: input.chatId, text: input.text, disable_web_page_preview: false }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { message_id?: number }; description?: string };
      if (res.ok && body.ok) {
        return { ok: true, messageId: body.result?.message_id != null ? String(body.result.message_id) : undefined };
      }
      // Telegram 400 "chat not found" etc → permanent; 429/5xx → retryable.
      const facts = classifyAutomationError({ message: body.description ?? `HTTP ${res.status}`, status: res.status });
      return { ok: false, status: res.status, errorCode: facts.code, errorMessage: facts.message, retryable: facts.retryable };
    } catch (e) {
      const facts = classifyAutomationError({ message: (e as Error)?.message ?? String(e) });
      return { ok: false, errorCode: facts.code, errorMessage: facts.message, retryable: facts.retryable };
    }
  },
};

// ---------------------------------------------------------------------------
// WEBHOOK (spec 50–57)
// ---------------------------------------------------------------------------

export interface WebhookSendInput {
  url: string;
  /** Endpoint secret — HMAC-SHA256 of the exact body (spec 53). */
  secret: string | null;
  eventId: string;
  body: string;
}

export interface WebhookProvider {
  mode: "REAL" | "DEMO";
  send(input: WebhookSendInput): Promise<ProviderSendResult>;
}

export function getWebhookProvider(): WebhookProvider {
  if (isDemoDeliveryMode()) return demoWebhookProvider;
  return realWebhookProvider;
}

const demoWebhookProvider: WebhookProvider = {
  mode: "DEMO",
  async send(input) {
    return { ok: true, messageId: `demo-webhook-${randomUUID().slice(0, 12)}`, status: 200 };
  },
};

export const WEBHOOK_TIMEOUT_MS = 8_000;

export function signWebhookBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

// Exported for security regression tests: prove the send-time SSRF guard
// runs even when demo mode would otherwise swap in the demo provider.
export const realWebhookProvider: WebhookProvider = {
  mode: "REAL",
  async send(input) {
    // DEFENSE IN DEPTH (spec 54): re-validate right before the fetch — even a
    // URL that somehow skipped save-time validation never reaches internals.
    const ssrf = await validateWebhookUrl(input.url);
    if (!ssrf.ok) {
      return { ok: false, errorCode: AUTO_ERROR.INVALID_WEBHOOK_URL, errorMessage: `Blocked by SSRF protection (${ssrf.error}).`, retryable: false };
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-HayDev-Event-Id": input.eventId,
      "User-Agent": "HayDev-LeadOS-Webhook/1",
    };
    if (input.secret) {
      headers["X-HayDev-Signature"] = signWebhookBody(input.body, input.secret);
    }
    try {
      // REDIRECT POLICY (spec 55): manual — a 3xx can never bypass validation.
      const res = await fetch(input.url, {
        method: "POST",
        headers,
        body: input.body,
        redirect: "manual",
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      if (res.status >= 300 && res.status < 400) {
        return { ok: false, status: res.status, errorCode: AUTO_ERROR.INVALID_WEBHOOK_URL, errorMessage: "Redirects are not allowed.", retryable: false };
      }
      if (res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: true, messageId: undefined, status: res.status, errorMessage: text.slice(0, 200) || undefined };
      }
      // Retry: 429 + 5xx. Other 4xx = permanent (spec 57).
      const facts = classifyAutomationError({ message: `Webhook responded ${res.status}.`, status: res.status });
      return { ok: false, status: res.status, errorCode: facts.code, errorMessage: facts.message, retryable: facts.retryable };
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      const facts = classifyAutomationError({ message: /abort|timeout/i.test(msg) ? "timeout" : msg });
      return { ok: false, errorCode: facts.code, errorMessage: facts.message, retryable: facts.retryable };
    }
  },
};

// ---------------------------------------------------------------------------
// Channel availability for the Integrations UI (spec 40, 90–91)
// ---------------------------------------------------------------------------

export interface ChannelAvailability {
  email: { mode: "REAL" | "DEMO" | "UNAVAILABLE"; from: string | null };
  telegram: { mode: "REAL" | "DEMO" | "UNAVAILABLE"; botConfigured: boolean };
  webhook: { mode: "REAL" | "DEMO" };
}

export function getChannelAvailability(): ChannelAvailability {
  const email = getEmailProvider();
  const telegram = getTelegramProvider();
  return {
    email: { mode: email?.mode ?? "UNAVAILABLE", from: process.env.EMAIL_FROM ?? null },
    telegram: { mode: telegram?.mode ?? "UNAVAILABLE", botConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN) || isDemoDeliveryMode() },
    webhook: { mode: getWebhookProvider().mode },
  };
}
