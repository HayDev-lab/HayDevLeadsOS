// HAYDEV LEADOS — DELIVERY CHANNELS (v0.16, spec 33–39), PURE module.
//
// External-channel fan-out model:
//   DomainEvent → Notification → Delivery rows (EMAIL/TELEGRAM per user,
//   WEBHOOK per org endpoint) → delivery worker → providers.
// IN_APP has NO delivery row (spec 37): the existing Notification Center
// stays the in-app source of truth — this module never touches it.
//
// Channel preferences (spec 38–40): per-user matrix event × channel. External
// channels default OFF (spec 98 — no sending starts automatically after
// deployment); IN_APP keeps its existing per-event toggles untouched.

import {
  DOMAIN_EVENT_TYPES,
  type DomainEventType,
} from "@/lib/domain-events";

// ---------------------------------------------------------------------------
// Channels + statuses (spec 35–36)
// ---------------------------------------------------------------------------

export const DELIVERY_CHANNEL = {
  EMAIL: "EMAIL",
  TELEGRAM: "TELEGRAM",
  WEBHOOK: "WEBHOOK",
} as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNEL)[keyof typeof DELIVERY_CHANNEL];
export const DELIVERY_CHANNELS: DeliveryChannel[] = Object.values(DELIVERY_CHANNEL);

export const DELIVERY_STATUS = {
  PENDING: "PENDING",
  SENDING: "SENDING",
  SENT: "SENT",
  FAILED_RETRYABLE: "FAILED_RETRYABLE",
  FAILED: "FAILED",
  SKIPPED: "SKIPPED",
} as const;
export type DeliveryStatus = (typeof DELIVERY_STATUS)[keyof typeof DELIVERY_STATUS];

// ---------------------------------------------------------------------------
// Channel preferences (spec 38–40, 98) — per user, stored in the SAME
// notification_preferences:<userId> Setting row as { types, channels }.
// ---------------------------------------------------------------------------

export interface ChannelToggles {
  email: boolean;
  telegram: boolean;
}

export type ChannelPreferences = Record<DomainEventType, ChannelToggles>;

export const DEFAULT_CHANNEL_PREFERENCES: ChannelPreferences = (() => {
  const out = {} as ChannelPreferences;
  for (const type of DOMAIN_EVENT_TYPES) out[type] = { email: false, telegram: false };
  return out;
})();

/** Fresh per-type toggle objects (NEVER share the module-level defaults —
 *  parsing must not mutate them, a shallow copy would leak state across
 *  calls because the nested {email, telegram} objects are shared). */
function freshChannelPreferences(): ChannelPreferences {
  const out = {} as ChannelPreferences;
  for (const type of DOMAIN_EVENT_TYPES) out[type] = { email: false, telegram: false };
  return out;
}

/** Parse the `.channels` part of a stored preferences row (backfill = OFF). */
export function parseChannelPreferences(raw: unknown): ChannelPreferences {
  const result: ChannelPreferences = freshChannelPreferences();
  if (raw == null || typeof raw !== "object") return result;
  let value = raw as Record<string, unknown>;
  if (value.channels && typeof value.channels === "object") {
    value = value.channels as Record<string, unknown>;
  }
  for (const type of DOMAIN_EVENT_TYPES) {
    const v = value[type];
    if (v == null || typeof v !== "object") continue;
    const t = v as Record<string, unknown>;
    if (typeof t.email === "boolean") result[type].email = t.email;
    if (typeof t.telegram === "boolean") result[type].telegram = t.telegram;
  }
  return result;
}

export interface ChannelPreferenceValidation {
  ok: boolean;
  errors: string[];
  channels: ChannelPreferences | null;
}

/** Validate raw channel-preference input (server-side, HTTP 400 on failure). */
export function validateChannelPreferences(raw: unknown): ChannelPreferenceValidation {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["Channel preferences must be an object."], channels: null };
  }
  const obj = raw as Record<string, unknown>;
  const errors: string[] = [];
  const channels: ChannelPreferences = freshChannelPreferences();
  for (const [type, v] of Object.entries(obj)) {
    if (!(type in DEFAULT_CHANNEL_PREFERENCES)) {
      errors.push(`Unknown notification type: ${type}`);
      continue;
    }
    if (v == null || typeof v !== "object") {
      errors.push(`Channel preferences for ${type} must be an object.`);
      continue;
    }
    const t = v as Record<string, unknown>;
    if (typeof t.email === "boolean") channels[type as DomainEventType].email = t.email;
    else errors.push(`email preference for ${type} must be a boolean.`);
    if (typeof t.telegram === "boolean") channels[type as DomainEventType].telegram = t.telegram;
    else errors.push(`telegram preference for ${type} must be a boolean.`);
  }
  if (errors.length) return { ok: false, errors, channels: null };
  return { ok: true, errors: [], channels };
}

// ---------------------------------------------------------------------------
// Content rendering (spec 44–45, 49, 52)
// ---------------------------------------------------------------------------

/** Absolute app link for a deepLink — APP_URL env (no client-bundle leak). */
export function appLink(deepLink: string | null | undefined): string {
  const base = process.env.APP_URL?.replace(/\/+$/, "") ?? "";
  if (!base) return deepLink ? `app:#/${deepLink}` : "app";
  return deepLink ? `${base}/#/${deepLink}` : base;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export interface RenderedTelegram {
  text: string;
}

export interface WebhookPayloadV1 {
  version: "1";
  event: string;
  occurredAt: string;
  organizationId: string;
  entity: { type: string; id: string };
  data: Record<string, unknown>;
}

export function buildWebhookPayload(input: {
  event: string;
  occurredAt: Date | string;
  organizationId: string;
  entityType: string;
  entityId: string;
  data: Record<string, unknown>;
}): WebhookPayloadV1 {
  return {
    version: "1",
    event: input.event,
    occurredAt: new Date(input.occurredAt).toISOString(),
    organizationId: input.organizationId,
    entity: { type: input.entityType, id: input.entityId },
    data: input.data,
  };
}

/** Simple HTML body for notification emails (short, spec 44). */
export function emailHtml(subject: string, text: string, link: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return [
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px">`,
    `<h2 style="font-size:16px;margin:0 0 12px">${esc(subject)}</h2>`,
    `<p style="font-size:14px;line-height:1.6;white-space:pre-line;margin:0 0 16px">${esc(text)}</p>`,
    `<p style="margin:0"><a href="${esc(link)}" style="display:inline-block;background:#171717;color:#fff;padding:8px 16px;border-radius:6px;font-size:13px;text-decoration:none">Open LeadOS</a></p>`,
    `</div>`,
  ].join("");
}
