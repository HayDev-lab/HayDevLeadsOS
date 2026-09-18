// HAYDEV LEADOS — PUBLIC (EXTERNAL) LEAD INGESTION ENDPOINT (v0.19.2 §6–9).
//
// AUTHENTICATION: per-source bearer credential (lsrc_…, hash-only storage —
// see lib/leados/source-token.ts). The organization is resolved SERVER-SIDE
// from the validated source; org slugs/ids from the client are NEVER read.
//
// PAYLOAD: ExternalLeadPayload — a NARROW, strict schema. Internal
// LeadCreate fields (force, ownerId, stageId, sourceId, sourceType,
// priority, tags, meta, status, pipelineId, organizationId, userId) are
// FORBIDDEN: unknown keys are rejected, a public client can never bypass
// duplicate protection or attach org-internal relations.
//
// LOGGING: WebhookLog stores ONLY redacted diagnostics — field NAMES, no
// values (no phone/email/answers), plus sourceId + requestId + status.
//
// RATE LIMIT (v0.20 §9 classification — honest, no inflated claims):
//   State store: the APPLICATION DATABASE (WebhookLog rows) — NOT process
//   memory. This means:
//     • Packaged demo / dev (SQLite file): effectively single-instance.
//     • Real production (external DATABASE_URL, e.g. Postgres): the window
//       is SHARED by every app instance connected to that database — no
//       Redis required for correct multi-instance limiting.
//   Known non-atomicity: the check-then-insert sequence is not serialized;
//   under extreme burst concurrency the window can overshoot slightly
//   (bounded by in-flight requests). Documented, accepted for lead capture.
//   Concurrency pinned by tests/public-ingest.test.ts (parallel requests
//   are all durably counted).

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { tooMany, apiError } from "@/lib/leados/api";
import { createLead } from "@/lib/leados/lead-service";
import { parseUtm, recordAttribution } from "@/lib/leados/attribution";
import { extractSourceToken, authenticateSourceToken, SourceAuthError } from "@/lib/leados/source-token";
import { z } from "zod";

// ---------------------------------------------------------------------------
// §6 — the ONLY fields a public client may send
// ---------------------------------------------------------------------------

const ExternalLeadPayload = z
  .strictObject({
    firstName: z.string().min(1).max(80).optional(),
    lastName: z.string().max(80).optional(),
    company: z.string().max(160).optional(),
    phone: z.string().max(40).optional(),
    email: z.string().max(160).optional(),
    preferredChannel: z.string().max(40).optional(),
    locale: z.string().max(8).optional(),
    summary: z.string().max(1000).optional(),
    requirements: z.string().max(2000).optional(),
    utm: z
      .strictObject({
        utm_source: z.string().max(160).optional(),
        utm_medium: z.string().max(160).optional(),
        utm_campaign: z.string().max(160).optional(),
        utm_content: z.string().max(160).optional(),
        utm_term: z.string().max(160).optional(),
        landing_page: z.string().max(500).optional(),
        referrer: z.string().max(500).optional(),
      })
      .optional(),
    sourceDetail: z.string().max(160).optional(),
    // externalId allowed ONLY in the source-scoped contract (per-source
    // idempotency key for website integrations); dedup by phone/email always runs.
    externalId: z.string().max(120).optional(),
  })
  .refine((d) => d.firstName || d.company || d.email || d.phone, {
    message: "At least one of firstName, company, email or phone is required",
  });

export type ExternalLeadPayloadT = z.infer<typeof ExternalLeadPayload>;

// ---------------------------------------------------------------------------
// §9 — durable, DB-backed rate limit (per source, sliding window)
// ---------------------------------------------------------------------------

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;

function authLogKey(sourceId: string): string {
  return `public_ingest:${sourceId}`;
}

async function rateLimited(sourceId: string): Promise<boolean> {
  const since = new Date(Date.now() - RATE_WINDOW_MS);
  const count = await db.webhookLog.count({
    where: { source: authLogKey(sourceId), createdAt: { gte: since } },
  });
  return count >= RATE_MAX;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const requestId = randomUUID();
  try {
    // 1) AUTHENTICATE (§7) — org resolved server-side from the credential.
    let auth;
    try {
      auth = await authenticateSourceToken(extractSourceToken(req));
    } catch (e) {
      if (e instanceof SourceAuthError) {
        return NextResponse.json(
          { error: e.code, message: e.message, requestId },
          { status: e.httpStatus }
        );
      }
      throw e;
    }

    // 2) RATE LIMIT (§9) — durable per-source window, DB-backed.
    if (await rateLimited(auth.sourceId)) {
      await db.webhookLog.create({
        data: {
          organizationId: auth.organizationId,
          source: authLogKey(auth.sourceId),
          endpoint: "/api/v1/leads/ingest",
          status: "FAILED",
          // §8 redaction: field names + diagnostics ONLY — never values.
          payload: { requestId, reason: "rate-limited", redacted: true } as never,
          error: "rate-limited",
        },
      });
      return tooMany("Too many requests for this source — slow down", Math.ceil(RATE_WINDOW_MS / 1000));
    }

    // 3) VALIDATE the narrow external payload (§6).
    const body = await req.json().catch(() => null);
    const v = ExternalLeadPayload.safeParse(body);
    if (!v.success) {
      await db.webhookLog.create({
        data: {
          organizationId: auth.organizationId,
          source: authLogKey(auth.sourceId),
          endpoint: "/api/v1/leads/ingest",
          status: "FAILED",
          payload: { requestId, reason: "validation-failed", issues: v.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })), redacted: true } as never,
          error: "validation-failed",
        },
      });
      return NextResponse.json(
        { error: "validation-failed", details: v.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })), requestId },
        { status: 400 }
      );
    }

    // 4) REDACTED LOG (§8) — field NAMES only, no PII values, no secrets.
    await db.webhookLog.create({
      data: {
        organizationId: auth.organizationId,
        source: authLogKey(auth.sourceId),
        endpoint: "/api/v1/leads/ingest",
        status: "OK",
        payload: {
          requestId,
          sourceId: auth.sourceId,
          fields: Object.keys(v.data),
          redacted: true,
        } as never,
      },
    });

    // 5) INGEST through the canonical service — the source is the VALIDATED
    //    row's id/type (server-side truth); duplicate protection ALWAYS runs
    //    (a public client cannot pass force or any internal control field).
    const utm = parseUtm(new URLSearchParams(v.data.utm ?? {}));
    const result = await createLead(auth.organizationId, null, {
      firstName: v.data.firstName,
      lastName: v.data.lastName,
      company: v.data.company,
      phone: v.data.phone,
      email: v.data.email,
      preferredChannel: v.data.preferredChannel,
      locale: v.data.locale,
      summary: v.data.summary,
      requirements: v.data.requirements,
      utm: v.data.utm,
      sourceDetail: v.data.sourceDetail,
      externalId: v.data.externalId,
      sourceId: auth.sourceId,
      sourceType: auth.sourceType,
      note: undefined,
      force: undefined,
    });

    if (result.created && utm) {
      await recordAttribution(result.lead.id, auth.sourceType, utm);
    }
    if (!result.created) {
      // Duplicate detected — duplicate protection CANNOT be bypassed publicly
      // (no force). Do NOT disclose the existing lead's internal id to an
      // unauthenticated external caller.
      return NextResponse.json(
        { duplicate: true, created: false, requestId },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { leadId: result.lead.id, duplicate: false, created: true, requestId },
      { status: 201 }
    );
  } catch (e) {
    return apiError("ingest-failed", e);
  }
}
