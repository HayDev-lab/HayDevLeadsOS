// META LEAD ADS — webhook verification & parsing (v0.19).
//
// GET  (Meta endpoint verification): hub.mode=subscribe + hub.verify_token
//      must match META_WEBHOOK_VERIFY_TOKEN → echo hub.challenge.
// POST (leadgen events): X-Hub-Signature-256 = "sha256=<hex hmac>" of the RAW
//      request body keyed with META_APP_SECRET — constant-time compared.
//
// Parsing handles MULTIPLE entries × changes; non-leadgen changes are ignored.
// This module is PURE (verify + parse only) — persistence lives in the service.

import { createHmac, timingSafeEqual } from "crypto";
import { MetaError, META_ERROR_CODE } from "./errors";
import { safeEqual } from "./encryption";

export interface LeadgenChange {
  pageId: string;
  formId: string;
  leadgenId: string;
  createdTime: number | null;
}

export interface MetaWebhookBody {
  object?: string;
  entry?: Array<{
    id?: string | number;
    changes?: Array<{
      field?: string;
      value?: {
        leadgen_id?: string | number;
        form_id?: string | number;
        page_id?: string | number;
        created_time?: number;
      };
    }>;
  }>;
}

/** Verify the webhook GET challenge. Returns the challenge on success. */
export function verifyWebhookChallenge(query: URLSearchParams, verifyToken: string | null): string | null {
  const mode = query.get("hub.mode");
  const token = query.get("hub.verify_token");
  const challenge = query.get("hub.challenge");
  if (mode !== "subscribe" || !challenge) return null;
  if (!verifyToken || !token || !safeEqual(token, verifyToken)) return null;
  return challenge;
}

/** Verify X-Hub-Signature-256 against the RAW body. Throws MetaError on failure. */
export function verifyWebhookSignature(rawBody: string, header: string | null, appSecret: string | null): void {
  if (!appSecret) {
    throw new MetaError(META_ERROR_CODE.META_CONFIG_ERROR, "Webhook signature verification unavailable (META_APP_SECRET not configured)");
  }
  if (!header?.startsWith("sha256=")) {
    throw new MetaError(META_ERROR_CODE.META_AUTH_ERROR, "Missing X-Hub-Signature-256 header");
  }
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  let got: Buffer;
  try {
    got = Buffer.from(header.slice(7), "hex");
  } catch {
    throw new MetaError(META_ERROR_CODE.META_AUTH_ERROR, "Malformed X-Hub-Signature-256 header");
  }
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    throw new MetaError(META_ERROR_CODE.META_AUTH_ERROR, "Webhook signature mismatch");
  }
}

const ID_RE = /^\d{1,64}$/;

/** Extract every leadgen change from a (signature-verified) payload. */
export function parseLeadgenChanges(body: unknown): LeadgenChange[] {
  const b = body as MetaWebhookBody;
  if (!b || typeof b !== "object" || b.object !== "page" || !Array.isArray(b.entry)) return [];
  const out: LeadgenChange[] = [];
  for (const entry of b.entry) {
    const pageId = String(entry.id ?? "");
    if (!ID_RE.test(pageId)) continue;
    for (const change of entry.changes ?? []) {
      if (change?.field !== "leadgen") continue; // non-leadgen → ignore
      const v = change.value ?? {};
      const leadgenId = String(v.leadgen_id ?? "");
      const formId = String(v.form_id ?? "");
      // page_id in the value must agree with the entry id when present.
      const valuePageId = v.page_id != null ? String(v.page_id) : pageId;
      if (!ID_RE.test(leadgenId) || !ID_RE.test(formId) || valuePageId !== pageId) continue;
      out.push({
        pageId,
        formId,
        leadgenId,
        createdTime: typeof v.created_time === "number" ? v.created_time : null,
      });
    }
  }
  return out;
}
