// Review service unit tests — ratings & written reviews for Study Materials.
//
// Exercises the service through injected fakes (no DB/HTTP) so the business
// rules can be asserted in isolation:
//   - rating bounds (integer 1–5) and body length (0–2000) validation,
//   - average computation from the denormalized aggregate,
//   - the Free-or-entitled submission gate (auth + Paid Material entitlement),
//   - upsert delta math on the material aggregate (new vs edit),
//   - owner-scoped vs admin delete and their not-found behavior.

import { describe, expect, it } from 'vitest';

import {
  canSubmitReview,
  computeAverage,
  createReviewService,
  resolveLimit,
  resolveOffset,
  toReviewDto,
  validateBody,
  validateRating,
} from './review.service';
import { AppError } from '../utils/errors';
import type { Review } from '@prisma/client';
import type { ReviewWithReviewer } from '../repositories/review.repository.types';
import type {
  ReviewMaterialInfo,
  ReviewServiceDeps,
} from './review.service.types';

// --- Fakes ----------------------------------------------------------------
//
// Type declarations must live in `*.types.ts` (Req 1.15/1.17), so the fakes here
// use inline structural annotations and reuse `ReviewWithReviewer` rather than
// declaring a local interface. A stored review is a `ReviewWithReviewer` (Prisma
// row + resolved reviewer name).

/** Build a `ReviewWithReviewer` row for seeding the in-memory store. */
function makeReviewRow(fields: {
  id: string;
  userId: string;
  studyMaterialId: string;
  rating: number;
  body: string;
  reviewerName: string;
  createdAt?: string;
  updatedAt?: string;
}): ReviewWithReviewer {
  return {
    id: fields.id,
    userId: fields.userId,
    studyMaterialId: fields.studyMaterialId,
    rating: fields.rating,
    body: fields.body,
    createdAt: new Date(fields.createdAt ?? '2026-01-01T00:00:00.000Z'),
    updatedAt: new Date(fields.updatedAt ?? '2026-01-01T00:00:00.000Z'),
    user: { name: fields.reviewerName },
  } as ReviewWithReviewer;
}

/**
 * An in-memory Review store + material aggregate that mirrors the repository's
 * transactional delta math, so the service's upsert/delete behavior can be
 * asserted end-to-end. `materials` maps material id → its facts (price +
 * aggregate); the store keeps one review per (user, material) pair.
 */
function makeFakes(seed: {
  materials: Record<string, ReviewMaterialInfo>;
  entitled?: Array<{ userId: string; studyMaterialId: string }>;
  reviews?: ReviewWithReviewer[];
}): {
  deps: ReviewServiceDeps;
  store: Map<string, ReviewWithReviewer>;
  material: (id: string) => ReviewMaterialInfo;
} {
  const materials = new Map<string, ReviewMaterialInfo>(
    Object.entries(seed.materials).map(([id, info]) => [id, { ...info }])
  );
  const store = new Map<string, ReviewWithReviewer>(
    (seed.reviews ?? []).map((review) => [
      `${review.userId}:${review.studyMaterialId}`,
      { ...review },
    ])
  );
  const entitled = new Set(
    (seed.entitled ?? []).map((e) => `${e.userId}:${e.studyMaterialId}`)
  );

  const deps: ReviewServiceDeps = {
    reviews: {
      async findReviewsForMaterial(studyMaterialId, limit, offset) {
        const all = [...store.values()]
          .filter((r) => r.studyMaterialId === studyMaterialId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return all.slice(offset, offset + limit);
      },
      async findUserReview(userId, studyMaterialId) {
        return store.get(`${userId}:${studyMaterialId}`) ?? null;
      },
      async upsertReviewWithAggregate({ userId, studyMaterialId, rating, body }) {
        const key = `${userId}:${studyMaterialId}`;
        const existing = store.get(key);
        const material = materials.get(studyMaterialId);
        if (material === undefined) {
          throw new Error('material missing in fake');
        }
        if (existing === undefined) {
          const created = makeReviewRow({
            id: `rev_${store.size + 1}`,
            userId,
            studyMaterialId,
            rating,
            body,
            reviewerName: 'Learner',
          });
          store.set(key, created);
          material.ratingCount += 1;
          material.ratingSum += rating;
          return created;
        }
        material.ratingSum += rating - existing.rating;
        existing.rating = rating;
        existing.body = body;
        existing.updatedAt = new Date('2026-02-01T00:00:00.000Z');
        return existing;
      },
      async deleteOwnReviewWithAggregate(userId, studyMaterialId) {
        const key = `${userId}:${studyMaterialId}`;
        const existing = store.get(key);
        if (existing === undefined) {
          return null;
        }
        store.delete(key);
        const material = materials.get(studyMaterialId);
        if (material !== undefined) {
          material.ratingCount -= 1;
          material.ratingSum -= existing.rating;
        }
        return existing as unknown as Review;
      },
      async deleteReviewByIdWithAggregate(reviewId) {
        for (const [key, review] of store) {
          if (review.id === reviewId) {
            store.delete(key);
            const material = materials.get(review.studyMaterialId);
            if (material !== undefined) {
              material.ratingCount -= 1;
              material.ratingSum -= review.rating;
            }
            return review as unknown as Review;
          }
        }
        return null;
      },
    },
    materials: {
      async findById(id) {
        const found = materials.get(id);
        return found === undefined ? null : { ...found };
      },
    },
    entitlements: {
      async findEntitlement(userId, studyMaterialId) {
        return entitled.has(`${userId}:${studyMaterialId}`)
          ? { userId, studyMaterialId }
          : null;
      },
    },
  };

  return {
    deps,
    store,
    material: (id) => {
      const found = materials.get(id);
      if (found === undefined) {
        throw new Error('unknown material in test');
      }
      return found;
    },
  };
}

const FREE = (id: string): ReviewMaterialInfo => ({
  id,
  priceAmount: null,
  ratingCount: 0,
  ratingSum: 0,
});
const PAID = (id: string): ReviewMaterialInfo => ({
  id,
  priceAmount: 50000,
  ratingCount: 0,
  ratingSum: 0,
});

async function expectAppError(
  promise: Promise<unknown>,
  code: string
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
  await promise.catch((error) => {
    expect(error).toBeInstanceOf(AppError);
  });
}

// --- Pure helpers ---------------------------------------------------------

describe('validateRating', () => {
  it('accepts integers 1–5', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(validateRating(n)).toBe(n);
    }
  });

  it('rejects out-of-range, non-integer, and non-number ratings', () => {
    for (const bad of [0, 6, -1, 2.5, Number.NaN, '5', null, undefined, {}]) {
      expect(() => validateRating(bad)).toThrowError(AppError);
    }
  });
});

describe('validateBody', () => {
  it('coalesces nullish to empty and trims', () => {
    expect(validateBody(undefined)).toBe('');
    expect(validateBody(null)).toBe('');
    expect(validateBody('  hello  ')).toBe('hello');
  });

  it('rejects a non-string body', () => {
    expect(() => validateBody(123)).toThrowError(AppError);
  });

  it('rejects a body over 2000 chars', () => {
    expect(() => validateBody('a'.repeat(2001))).toThrowError(AppError);
    expect(validateBody('a'.repeat(2000))).toHaveLength(2000);
  });
});

describe('computeAverage', () => {
  it('is null when there are no ratings', () => {
    expect(computeAverage(0, 0)).toBeNull();
  });

  it('divides sum by count', () => {
    expect(computeAverage(23, 5)).toBeCloseTo(4.6, 5);
    expect(computeAverage(5, 1)).toBe(5);
  });
});

describe('resolveLimit / resolveOffset', () => {
  it('defaults and clamps the limit into 1..100', () => {
    expect(resolveLimit(undefined)).toBe(50);
    expect(resolveLimit(0)).toBe(1);
    expect(resolveLimit(1000)).toBe(100);
    expect(resolveLimit(10)).toBe(10);
  });

  it('normalizes the offset to a non-negative integer', () => {
    expect(resolveOffset(undefined)).toBe(0);
    expect(resolveOffset(-5)).toBe(0);
    expect(resolveOffset(12.9)).toBe(12);
  });
});

describe('canSubmitReview (pure eligibility)', () => {
  it('is false without a resolved learner', () => {
    expect(canSubmitReview(undefined, FREE('m1'), [])).toBe(false);
  });

  it('is true for a Free material with a resolved learner', () => {
    expect(canSubmitReview('u1', FREE('m1'), [])).toBe(true);
  });

  it('is gated on entitlement for a Paid material', () => {
    expect(canSubmitReview('u1', PAID('m1'), [])).toBe(false);
    expect(
      canSubmitReview('u1', PAID('m1'), [
        { userId: 'u1', studyMaterialId: 'm1' },
      ])
    ).toBe(true);
  });
});

describe('toReviewDto', () => {
  it('exposes the display name (never email) and marks isOwn', () => {
    const row = {
      id: 'r1',
      userId: 'u1',
      studyMaterialId: 'm1',
      rating: 4,
      body: 'nice',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      user: { name: 'Asha' },
    } as ReviewWithReviewer;
    expect(toReviewDto(row, 'u1')).toEqual({
      id: 'r1',
      reviewerName: 'Asha',
      rating: 4,
      body: 'nice',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      isOwn: true,
    });
    expect(toReviewDto(row, 'someone-else').isOwn).toBe(false);
    expect(toReviewDto(row, undefined).isOwn).toBe(false);
  });
});

// --- Service behavior -----------------------------------------------------

describe('getReviews', () => {
  it('returns the aggregate, canReview, and myReview for a Free material', async () => {
    const { deps } = makeFakes({
      materials: { m1: { id: 'm1', priceAmount: null, ratingCount: 2, ratingSum: 9 } },
      reviews: [
        makeReviewRow({
          id: 'r1',
          userId: 'u1',
          studyMaterialId: 'm1',
          rating: 4,
          body: 'ok',
          reviewerName: 'Asha',
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
        makeReviewRow({
          id: 'r2',
          userId: 'u2',
          studyMaterialId: 'm1',
          rating: 5,
          body: 'great',
          reviewerName: 'Ben',
          createdAt: '2026-01-02T00:00:00.000Z',
        }),
      ],
    });
    const service = createReviewService(deps);
    const result = await service.getReviews('m1', 'u1');

    expect(result.reviewCount).toBe(2);
    expect(result.averageRating).toBe(4.5);
    expect(result.canReview).toBe(true);
    expect(result.myReview?.id).toBe('r1');
    // Newest first.
    expect(result.reviews.map((r) => r.id)).toEqual(['r2', 'r1']);
    expect(result.reviews.find((r) => r.id === 'r1')?.isOwn).toBe(true);
  });

  it('canReview is false for a signed-out caller and null aggregate when unrated', async () => {
    const { deps } = makeFakes({ materials: { m1: FREE('m1') } });
    const service = createReviewService(deps);
    const result = await service.getReviews('m1', undefined);
    expect(result.canReview).toBe(false);
    expect(result.averageRating).toBeNull();
    expect(result.reviewCount).toBe(0);
    expect(result.myReview).toBeNull();
  });

  it('canReview is gated by entitlement on a Paid material', async () => {
    const { deps } = makeFakes({
      materials: { m1: PAID('m1') },
      entitled: [{ userId: 'u2', studyMaterialId: 'm1' }],
    });
    const service = createReviewService(deps);
    expect((await service.getReviews('m1', 'u1')).canReview).toBe(false);
    expect((await service.getReviews('m1', 'u2')).canReview).toBe(true);
  });

  it('throws NOT_FOUND for a missing material', async () => {
    const { deps } = makeFakes({ materials: {} });
    const service = createReviewService(deps);
    await expectAppError(service.getReviews('nope', 'u1'), 'NOT_FOUND');
  });
});

describe('submitReview', () => {
  it('requires a resolved learner', async () => {
    const { deps } = makeFakes({ materials: { m1: FREE('m1') } });
    const service = createReviewService(deps);
    await expectAppError(
      service.submitReview(undefined, 'm1', 5, 'hi'),
      'AUTH_REQUIRED'
    );
  });

  it('rejects an invalid rating before persistence', async () => {
    const { deps, material } = makeFakes({ materials: { m1: FREE('m1') } });
    const service = createReviewService(deps);
    await expectAppError(
      service.submitReview('u1', 'm1', 9, 'hi'),
      'VALIDATION_ERROR'
    );
    expect(material('m1').ratingCount).toBe(0);
  });

  it('gates a Paid material on a Payment Entitlement', async () => {
    const { deps } = makeFakes({ materials: { m1: PAID('m1') } });
    const service = createReviewService(deps);
    await expectAppError(
      service.submitReview('u1', 'm1', 5, 'hi'),
      'PAYMENT_REQUIRED'
    );
  });

  it('allows a Paid material review when entitled and updates the aggregate', async () => {
    const { deps, material } = makeFakes({
      materials: { m1: PAID('m1') },
      entitled: [{ userId: 'u1', studyMaterialId: 'm1' }],
    });
    const service = createReviewService(deps);
    const dto = await service.submitReview('u1', 'm1', 5, '  loved it  ');
    expect(dto.rating).toBe(5);
    expect(dto.body).toBe('loved it');
    expect(dto.isOwn).toBe(true);
    expect(material('m1').ratingCount).toBe(1);
    expect(material('m1').ratingSum).toBe(5);
  });

  it('upsert delta: a new review increments count+sum; an edit shifts only the sum', async () => {
    const { deps, material } = makeFakes({ materials: { m1: FREE('m1') } });
    const service = createReviewService(deps);

    await service.submitReview('u1', 'm1', 3, 'first');
    expect(material('m1').ratingCount).toBe(1);
    expect(material('m1').ratingSum).toBe(3);

    // Same user edits their review: count unchanged, sum shifts by 5 - 3 = +2.
    await service.submitReview('u1', 'm1', 5, 'better');
    expect(material('m1').ratingCount).toBe(1);
    expect(material('m1').ratingSum).toBe(5);

    // A second user adds a review: count+1, sum+4.
    await service.submitReview('u2', 'm1', 4, 'good');
    expect(material('m1').ratingCount).toBe(2);
    expect(material('m1').ratingSum).toBe(9);
    expect(computeAverage(material('m1').ratingSum, material('m1').ratingCount)).toBe(4.5);
  });
});

describe('deleteOwnReview', () => {
  it('deletes the caller review and decrements the aggregate', async () => {
    const { deps, material } = makeFakes({
      materials: { m1: { id: 'm1', priceAmount: null, ratingCount: 1, ratingSum: 4 } },
      reviews: [
        makeReviewRow({
          id: 'r1',
          userId: 'u1',
          studyMaterialId: 'm1',
          rating: 4,
          body: 'ok',
          reviewerName: 'Asha',
        }),
      ],
    });
    const service = createReviewService(deps);
    await service.deleteOwnReview('u1', 'm1');
    expect(material('m1').ratingCount).toBe(0);
    expect(material('m1').ratingSum).toBe(0);
  });

  it('requires auth and 404s when the caller has no review', async () => {
    const { deps } = makeFakes({ materials: { m1: FREE('m1') } });
    const service = createReviewService(deps);
    await expectAppError(
      service.deleteOwnReview(undefined, 'm1'),
      'AUTH_REQUIRED'
    );
    await expectAppError(service.deleteOwnReview('u1', 'm1'), 'NOT_FOUND');
  });
});

describe('deleteReviewAsAdmin', () => {
  it('deletes any review by id and decrements the owning aggregate', async () => {
    const { deps, material } = makeFakes({
      materials: { m1: { id: 'm1', priceAmount: null, ratingCount: 1, ratingSum: 5 } },
      reviews: [
        makeReviewRow({
          id: 'r1',
          userId: 'u1',
          studyMaterialId: 'm1',
          rating: 5,
          body: 'spam',
          reviewerName: 'Asha',
        }),
      ],
    });
    const service = createReviewService(deps);
    await service.deleteReviewAsAdmin('r1');
    expect(material('m1').ratingCount).toBe(0);
    expect(material('m1').ratingSum).toBe(0);
  });

  it('404s for an unknown review id', async () => {
    const { deps } = makeFakes({ materials: { m1: FREE('m1') } });
    const service = createReviewService(deps);
    await expectAppError(service.deleteReviewAsAdmin('nope'), 'NOT_FOUND');
  });
});
