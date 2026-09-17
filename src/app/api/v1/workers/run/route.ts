// POST /api/v1/workers/run — WORKER ORCHESTRATOR endpoint (v0.16 hardened).
//
// Reconcile → project → automations → fan-out → deliveries for ALL orgs,
// each step independently retryable (spec 82), under ONE DB lease + ONE
// durable WorkerRun. The PRODUCTION trigger is the in-process scheduler
// (instrumentation.ts); this endpoint serves manual runs and external cron.
//
// SECURITY (v0.16 spec 5–6):
//   • Authorization: EITHER a valid session (any user of the org) OR the
//     x-workers-secret header matching WORKERS_SECRET — compared in CONSTANT
//     TIME (timingSafeEqual), never a plain ===;
//   • the secret lives ONLY in the environment (spec 88);
//   • parallel runs are serialized by the DB lease — the second caller gets
//     HTTP 409 LEASE_BUSY instead of double-processing (spec 8, TEST D);
//   • the response carries COUNTS only — never event/notification payloads
//     (spec 6: no sensitive payload out of a worker endpoint).

import { timingSafeEqual } from "crypto";
import { getSession } from "@/lib/leados/context";
import { ok, serverError, unauthorized, conflict } from "@/lib/leados/api";
import { runAllLeadOSWorkers, runLeadOSWorkers } from "@/lib/leados/leados-workers";

/** Constant-time secret comparison (both must be non-empty). */
function secretsMatch(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  if (a.length !== b.length) {
    // Still burn a comparison to keep timing uniform-ish.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  try {
    const secret = process.env.WORKERS_SECRET;
    let orgId: string | null = null;
    let trigger = "manual-api";

    if (secretsMatch(req.headers.get("x-workers-secret"), secret)) {
      // Secret-authenticated external scheduler: run for ALL orgs.
      const { db } = await import("@/lib/db");
      const orgs = await db.organization.findMany({ orderBy: { createdAt: "asc" }, select: { id: true } });
      orgId = orgs[0]?.id ?? null;
      const result = await runAllLeadOSWorkers({ orgIds: orgs.map((o) => o.id), trigger: "scheduler" });
      if (result.status === "LEASE_BUSY") {
        return conflict("LEASE_BUSY", { code: "LEASE_BUSY", runId: result.runId });
      }
      return ok({
        ok: true,
        runId: result.runId,
        status: result.status,
        durationMs: result.durationMs,
        stats: result.stats,
      });
    }

    // Session-authenticated run (dev/demo/manual): scoped to the caller's org.
    try {
      const session = await getSession();
      orgId = session.orgId;
      trigger = req.headers.get("x-worker-trigger") === "client-tick" ? "client-tick" : "manual-api";
    } catch {
      orgId = null;
    }

    if (!orgId) {
      return unauthorized("Provide a session or the x-workers-secret header");
    }

    const result = await runLeadOSWorkers(orgId);
    if (result.status === "LEASE_BUSY") {
      return conflict("LEASE_BUSY", { code: "LEASE_BUSY", runId: result.runId });
    }
    return ok({
      ok: true,
      runId: result.runId,
      status: result.status,
      durationMs: result.durationMs,
      stats: result.stats,
    });
  } catch (e) {
    return serverError("workers-run-failed", e);
  }
}
