// Property 2 (Preservation) — Unowned and Unidentified Listings Unchanged.
//
// Bugfix spec: test-purchase-buy-state. This is the PRESERVATION property test
// and it is written BEFORE the fix, following observation-first methodology: we
// observe the UNFIXED listing behavior for non-bug-condition inputs and encode
// the invariants that must survive the fix. It is EXPECTED TO PASS on the
// unfixed code (it captures the baseline behavior to preserve) and MUST STILL
// PASS after the fix (Task 3.8) — no regressions.
//
// Non-bug condition (design `isBugCondition` returns false): every listed
// product is unowned, OR the caller is unauthenticated (`userId === undefined`).
// For those inputs the design requires:
//   renderListings_original(input) = renderListings_fixed(input)
// i.e. the "Buy" action + product-cart checkout wiring is unchanged and each
// listing's title, price/free indicator, and deterministic `createdAt asc,
// id asc` order are invariant (Req 3.1–3.4).
//
// SCOPE NOTE (frontend limitation): the "Buy" action label and the product-cart
// checkout wiring live in the Home Page `ListingCard` (frontend). The frontend
// project has no DOM/component test infrastructure (no jsdom/RTL harness), so
// these tests are scoped to the BACKEND listing service, where the ownership
// logic actually lives. At the service level the "Buy vs Start test" decision is
// driven entirely by the per-product ownership signal: the fix is additive and
// only introduces an `isEntitled` flag, so a non-bug input yields no owned
// product and therefore drives the unchanged "Buy" path on the Home Page. These
// tests lock the service-level payload (title, price/free indicator, order) that
// the unchanged "Buy" rendering depends on. The fix keeps `listTestSeries` /
// `listSectionalTests` returning DTOs whose title/price/currency/isFree/order
// match the input rows verbatim for non-owned/unauthenticated callers.
//
// To stay stable across the fix, these assertions deliberately exclude the new
// additive `isEntitled` field (undefined on unfixed code, `false` after the fix
// for non-bug inputs) and assert only the fields that are invariant on both.
//
// **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createTestListingService } from './testSeriesListing.service';
import { classifyPrice } from './price.service';
import { DEFAULT_CURRENCY } from '../constants/payment.constant';
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
    priceAmount:
      overrides.priceAmount === undefined ? 50000 : overrides.priceAmount,
    currency: overrides.currency ?? DEFAULT_CURRENCY,
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
    currency: overrides.currency ?? DEFAULT_CURRENCY,
    createdAt: now,
    updatedAt: now,
    test: makeTest({ id: overrides.testId }),
  } as unknown as SectionWithTest;
}

/**
 * Build the listing service. The `entitlements` slice mirrors the FIXED contract
 * (Task 3.2) but is ignored by the unfixed service. For preservation we only
 * ever report ownership of ids that are NOT in the listing (or none at all), so
 * every input is a non-bug condition (no listed product is owned). The unfixed
 * service ignores both the slice and the `userId` argument entirely.
 */
function buildService(args: {
  tests: Test[];
  sections: SectionWithTest[];
  entitledTestIds?: string[];
  entitledSectionIds?: string[];
}) {
  const deps = {
    tests: {
      listTests: async () => args.tests,
      listPricedSections: async () => args.sections,
    },
    entitlements: {
      listEntitledTestIds: async (_userId: string) =>
        args.entitledTestIds ?? [],
      listEntitledSectionIds: async (_userId: string) =>
        args.entitledSectionIds ?? [],
    },
  } as any;
  return createTestListingService(deps) as any;
}

/**
 * Invoke a listing read for a non-bug caller. `authPresent === false` models an
 * unauthenticated load (`userId === undefined`); `authPresent === true` models
 * an authenticated learner who owns nothing in this listing. Both are non-bug
 * conditions and the unfixed service ignores the argument regardless.
 */
async function readListing(
  service: { [k: string]: (userId?: string) => Promise<unknown[]> },
  method: 'listTestSeries' | 'listSectionalTests',
  authPresent: boolean,
  userId: string,
): Promise<unknown[]> {
  return authPresent ? service[method](userId) : service[method]();
}

// --- Arbitraries ----------------------------------------------------------

const idArb = fc
  .string({ minLength: 1, maxLength: 12 })
  .map((s) => `id_${s.replace(/[^A-Za-z0-9]/g, '') || 'x'}`);
const titleArb = fc.string({ minLength: 1, maxLength: 40 });
const userIdArb = idArb.map((s) => `user_${s}`);
const authPresentArb = fc.boolean();

// A price that is either free (null or 0) or a positive paise amount, so the
// generator covers free vs priced Tests.
const testPriceArb = fc.oneof(
  fc.constant(null),
  fc.constant(0),
  fc.integer({ min: 1, max: 1_000_000 }),
);

// Ownership of ids that can never be in the listing (distinct prefix), so the
// caller owns nothing listed → guaranteed non-bug condition even after the fix.
const unlistedOwnedIdsArb = fc.array(
  idArb.map((s) => `unlisted_${s}`),
  { maxLength: 4 },
);

// A list of Test rows with unique ids, in the order the repository would return
// them (order is meaningful — we assert it is preserved verbatim).
const testRowsArb = fc
  .uniqueArray(fc.tuple(idArb, titleArb, testPriceArb), {
    maxLength: 6,
    selector: ([id]) => id,
  })
  .map((tuples) =>
    tuples.map(([id, title, priceAmount]) =>
      makeTest({ id, title, priceAmount }),
    ),
  );

// A list of priced Section rows with unique ids, in repository order.
const sectionRowsArb = fc
  .uniqueArray(
    fc.tuple(idArb, idArb, titleArb, fc.integer({ min: 1, max: 1_000_000 })),
    { maxLength: 6, selector: ([id]) => id },
  )
  .map((tuples) =>
    tuples.map(([id, testId, title, priceAmount]) =>
      makeSection({ id, testId, title, priceAmount }),
    ),
  );

describe('Property 2 (Preservation): unowned / unauthenticated Test Series listings unchanged', () => {
  it('preserves title, price/free indicator, and deterministic order for every listed Test', async () => {
    await fc.assert(
      fc.asyncProperty(
        testRowsArb,
        authPresentArb,
        userIdArb,
        unlistedOwnedIdsArb,
        async (rows, authPresent, userId, unlistedOwned) => {
          const service = buildService({
            tests: rows,
            sections: [],
            entitledTestIds: unlistedOwned, // never intersects listed ids
          });

          const listings = (await readListing(
            service,
            'listTestSeries',
            authPresent,
            userId,
          )) as Array<{
            id: string;
            title: string;
            priceAmount: number | null;
            currency: string;
            isFree: boolean;
          }>;

          // Order preserved 1:1 with the repository rows (Req 3.3).
          expect(listings.map((l) => l.id)).toEqual(rows.map((r) => r.id));

          // Each listing preserves its title, price, currency, and free
          // indicator exactly as before (Req 3.3, 3.4).
          rows.forEach((row, i) => {
            const dto = listings[i];
            const expectedPrice = row.priceAmount ?? null;
            expect(dto.title).toBe(row.title);
            expect(dto.priceAmount).toBe(expectedPrice);
            expect(dto.currency).toBe(row.currency ?? DEFAULT_CURRENCY);
            expect(dto.isFree).toBe(classifyPrice(expectedPrice) === 'free');
          });
        },
      ),
      { numRuns: 60 },
    );
  });

  it('a free, unowned Test keeps its free indicator (isFree true, priceAmount null)', async () => {
    await fc.assert(
      fc.asyncProperty(
        idArb,
        titleArb,
        authPresentArb,
        userIdArb,
        fc.constantFrom<number | null>(null, 0),
        async (testId, title, authPresent, userId, freePrice) => {
          const service = buildService({
            tests: [makeTest({ id: testId, title, priceAmount: freePrice })],
            sections: [],
          });

          const listings = (await readListing(
            service,
            'listTestSeries',
            authPresent,
            userId,
          )) as Array<{
            id: string;
            title: string;
            priceAmount: number | null;
            isFree: boolean;
          }>;

          const dto = listings.find((l) => l.id === testId);
          expect(dto).toBeDefined();
          // Free indicator + wiring preserved regardless of auth (Req 3.4).
          // Observed baseline: the mapper carries `priceAmount` through as
          // `test.priceAmount ?? null`, so a `0` price stays `0` and a `null`
          // price stays `null` — both classify as free (isFree true).
          expect(dto?.isFree).toBe(true);
          expect(dto?.priceAmount).toBe(freePrice ?? null);
          expect(dto?.title).toBe(title);
        },
      ),
      { numRuns: 40 },
    );
  });

  it('produces an empty list for empty listings (edge case)', async () => {
    await fc.assert(
      fc.asyncProperty(authPresentArb, userIdArb, async (authPresent, userId) => {
        const service = buildService({ tests: [], sections: [] });
        const listings = await readListing(
          service,
          'listTestSeries',
          authPresent,
          userId,
        );
        expect(listings).toEqual([]);
      }),
      { numRuns: 20 },
    );
  });
});

describe('Property 2 (Preservation): unowned / unauthenticated Sectional Test listings unchanged', () => {
  it('preserves title, price, and deterministic order for every listed Sectional Test', async () => {
    await fc.assert(
      fc.asyncProperty(
        sectionRowsArb,
        authPresentArb,
        userIdArb,
        unlistedOwnedIdsArb,
        async (rows, authPresent, userId, unlistedOwned) => {
          const service = buildService({
            tests: [],
            sections: rows,
            entitledSectionIds: unlistedOwned, // never intersects listed ids
          });

          const listings = (await readListing(
            service,
            'listSectionalTests',
            authPresent,
            userId,
          )) as Array<{
            sectionId: string;
            testId: string;
            title: string;
            priceAmount: number;
            currency: string;
          }>;

          // Order preserved 1:1 with repository rows (Req 3.3).
          expect(listings.map((l) => l.sectionId)).toEqual(
            rows.map((r) => r.id),
          );

          // Each listing preserves its identity, title, price, and currency
          // exactly as before (Req 3.3, 3.4).
          rows.forEach((row, i) => {
            const dto = listings[i];
            expect(dto.sectionId).toBe(row.id);
            expect(dto.testId).toBe(row.testId);
            expect(dto.title).toBe(row.title);
            expect(dto.priceAmount).toBe(row.priceAmount ?? 0);
            expect(dto.currency).toBe(row.currency ?? DEFAULT_CURRENCY);
          });
        },
      ),
      { numRuns: 60 },
    );
  });

  it('produces an empty list for empty Sectional listings (edge case)', async () => {
    await fc.assert(
      fc.asyncProperty(authPresentArb, userIdArb, async (authPresent, userId) => {
        const service = buildService({ tests: [], sections: [] });
        const listings = await readListing(
          service,
          'listSectionalTests',
          authPresent,
          userId,
        );
        expect(listings).toEqual([]);
      }),
      { numRuns: 20 },
    );
  });
});
