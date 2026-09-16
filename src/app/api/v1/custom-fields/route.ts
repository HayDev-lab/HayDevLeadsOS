import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError, parseJson } from "@/lib/leados/api";
import { z } from "zod";

export async function GET() {
  try {
    const session = await getSession();
    const rows = await db.customField.findMany({
      where: { organizationId: session.orgId },
      orderBy: { position: "asc" },
    });
    return ok({ rows });
  } catch (e) {
    return serverError("custom-fields-list-failed", e);
  }
}

const Create = z.object({
  name: z.string().min(1).max(80),
  key: z.string().min(1).max(40).regex(/^[a-z0-9_]+$/, "key must be lowercase snake_case"),
  type: z.enum(["text", "number", "select", "multiselect", "date", "bool"]).default("text"),
  options: z.array(z.string()).optional(),
});

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot create custom fields");
    const body = await parseJson(req);
    const v = Create.safeParse(body);
    if (!v.success) return badRequest("validation", v.error.flatten());
    const count = await db.customField.count({ where: { organizationId: session.orgId } });
    const field = await db.customField.create({
      data: {
        organizationId: session.orgId,
        name: v.data.name,
        key: v.data.key,
        type: v.data.type,
        options: (v.data.options ?? null) as never,
        position: count,
      },
    });
    return ok({ field });
  } catch (e) {
    return serverError("custom-field-create-failed", e);
  }
}
