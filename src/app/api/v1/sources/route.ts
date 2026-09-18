import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, apiError, parseJson } from "@/lib/leados/api";
import { z } from "zod";

export async function GET() {
  try {
    const session = await getSession();
    const rows = await db.leadSource.findMany({
      where: { organizationId: session.orgId },
      orderBy: { position: "asc" },
    });
    // v0.19.2 §7: NEVER expose the stored tokenHash — credential metadata only.
    const safe = rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      position: r.position,
      isSystem: r.isSystem,
      active: r.active,
      createdAt: r.createdAt,
      token: {
        hasCredential: !!r.tokenPrefix,
        prefix: r.tokenPrefix,
        last4: r.tokenLast4,
        createdAt: r.tokenCreatedAt,
        revealedAt: r.tokenRevealedAt,
        disabledAt: r.tokenDisabledAt,
      },
    }));
    return ok({ rows: safe });
  } catch (e) {
    return apiError("sources-list-failed", e);
  }
}

const Create = z.object({ name: z.string().min(1), type: z.string().default("other") });

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot create sources");
    const body = await parseJson(req);
    const v = Create.safeParse(body);
    if (!v.success) return badRequest("validation", v.error.flatten());
    const count = await db.leadSource.count({ where: { organizationId: session.orgId } });
    const src = await db.leadSource.create({
      data: { organizationId: session.orgId, name: v.data.name, type: v.data.type, position: count, isSystem: false },
    });
    return ok({ source: src });
  } catch (e) {
    return apiError("source-create-failed", e);
  }
}
