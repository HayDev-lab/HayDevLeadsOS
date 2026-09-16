import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError, parseJson } from "@/lib/leados/api";
import { z } from "zod";

export async function GET() {
  try {
    const session = await getSession();
    const rows = await db.leadSource.findMany({
      where: { organizationId: session.orgId },
      orderBy: { position: "asc" },
    });
    return ok({ rows });
  } catch (e) {
    return serverError("sources-list-failed", e);
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
    return serverError("source-create-failed", e);
  }
}
