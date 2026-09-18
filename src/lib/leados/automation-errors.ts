// HAYDEV LEADOS — AUTOMATION/DELIVERY ERROR MODEL (v0.16, spec 20–23, 68–70).
//
// Centralized error classification. The UI NEVER guesses retryability from
// string matching — it reads errorCode + errorParams and renders a localized
// message in the viewer's locale. English `error`/`errorMessage` snapshots
// are kept on the rows only as an export/debug fallback.
//
// RETRYABLE (spec 22): DB/network timeout, provider temporary error, 429, 5xx.
// NON-RETRYABLE (spec 22): missing owner, invalid recipient, invalid
// configuration, deleted entity, channel not connected.

// ---------------------------------------------------------------------------
// Codes (spec 69–70)
// ---------------------------------------------------------------------------

export const AUTO_ERROR = {
  // Non-retryable — business/configuration facts.
  NO_LEAD_OWNER: "NO_LEAD_OWNER",
  NO_RECIPIENT: "NO_RECIPIENT",
  INVALID_RECIPIENT: "INVALID_RECIPIENT",
  LEAD_NOT_FOUND: "LEAD_NOT_FOUND",
  TASK_NOT_FOUND: "TASK_NOT_FOUND",
  CHANNEL_NOT_CONNECTED: "CHANNEL_NOT_CONNECTED",
  CHANNEL_NOT_CONFIGURED: "CHANNEL_NOT_CONFIGURED",
  INVALID_WEBHOOK_URL: "INVALID_WEBHOOK_URL",
  INVALID_ENDPOINT: "INVALID_ENDPOINT",
  UNKNOWN_ACTION: "UNKNOWN_ACTION",
  NO_SPECIFIC_USER: "NO_SPECIFIC_USER",
  NO_ORG_OWNER: "NO_ORG_OWNER",
  // Retryable — transient.
  PROVIDER_TIMEOUT: "PROVIDER_TIMEOUT",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  RATE_LIMITED: "RATE_LIMITED",
  NETWORK_ERROR: "NETWORK_ERROR",
  DB_TEMPORARY_ERROR: "DB_TEMPORARY_ERROR",
  // Worker-level (spec 70).
  WORKER_CRASHED: "WORKER_CRASHED",
  MAX_ATTEMPTS_EXCEEDED: "MAX_ATTEMPTS_EXCEEDED",
  LEASE_BUSY: "LEASE_BUSY",
  TIME_BUDGET_EXCEEDED: "TIME_BUDGET_EXCEEDED",
  // Unknown exception (conservatively non-retryable: a code bug won't heal).
  ACTION_FAILED: "ACTION_FAILED",
} as const;
export type AutoErrorCode = (typeof AUTO_ERROR)[keyof typeof AUTO_ERROR];

const RETRYABLE_CODES = new Set<string>([
  AUTO_ERROR.PROVIDER_TIMEOUT,
  AUTO_ERROR.PROVIDER_UNAVAILABLE,
  AUTO_ERROR.RATE_LIMITED,
  AUTO_ERROR.NETWORK_ERROR,
  AUTO_ERROR.DB_TEMPORARY_ERROR,
  AUTO_ERROR.WORKER_CRASHED, // crash recovery retries once, effects are idempotent
]);

/** Heuristic patterns for unknown exceptions (spec 22: timeouts/temporary). */
const TRANSIENT_PATTERNS: RegExp[] = [
  /timeout/i,
  /temporar/i,
  /network/i,
  /ECONN/i,
  /ETIMEDOUT/i,
  /EAI_AGAIN/i,
  /too many requests/i,
  /\b429\b/,
  /\b50[0234]\b/,
  /SQLITE_BUSY/i,
  /database is locked/i,
];

export interface ErrorFacts {
  code: AutoErrorCode;
  retryable: boolean;
  /** English human snapshot (fallback only — UI renders from code, spec 68). */
  message: string;
  params?: Record<string, string | number>;
}

export function classifyAutomationError(input: {
  code?: string | null;
  message?: string | null;
  /** HTTP-ish status for provider errors (429/5xx → retryable). */
  status?: number | null;
}): ErrorFacts {
  const message = input.message ?? "";
  if (input.code && isKnownCode(input.code)) {
    return {
      code: input.code as AutoErrorCode,
      retryable: RETRYABLE_CODES.has(input.code),
      message: message || input.code,
    };
  }
  if (typeof input.status === "number") {
    if (input.status === 429) {
      return { code: AUTO_ERROR.RATE_LIMITED, retryable: true, message: message || "Rate limited (429)." };
    }
    if (input.status >= 500) {
      return { code: AUTO_ERROR.PROVIDER_UNAVAILABLE, retryable: true, message: message || `Provider error (${input.status}).` };
    }
  }
  if (TRANSIENT_PATTERNS.some((re) => re.test(message))) {
    return { code: AUTO_ERROR.NETWORK_ERROR, retryable: true, message: message || "Temporary network error." };
  }
  return { code: AUTO_ERROR.ACTION_FAILED, retryable: false, message: message || "The action could not be completed." };
}

function isKnownCode(code: string): code is AutoErrorCode {
  return Object.values(AUTO_ERROR as Record<string, string>).includes(code);
}

// ---------------------------------------------------------------------------
// Retry policy (spec 20–21): max 3 attempts, backoff 1m / 5m / 15m.
// ---------------------------------------------------------------------------

export const MAX_AUTOMATION_ATTEMPTS = 3;
export const MAX_DELIVERY_ATTEMPTS = 3;

/** Backoff BEFORE the Nth retry (attemptCount = attempts already made). */
export function retryBackoffMs(attemptCount: number, now = new Date()): number {
  const schedule = [60_000, 5 * 60_000, 15 * 60_000]; // 1m, 5m, 15m
  const idx = Math.max(0, Math.min(attemptCount - 1, schedule.length - 1));
  // Deterministic for tests: pure arithmetic on the given clock.
  void now;
  return schedule[idx];
}

export function nextRetryAt(attemptCount: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + retryBackoffMs(attemptCount));
}

/** Should a failed row be retried automatically? (bounded, spec 21). */
export function canAutoRetry(attemptCount: number, retryable: boolean): boolean {
  return retryable && attemptCount < MAX_AUTOMATION_ATTEMPTS;
}

// ---------------------------------------------------------------------------
// Typed error for action handlers / providers.
// ---------------------------------------------------------------------------

export class AutoError extends Error {
  readonly code: AutoErrorCode;
  readonly retryable: boolean;
  readonly status?: number;
  readonly params?: Record<string, string | number>;

  constructor(facts: { code: AutoErrorCode; message?: string; status?: number; params?: Record<string, string | number> }) {
    const classified = classifyAutomationError({ code: facts.code, message: facts.message, status: facts.status });
    super(classified.message);
    this.name = "AutoError";
    this.code = facts.code;
    this.retryable = classified.retryable;
    this.status = facts.status;
    this.params = facts.params;
  }
}
