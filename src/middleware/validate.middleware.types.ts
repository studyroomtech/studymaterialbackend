// Types for the Zod request-validation middleware (Req 1.15: type declarations
// live only in `*.types.ts`).
//
// `validate.middleware.ts` validates the parts of an incoming request (body,
// route params, query string) against caller-supplied Zod schemas before the
// controller runs. On failure it produces a `ValidationError` carrying per-field
// `{ field, reason }` details so the errorHandler returns the unified
// `{ error: { code, message, fields } }` envelope with a 422 status (Req 8.3).

import type { ZodTypeAny } from 'zod';

/**
 * The parts of an Express request that can be validated. These map directly to
 * `req.body`, `req.params`, and `req.query`.
 */
export type ValidationTarget = 'body' | 'params' | 'query';

/**
 * A per-target set of Zod schemas. Any subset may be supplied; only the
 * provided targets are validated, and each supplied schema's parsed (and
 * possibly coerced) output replaces the corresponding request part on success.
 *
 * - `body`: validates `req.body` (e.g. the Download Gate submission — Req 6.3).
 * - `params`: validates `req.params` (e.g. a `:id` route parameter).
 * - `query`: validates `req.query` (e.g. search `q`/`categoryId` — Req 4).
 */
export interface ValidationSchemas {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
}
