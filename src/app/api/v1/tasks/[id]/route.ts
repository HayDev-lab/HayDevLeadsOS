import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError, notFound, parseJson } from "@/lib/leados/api";
import { z } from "zod";

const Patch = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "DONE", "CANCELLED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  assignedTo: z.string().nullable().optional(),
  dueAt: z.string().nullable().optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot edit tasks");
    const { id } = await ctx.params;
    const task = await db.task.findUnique({ where: { id }, select: { organizationId: true } });
    if (!task || task.organizationId !== session.orgId) return notFound("task");
    const body = await parseJson(req);
    const v = Patch.safeParse(body);
    if (!v.success) return badRequest("validation", v.error.flatten());
    const data: Record<string, unknown> = {};
    if (v.data.title !== undefined) data.title = v.data.title;
    if (v.data.description !== undefined) data.description = v.data.description;
    if (v.data.status !== undefined) {
      data.status = v.data.status;
      if (v.data.status === "DONE") data.completedAt = new Date();
    }
    if (v.data.priority !== undefined) data.priority = v.data.priority;
    if (v.data.assignedTo !== undefined) data.assignedTo = v.data.assignedTo;
    if (v.data.dueAt !== undefined) data.dueAt = v.data.dueAt ? new Date(v.data.dueAt) : null;
    const updated = await db.task.update({ where: { id }, data });
    return ok({ task: updated });
  } catch (e) {
    return serverError("task-update-failed", e);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot delete tasks");
    const { id } = await ctx.params;
    const task = await db.task.findUnique({ where: { id }, select: { organizationId: true } });
    if (!task || task.organizationId !== session.orgId) return notFound("task");
    await db.task.delete({ where: { id } });
    return ok({ ok: true });
  } catch (e) {
    return serverError("task-delete-failed", e);
  }
}
