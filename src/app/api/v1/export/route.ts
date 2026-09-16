import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/leados/context";
import { serverError } from "@/lib/leados/api";
import { toCsv } from "@/lib/leados/attribution";
import { normalizePhone, normalizeEmail } from "@/lib/leados/normalize";

export async function GET(req: Request) {
  try {
    const session = await getSession();
    const p = new URL(req.url).searchParams;
    const where: Record<string, unknown> = { organizationId: session.orgId, status: { not: "ARCHIVED" } };
    const sourceId = p.get("sourceId");
    const ownerId = p.get("ownerId");
    const stageId = p.get("stageId");
    const priority = p.getAll("priority");
    const q = p.get("q");
    if (sourceId) where.sourceId = sourceId;
    if (ownerId) where.ownerId = ownerId;
    if (stageId) where.stageId = stageId;
    if (priority.length) where.priority = { in: priority };
    if (q) {
      const nPhone = normalizePhone(q);
      const nEmail = normalizeEmail(q);
      where.OR = [
        { firstName: { contains: q } },
        { lastName: { contains: q } },
        { company: { contains: q } },
        { email: { contains: q } },
        { phone: { contains: q } },
        ...(nPhone ? [{ normalizedPhone: nPhone }] : []),
        ...(nEmail ? [{ normalizedEmail: nEmail }] : []),
      ];
    }
    const rows = await db.lead.findMany({
      where,
      include: { stage: true, source: true, owner: { select: { name: true } }, leadTags: { include: { tag: true } } },
      orderBy: { createdAt: "desc" },
      take: 2000,
    });
    const exportRows = rows.map((l) => ({
      firstName: l.firstName ?? "",
      lastName: l.lastName ?? "",
      company: l.company ?? "",
      phone: l.phone ?? "",
      email: l.email ?? "",
      source: l.source?.name ?? "",
      stage: l.stage?.name ?? "",
      status: l.status,
      priority: l.priority,
      score: l.leadScore,
      owner: l.owner?.name ?? "",
      estimatedValue: l.estimatedValue ?? "",
      currency: l.currency ?? "",
      summary: l.summary ?? "",
      nextActionAt: l.nextActionAt ? new Date(l.nextActionAt).toISOString() : "",
      lastContactAt: l.lastContactAt ? new Date(l.lastContactAt).toISOString() : "",
      tags: l.leadTags.map((t) => t.tag.name).join("; "),
      createdAt: new Date(l.createdAt).toISOString(),
    }));
    const csv = toCsv(exportRows);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="leados-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (e) {
    return serverError("export-failed", e);
  }
}
