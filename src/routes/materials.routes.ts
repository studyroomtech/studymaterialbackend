// Public material routes — search and single-material read (Req 4, 5).
//
// Wires the two public material endpoints through the authentication-resolution
// middleware and Zod request validation before delegating to the material
// controller. The router is designed to be mounted at `/api` by the Express app
// assembly (task 9.4), so paths are declared relative to that mount point.
//
//   - `GET /api/materials/search` — validates the query string: a trimmed `q`
//     is bounded to the 1–100 character search window (empty/whitespace is
//     accepted and returns all materials, resolved in the service — Req 4.1,
//     4.3); an optional `categoryId` filter must be a non-empty string
//     (Req 4.2, 4.4).
//   - `GET /api/materials/:id` — validates that a non-empty `:id` is present
//     before the controller loads the material (Req 5.1); a missing material
//     surfaces as a not-found error from the service (Req 5.4).
//
// The literal `/materials/search` and `/materials/paid` routes are registered
// before the `/materials/:id` route so those literal paths are matched ahead of
// the `:id` parameter.
//
//   - `GET /api/materials/paid` — lists the Paid Materials (with Price and
//     Currency) for the Paid Materials Tab, delegating to the payment
//     controller (task 19.3); content bytes stay gated by a Payment Entitlement
//     (Req 12.1, 12.3).
//
// The single-material read (`GET /api/materials/:id`) is entitlement-aware: the
// controller forwards the resolved Learner id from `req.auth` into the material
// service, so a Paid Material's content is gated on a Payment Entitlement
// (403 PAYMENT_REQUIRED) while Free Materials are unaffected (Req 12.2, 12.3).

import { Router } from 'express';
import { z } from 'zod';

import {
  getMaterialHandler,
  searchMaterialsHandler,
} from '../controllers/material.controller';
import { listPaidMaterialsHandler } from '../controllers/payment.controller';
import { SEARCH_QUERY_MAX_LENGTH } from '../constants/limits.constant';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';

/**
 * Query schema for `GET /api/materials/search`. `q` is optional and bounded to
 * the maximum search-query length; an empty or whitespace-only `q` is left to
 * the search service to interpret as "return all" (Req 4.1, 4.3). `categoryId`
 * is an optional non-empty Category filter (Req 4.2, 4.4). Unknown query keys
 * are stripped.
 */
const searchQuerySchema = z.object({
  q: z.string().max(SEARCH_QUERY_MAX_LENGTH).optional(),
  categoryId: z.string().min(1).optional(),
});

/**
 * Params schema for `GET /api/materials/:id` — a non-empty material id must be
 * present before the controller runs (Req 5.1).
 */
const materialParamsSchema = z.object({
  id: z.string().min(1),
});

/**
 * Router exposing the public material search, Paid Materials listing, and
 * single-material read endpoints. Mount at `/api` so the effective routes are
 * `GET /api/materials/search`, `GET /api/materials/paid`, and
 * `GET /api/materials/:id`.
 *
 * The literal `/materials/search` and `/materials/paid` routes are registered
 * before `/materials/:id` so they win over the `:id` parameter match.
 */
const materialsRouter = Router();

materialsRouter.use(authMiddleware);
materialsRouter.get(
  '/materials/search',
  validate({ query: searchQuerySchema }),
  searchMaterialsHandler,
);
materialsRouter.get('/materials/paid', listPaidMaterialsHandler);
materialsRouter.get(
  '/materials/:id',
  validate({ params: materialParamsSchema }),
  getMaterialHandler,
);

export { materialsRouter };
export default materialsRouter;
