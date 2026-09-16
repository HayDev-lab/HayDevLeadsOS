import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getSession } from "@/lib/leados/context";
import { ok, badRequest, serverError, validate } from "@/lib/leados/api";
import { z } from "zod";

export async function GET() {
  try {
    const session = await getSession();
    const users = await db.user.findMany({
      where: { organizationId: session.orgId, status: "ACTIVE" },
      select: { id: true, name: true, email: true, role: true, title: true, avatarColor: true },
      orderBy: { createdAt: "asc" },
    });
    return ok({ session, users });
  } catch (e) {
    return serverError("session-failed", e);
  }
}

const Switch = z.object({ userId: z.string().min(1) });

export async function POST(req: Request) {
  try {
    const session = await getSession();
    const body = await req.json().catch(() => null);
    const v = validate(Switch, body);
    if (!v.ok) return v.error;
    const user = await db.user.findUnique({ where: { id: v.value.userId } });
    if (!user || user.organizationId !== session.orgId) return badRequest("user-not-in-org");
    const c = await cookies();
    c.set("leados_uid", user.id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return ok({ ok: true, user: { id: user.id, name: user.name, role: user.role } });
  } catch (e) {
    return serverError("switch-user-failed", e);
  }
}
