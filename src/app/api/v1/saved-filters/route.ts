import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, apiError, validate, parseJson } from "@/lib/leados/api";
import { z } from "zod";

export async function GET() {
  try {
    const session = await getSession();
    // user's own filters + shared filters
    const rows = await db.savedFilter.findMany({
      where: {
        organizationId: session.orgId,
        OR: [{ userId: session.userId }, { isShared: true }],
      },
      orderBy: [{ isShared: "desc" }, { createdAt: "desc" }],
    });
    return ok({ rows });
  } catch (e) {
    return apiError("saved-filters-list-failed", e);
  }
}

const Create = z.object({
  name: z.string().min(1).max(60),
  query: z.record(z.string(), z.unknown()),
  isShared: z.boolean().default(false),
});

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot create saved filters");
    const body = await parseJson(req);
    const v = validate(Create, body);
    if (!v.ok) return v.error;
    const filter = await db.savedFilter.create({
      data: {
        organizationId: session.orgId,
        userId: session.userId,
        name: v.value.name,
        query: v.value.query as never,
        isShared: v.value.isShared,
      },
    });
    return ok({ filter });
  } catch (e) {
    return apiError("saved-filter-create-failed", e);
  }
}
