// API helpers: typed JSON responses, zod validation, error handling, org-scoped helpers.

import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthRequiredError, ForbiddenError } from "./context";
import { TenantGuardError } from "./tenant-guard";

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function created(data: unknown) {
  return NextResponse.json(data, { status: 201 });
}

export function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status: 400 });
}

export function unauthorized(message = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function forbidden(message = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function notFound(message = "Not found") {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function conflict(message: string, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status: 409 });
}

export function tooMany(message = "Too many requests", retryAfterSec?: number) {
  return NextResponse.json(
    { error: message },
    { status: 429, ...(retryAfterSec ? { headers: { "retry-after": String(retryAfterSec) } } : {}) }
  );
}

export function serverError(message: string, details?: unknown) {
  console.error("[LEADOS] serverError", message, details);
  return NextResponse.json({ error: message, details }, { status: 500 });
}

/**
 * Error mapper for route catch blocks (v0.17): auth-aware replacement for
 * serverError(). AuthRequiredError → 401, ForbiddenError → 403, everything
 * else → 500 exactly like serverError.
 */
export function apiError(message: string, details?: unknown) {
  if (details instanceof AuthRequiredError) {
    return unauthorized(details.message === "Authentication required" ? "Not authenticated" : details.message);
  }
  if (details instanceof ForbiddenError) {
    return forbidden(details.message);
  }
  if (details instanceof TenantGuardError) {
    // v0.19.2 §10: foreign ID = same outcome as missing (404, no enumeration).
    return notFound(details.code.replace(/_NOT_FOUND$/, "").toLowerCase());
  }
  return serverError(message, details);
}

export function validate<T>(
  schema: z.ZodType<T>,
  data: unknown
): { ok: true; value: T } | { ok: false; error: NextResponse } {
  const res = schema.safeParse(data);
  if (res.success) return { ok: true, value: res.data };
  return {
    ok: false,
    error: badRequest("Validation failed", res.error.flatten()),
  };
}

/** Parse a JSON body safely. */
export async function parseJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** Get an integer query param or null. */
export function qInt(v: string | null): number | null {
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/** Get a string query param or null. */
export function qStr(v: string | null): string | null {
  return v && v.length ? v : null;
}

/** Get a boolean query param (1/true → true). */
export function qBool(v: string | null): boolean {
  return v === "1" || v === "true";
}

/** Get a comma-separated array of strings. */
export function qArr(v: string | null): string[] | null {
  if (!v) return null;
  const arr = v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return arr.length ? arr : null;
}

/** Paginate helper. */
export function paginate(page: number | null, limit: number | null) {
  const p = Math.max(1, page ?? 1);
  const l = Math.min(200, Math.max(1, limit ?? 50));
  return { page: p, limit: l, skip: (p - 1) * l };
}
