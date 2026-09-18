/**
 * Meta Lead Ads Integration — Error Types
 * 
 * Centralized error classification for Meta API interactions.
 */

export type MetaErrorType =
  | "META_AUTH_ERROR"
  | "META_PERMISSION_ERROR"
  | "META_RATE_LIMIT"
  | "META_NOT_FOUND"
  | "META_TEMPORARY_ERROR"
  | "META_INVALID_RESPONSE"
  | "META_WEBHOOK_INVALID_SIGNATURE"
  | "META_WEBHOOK_VERIFICATION_FAILED"
  | "META_CONFIG_ERROR"
  | "META_TOKEN_EXPIRED"
  | "META_SUBSCRIPTION_ERROR";

export class MetaIntegrationError extends Error {
  public readonly type: MetaErrorType;
  public readonly code?: number;
  public readonly subcode?: number;
  public readonly retryable: boolean;

  constructor(
    message: string,
    type: MetaErrorType,
    options?: {
      code?: number;
      subcode?: number;
      cause?: unknown;
    }
  ) {
    super(message);
    this.name = "MetaIntegrationError";
    this.type = type;
    this.code = options?.code;
    this.subcode = options?.subcode;

    // Classify retryability based on error type
    this.retryable = this.isRetryable(type, options?.code);

    if (options?.cause) {
      (this as any).cause = options.cause;
    }
  }

  private isRetryable(type: MetaErrorType, code?: number): boolean {
    switch (type) {
      case "META_RATE_LIMIT":
        return true; // 429 - retry after delay
      case "META_TEMPORARY_ERROR":
        return true; // 5xx - temporary server issues
      case "META_AUTH_ERROR":
      case "META_PERMISSION_ERROR":
      case "META_TOKEN_EXPIRED":
        return false; // Auth errors won't fix themselves without reauth
      case "META_NOT_FOUND":
        return false; // Resource doesn't exist
      case "META_INVALID_RESPONSE":
      case "META_WEBHOOK_INVALID_SIGNATURE":
      case "META_WEBHOOK_VERIFICATION_FAILED":
      case "META_CONFIG_ERROR":
      case "META_SUBSCRIPTION_ERROR":
        return false; // Configuration/validation errors
      default:
        // Check HTTP status code if available
        if (code !== undefined) {
          return code >= 500 || code === 429;
        }
        return false;
    }
  }
}

/**
 * Create a Meta error from a Graph API error response.
 * Meta Graph API errors have the structure:
 * { error: { message, type, code, subcode, fbtrace_id } }
 */
export function createMetaErrorFromApiResponse(
  apiError: {
    message?: string;
    type?: string;
    code?: number;
    subcode?: number;
    fbtrace_id?: string;
  },
  defaultMessage = "Meta API error"
): MetaIntegrationError {
  const code = apiError.code;
  const subcode = apiError.subcode;
  const message = apiError.message || defaultMessage;
  const type = apiError.type;

  // Classify error based on Meta's error codes
  // https://developers.facebook.com/docs/graph-api/guides/error-handling/
  if (code === 190 || subcode === 463 || subcode === 458 || subcode === 467) {
    // Invalid OAuth access token, session expired, etc.
    return new MetaIntegrationError(message, "META_TOKEN_EXPIRED", { code, subcode });
  }

  if (code === 100 || subcode === 2001001) {
    // Permission error
    return new MetaIntegrationError(message, "META_PERMISSION_ERROR", { code, subcode });
  }

  if (code === 429 || (code !== undefined && code >= 500 && code < 600)) {
    // Rate limit or server error
    return new MetaIntegrationError(
      message,
      code === 429 ? "META_RATE_LIMIT" : "META_TEMPORARY_ERROR",
      { code, subcode }
    );
  }

  if (code === 404 || subcode === 1) {
    // Not found
    return new MetaIntegrationError(message, "META_NOT_FOUND", { code, subcode });
  }

  if (code === 401 || code === 403) {
    // Auth error
    return new MetaIntegrationError(message, "META_AUTH_ERROR", { code, subcode });
  }

  // Default to generic error
  return new MetaIntegrationError(message, "META_INVALID_RESPONSE", { code, subcode });
}

/**
 * Type guard to check if an error is a MetaIntegrationError.
 */
export function isMetaError(error: unknown): error is MetaIntegrationError {
  return error instanceof MetaIntegrationError;
}
