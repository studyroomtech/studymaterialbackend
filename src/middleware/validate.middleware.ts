// Zod request-validation middleware (Req 8.3).
//
// This middleware factory validates one or more parts of an incoming request
// (body, route params, query string) against caller-supplied Zod schemas
// *before* the controller executes. Because a failing request is short-circuited
// here — the middleware forwards a `ValidationError` to the errorHandler via
// `next(err)` and never calls the next handler — an invalid request can never
// reach a controller, a service, or persistence (Req 8.3).
//
// On failure it maps every Zod issue to a per-field `{ field, reason }` detail
// so the errorHandler renders the unified error envelope
// `{ error: { code, message, fields } }` with a 422 status, identifying each
// invalid field and the reason it is invalid (Req 8.3).
//
// On success, each schema's parsed (and possibly coerced/defaulted) output
// replaces the corresponding request part (`req.body` / `req.params` /
// `req.query`) so downstream controllers read validated, typed values.

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodError, ZodTypeAny } from 'zod';

import { ValidationError } from '../utils/errors';
import type { ApiErrorFieldDto } from '../types/api.types';
import type {
  ValidationSchemas,
  ValidationTarget,
} from './validate.middleware.types';

// The request parts are validated in a stable order so that, when more than one
// part is invalid, the reported `fields` appear in a deterministic sequence.
const VALIDATION_TARGETS: readonly ValidationTarget[] = [
  'params',
  'query',
  'body',
];

/**
 * Map every issue in a Zod error into the per-field details carried by the
 * unified error envelope (Req 8.3). The `field` is the dotted path to the
 * invalid value (e.g. `email`, `address.city`); when an issue has no path
 * (a whole-object refinement), the request part name is used instead. The
 * `reason` is Zod's human-readable message for the issue.
 */
function toFieldDetails(
  target: ValidationTarget,
  error: ZodError,
): ApiErrorFieldDto[] {
  return error.issues.map((issue) => {
    const path = issue.path.map((segment) => String(segment)).join('.');
    return {
      field: path.length > 0 ? path : target,
      reason: issue.message,
    };
  });
}

/**
 * Overwrite a validated request part with its parsed value. `req.body`,
 * `req.params`, and `req.query` are assignable on the Express request, but are
 * typed narrowly; a single localized cast lets us store the parsed output while
 * keeping the public middleware signature fully typed.
 */
function assignParsed(
  req: Request,
  target: ValidationTarget,
  value: unknown,
): void {
  (req as unknown as Record<ValidationTarget, unknown>)[target] = value;
}

/**
 * Build an Express middleware that validates the supplied request parts against
 * their Zod schemas before the controller runs (Req 8.3).
 *
 * Behavior:
 *   - Only the targets present in `schemas` are validated; others pass through
 *     untouched.
 *   - Every provided schema is evaluated so that a single response reports all
 *     invalid fields across body, params, and query at once.
 *   - If any part is invalid, a `ValidationError` carrying the collected
 *     per-field `{ field, reason }` details is forwarded to the errorHandler
 *     and no downstream handler runs — the request never reaches persistence.
 *   - If every provided part is valid, each parsed value replaces the
 *     corresponding request part and control passes to the next handler.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const fields: ApiErrorFieldDto[] = [];
    const parsedByTarget: Partial<Record<ValidationTarget, unknown>> = {};

    for (const target of VALIDATION_TARGETS) {
      const schema: ZodTypeAny | undefined = schemas[target];
      if (schema === undefined) {
        continue;
      }

      const result = schema.safeParse(req[target]);
      if (result.success) {
        parsedByTarget[target] = result.data;
      } else {
        fields.push(...toFieldDetails(target, result.error));
      }
    }

    if (fields.length > 0) {
      // Reject before any controller/service runs so no persistence occurs
      // on a malformed request (Req 8.3).
      next(
        new ValidationError(
          'The request contains one or more invalid fields.',
          fields,
        ),
      );
      return;
    }

    // Every provided part validated: attach the parsed values only now, so a
    // partially-valid request never leaves coerced values on a rejected call.
    for (const target of VALIDATION_TARGETS) {
      if (Object.prototype.hasOwnProperty.call(parsedByTarget, target)) {
        assignParsed(req, target, parsedByTarget[target]);
      }
    }

    next();
  };
}
