// Tests for the pure Payment Entitlement membership logic (Req 12.2, 12.3,
// 12.8).
//
// Covers `entitlementMatches` and `isEntitled` with example/unit checks plus
// the membership core of the design's Property 24 (entitlement-gated access):
// a Learner is entitled iff some Entitlement references exactly the
// `(userId, materialId)` pair, and that decision is stable across repeated
// checks (access preserved without repayment).

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { entitlementMatches, isEntitled } from './entitlement.service';
import type { EntitlementRef } from './entitlement.service.types';

describe('entitlementMatches', () => {
  const entitlement: EntitlementRef = {
    userId: 'user_1',
    studyMaterialId: 'mat_1',
  };

  it('matches only when both user and material are identical', () => {
    expect(entitlementMatches(entitlement, 'user_1', 'mat_1')).toBe(true);
    expect(entitlementMatches(entitlement, 'user_2', 'mat_1')).toBe(false);
    expect(entitlementMatches(entitlement, 'user_1', 'mat_2')).toBe(false);
    expect(entitlementMatches(entitlement, 'user_2', 'mat_2')).toBe(false);
  });
});

describe('isEntitled', () => {
  it('returns false for an empty entitlement set', () => {
    expect(isEntitled([], 'user_1', 'mat_1')).toBe(false);
  });

  it('returns true when a matching entitlement is present', () => {
    const entitlements: EntitlementRef[] = [
      { userId: 'user_9', studyMaterialId: 'mat_9' },
      { userId: 'user_1', studyMaterialId: 'mat_1' },
    ];
    expect(isEntitled(entitlements, 'user_1', 'mat_1')).toBe(true);
  });

  it('does not grant access from another user or another material', () => {
    const entitlements: EntitlementRef[] = [
      { userId: 'user_1', studyMaterialId: 'mat_2' },
      { userId: 'user_2', studyMaterialId: 'mat_1' },
    ];
    // Entitlement exists for the material (other user) and for the user (other
    // material), but not for this exact pair (Req 12.2, 12.3).
    expect(isEntitled(entitlements, 'user_1', 'mat_1')).toBe(false);
  });

  it('remains true on repeated checks once entitled (access preserved)', () => {
    const entitlements: EntitlementRef[] = [
      { userId: 'user_1', studyMaterialId: 'mat_1' },
    ];
    expect(isEntitled(entitlements, 'user_1', 'mat_1')).toBe(true);
    expect(isEntitled(entitlements, 'user_1', 'mat_1')).toBe(true);
  });
});

// --- Property 24 (membership core): entitlement decision ------------------

describe('Property 24: entitlement membership decision', () => {
  // Feature: study-materials-platform, Property 24: Entitlement-gated access to
  // paid materials — a Learner is entitled iff an Entitlement exists for the
  // exact (userId, materialId) pair.
  // Validates: Requirements 12.2, 12.3, 12.8
  const idArb = fc.stringMatching(/^[a-z0-9]{1,8}$/);

  it('isEntitled iff some entitlement references the exact (user, material) pair', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(idArb, idArb), { maxLength: 20 }),
        idArb,
        idArb,
        (pairs, userId, materialId) => {
          const entitlements: EntitlementRef[] = pairs.map(([u, m]) => ({
            userId: u,
            studyMaterialId: m,
          }));

          const expected = pairs.some(
            ([u, m]) => u === userId && m === materialId
          );

          expect(isEntitled(entitlements, userId, materialId)).toBe(expected);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('adding the exact pair always grants, and the decision is idempotent', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(idArb, idArb), { maxLength: 20 }),
        idArb,
        idArb,
        (pairs, userId, materialId) => {
          const entitlements: EntitlementRef[] = [
            ...pairs.map(([u, m]) => ({ userId: u, studyMaterialId: m })),
            { userId, studyMaterialId: materialId },
          ];
          expect(isEntitled(entitlements, userId, materialId)).toBe(true);
          // Stable across repeated evaluation (Req 12.8).
          expect(isEntitled(entitlements, userId, materialId)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });
});
