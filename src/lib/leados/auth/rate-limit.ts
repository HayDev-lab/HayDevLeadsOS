// AUTH RATE LIMITING + BRUTE-FORCE LOCKOUT (v0.17 spec 21, 93, 99).
//
// In-memory sliding window + lockout map. This deployment is a single
// long-lived self-hosted process (standalone Next.js behind Caddy), so
// process memory is the correct store — same trade-off the delivery layer
// already makes for its demo guard. No Redis dependency (skill policy).
//
// Two mechanisms:
//   checkRateLimit(bucket, {windowMs, max})  — sliding window (false = limited)
//   registerFailure / lockStatus             — escalating lockout after N
//     failures inside the failure window (15m → 30m → 60m, capped). Never
//     permanent: locks expire on their own (spec 21: "не блокировать навечно").
//
// All state is keyed by caller-supplied buckets ("login:ip:1.2.3.4",
// "login:email:a@b.c", "invite-accept:ip:…"). Unbounded map growth is pruned
// opportunistically on every access.

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

export interface LockoutOptions {
  failureWindowMs: number;
  maxFailures: number;
  initialLockMs: number;
  maxLockMs: number;
}

export interface LockStatus {
  locked: boolean;
  retryAfterMs: number;
}

export class RateLimiter {
  private hits = new Map<string, number[]>();
  private locks = new Map<string, { until: number; strikes: number }>();
  private failures = new Map<string, number[]>();

  constructor(private readonly opts: LockoutOptions & RateLimitOptions) {}

  /** Sliding-window allow check. Records the hit when allowed. */
  checkRateLimit(bucket: string, o?: Partial<RateLimitOptions>): boolean {
    const windowMs = o?.windowMs ?? this.opts.windowMs;
    const max = o?.max ?? this.opts.max;
    const now = Date.now();
    const arr = (this.hits.get(bucket) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      this.hits.set(bucket, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(bucket, arr);
    return true;
  }

  /** Record a failed attempt; escalates the lock when the threshold is hit. */
  registerFailure(bucket: string): void {
    const now = Date.now();
    const arr = (this.failures.get(bucket) ?? []).filter((t) => now - t < this.opts.failureWindowMs);
    arr.push(now);
    this.failures.set(bucket, arr);
    if (arr.length >= this.opts.maxFailures) {
      const prev = this.locks.get(bucket);
      const strikes = (prev?.strikes ?? 0) + 1;
      const lockMs = Math.min(this.opts.initialLockMs * Math.pow(2, strikes - 1), this.opts.maxLockMs);
      this.locks.set(bucket, { until: now + lockMs, strikes });
      this.failures.set(bucket, []); // fresh window after a lock
    }
    this.prune();
  }

  /** Clear failures after a successful action (login OK → no strike build-up). */
  clearFailures(bucket: string): void {
    this.failures.delete(bucket);
    const lock = this.locks.get(bucket);
    if (lock) this.locks.set(bucket, { ...lock, strikes: Math.max(0, lock.strikes - 1) });
  }

  lockStatus(bucket: string): LockStatus {
    const lock = this.locks.get(bucket);
    if (!lock) return { locked: false, retryAfterMs: 0 };
    const remaining = lock.until - Date.now();
    if (remaining <= 0) {
      this.locks.delete(bucket);
      return { locked: false, retryAfterMs: 0 };
    }
    return { locked: true, retryAfterMs: remaining };
  }

  private prune(): void {
    if (this.locks.size + this.hits.size + this.failures.size < 5000) return;
    const now = Date.now();
    for (const [k, v] of this.locks) if (v.until < now) this.locks.delete(k);
    for (const [k, arr] of this.hits) if (!arr.some((t) => now - t < this.opts.windowMs)) this.hits.delete(k);
    for (const [k, arr] of this.failures) if (!arr.some((t) => now - t < this.opts.failureWindowMs)) this.failures.delete(k);
  }
}

/** Shared limiter for auth-sensitive routes (spec 93). */
export const authLimiter = new RateLimiter({
  // login attempts per IP
  windowMs: 60_000,
  max: 10,
  // lockout after repeated failures
  failureWindowMs: 15 * 60_000,
  maxFailures: 5,
  initialLockMs: 15 * 60_000,
  maxLockMs: 60 * 60_000,
});

/** Lighter limiter for invite acceptance / password reset / bootstrap. */
export const actionLimiter = new RateLimiter({
  windowMs: 60 * 60_000,
  max: 20,
  failureWindowMs: 60 * 60_000,
  maxFailures: 10,
  initialLockMs: 10 * 60_000,
  maxLockMs: 30 * 60_000,
});

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
