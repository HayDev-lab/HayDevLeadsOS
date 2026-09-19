// META LEAD ADS — webhook endpoint (v0.19).
//
// GET  : Meta endpoint verification (hub.challenge echo).
// POST : X-Hub-Signature-256 (HMAC-SHA256 of the RAW body with the app
//        secret, constant-time) → strict parse → DURABLE MetaWebhookEvent
//        rows (leadgenId globally unique = idempotency) → FAST 200 ACK.
//        The Graph fetch happens ONLY in the worker — never inline here.
//
// This is a PUBLIC endpoint (Meta cannot carry a session): the signature IS
// the auth. Routing pageId → organization is derived server-side from page
// connections; the payload NEVER supplies an org id.

import { NextResponse } from "next/server";
import { getMetaConfig, META_WEBHOOK_MAX_BODY_BYTES } from "@/lib/integrations/meta/config";
import { verifyWebhookChallenge, verifyWebhookSignature, parseLeadgenChanges } from "@/lib/integrations/meta/webhook";
import { persistLeadgenEvents } from "@/lib/leados/meta-service";

export async function GET(req: Request) {
  const cfg = getMetaConfig();
  const url = new URL(req.url);
  const challenge = verifyWebhookChallenge(url.searchParams, cfg.webhookVerifyToken);
  if (challenge === null) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(req: Request) {
  const cfg = getMetaConfig();

  // 0) BASIC DoS GUARD (v0.19.3): reject oversized bodies before buffering.
  //    Small body limit + signature verification + fast ACK + async worker —
  //    no per-IP throttling that could block legitimate Meta delivery.
  const lenHeader = req.headers.get("content-length");
  if (lenHeader) {
    const len = Number(lenHeader);
    if (Number.isFinite(len) && len > META_WEBHOOK_MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false }, { status: 413 });
    }
  }
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > META_WEBHOOK_MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false }, { status: 413 });
  }

  // 1) CURRENT authenticity verification — signature over the RAW body.
  try {
    verifyWebhookSignature(raw, req.headers.get("x-hub-signature-256"), cfg.appSecret);
  } catch {
    // Invalid signature → 401, nothing persisted, no PII in the response.
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // 2) STRICT payload validation + leadgen extraction (multiple entries ok,
  //    non-leadgen changes ignored).
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true }); // malformed JSON → ack (Meta retries would loop otherwise)
  }
  const changes = parseLeadgenChanges(body);

  // 3) Persist durable events (leadgenId unique ⇒ same webhook ×10 = 1 row).
  try {
    const result = await persistLeadgenEvents(changes, body);
    // 4) FAST ACK — worker owns the Graph fetch.
    return NextResponse.json({ ok: true, ...result });
  } catch {
    // Persistence failure → 500 so Meta retries delivery (durable-first).
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
