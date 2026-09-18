import { NextResponse } from "next/server";
import { getSession } from "@/lib/leados/context";
import { ok, apiError } from "@/lib/leados/api";
import { getTeamPerformance } from "@/lib/leados/team-service";
import { cached } from "@/lib/leados/api-cache";

export async function GET() {
  try {
    const session = await getSession();
    // TTL-bounded stats cache (v0.20): the aggregation scans tasks + leads +
    // activities per user; staleness of ≤60s is acceptable for a team board.
    const data = await cached(`team:${session.orgId}`, 60_000, () =>
      getTeamPerformance(session.orgId)
    );
    return ok(data);
  } catch (e) {
    return apiError("team-perf-failed", e);
  }
}
