import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError, validate, parseJson } from "@/lib/leados/api";
import { z } from "zod";

export async function GET() {
  try {
    const session = await getSession();
    const rows = await db.webhookEndpoint.findMany({
      where: { organizationId: session.orgId },
      orderBy: [{ enabled: "desc" }, { createdAt: "desc" }],
    });
    return ok({ rows });
  } catch (e) {
    console.error("[webhook-endpoints] error:", e);
    return serverError("webhook-endpoints-list-failed", e instanceof Error ? e.message : String(e));
  }
}

const Create = z.object({
  name: z.string().min(1).max(80),
  url: z.string().url(),
  secret: z.string().max(120).optional(),
  events: z.string().default("*"),
  enabled: z.boolean().default(true),
});

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot create webhook endpoints");
    const body = await parseJson(req);
    const v = validate(Create, body);
    if (!v.ok) return v.error;
    const endpoint = await db.webhookEndpoint.create({
      data: {
        organizationId: session.orgId,
        name: v.value.name,
        url: v.value.url,
        secret: v.value.secret ?? null,
        events: v.value.events,
        enabled: v.value.enabled,
      },
    });
    return ok({ endpoint });
  } catch (e) {
    return serverError("webhook-endpoint-create-failed", e);
  }
}
