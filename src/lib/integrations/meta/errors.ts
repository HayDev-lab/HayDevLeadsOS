// META LEAD ADS — error taxonomy (v0.19).
//
// Every failure anywhere in the Meta connector maps to ONE of these stable
// codes. The worker uses `retryable` to bound retries:
//   timeout / 429 / temporary 5xx / network  → retry (bounded)
//   auth / permission / config / unmapped    → NO automatic retry
// Codes NEVER carry PII or tokens — they are safe for UI, logs and AuditLog.

export const META_ERROR_CODE = {
  META_AUTH_ERROR: "META_AUTH_ERROR",
  META_PERMISSION_ERROR: "META_PERMISSION_ERROR",
  META_RATE_LIMIT: "META_RATE_LIMIT",
  META_TEMPORARY_ERROR: "META_TEMPORARY_ERROR",
  META_NOT_FOUND: "META_NOT_FOUND",
  META_INVALID_RESPONSE: "META_INVALID_RESPONSE",
  META_TOKEN_EXPIRED: "META_TOKEN_EXPIRED",
  META_CONFIG_ERROR: "META_CONFIG_ERROR",
  UNMAPPED_PAGE: "UNMAPPED_PAGE",
  UNMAPPED_FORM: "UNMAPPED_FORM",
} as const;

export type MetaErrorCode = (typeof META_ERROR_CODE)[keyof typeof META_ERROR_CODE];

export class MetaError extends Error {
  readonly code: MetaErrorCode;
  readonly retryable: boolean;
  /** Raw Graph error_subcode (number) — diagnostic only, never PII. */
  readonly subcode?: number;

  constructor(code: MetaErrorCode, message: string, opts?: { retryable?: boolean; subcode?: number }) {
    // Message discipline: codes + neutral text only (no tokens, no lead data).
    super(`[${code}] ${message}`);
    this.name = "MetaError";
    this.code = code;
    this.retryable = opts?.retryable ?? DEFAULT_RETRYABLE[code];
    this.subcode = opts?.subcode;
  }
}

const DEFAULT_RETRYABLE: Record<MetaErrorCode, boolean> = {
  [META_ERROR_CODE.META_AUTH_ERROR]: false,
  [META_ERROR_CODE.META_PERMISSION_ERROR]: false,
  [META_ERROR_CODE.META_RATE_LIMIT]: true,
  [META_ERROR_CODE.META_TEMPORARY_ERROR]: true,
  [META_ERROR_CODE.META_NOT_FOUND]: false,
  [META_ERROR_CODE.META_INVALID_RESPONSE]: false,
  [META_ERROR_CODE.META_TOKEN_EXPIRED]: false,
  [META_ERROR_CODE.META_CONFIG_ERROR]: false,
  [META_ERROR_CODE.UNMAPPED_PAGE]: false,
  [META_ERROR_CODE.UNMAPPED_FORM]: false,
};

/** Map a Graph API error body to the taxonomy. `body.error` shape:
 *  { message, type, code, error_subcode, error_user_title, error_user_msg } */
export function classifyGraphError(status: number, body: unknown): MetaError {
  const err = (body as { error?: { code?: number; error_subcode?: number; message?: string; type?: string } })?.error;
  const code = err?.code;
  const subcode = err?.error_subcode;
  const type = err?.type ?? "";
  const msg = err?.message ?? "Graph API error";

  // Token problems (code 190): expired (subcode 463/461) vs general invalid.
  if (code === 190) {
    if (subcode === 463 || subcode === 461) {
      return new MetaError(META_ERROR_CODE.META_TOKEN_EXPIRED, "Access token expired", { subcode });
    }
    return new MetaError(META_ERROR_CODE.META_AUTH_ERROR, "Invalid access token", { subcode });
  }
  if (status === 401 || code === 104 || type === "OAuthException") {
    return new MetaError(META_ERROR_CODE.META_AUTH_ERROR, "Authentication failed", { subcode });
  }
  if (status === 403 || code === 200 || code === 10) {
    return new MetaError(META_ERROR_CODE.META_PERMISSION_ERROR, "Permission denied", { subcode });
  }
  if (status === 429 || code === 4 || code === 17 || code === 32 || code === 613) {
    return new MetaError(META_ERROR_CODE.META_RATE_LIMIT, "Rate limited", { subcode, retryable: true });
  }
  if (status >= 500 || status === 408 || code === 1 || code === 2) {
    return new MetaError(META_ERROR_CODE.META_TEMPORARY_ERROR, "Temporary Graph error", { subcode, retryable: true });
  }
  if (status === 404) {
    return new MetaError(META_ERROR_CODE.META_NOT_FOUND, "Not found", { subcode });
  }
  return new MetaError(META_ERROR_CODE.META_INVALID_RESPONSE, `Unexpected Graph response (HTTP ${status})`, { subcode });
}
