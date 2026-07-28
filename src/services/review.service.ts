// Review service — ratings & written reviews for Study Materials.
//
// Implements the learner-facing review lifecycle plus admin moderation:
//
//   - Read: list a material's reviews (public — no entitlement gate) together
//     with the denormalized aggregate (average + count), whether the caller may
//     submit a review, and the caller's own review for prefill.
//   - Submit: upsert exactly one rating (1–5, required) with an optional body
//     (0–2000 chars) per user per material. A resolved learner is required
//     (AuthRequiredError → 401); a Paid Material additionally requires a Payment
//     Entitlement (PaymentRequiredError → 403), reusing the same Free-or-
//     entitled rule as the material view gate. An out-of-range rating or an
//     over-long body is rejected (ValidationError → 422) before persistence.
//   - Delete own: a learner deletes their own review; a missing review yields a
//     not-found error (404).
//   - Delete as admin: an Admin deletes any review by id; absent → 404.
//
// Business rules that don't require I/O — rating/body validation, average
// computation, eligibility, and DTO mapping — are isolated into exported pure
// functions so they can be property-tested without a repository. All
// persistence is reached only through the injected contracts, keeping the
// service independent of Prisma.

import {
  AuthRequiredError,
  NotFoundError,
  PaymentRequiredError,
  ValidationError,
} from '../utils/errors';
import * as reviewRepository from '../repositories/review.repository';
import * as materialRepository from '../repositories/material.repository';
import * as entitlementRepository from '../repositories/entitlement.repository';
import { isEntitled } from './entitlement.service';
import { isPaidMaterial } from './material.service';
import {
  RATING_MAX,
  RATING_MIN,
  REVIEW_BODY_MAX_LENGTH,
  REVIEWS_DEFAULT_LIMIT,
  REVIEWS_MAX_LIMIT,
} from './review.service.constant';
import type { ReviewWithReviewer } from '../repositories/review.repository.types';
import type {
  MaterialReviewsDto,
  ReviewDto,
  ReviewMaterialInfo,
  ReviewService,
  ReviewServiceDeps,
} from './review.service.types';

// --- Pure helpers (no I/O) ------------------------------------------------

/**
 * Validate a rating, returning the integer star count on success or throwing a
 * `ValidationError` naming `rating`. A rating must be an integer in the
 * inclusive 1–5 range; a non-number, non-integer, or out-of-range value is
 * rejected. Pure aside from the throw.
 */
export function validateRating(rating: unknown): number {
  if (
    typeof rating !== 'number' ||
    !Number.isInteger(rating) ||
    rating < RATING_MIN ||
    rating > RATING_MAX
  ) {
    throw new ValidationError(
      'The request contains one or more invalid fields.',
      [
        {
          field: 'rating',
          reason: `rating must be an integer between ${RATING_MIN} and ${RATING_MAX}.`,
        },
      ]
    );
  }
  return rating;
}

/**
 * Validate and normalize an optional review body, returning the trimmed string
 * (empty when absent) or throwing a `ValidationError` naming `body` when it
 * exceeds the maximum length. A non-string, non-nullish value is rejected. Pure
 * aside from the throw.
 */
export function validateBody(body: unknown): string {
  if (body === null || body === undefined) {
    return '';
  }
  if (typeof body !== 'string') {
    throw new ValidationError(
      'The request contains one or more invalid fields.',
      [{ field: 'body', reason: 'body must be a string.' }]
    );
  }
  const normalized = body.trim();
  if (normalized.length > REVIEW_BODY_MAX_LENGTH) {
    throw new ValidationError(
      'The request contains one or more invalid fields.',
      [
        {
          field: 'body',
          reason: `body must be at most ${REVIEW_BODY_MAX_LENGTH} characters.`,
        },
      ]
    );
  }
  return normalized;
}

/**
 * Compute the average rating from the denormalized sum and count, or `null`
 * when there are no ratings. Pure and total.
 */
export function computeAverage(
  ratingSum: number,
  ratingCount: number
): number | null {
  if (ratingCount <= 0) {
    return null;
  }
  return ratingSum / ratingCount;
}

/**
 * Whether a resolved learner is eligible to submit a review for a material: the
 * material must be Free, or the learner must hold a Payment Entitlement for it.
 * An unresolved learner is never eligible. Pure — the caller supplies the
 * already-resolved Entitlement set.
 */
export function canSubmitReview(
  userId: string | null | undefined,
  material: ReviewMaterialInfo,
  entitlements: readonly { userId: string; studyMaterialId: string | null }[]
): boolean {
  if (userId === null || userId === undefined) {
    return false;
  }
  if (!isPaidMaterial(material.priceAmount)) {
    return true;
  }
  return isEntitled(entitlements, userId, material.id);
}

/**
 * Clamp a requested page size into the supported range, defaulting when absent.
 * Pure and total.
 */
export function resolveLimit(limit: number | null | undefined): number {
  if (limit === null || limit === undefined || Number.isNaN(limit)) {
    return REVIEWS_DEFAULT_LIMIT;
  }
  const floored = Math.floor(limit);
  if (floored < 1) {
    return 1;
  }
  return Math.min(floored, REVIEWS_MAX_LIMIT);
}

/**
 * Normalize a requested offset to a non-negative integer, defaulting to 0.
 * Pure and total.
 */
export function resolveOffset(offset: number | null | undefined): number {
  if (offset === null || offset === undefined || Number.isNaN(offset)) {
    return 0;
  }
  const floored = Math.floor(offset);
  return floored < 0 ? 0 : floored;
}

/**
 * Map a persisted Review (joined with the reviewer's display name) to its
 * public `ReviewDto`, marking `isOwn` against the resolved caller. The
 * reviewer's email is never present in the input and never surfaced. Pure.
 */
export function toReviewDto(
  review: ReviewWithReviewer,
  userId: string | null | undefined
): ReviewDto {
  return {
    id: review.id,
    reviewerName: review.user.name,
    rating: review.rating,
    body: review.body,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
    isOwn: userId !== null && userId !== undefined && review.userId === userId,
  };
}

// --- Service factory ------------------------------------------------------

/**
 * Construct the Review service over the injected repositories. The controller
 * layer wires in the concrete Prisma-backed Review/material/entitlement slices.
 */
export function createReviewService(deps: ReviewServiceDeps): ReviewService {
  const { reviews, materials, entitlements } = deps;

  /**
   * Resolve a material's minimal facts or throw a not-found error. Shared by
   * every method so a review action against a missing material never proceeds.
   */
  async function requireMaterial(id: string): Promise<ReviewMaterialInfo> {
    const material = await materials.findById(id);
    if (material === null) {
      throw new NotFoundError('The requested Study Material was not found.');
    }
    return material;
  }

  /**
   * Resolve whether the learner is eligible to submit a review for the
   * material, loading the Payment Entitlement only for a Paid Material.
   */
  async function resolveCanReview(
    userId: string | null | undefined,
    material: ReviewMaterialInfo
  ): Promise<boolean> {
    if (userId === null || userId === undefined) {
      return false;
    }
    if (!isPaidMaterial(material.priceAmount)) {
      return true;
    }
    const entitlement = await entitlements.findEntitlement(userId, material.id);
    const held = entitlement === null ? [] : [entitlement];
    return isEntitled(held, userId, material.id);
  }

  async function getReviews(
    studyMaterialId: string,
    userId: string | null | undefined,
    limit?: number,
    offset?: number
  ): Promise<MaterialReviewsDto> {
    const material = await requireMaterial(studyMaterialId);
    const [rows, canReview, myReviewRow] = await Promise.all([
      reviews.findReviewsForMaterial(
        studyMaterialId,
        resolveLimit(limit),
        resolveOffset(offset)
      ),
      resolveCanReview(userId, material),
      userId === null || userId === undefined
        ? Promise.resolve(null)
        : reviews.findUserReview(userId, studyMaterialId),
    ]);

    return {
      reviews: rows.map((row) => toReviewDto(row, userId)),
      averageRating: computeAverage(material.ratingSum, material.ratingCount),
      reviewCount: material.ratingCount,
      canReview,
      myReview:
        myReviewRow === null ? null : toReviewDto(myReviewRow, userId),
    };
  }

  async function submitReview(
    userId: string | null | undefined,
    studyMaterialId: string,
    rating: unknown,
    body: unknown
  ): Promise<ReviewDto> {
    if (userId === null || userId === undefined) {
      throw new AuthRequiredError();
    }
    // Validate before any Entitlement lookup or persistence so a malformed
    // request is rejected up front.
    const validRating = validateRating(rating);
    const validBody = validateBody(body);

    const material = await requireMaterial(studyMaterialId);
    if (isPaidMaterial(material.priceAmount)) {
      const entitlement = await entitlements.findEntitlement(
        userId,
        studyMaterialId
      );
      const held = entitlement === null ? [] : [entitlement];
      if (!isEntitled(held, userId, studyMaterialId)) {
        throw new PaymentRequiredError();
      }
    }

    const review = await reviews.upsertReviewWithAggregate({
      userId,
      studyMaterialId,
      rating: validRating,
      body: validBody,
    });
    return toReviewDto(review, userId);
  }

  async function deleteOwnReview(
    userId: string | null | undefined,
    studyMaterialId: string
  ): Promise<void> {
    if (userId === null || userId === undefined) {
      throw new AuthRequiredError();
    }
    const deleted = await reviews.deleteOwnReviewWithAggregate(
      userId,
      studyMaterialId
    );
    if (deleted === null) {
      throw new NotFoundError('The requested review was not found.');
    }
  }

  async function deleteReviewAsAdmin(reviewId: string): Promise<void> {
    const deleted = await reviews.deleteReviewByIdWithAggregate(reviewId);
    if (deleted === null) {
      throw new NotFoundError('The requested review was not found.');
    }
  }

  return {
    getReviews,
    submitReview,
    deleteOwnReview,
    deleteReviewAsAdmin,
  };
}

// --- Default wiring -------------------------------------------------------

/**
 * Construct the Review service wired to the real Prisma-backed Review, material,
 * and Entitlement repositories. Used by the controller layer in production
 * (mirrors `createDefaultMaterialService`).
 */
export function createDefaultReviewService(): ReviewService {
  return createReviewService({
    reviews: {
      findReviewsForMaterial: reviewRepository.findReviewsForMaterial,
      findUserReview: reviewRepository.findUserReview,
      upsertReviewWithAggregate: reviewRepository.upsertReviewWithAggregate,
      deleteOwnReviewWithAggregate:
        reviewRepository.deleteOwnReviewWithAggregate,
      deleteReviewByIdWithAggregate:
        reviewRepository.deleteReviewByIdWithAggregate,
    },
    materials: {
      async findById(id) {
        const record = await materialRepository.findMaterialById(id);
        if (record === null) {
          return null;
        }
        return {
          id: record.id,
          priceAmount: record.priceAmount,
          ratingCount: record.ratingCount,
          ratingSum: record.ratingSum,
        };
      },
    },
    entitlements: {
      findEntitlement: entitlementRepository.findEntitlement,
    },
  });
}
