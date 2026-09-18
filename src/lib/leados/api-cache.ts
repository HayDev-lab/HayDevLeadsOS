// In-memory TTL cache for expensive read APIs (analytics, dashboard).
//
// Rationale (v0.19 spec): getAnalytics() runs ~60+ aggregate scans per call
// (30-day loop + per-lead first-activity lookups), and the dashboard fires it
// on every visit since the mini-forecast widget landed. At demo scale that is
// 300–500ms per request; a short-lived per-org cache removes the repeat cost.
//
// Design:
//  - Per-org keys (`<scope>:<orgId>`), TTL 45–90s — bounded staleness only.
//  - Mutations invalidate eagerly via invalidateOrgCache() (lead-service +
//    task mutations), so users never see their own writes stale in practice.
//  - Single-instance, in-process (matches the "local memory caching" stack
//    rule). Multi-instance deployments must run this per node or disable.
//  - LRU-ish guard: max 512 entries, oldest-insert evicted first; expired
//    entries are swept lazily on read.

type CacheEntry = {
  value: unknown;
  expiresAt: number;
  insertedAt: number;
};

const MAX_ENTRIES = 512;

// NOTE: the store MUST live on globalThis. In dev (and per-route output
// bundling) each API route gets its own module graph — a plain module-level
// Map would be duplicated per route, and invalidations fired from
// lead-service would never reach the copy the analytics route reads.
// Same singleton pattern as src/lib/db.ts uses for Prisma.
const globalForCache = globalThis as unknown as {
  __leadosApiCache?: Map<string, CacheEntry>;
};
const store: Map<string, CacheEntry> = (globalForCache.__leadosApiCache ??= new Map());

/** Get a value from cache or compute, store and return it. */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;

  const value = await fn();
  if (store.size >= MAX_ENTRIES) {
    // evict the oldest inserted entry (Map preserves insertion order)
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expiresAt: now + ttlMs, insertedAt: now });
  return value;
}

/** Drop all cached entries for an organization (any scope). */
export function invalidateOrgCache(orgId: string): void {
  if (!orgId) return;
  const suffix = `:${orgId}`;
  for (const key of store.keys()) {
    if (key.endsWith(suffix)) store.delete(key);
  }
}

/** Test/introspection helper — not used by request paths. */
export function cacheSize(): number {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  return store.size;
}
