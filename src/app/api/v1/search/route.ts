import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/leados/context";
import { ok, apiError } from "@/lib/leados/api";
import { normalizePhone, normalizeEmail } from "@/lib/leados/normalize";

export async function GET(req: Request) {
  try {
    const session = await getSession();
    const q = new URL(req.url).searchParams.get("q")?.trim();
    if (!q) return ok({ rows: [] });
    const nPhone = normalizePhone(q);
    const nEmail = normalizeEmail(q);
    const rows = await db.lead.findMany({
      where: {
        organizationId: session.orgId,
        status: { not: "ARCHIVED" },
        OR: [
          { firstName: { contains: q } },
          { lastName: { contains: q } },
          { company: { contains: q } },
          { email: { contains: q } },
          { phone: { contains: q } },
          ...(nPhone ? [{ normalizedPhone: nPhone }] : []),
          ...(nEmail ? [{ normalizedEmail: nEmail }] : []),
        ],
      },
      include: { stage: true, source: true, owner: { select: { id: true, name: true, avatarColor: true } } },
      take: 20,
      orderBy: { createdAt: "desc" },
    });
    return ok({ rows });
  } catch (e) {
    return apiError("search-failed", e);
  }
}
