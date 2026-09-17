import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, serverError, validate, parseJson, badRequest } from "@/lib/leados/api";
import { TaskCreate } from "@/lib/schemas/lead";
import { TASK_TYPE } from "@/lib/leados/constants";
import { createTask } from "@/lib/leados/task-service";

export async function GET(req: Request) {
  try {
    const session = await getSession();
    const url = new URL(req.url);
    // Accept BOTH ?status=TODO&status=IN_PROGRESS and ?status=TODO,IN_PROGRESS
    // (the client hook joins with a comma — keep both contracts working).
    const status = url.searchParams.getAll("status").flatMap((s) => s.split(",")).filter(Boolean);
    const where: Record<string, unknown> = { organizationId: session.orgId };
    if (status.length) where.status = { in: status };
    else where.status = { in: ["TODO", "IN_PROGRESS"] };
    const rows = await db.task.findMany({
      where,
      include: {
        lead: { select: { id: true, firstName: true, lastName: true, company: true } },
        assignee: { select: { id: true, name: true, avatarColor: true } },
      },
      orderBy: [{ createdAt: "desc" }],
    });
    return ok({ rows });
  } catch (e) {
    return serverError("tasks-list-failed", e);
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot create tasks");
    const body = await parseJson(req);
    const v = validate(TaskCreate, body);
    if (!v.ok) return v.error;
    try {
      const task = await createTask(session.orgId, {
        title: v.value.title,
        description: v.value.description ?? null,
        leadId: v.value.leadId ?? null,
        assignedTo: v.value.assignedTo ?? session.userId,
        priority: v.value.priority ?? "MEDIUM",
        dueAt: v.value.dueAt ? new Date(v.value.dueAt) : null,
        type: v.value.type ?? TASK_TYPE.TASK,
        actorUserId: session.userId,
      });
      return ok({ task });
    } catch (e) {
      if ((e as Error)?.message === "LEAD_NOT_FOUND") return badRequest("lead-not-in-org");
      throw e;
    }
  } catch (e) {
    return serverError("task-create-failed", e);
  }
}
