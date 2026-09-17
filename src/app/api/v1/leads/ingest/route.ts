import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ok, badRequest, apiError, validate } from "@/lib/leados/api";
import { LeadCreate } from "@/lib/schemas/lead";
import { createLead } from "@/lib/leados/lead-service";
import { parseUtm, recordAttribution } from "@/lib/leados/attribution";
import { z } from "zod";

// PUBLIC lead ingestion — for website forms / external integrations.
// Org is resolved by the `x-org-slug` header. Rate-limit + spam protection
// are prepared via the WebhookLog table and a simple in-memory guard.

const PublicIngest = LeadCreate.extend({
  orgSlug: z.string().optional(),
}).refine((d) => d.firstName || d.company || d.email || d.phone, {
  message: "At least one of firstName, company, email or phone is required",
});

const recent = new Map<string, number[]>();
function rateLimit(key: string, windowMs = 60_000, max = 5): boolean {
  const now = Date.now();
  const arr = (recent.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return false;
  arr.push(now);
  recent.set(key, arr);
  return true;
}

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (!rateLimit(`ingest:${ip}`, 60_000, 8)) {
      return badRequest("Too many requests. Please slow down.");
    }
    const slug = req.headers.get("x-org-slug");
    if (!slug) return badRequest("Missing x-org-slug header");
    const org = await db.organization.findUnique({ where: { slug } });
    if (!org) return badRequest("Unknown organization");

    const body = await req.json().catch(() => null);
    const v = validate(PublicIngest, body);
    if (!v.ok) return v.error;

    // log the webhook
    await db.webhookLog.create({
      data: {
        organizationId: org.id,
        source: "public_ingest",
        endpoint: "/api/v1/leads/ingest",
        status: "OK",
        payload: (v.value as unknown) as never,
      },
    });

    const utm = parseUtm(new URLSearchParams(v.value.utm ?? {}));
    const result = await createLead(org.id, null, v.value);
    if (utm) await recordAttribution(result.lead.id, v.value.sourceType ?? "website", utm);
    return ok({ leadId: result.lead.id, duplicate: result.duplicate, created: result.created });
  } catch (e) {
    return apiError("ingest-failed", e);
  }
}
