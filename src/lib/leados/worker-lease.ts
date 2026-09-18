// HAYDEV LEADOS — WORKER LEASE (v0.16, spec 8–10).
//
// DB-backed distributed lock: two schedulers (or scheduler + manual API call)
// must never process the same batch concurrently. One ACTIVE lease per worker
// type, enforced by WorkerLease.type UNIQUE.
//
// SEMANTICS (spec 9): a lease carries an expiresAt. If the holder dies, the
// lease simply expires — the next worker takes over after expiry. There is NO
// permanent lock. Every pipeline step is idempotent, so a takeover after
// expiry is safe: at worst a pair is re-checked and no-ops.
//
// ACQUIRE STRATEGY (single-writer friendly):
//   1. try UPDATE ... WHERE type = ? AND expiresAt < now   (take over EXPIRED)
//   2. if 0 rows → try INSERT                              (fresh lock)
//   3. both fail → LEASE_BUSY
// The UPDATE-first order avoids insert/delete churn on the hot path and keeps
// exactly one row per type.

import { db } from "@/lib/db";

export const WORKER_LEASE_TYPE = {
  WORKERS: "WORKERS",
  DELIVERY: "NOTIFICATION_DELIVERY",
  META: "META_LEAD_WORKER",
} as const;
export type WorkerLeaseType = (typeof WORKER_LEASE_TYPE)[keyof typeof WORKER_LEASE_TYPE];

/** Default lease TTL: enough for a full budgeted run (spec 10 — batch-level lease). */
export const DEFAULT_LEASE_TTL_MS = 90_000;

export type LeaseResult =
  | { ok: true; leaseId: string }
  | { ok: false; reason: "LEASE_BUSY"; holderRunId: string | null; expiresAt: Date };

/** Try to acquire (or take over an EXPIRED) lease for a worker type. */
export async function acquireWorkerLease(
  type: WorkerLeaseType,
  holderRunId: string,
  ttlMs: number = DEFAULT_LEASE_TTL_MS
): Promise<LeaseResult> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  // 1. Take over an expired lease (single conditional UPDATE — atomic).
  const taken = await db.workerLease.updateMany({
    where: { type, expiresAt: { lt: now } },
    data: { holderRunId, acquiredAt: now, expiresAt },
  });
  if (taken.count > 0) {
    const row = await db.workerLease.findUnique({ where: { type } });
    return { ok: true, leaseId: row?.id ?? "taken-over" };
  }

  // 2. Fresh lease (INSERT); unique(type) loses a race → busy.
  try {
    const row = await db.workerLease.create({ data: { type, holderRunId, acquiredAt: now, expiresAt } });
    return { ok: true, leaseId: row.id };
  } catch {
    const row = await db.workerLease.findUnique({ where: { type } });
    return { ok: false, reason: "LEASE_BUSY", holderRunId: row?.holderRunId ?? null, expiresAt: row?.expiresAt ?? now };
  }
}

/** Extend (heartbeat) the lease — only its current holder may (spec 10). */
export async function extendWorkerLease(
  type: WorkerLeaseType,
  holderRunId: string,
  ttlMs: number = DEFAULT_LEASE_TTL_MS
): Promise<boolean> {
  const now = new Date();
  const extended = await db.workerLease.updateMany({
    where: { type, holderRunId },
    data: { expiresAt: new Date(now.getTime() + ttlMs) },
  });
  return extended.count > 0;
}

/** Release the lease (only its current holder). Never throws. */
export async function releaseWorkerLease(type: WorkerLeaseType, holderRunId: string): Promise<void> {
  try {
    await db.workerLease.deleteMany({ where: { type, holderRunId } });
  } catch (e) {
    console.error(`[WORKER-LEASE] release failed type=${type} run=${holderRunId}:`, e);
  }
}

/** Inspect the current lease for diagnostics (Worker Health). */
export async function getWorkerLease(type: WorkerLeaseType) {
  const row = await db.workerLease.findUnique({ where: { type } });
  if (!row) return { active: false as const };
  return {
    active: row.expiresAt.getTime() > Date.now(),
    holderRunId: row.holderRunId,
    acquiredAt: row.acquiredAt,
    expiresAt: row.expiresAt,
  };
}
