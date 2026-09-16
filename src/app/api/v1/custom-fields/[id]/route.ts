import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError, notFound, parseJson } from "@/lib/leados/api";
import { z } from "zod";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot delete custom fields");
    const { id } = await ctx.params;
    const field = await db.customField.findUnique({ where: { id }, select: { organizationId: true } });
    if (!field || field.organizationId !== session.orgId) return notFound("custom-field");
    await db.customField.delete({ where: { id } });
    return ok({ ok: true });
  } catch (e) {
    return serverError("custom-field-delete-failed", e);
  }
}

const Update = z.object({
  name: z.string().min(1).max(80).optional(),
  options: z.array(z.string()).optional(),
  position: z.number().int().min(0).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot edit custom fields");
    const { id } = await ctx.params;
    const field = await db.customField.findUnique({ where: { id }, select: { organizationId: true } });
    if (!field || field.organizationId !== session.orgId) return notFound("custom-field");
    const body = await parseJson(req);
    const v = Update.safeParse(body);
    if (!v.success) return badRequest("validation", v.error.flatten());
    const data: Record<string, unknown> = {};
    if (v.data.name !== undefined) data.name = v.data.name;
    if (v.data.options !== undefined) data.options = v.data.options as never;
    if (v.data.position !== undefined) data.position = v.data.position;
    const updated = await db.customField.update({ where: { id }, data });
    return ok({ field: updated });
  } catch (e) {
    return serverError("custom-field-update-failed", e);
  }
}
