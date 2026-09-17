// DEMO SEED (v0.17 guard): seeding is allowed while the database has NO
// organizations, or while LEADOS_DEMO=true (public demo). A production
// deployment with data can never be re-seeded from the API.

import { db } from "@/lib/db";
import { seedIfEmpty } from "@/lib/leados/seed";
import { ok, forbidden, apiError } from "@/lib/leados/api";
import { isDemoMode } from "@/lib/leados/context";

export async function GET() {
  try {
    const org = await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
    if (!org) return ok({ seeded: false, orgId: null });
    const counts = {
      users: await db.organizationMember.count({ where: { organizationId: org.id } }),
      leads: await db.lead.count({ where: { organizationId: org.id } }),
      sources: await db.leadSource.count({ where: { organizationId: org.id } }),
      stages: await db.pipelineStage.count({ where: { pipeline: { organizationId: org.id } } }),
    };
    return ok({ seeded: true, orgId: org.id, ...counts });
  } catch (e) {
    return apiError("seed-get-failed", e);
  }
}

export async function POST() {
  try {
    const hasOrgs = await db.organization.findFirst({ select: { id: true } });
    if (hasOrgs && !isDemoMode()) {
      return forbidden("Seeding is only available for an empty database or in demo mode.");
    }
    const result = await seedIfEmpty();
    return ok(result);
  } catch (e) {
    return apiError("seed-failed", e);
  }
}
