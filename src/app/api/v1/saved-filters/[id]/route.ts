import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError, notFound, parseJson } from "@/lib/leados/api";
import { z } from "zod";

const Update = z.object({
  name: z.string().min(1).max(60).optional(),
  query: z.record(z.string(), z.unknown()).optional(),
  isShared: z.boolean().optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot edit saved filters");
    const { id } = await ctx.params;
    const filter = await db.savedFilter.findUnique({ where: { id } });
    if (!filter || filter.organizationId !== session.orgId) return notFound("saved-filter");
    // only owner or admin can edit
    if (filter.userId !== session.userId && session.role !== "OWNER" && session.role !== "ADMIN") return badRequest("not-owner");
    const body = await parseJson(req);
    const v = Update.safeParse(body);
    if (!v.success) return badRequest("validation", v.error.flatten());
    const data: Record<string, unknown> = {};
    if (v.data.name !== undefined) data.name = v.data.name;
    if (v.data.query !== undefined) data.query = v.data.query as never;
    if (v.data.isShared !== undefined) data.isShared = v.data.isShared;
    const updated = await db.savedFilter.update({ where: { id }, data });
    return ok({ filter: updated });
  } catch (e) {
    return serverError("saved-filter-update-failed", e);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot delete saved filters");
    const { id } = await ctx.params;
    const filter = await db.savedFilter.findUnique({ where: { id } });
    if (!filter || filter.organizationId !== session.orgId) return notFound("saved-filter");
    if (filter.userId !== session.userId && session.role !== "OWNER" && session.role !== "ADMIN") return badRequest("not-owner");
    await db.savedFilter.delete({ where: { id } });
    return ok({ ok: true });
  } catch (e) {
    return serverError("saved-filter-delete-failed", e);
  }
}
