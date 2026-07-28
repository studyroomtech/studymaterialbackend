// Review controller — ratings & written reviews for Study Materials.
//
// Shapes the HTTP surface of the review endpoints, delegating all business
// logic to `review.service.ts`:
//
//   - `GET /api/materials/:id/reviews` — list a material's reviews plus the
//     aggregate, `canReview`, and the caller's own review. Reviews are public;
//     the resolved learner id (from `req.auth`, `undefined` when signed out) is
//     forwarded only to compute `isOwn`/`canReview`/`myReview`.
//   - `POST /api/materials/:id/reviews` — upsert the caller's rating/review. A
//     resolved learner is required (401) and a Paid Material additionally
//     requires a Payment Entitlement (403); an out-of-range rating/over-long
//     body is rejected (422).
//   - `DELETE /api/materials/:id/reviews` — delete the caller's own review.
//   - `DELETE /api/admin/reviews/:reviewId` — admin moderation: delete any
//     review by id (guarded by `requireAdmin` in the admin router).
//
// The controller holds no business logic; typed domain errors thrown by the
// service are forwarded to the central error handler via `next(error)`.

import type { NextFunction, Request, Response } from 'express';

import { createDefaultReviewService } from '../services/review.service';

/**
 * Read a query-string value as a single finite number, coalescing an absent or
 * non-numeric parameter to `undefined` so the service applies its default page
 * bound.
 */
function readNumericQueryParam(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * `GET /api/materials/:id/reviews` — return a material's reviews together with
 * the aggregate, `canReview`, and the caller's own review. A missing material
 * yields a not-found error with no content.
 */
export async function listReviewsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const payload = await createDefaultReviewService().getReviews(
      req.params.id,
      req.auth.userId,
      readNumericQueryParam(req.query.limit),
      readNumericQueryParam(req.query.offset)
    );
    res.status(200).json(payload);
  } catch (error) {
    next(error);
  }
}

/**
 * `POST /api/materials/:id/reviews` — upsert the caller's rating/review. The
 * resolved learner id is required by the service (401 when absent); a Paid
 * Material requires a Payment Entitlement (403). The created/updated review is
 * returned unwrapped.
 */
export async function submitReviewHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { rating, body } = req.body as { rating?: unknown; body?: unknown };
    const review = await createDefaultReviewService().submitReview(
      req.auth.userId,
      req.params.id,
      rating,
      body
    );
    res.status(200).json(review);
  } catch (error) {
    next(error);
  }
}

/**
 * `DELETE /api/materials/:id/reviews` — delete the caller's own review. A
 * missing review yields a not-found error.
 */
export async function deleteReviewHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await createDefaultReviewService().deleteOwnReview(
      req.auth.userId,
      req.params.id
    );
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

/**
 * `DELETE /api/admin/reviews/:reviewId` — admin moderation: delete any review by
 * id. Guarded by `requireAdmin` in the admin router; a missing review yields a
 * not-found error.
 */
export async function adminDeleteReviewHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await createDefaultReviewService().deleteReviewAsAdmin(
      req.params.reviewId
    );
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
