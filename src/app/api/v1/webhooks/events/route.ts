// Webhook outgoing events — lists IntegrationEvents for subscribers to consume.
// In a production setup, these would be delivered to registered webhook URLs.
// This endpoint is the read layer; a background worker would poll + deliver.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/leados/context";
import { ok, serverError, qInt, qStr } from "@/lib/leados/api";

export async function GET(req: Request) {
  try {
    const session = await getSession();
    const url = new URL(req.url);
    const p = url.searchParams;
    const event = qStr(p.get("event"));
    const publishedOnly = p.get("published") !== "0";
    const limit = Math.min(200, Number(p.get("limit") ?? 50));

    const where: Record<string, unknown> = { organizationId: session.orgId };
    if (event) where.event = event;
    if (publishedOnly) where.published = true;

    const rows = await db.integrationEvent.findMany({
      where,
      include: { lead: { select: { id: true, firstName: true, lastName: true, company: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // summary by event type
    const byEvent: Record<string, number> = {};
    for (const r of rows) byEvent[r.event] = (byEvent[r.event] ?? 0) + 1;

    return ok({ rows, byEvent, total: rows.length });
  } catch (e) {
    return serverError("webhook-events-list-failed", e);
  }
}
