// Types for the Review service (Req 1.15: type/interface declarations live only
// in `*.types.ts`).
//
// These describe the DTOs the Review service returns to the controller layer
// and the narrow dependency contracts it is constructed over, so the service
// can be unit-tested with injected fakes independent of Prisma.

import type { EntitlementRef } from './entitlement.service.types';
import type {
  ReviewWithReviewer,
  UpsertReviewInput,
} from '../repositories/review.repository.types';
import type { Review } from '@prisma/client';

/**
 * A single Review as surfaced to the Frontend. The reviewer is identified by
 * display name only — the email is never included. `isOwn` marks the caller's
 * own review so the UI can offer edit/delete. Timestamps are ISO 8601 UTC
 * strings.
 */
export interface ReviewDto {
  id: string;
  reviewerName: string;
  rating: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  isOwn: boolean;
}

/**
 * The reviews payload for a Study Material: the (paged) list of reviews, the
 * denormalized aggregate, whether the caller may submit a review, and the
 * caller's own review when present.
 *
 * - `averageRating` is `ratingSum / ratingCount`, or `null` when there are no
 *   ratings yet.
 * - `canReview` is `true` only when a learner is resolved AND the material is
 *   Free or the learner is entitled to it.
 * - `myReview` is the caller's own review, or `null` when they have not
 *   reviewed the material (or no learner is resolved).
 */
export interface MaterialReviewsDto {
  reviews: ReviewDto[];
  averageRating: number | null;
  reviewCount: number;
  canReview: boolean;
  myReview: ReviewDto | null;
}

/**
 * The minimal material facts the Review service needs: whether the material
 * exists, its Price (to classify Free vs Paid for the eligibility gate), and
 * its denormalized rating aggregate. `null` signals the material does not
 * exist, which the service maps to a not-found error.
 */
export interface ReviewMaterialInfo {
  id: string;
  priceAmount: number | null;
  ratingCount: number;
  ratingSum: number;
}

/**
 * Persistence contract for Reviews consumed by the service. The concrete
 * implementation wraps the Prisma-backed Review repository; each mutation keeps
 * the owning material's rating aggregates in sync transactionally.
 */
export interface ReviewRepository {
  findReviewsForMaterial(
    studyMaterialId: string,
    limit: number,
    offset: number
  ): Promise<ReviewWithReviewer[]>;
  findUserReview(
    userId: string,
    studyMaterialId: string
  ): Promise<ReviewWithReviewer | null>;
  upsertReviewWithAggregate(
    input: UpsertReviewInput
  ): Promise<ReviewWithReviewer>;
  deleteOwnReviewWithAggregate(
    userId: string,
    studyMaterialId: string
  ): Promise<Review | null>;
  deleteReviewByIdWithAggregate(reviewId: string): Promise<Review | null>;
}

/**
 * Material lookup contract used to check existence, Price (Free vs Paid), and
 * the rating aggregate. `findById` returns `null` (never throws) when the
 * material does not exist.
 */
export interface ReviewMaterialRepository {
  findById(id: string): Promise<ReviewMaterialInfo | null>;
}

/**
 * Payment Entitlement lookup contract, reused to gate review submission on Paid
 * Materials exactly like the material view gate. `findEntitlement` returns
 * `null` when the learner holds no Entitlement for the `(userId, materialId)`
 * pair.
 */
export interface ReviewEntitlementRepository {
  findEntitlement(
    userId: string,
    studyMaterialId: string
  ): Promise<EntitlementRef | null>;
}

/**
 * The dependency bundle the Review service is constructed with. The controller
 * layer wires in the concrete Prisma-backed repositories.
 */
export interface ReviewServiceDeps {
  reviews: ReviewRepository;
  materials: ReviewMaterialRepository;
  entitlements: ReviewEntitlementRepository;
}

/**
 * The public surface of the Review service. Every method resolves with a DTO or
 * throws a typed domain error (ValidationError → 422, AuthRequiredError → 401,
 * PaymentRequiredError → 403, NotFoundError → 404) that the errorHandler maps to
 * the unified error envelope.
 */
export interface ReviewService {
  /**
   * List a material's reviews plus the aggregate, `canReview`, and the caller's
   * own review. Reviews are public; no entitlement gate is applied on read. A
   * missing material yields a not-found error.
   */
  getReviews(
    studyMaterialId: string,
    userId: string | null | undefined,
    limit?: number,
    offset?: number
  ): Promise<MaterialReviewsDto>;

  /**
   * Upsert the caller's rating/review for a material. Requires a resolved
   * learner (401 otherwise) and, for a Paid Material, a Payment Entitlement
   * (403 otherwise). Rejects an out-of-range rating or over-long body (422).
   */
  submitReview(
    userId: string | null | undefined,
    studyMaterialId: string,
    rating: unknown,
    body: unknown
  ): Promise<ReviewDto>;

  /** Delete the caller's own review; not-found when they have none (404). */
  deleteOwnReview(
    userId: string | null | undefined,
    studyMaterialId: string
  ): Promise<void>;

  /** Delete any review by id (admin moderation); not-found when absent (404). */
  deleteReviewAsAdmin(reviewId: string): Promise<void>;
}
