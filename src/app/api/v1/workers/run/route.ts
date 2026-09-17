// POST /api/v1/workers/run — WORKER ORCHESTRATOR endpoint (spec 83).
//
// Reconcile → project notifications → process automations, each step
// independently retryable (spec 82). NO production scheduler exists in this
// deployment — this endpoint is the honest target for an external cron
// (protected by the WORKERS_SECRET header when configured) and is also
// called by the client tick while the app is open (demo fallback, spec 84).
//
// Auth: EITHER a valid session (any user of the org) OR the
// x-workers-secret header matching the WORKERS_SECRET env var.

import { getSession } from "@/lib/leados/context";
import { ok, serverError, unauthorized } from "@/lib/leados/api";
import { runLeadOSWorkers } from "@/lib/leados/leados-workers";

export async function POST(req: Request) {
  try {
    const secret = process.env.WORKERS_SECRET;
    let orgId: string | null = null;

    if (secret && req.headers.get("x-workers-secret") === secret) {
      // Secret-authenticated external scheduler: run for the first org.
      const { db } = await import("@/lib/db");
      const org = await db.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
      orgId = org?.id ?? null;
    } else {
      try {
        const session = await getSession();
        orgId = session.orgId;
      } catch {
        orgId = null;
      }
    }

    if (!orgId) {
      return unauthorized("Provide a session or the x-workers-secret header");
    }

    const result = await runLeadOSWorkers(orgId);
    return ok({ ok: true, result });
  } catch (e) {
    return serverError("workers-run-failed", e);
  }
}
