import { NextResponse } from "next/server";
import { getSession } from "@/lib/leados/context";
import { ok, apiError } from "@/lib/leados/api";
import { getAnalytics } from "@/lib/leados/analytics-service";
import { cached } from "@/lib/leados/api-cache";

export async function GET() {
  try {
    const session = await getSession();
    // Heavy aggregate scan (~60+ queries) — cached 90s, invalidated eagerly on
    // any lead mutation via invalidateOrgCache() in lead-service.
    const data = await cached(`analytics:${session.orgId}`, 90_000, () => getAnalytics(session.orgId));
    return ok(data);
  } catch (e) {
    return apiError("analytics-failed", e);
  }
}
