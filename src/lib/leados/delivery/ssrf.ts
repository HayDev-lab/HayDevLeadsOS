// HAYDEV LEADOS — WEBHOOK SSRF PROTECTION (v0.16, spec 54–55).
//
// A user-configured webhook URL is a classic SSRF vector: it can make the
// server POST into its own infrastructure (localhost, private LAN, cloud
// metadata). This module validates a URL BEFORE it is ever stored or fetched:
//
//   - http/https only (file://, ftp:, gopher: ... rejected)
//   - no userinfo (user:pass@host)
//   - hostname not localhost / *.localhost
//   - literal IPs checked against private/reserved ranges (IPv4 + IPv6)
//   - DNS names RESOLVED and every resolved address checked
//   - at FETCH time: redirect: "manual" so a redirect can never bypass
//     validation (spec 55) — 3xx responses are treated as failures.

import { lookup } from "dns/promises";
import { isIP } from "net";

export type SsrfRejection =
  | "INVALID_URL"
  | "INVALID_SCHEME"
  | "USERINFO_NOT_ALLOWED"
  | "LOCALHOST_BLOCKED"
  | "PRIVATE_ADDRESS_BLOCKED"
  | "RESOLUTION_FAILED";

export interface SsrfResult {
  ok: boolean;
  error?: SsrfRejection;
  detail?: string;
}

/** Private / reserved IPv4 ranges (RFC1918, loopback, link-local, CGNAT, ...). */
function privateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + TEST-NET-1 192.0.2.0/24
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/** Private / reserved IPv6 (::1, ULA fc00::/7, link-local fe80::/10, ...). */
function privateIPv6(ip: string): boolean {
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true; // unspecified, loopback
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) → check the v4.
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) ?? v6.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateIPv4(mapped[1]);
  if (v6.startsWith("fc") || v6.startsWith("fd")) return true; // unique local
  if (v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb")) return true; // link-local
  if (v6.startsWith("ff")) return true; // multicast
  if (v6.startsWith("2001:db8")) return true; // documentation
  return false;
}

function privateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return privateIPv4(ip);
  if (kind === 6) return privateIPv6(ip);
  return true; // not an IP at all → treat as blocked (defensive)
}

/**
 * Validate a webhook URL. Async because DNS names are resolved (spec 54).
 * `resolve` is injectable for tests.
 */
export async function validateWebhookUrl(
  url: string,
  opts: { resolve?: (host: string) => Promise<{ address: string }[]> } = {}
): Promise<SsrfResult> {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { ok: false, error: "INVALID_URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "INVALID_SCHEME" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "USERINFO_NOT_ALLOWED" };
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, error: "LOCALHOST_BLOCKED", detail: host };
  }
  // Underscore hostnames are invalid per RFC and often internal aliases.
  if (host.includes("_")) return { ok: false, error: "LOCALHOST_BLOCKED", detail: host };

  const kind = isIP(host);
  if (kind !== 0) {
    if (privateAddress(host)) return { ok: false, error: "PRIVATE_ADDRESS_BLOCKED", detail: host };
    return { ok: true };
  }

  // DNS name: resolve and validate EVERY address.
  try {
    const resolve = opts.resolve ?? ((h: string) => lookup(h, { all: true, verbatim: true }));
    const addrs = await resolve(host);
    if (!addrs.length) return { ok: false, error: "RESOLUTION_FAILED", detail: host };
    for (const a of addrs) {
      if (privateAddress(a.address)) {
        return { ok: false, error: "PRIVATE_ADDRESS_BLOCKED", detail: `${host} → ${a.address}` };
      }
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "RESOLUTION_FAILED", detail: host };
  }
}
