// Review repository — ratings & written reviews for Study Materials.
//
// Wraps Prisma access to the `Review` table and keeps each Study Material's
// denormalized rating aggregates (`ratingCount`/`ratingSum`) in sync on every
// write. Every mutation runs inside a `prisma.$transaction` so a Review and the
// owning material's counters can never drift: the aggregate is adjusted by the
// exact delta of the write (a new review adds `+1`/`+rating`; an edit shifts the
// sum by `newRating - oldRating`; a delete subtracts `1`/`rating`).
//
// Reads never expose the reviewer's email — only the display name is selected —
// so the service can surface reviews by name alone.

import type { Review } from '@prisma/client';

import { getPrismaClient } from './prismaClient';
import type {
  ReviewWithReviewer,
  UpsertReviewInput,
} from './review.repository.types';

// Select shape that resolves the reviewer's display name (never the email).
const REVIEWER_SELECT = { user: { select: { name: true } } } as const;

/**
 * List the reviews for a Study Material, newest first, each joined with the
 * reviewer's display name. `limit`/`offset` page the list; the service supplies
 * bounded values.
 */
export function findReviewsForMaterial(
  studyMaterialId: string,
  limit: number,
  offset: number
): Promise<ReviewWithReviewer[]> {
  return getPrismaClient().review.findMany({
    where: { studyMaterialId },
    orderBy: { createdAt: 'desc' },
    skip: offset,
    take: limit,
    include: REVIEWER_SELECT,
  });
}

/**
 * Find the caller's own Review for a material (with the reviewer name), or
 * `null` when they have not reviewed it. Backs the "my review" prefill and the
 * owner-scoped delete.
 */
export function findUserReview(
  userId: string,
  studyMaterialId: string
): Promise<ReviewWithReviewer | null> {
  return getPrismaClient().review.findUnique({
    where: { userId_studyMaterialId: { userId, studyMaterialId } },
    include: REVIEWER_SELECT,
  });
}

/**
 * Count the reviews for a material. Used when a caller needs the review count
 * independent of a page of results.
 */
export function countReviewsForMaterial(
  studyMaterialId: string
): Promise<number> {
  return getPrismaClient().review.count({ where: { studyMaterialId } });
}

/**
 * Upsert the caller's Review for a material and adjust the material's rating
 * aggregates by the exact delta, atomically (Req: one review per user per
 * material, editable). On first review the row is created and the material's
 * `ratingCount`/`ratingSum` increment by `1`/`rating`; on an edit the existing
 * row is updated and the sum shifts by `newRating - oldRating` (count
 * unchanged). Returns the persisted Review with the reviewer's display name.
 */
export function upsertReviewWithAggregate(
  input: UpsertReviewInput
): Promise<ReviewWithReviewer> {
  const { userId, studyMaterialId, rating, body } = input;
  return getPrismaClient().$transaction(async (tx) => {
    const existing = await tx.review.findUnique({
      where: { userId_studyMaterialId: { userId, studyMaterialId } },
    });

    const review = await tx.review.upsert({
      where: { userId_studyMaterialId: { userId, studyMaterialId } },
      update: { rating, body },
      create: { userId, studyMaterialId, rating, body },
      include: REVIEWER_SELECT,
    });

    // A new review adds one rating; an edit keeps the count and shifts the sum
    // by the difference between the new and old ratings.
    const countDelta = existing === null ? 1 : 0;
    const sumDelta = existing === null ? rating : rating - existing.rating;
    await tx.studyMaterial.update({
      where: { id: studyMaterialId },
      data: {
        ratingCount: { increment: countDelta },
        ratingSum: { increment: sumDelta },
      },
    });

    return review;
  });
}

/**
 * Delete the caller's own Review for a material and decrement the material's
 * aggregates, atomically. Returns the deleted Review, or `null` when the caller
 * has no review on that material (so the service maps absence to a not-found
 * error without mutating anything).
 */
export function deleteOwnReviewWithAggregate(
  userId: string,
  studyMaterialId: string
): Promise<Review | null> {
  return getPrismaClient().$transaction(async (tx) => {
    const existing = await tx.review.findUnique({
      where: { userId_studyMaterialId: { userId, studyMaterialId } },
    });
    if (existing === null) {
      return null;
    }

    await tx.review.delete({ where: { id: existing.id } });
    await tx.studyMaterial.update({
      where: { id: studyMaterialId },
      data: {
        ratingCount: { decrement: 1 },
        ratingSum: { decrement: existing.rating },
      },
    });

    return existing;
  });
}

/**
 * Delete any Review by id (admin moderation) and decrement the owning
 * material's aggregates, atomically. Returns the deleted Review, or `null` when
 * no Review with that id exists.
 */
export function deleteReviewByIdWithAggregate(
  reviewId: string
): Promise<Review | null> {
  return getPrismaClient().$transaction(async (tx) => {
    const existing = await tx.review.findUnique({ where: { id: reviewId } });
    if (existing === null) {
      return null;
    }

    await tx.review.delete({ where: { id: existing.id } });
    await tx.studyMaterial.update({
      where: { id: existing.studyMaterialId },
      data: {
        ratingCount: { decrement: 1 },
        ratingSum: { decrement: existing.rating },
      },
    });

    return existing;
  });
}
