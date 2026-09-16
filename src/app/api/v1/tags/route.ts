import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError, parseJson } from "@/lib/leados/api";
import { z } from "zod";

export async function GET() {
  try {
    const session = await getSession();
    const rows = await db.tag.findMany({ where: { organizationId: session.orgId }, orderBy: { name: "asc" } });
    return ok({ rows });
  } catch (e) {
    return serverError("tags-list-failed", e);
  }
}

const Create = z.object({ name: z.string().min(1), color: z.string().optional() });

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot create tags");
    const body = await parseJson(req);
    const v = Create.safeParse(body);
    if (!v.success) return badRequest("validation", v.error.flatten());
    const tag = await db.tag.create({
      data: { organizationId: session.orgId, name: v.data.name, color: v.data.color ?? "#64748b" },
    });
    return ok({ tag });
  } catch (e) {
    return serverError("tag-create-failed", e);
  }
}
