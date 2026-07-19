// Property 1 (Bug Condition) — Owned Test Listings Expose "Start test".
//
// Bugfix spec: test-purchase-buy-state. This is the BUG CONDITION EXPLORATION
// test and it is EXPECTED TO FAIL on the unfixed code — the failure confirms the
// bug exists. It encodes the expected (post-fix) behavior, so once the fix lands
// (Task 3) this same test will pass and validate the fix.
//
// Bug condition (design `isBugCondition`):
//   input.userId != undefined
//   AND EXISTS product IN input.listedProducts WHERE
//        (product.kind = TEST    AND product.id      IN listEntitledTestIds(userId))
//     OR (product.kind = SECTION AND product.sectionId IN listEntitledSectionIds(userId))
//
// Expected behavior (design `expectedBehavior`): for every owned listed product P
//   P.isEntitled = true. (On the Home Page this drives actionLabel = "Start test"
//   and actionLabel != "Buy"; the backend DTO carrying `isEntitled = true` is the
//   root-cause signal that the frontend "Start test" branch depends on.)
//
// The test is written against the FIXED service contract — an injected
// `entitlements` slice plus a resolved `userId` passed into the listing reads.
// The UNFIXED service ignores the extra dependency and the argument and returns
// DTOs with no `isEntitled` field, so `dto.isEntitled` is `undefined` and every
// assertion below fails: this is the counterexample proving the bug.
//
// **Validates: Requirements 2.1, 2.2, 2.3, 2.4**

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createTestListingService } from './testSeriesListing.service';
import type { Test } from '@prisma/client';
import type { SectionWithTest } from '../repositories/testSeries.repository.types';

// --- Fake row builders (scalar fields the mappers read) -------------------

function makeTest(overrides: Partial<Test> & { id: string }): Test {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: overrides.id,
    title: overrides.title ?? `Test ${overrides.id}`,
    timingMode: overrides.timingMode ?? 'overall',
    timeLimitSeconds: overrides.timeLimitSeconds ?? 3600,
    priceAmount: overrides.priceAmount ?? 50000,
    currency: overrides.currency ?? 'INR',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  } as unknown as Test;
}

function makeSection(
  overrides: Partial<SectionWithTest> & { id: string; testId: string },
): SectionWithTest {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: overrides.id,
    testId: overrides.testId,
    title: overrides.title ?? `Section ${overrides.id}`,
    orderIndex: overrides.orderIndex ?? 0,
    timeLimitSeconds: overrides.timeLimitSeconds ?? 1200,
    correctMarkCenti: 100,
    negativeMarkCenti: 25,
    priceAmount: overrides.priceAmount ?? 20000,
    currency: overrides.currency ?? 'INR',
    createdAt: now,
    updatedAt: now,
    test: makeTest({ id: overrides.testId }),
  } as unknown as SectionWithTest;
}

/**
 * Build the listing service under the FIXED contract: an injected `tests` slice
 * returning the given rows and an `entitlements` slice reporting the ids the
 * given learner owns. On the unfixed service the `entitlements` dependency and
 * the `userId` argument are simply ignored.
 */
function buildService(args: {
  tests: Test[];
  sections: SectionWithTest[];
  entitledTestIds: string[];
  entitledSectionIds: string[];
}) {
  // Cast through `any` because the unfixed `TestListingServiceDeps` does not yet
  // declare the `entitlements` slice; the fix (Task 3.2) adds it.
  const deps = {
    tests: {
      listTests: async () => args.tests,
      listPricedSections: async () => args.sections,
    },
    entitlements: {
      listEntitledTestIds: async (_userId: string) => args.entitledTestIds,
      listEntitledSectionIds: async (_userId: string) => args.entitledSectionIds,
    },
  } as any;
  // The fixed `listTestSeries`/`listSectionalTests` take a `userId`; the unfixed
  // ones ignore it.
  return createTestListingService(deps) as any;
}

const idArb = fc
  .string({ minLength: 1, maxLength: 12 })
  .map((s) => `id_${s.replace(/[^A-Za-z0-9]/g, '') || 'x'}`);
const titleArb = fc.string({ minLength: 1, maxLength: 40 });
const priceArb = fc.integer({ min: 100, max: 1_000_000 });
const userIdArb = idArb.map((s) => `user_${s}`);

describe('Property 1 (Bug Condition): owned Test listings expose "Start test"', () => {
  it('an authenticated learner who owns a listed Test sees TestSeriesListingDto.isEntitled === true', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        idArb,
        titleArb,
        priceArb,
        async (userId, testId, title, priceAmount) => {
          // Bug condition: authenticated learner (userId defined) owning this Test.
          const owned = makeTest({ id: testId, title, priceAmount });
          const service = buildService({
            tests: [owned],
            sections: [],
            entitledTestIds: [testId],
            entitledSectionIds: [],
          });

          const listings = await service.listTestSeries(userId);
          const dto = listings.find(
            (l: { id: string }) => l.id === testId,
          );

          // Expected behavior: the owned product is marked owned so the Home Page
          // renders "Start test" (not "Buy"). FAILS on unfixed code: no field.
          expect(dto).toBeDefined();
          expect(dto.isEntitled).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('an authenticated learner who owns a listed Sectional Test sees SectionalTestListingDto.isEntitled === true', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        idArb,
        idArb,
        titleArb,
        priceArb,
        async (userId, sectionId, testId, title, priceAmount) => {
          // Bug condition: authenticated learner owning this Section.
          const owned = makeSection({ id: sectionId, testId, title, priceAmount });
          const service = buildService({
            tests: [],
            sections: [owned],
            entitledTestIds: [],
            entitledSectionIds: [sectionId],
          });

          const listings = await service.listSectionalTests(userId);
          const dto = listings.find(
            (l: { sectionId: string }) => l.sectionId === sectionId,
          );

          // Expected behavior: owned Section is marked owned → "Start test".
          // FAILS on unfixed code: no `isEntitled` field on the DTO.
          expect(dto).toBeDefined();
          expect(dto.isEntitled).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('with a mix of owned and unowned listed products, every owned product is isEntitled === true (no cross-contamination)', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        fc.uniqueArray(idArb, { minLength: 2, maxLength: 6 }),
        async (userId, testIds) => {
          // Own the first half of the listed Tests; leave the rest unowned.
          const ownedIds = testIds.slice(0, Math.ceil(testIds.length / 2));
          const ownedSet = new Set(ownedIds);
          const tests = testIds.map((id) => makeTest({ id }));

          const service = buildService({
            tests,
            sections: [],
            entitledTestIds: ownedIds,
            entitledSectionIds: [],
          });

          const listings: Array<{ id: string; isEntitled?: boolean }> =
            await service.listTestSeries(userId);

          for (const dto of listings) {
            // Owned → true (fails on unfixed: undefined). Unowned → false.
            expect(dto.isEntitled).toBe(ownedSet.has(dto.id));
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
