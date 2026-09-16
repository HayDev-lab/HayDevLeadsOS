import { NextResponse } from "next/server";
import { getSession } from "@/lib/leados/context";
import { ok, serverError } from "@/lib/leados/api";
import { getAnalytics } from "@/lib/leados/analytics-service";

export async function GET() {
  try {
    const session = await getSession();
    const data = await getAnalytics(session.orgId);
    return ok(data);
  } catch (e) {
    return serverError("analytics-failed", e);
  }
}
