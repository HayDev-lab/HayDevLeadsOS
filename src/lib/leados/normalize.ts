// Normalization utilities — phone (E.164-ish), email, names.
// Used for duplicate detection and search. Pure functions, deterministic.

const ARM_PHONE_PREFIX = "+374";

/**
 * Normalize a phone number to a comparable canonical form.
 * Handles Armenian (+374), common formats, strips spaces/dashes.
 * Returns null if the input is empty or unusable.
 */
export function normalizePhone(input?: string | null): string | null {
  if (!input) return null;
  let s = String(input).trim();
  if (!s) return null;
  // Keep digits and leading +
  const hasPlus = s.startsWith("+");
  s = s.replace(/[^\d]/g, "");
  if (!s) return null;

  // Armenia: 094XXXXXX / 010XXXXXX / +374.. / 374..
  if (hasPlus && s.startsWith("374")) {
    return "+" + s;
  }
  if (!hasPlus && s.startsWith("374") && s.length === 11) {
    return "+" + s;
  }
  if (s.startsWith("0") && s.length === 9) {
    // local Armenian number starting with 0
    return ARM_PHONE_PREFIX + s.slice(1);
  }
  if (s.length === 8) {
    // bare 8-digit Armenian number (landline without 0)
    return ARM_PHONE_PREFIX + s;
  }
  if (hasPlus) return "+" + s;
  // fallback — return digits as-is, prefixed with + if length suggests international
  return s.length > 8 ? "+" + s : s;
}

/**
 * Normalize email to a canonical lowercase trimmed form.
 */
export function normalizeEmail(input?: string | null): string | null {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  if (!s) return null;
  // basic shape check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s;
}

/** Normalize a person/company name: trim, collapse spaces, title-case-ish. */
export function normalizeName(input?: string | null): string | null {
  if (!input) return null;
  const s = String(input).trim().replace(/\s+/g, " ");
  return s.length ? s : null;
}

/** Combined contact identity key for dedupe (phone preferred over email). */
export function dedupeKey(opts: {
  normalizedPhone?: string | null;
  normalizedEmail?: string | null;
}): string | null {
  if (opts.normalizedPhone) return "p:" + opts.normalizedPhone;
  if (opts.normalizedEmail) return "e:" + opts.normalizedEmail;
  return null;
}

export function initials(first?: string | null, last?: string | null): string {
  const f = (first || "").trim()[0] || "";
  const l = (last || "").trim()[0] || "";
  return (f + l).toUpperCase() || "?";
}

/** Format an estimated value in a compact way: 1 200 000 → "1.2M" or with currency. */
export function formatMoney(value?: number | null, currency = "AMD"): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M ${currency}`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K ${currency}`;
  return `${value} ${currency}`;
}
