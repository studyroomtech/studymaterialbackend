// Stable error codes for the unified Backend API error envelope.
//
// Every Backend API error returns a consistent JSON envelope of the form
// `{ "error": { "code", "message", "fields?" } }`. These `code` values are the
// stable, machine-readable identifiers the Frontend Project uses to render
// messages uniformly.
//
// References:
//   - Req 8.3:  Malformed / invalid input -> VALIDATION_ERROR (422).
//   - Req 6.1 / 6.7 / 10.6 / 10.8: Missing/expired/invalid auth -> AUTH_REQUIRED (401).
//   - Req 10.7: role_common attempts an admin action -> FORBIDDEN (403).
//   - Req 5.4 / 11.4 / 11.12: Entity not found -> NOT_FOUND (404).
//   - Req 8.4 / 8.5: Unexpected server error -> INTERNAL_ERROR (500).
//
// Payment-specific error codes (Phase 2, Req 12):
//   - Req 12.3:  A Paid Material requested without an Entitlement -> PAYMENT_REQUIRED (403).
//   - Req 12.10: A Payment initiated for a Free Material -> PAYMENT_NOT_REQUIRED (422).
//   - Req 12.11: A Payment initiated when already entitled -> ALREADY_ENTITLED (409).
//   - Req 12.7 / 12.18: Payment Signature Verification fails / no matching record
//     -> PAYMENT_VERIFICATION_FAILED (400).
//   - Req 12.19 / 12.24: A Razorpay Webhook whose signature does not verify
//     -> WEBHOOK_VERIFICATION_FAILED (400).
//
// Rate limiting:
//   - Too many requests within the configured window -> TOO_MANY_REQUESTS (429).

export const VALIDATION_ERROR = 'VALIDATION_ERROR';
export const AUTH_REQUIRED = 'AUTH_REQUIRED';
export const FORBIDDEN = 'FORBIDDEN';
export const NOT_FOUND = 'NOT_FOUND';
export const INTERNAL_ERROR = 'INTERNAL_ERROR';
export const PAYMENT_REQUIRED = 'PAYMENT_REQUIRED';
export const PAYMENT_NOT_REQUIRED = 'PAYMENT_NOT_REQUIRED';
export const ALREADY_ENTITLED = 'ALREADY_ENTITLED';
export const PAYMENT_VERIFICATION_FAILED = 'PAYMENT_VERIFICATION_FAILED';
export const WEBHOOK_VERIFICATION_FAILED = 'WEBHOOK_VERIFICATION_FAILED';
export const TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS';

// Grouped view of the error codes for convenient, type-safe access.
export const ERROR_CODES = {
  VALIDATION_ERROR,
  AUTH_REQUIRED,
  FORBIDDEN,
  NOT_FOUND,
  INTERNAL_ERROR,
  PAYMENT_REQUIRED,
  PAYMENT_NOT_REQUIRED,
  ALREADY_ENTITLED,
  PAYMENT_VERIFICATION_FAILED,
  WEBHOOK_VERIFICATION_FAILED,
  TOO_MANY_REQUESTS,
} as const;
