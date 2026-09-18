import { NextResponse } from "next/server";
import { getSession } from "@/lib/leados/context";
import { ok, apiError } from "@/lib/leados/api";
import { getTeamPerformance } from "@/lib/leados/team-service";

export async function GET() {
  try {
    const session = await getSession();
    const data = await getTeamPerformance(session.orgId);
    return ok(data);
  } catch (e) {
    return apiError("team-perf-failed", e);
  }
}
