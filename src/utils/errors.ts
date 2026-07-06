// Typed domain errors for the Study Materials Platform backend.
//
// Each error carries a stable, machine-readable `code` (from
// `errorCodes.constant.ts`) plus the HTTP `statusCode` the Backend API returns,
// and an optional per-field `fields` payload for validation failures. The
// errorHandler middleware (Task 3.4) maps any thrown `AppError` into the single
// error envelope `{ error: { code, message, fields? } }` (Req 8.1, 8.3, 8.4),
// while unknown/non-AppError throwables become a generic INTERNAL_ERROR so no
// internal details leak to the caller (Req 8.4).

import { ERROR_CODES } from '../constants/errorCodes.constant';
import type { ApiErrorDto, ApiErrorFieldDto } from '../types/api.types';

/**
 * Base class for every expected/domain error. Services and middleware throw an
 * `AppError` (or one of its subclasses) to signal a specific failure with a
 * stable error code and HTTP status. Anything that is not an `AppError` is
 * treated by the errorHandler as an unexpected server error.
 */
export class AppError extends Error {
  /** Stable, machine-readable error code from `errorCodes.constant.ts`. */
  public readonly code: string;

  /** HTTP status code the Backend API returns for this error. */
  public readonly statusCode: number;

  /** Optional per-field details for validation errors (Req 8.3). */
  public readonly fields?: ApiErrorFieldDto[];

  constructor(
    code: string,
    statusCode: number,
    message: string,
    fields?: ApiErrorFieldDto[],
  ) {
    super(message);
    // Preserve the concrete subclass name and prototype chain when this class
    // is transpiled to older targets, so `instanceof` checks stay reliable.
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
    this.code = code;
    this.statusCode = statusCode;
    if (fields !== undefined && fields.length > 0) {
      this.fields = fields;
    }
  }

  /**
   * Project this error into the client-facing error body used by the unified
   * error envelope. Only the safe, public fields (code, message, and optional
   * field details) are included — never a stack trace or internal identifier
   * (Req 8.4).
   */
  public toErrorBody(): ApiErrorDto {
    const body: ApiErrorDto = { code: this.code, message: this.message };
    if (this.fields !== undefined && this.fields.length > 0) {
      body.fields = this.fields;
    }
    return body;
  }
}

/**
 * A malformed or invalid request (Req 8.3). Maps to `VALIDATION_ERROR` (422)
 * and carries per-field details naming each invalid field and the reason.
 */
export class ValidationError extends AppError {
  constructor(
    message = 'The request contains one or more invalid fields.',
    fields?: ApiErrorFieldDto[],
  ) {
    super(ERROR_CODES.VALIDATION_ERROR, 422, message, fields);
  }
}

/**
 * Authentication is required but was missing, invalid, or expired
 * (Req 6.1, 6.7, 6.10, 10.6, 10.8). Maps to `AUTH_REQUIRED` (401).
 */
export class AuthRequiredError extends AppError {
  constructor(message = 'A valid authentication token is required.') {
    super(ERROR_CODES.AUTH_REQUIRED, 401, message);
  }
}

/**
 * The caller is authenticated but not authorized for the requested action —
 * for example a role_common caller attempting a Content Management Action
 * (Req 10.7). Maps to `FORBIDDEN` (403).
 */
export class ForbiddenError extends AppError {
  constructor(message = 'You are not permitted to perform this action.') {
    super(ERROR_CODES.FORBIDDEN, 403, message);
  }
}

/**
 * The requested entity does not exist (Req 5.4, 11.4, 11.12). Maps to
 * `NOT_FOUND` (404). The message names the missing resource without leaking
 * internal details.
 */
export class NotFoundError extends AppError {
  constructor(message = 'The requested resource was not found.') {
    super(ERROR_CODES.NOT_FOUND, 404, message);
  }
}

/**
 * An unexpected server error (Req 8.4). Maps to `INTERNAL_ERROR` (500) with a
 * generic, caller-safe message that reveals no implementation details.
 */
export class InternalError extends AppError {
  constructor(message = 'The request could not be processed.') {
    super(ERROR_CODES.INTERNAL_ERROR, 500, message);
  }
}

/**
 * A Paid Material was requested without a Payment Entitlement (Req 12.3). Maps
 * to `PAYMENT_REQUIRED` (403); no content or presigned URL is delivered and the
 * Learner is prompted to complete a Payment.
 */
export class PaymentRequiredError extends AppError {
  constructor(
    message = 'A Payment is required to access this Study Material.',
  ) {
    super(ERROR_CODES.PAYMENT_REQUIRED, 403, message);
  }
}

/**
 * A Payment was initiated for a Free Material (Req 12.10). Maps to
 * `PAYMENT_NOT_REQUIRED` (422); no Razorpay order is created.
 */
export class PaymentNotRequiredError extends AppError {
  constructor(message = 'This Study Material does not require payment.') {
    super(ERROR_CODES.PAYMENT_NOT_REQUIRED, 422, message);
  }
}

/**
 * A Payment was initiated for a Paid Material the Learner already holds a
 * Payment Entitlement for (Req 12.11). Maps to `ALREADY_ENTITLED` (409); no
 * duplicate Razorpay order is created.
 */
export class AlreadyEntitledError extends AppError {
  constructor(message = 'This Study Material has already been purchased.') {
    super(ERROR_CODES.ALREADY_ENTITLED, 409, message);
  }
}

/**
 * Payment Signature Verification failed, or no matching/consistent Payment
 * Record exists for the confirmation (Req 12.7, 12.18). Maps to
 * `PAYMENT_VERIFICATION_FAILED` (400); no Payment Entitlement is granted.
 */
export class PaymentVerificationFailedError extends AppError {
  constructor(message = 'The Payment could not be verified.') {
    super(ERROR_CODES.PAYMENT_VERIFICATION_FAILED, 400, message);
  }
}

/**
 * A Razorpay Webhook event whose signature does not verify against the Razorpay
 * Webhook Secret (Req 12.19, 12.24). Maps to `WEBHOOK_VERIFICATION_FAILED`
 * (400); the event is rejected and no stored data is changed.
 */
export class WebhookVerificationFailedError extends AppError {
  constructor(message = 'The webhook signature could not be verified.') {
    super(ERROR_CODES.WEBHOOK_VERIFICATION_FAILED, 400, message);
  }
}

/**
 * The caller has sent too many requests within the configured rate-limit
 * window. Maps to `TOO_MANY_REQUESTS` (429); the request is rejected before any
 * controller/service runs so no stored data is created, edited, or deleted.
 */
export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests. Please slow down and try again.') {
    super(ERROR_CODES.TOO_MANY_REQUESTS, 429, message);
  }
}

/**
 * Narrow an unknown throwable to an `AppError`. The errorHandler uses this to
 * distinguish expected domain errors (which carry a safe code/message) from
 * unexpected errors that must be masked as an `INTERNAL_ERROR` (Req 8.4).
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
