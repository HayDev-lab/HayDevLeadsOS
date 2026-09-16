import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, canMutate } from "@/lib/leados/context";
import { ok, badRequest, serverError, parseJson, validate } from "@/lib/leados/api";
import { z } from "zod";
import { ROLES } from "@/lib/leados/constants";

export async function GET() {
  try {
    const session = await getSession();
    const rows = await db.user.findMany({
      where: { organizationId: session.orgId },
      select: { id: true, name: true, email: true, role: true, status: true, title: true, avatarColor: true, phone: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    return ok({ rows });
  } catch (e) {
    return serverError("users-list-failed", e);
  }
}

const Create = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum([ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER, ROLES.SALES_MANAGER, ROLES.VIEWER]).default(ROLES.MANAGER),
  title: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!canMutate(session.role)) return badRequest("Viewers cannot create users");
    const body = await parseJson(req);
    const v = validate(Create, body);
    if (!v.ok) return v.error;
    const existing = await db.user.findUnique({ where: { organizationId_email: { email: v.value.email, organizationId: session.orgId } } });
    if (existing) return badRequest("user-already-exists");
    const user = await db.user.create({
      data: {
        organizationId: session.orgId,
        name: v.value.name,
        email: v.value.email,
        role: v.value.role,
        status: "ACTIVE",
        title: v.value.title ?? null,
      },
    });
    return ok({ user });
  } catch (e) {
    return serverError("user-create-failed", e);
  }
}
