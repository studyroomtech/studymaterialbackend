// Central Express error-handling middleware.
//
// This is the single place where every thrown error — expected domain errors
// (typed via `utils/errors.ts`) and unexpected/unknown throwables — is mapped
// into the unified error envelope `{ error: { code, message, fields? } }`
// (Req 8.1). It guarantees that no stack trace or internal identifier ever
// reaches the client (Req 8.4), and that every unexpected `500` is logged with
// error details and an ISO 8601 timestamp (Req 8.5).
//
// Being registered last (after all routes) lets Express route both thrown and
// `next(err)`-forwarded errors here.

import type { NextFunction, Request, Response } from 'express';

import { INTERNAL_ERROR } from '../constants/errorCodes.constant';
import { isAppError } from '../utils/errors';
import { logError } from '../utils/logger';
import type { ApiErrorResponse } from '../types/api.types';

/** Fallback message when an unexpected error carries no usable message. */
const GENERIC_ERROR_MESSAGE = 'The request could not be processed.';

/**
 * Extract a caller-facing message from an unexpected throwable. The actual
 * error message is surfaced to the frontend (rather than a generic string);
 * stack traces and other internals are still never sent (only `message` is
 * used).
 */
function resolveErrorMessage(error: unknown): string {
  if (isAppError(error) && error.message.length > 0) {
    return error.message;
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  return GENERIC_ERROR_MESSAGE;
}

/**
 * Reduce an unknown throwable to safe, loggable details. Only the error's own
 * name, message, and stack (when present) are captured for the server-side
 * log; these are never sent to the client (Req 8.4, 8.5).
 */
function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      errorMessage: error.message,
      stack: error.stack,
    };
  }
  return { value: String(error) };
}

/**
 * Express error-handling middleware. Must keep all four parameters so Express
 * recognizes it as an error handler and routes errors to it.
 *
 * - Expected domain errors (`AppError`) below `500` are returned with their
 *   own status code and safe envelope produced by `toErrorBody()` (Req 8.1).
 * - Any error that maps to a `5xx` status — an unexpected/unknown throwable or
 *   a server-side `AppError` such as `InternalError` — is logged with details
 *   and an ISO 8601 timestamp (Req 8.5), then answered with the actual error
 *   message so the frontend can surface it. Stack traces and other internals
 *   are never sent — only the error's `message`.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // If a response has already begun streaming, we cannot rewrite the status or
  // body; defer to Express's default handling to close the connection.
  if (res.headersSent) {
    next(err);
    return;
  }

  // Expected domain errors below the 5xx range carry a safe, caller-facing
  // code/message and are returned as-is (Req 8.1). Server-side (5xx) AppErrors
  // fall through to the unexpected-error path so they are both logged and
  // masked behind the generic envelope.
  if (isAppError(err) && err.statusCode < 500) {
    const body: ApiErrorResponse = { error: err.toErrorBody() };
    res.status(err.statusCode).json(body);
    return;
  }

  // Unexpected server error (any 5xx): record it server-side with a timestamp
  // (the logger stamps every record with an ISO 8601 `timestamp`, Req 8.5),
  // then respond with the actual error message so the frontend can surface it.
  // The status code and error code are preserved for AppErrors; unknown
  // throwables map to 500 / INTERNAL_ERROR. Only `message` is exposed — never a
  // stack trace or other internals.
  const statusCode = isAppError(err) ? err.statusCode : 500;
  const code = isAppError(err) ? err.code : INTERNAL_ERROR;

  logError('Unexpected server error', {
    code,
    method: req.method,
    path: req.originalUrl,
    ...describeError(err),
  });

  const body: ApiErrorResponse = {
    error: {
      code,
      message: resolveErrorMessage(err),
    },
  };
  res.status(statusCode).json(body);
}
