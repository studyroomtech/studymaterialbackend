// Types for the Review repository (Req 1.15: type declarations live only in
// `*.types.ts`).
//
// These describe the shapes exchanged with the Prisma-backed Review persistence
// layer, which stores one Review per (User, Study Material) pair and keeps the
// owning material's denormalized rating aggregates (`ratingCount`/`ratingSum`)
// in sync transactionally on every write.

import type { Review } from '@prisma/client';

/**
 * A persisted Review joined with the reviewer's display name. The reviewer's
 * email is never selected — reviews surface the display name only.
 */
export type ReviewWithReviewer = Review & {
  user: { name: string };
};

/**
 * The rating aggregates denormalized onto a Study Material. `average` is
 * `ratingSum / ratingCount`, or `null` when there are no ratings yet.
 */
export interface MaterialRatingAggregate {
  ratingCount: number;
  ratingSum: number;
}

/**
 * Input to a transactional Review upsert: the reviewer, the target material,
 * and the validated rating/body. When a Review already exists for the pair it
 * is updated in place (edit); otherwise a new Review is created.
 */
export interface UpsertReviewInput {
  userId: string;
  studyMaterialId: string;
  rating: number;
  body: string;
}
