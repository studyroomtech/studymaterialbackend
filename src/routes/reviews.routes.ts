// Review routes — ratings & written reviews for Study Materials.
//
// Wires the learner-facing review endpoints through the authentication-
// resolution middleware and Zod request validation before delegating to the
// review controller. The router is mounted at `/api` by the Express app
// assembly, so paths are declared relative to that mount point.
//
//   - `GET /api/materials/:id/reviews` — list a material's reviews plus the
//     aggregate; optional `limit`/`offset` page the list. Public read: the
//     resolved learner (from `req.auth`) only influences `isOwn`/`canReview`/
//     `myReview`.
//   - `POST /api/materials/:id/reviews` — upsert the caller's rating (1–5) with
//     an optional body. Authoritative rating/body bounds and the Free-or-
//     entitled gate are enforced by the service; the Zod layer only shapes the
//     request.
//   - `DELETE /api/materials/:id/reviews` — delete the caller's own review.
//
// The `authMiddleware` resolves the caller's Role/identity for every review
// request (role_common by default). Admin moderation (`DELETE
// /api/admin/reviews/:reviewId`) lives on the admin router behind
// `requireAdmin`.

import { Router } from 'express';
import { z } from 'zod';

import {
  deleteReviewHandler,
  listReviewsHandler,
  submitReviewHandler,
} from '../controllers/review.controller';
import {
  RATING_MAX,
  RATING_MIN,
  REVIEW_BODY_MAX_LENGTH,
} from '../services/review.service.constant';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';

/**
 * Params schema — a non-empty material id must be present before the controller
 * runs.
 */
const materialParamsSchema = z.object({
  id: z.string().min(1),
});

/**
 * Query schema for listing reviews — optional non-negative `limit`/`offset`.
 * The service clamps `limit` into its supported range; the Zod layer only
 * coerces the query strings to numbers and rejects negatives.
 */
const listReviewsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/**
 * Body schema for submitting a review — a required integer rating in 1–5 and an
 * optional body bounded to the maximum length. Authoritative validation is
 * repeated in the service so a direct service caller is also protected.
 */
const submitReviewBodySchema = z.object({
  rating: z.number().int().min(RATING_MIN).max(RATING_MAX),
  body: z.string().max(REVIEW_BODY_MAX_LENGTH).optional(),
});

/**
 * Router exposing the material review endpoints. Mount at `/api` so the
 * effective routes are `GET/POST/DELETE /api/materials/:id/reviews`.
 */
const reviewsRouter: Router = Router();

reviewsRouter.use(authMiddleware);

reviewsRouter.get(
  '/materials/:id/reviews',
  validate({ params: materialParamsSchema, query: listReviewsQuerySchema }),
  listReviewsHandler
);

reviewsRouter.post(
  '/materials/:id/reviews',
  validate({ params: materialParamsSchema, body: submitReviewBodySchema }),
  submitReviewHandler
);

reviewsRouter.delete(
  '/materials/:id/reviews',
  validate({ params: materialParamsSchema }),
  deleteReviewHandler
);

export { reviewsRouter };
export default reviewsRouter;
