// Test listing service — Home Page Test Series and Sectional Tests listings
// (Req 6).
//
// Returns two lists for the Home Page:
//   - Test Series: every Test, including free Tests, mapped to
//     `TestSeriesListingDto` with `isFree` derived from the pure `classifyPrice`
//     helper so a `null`/`0` Price surfaces as a free Test (Req 6.1, 6.3).
//   - Sectional Tests: only Sections whose Price amount is present and positive,
//     mapped to `SectionalTestListingDto` (Req 6.1). The priced-only filter is
//     applied by the repository read.
//
// Both lists preserve the deterministic `createdAt asc, id asc` order the
// repository provides, so the ordering is identical across repeated loads of the
// same data (Req 6.4). The service holds no timing/scoring/access logic — it is
// a thin, pure mapping over the injected ordered reads, mirroring the
// `createXxxService(deps)` + `createDefaultXxxService()` split used by the
// payment and material services.

import { DEFAULT_CURRENCY } from '../constants/payment.constant';
import * as entitlementRepository from '../repositories/entitlement.repository';
import * as testSeriesRepository from '../repositories/testSeries.repository';
import { classifyPrice } from './price.service';
import type {
  SectionalTestListingDto,
  TestSeriesListingDto,
} from '../types/domain.types';
import type { Test } from '@prisma/client';
import type { SectionWithTest } from '../repositories/testSeries.repository.types';
import type {
  TestListingService,
  TestListingServiceDeps,
} from './testSeriesListing.service.types';

// --- Pure mappers (no I/O) ------------------------------------------------

/**
 * Map a persisted Test to its Test Series listing DTO (Req 6.1–6.3). The Price
 * amount is carried through in paise (`null` for a free Test) and `isFree` is
 * derived from the pure price classifier so the Paid/Free boundary matches price
 * validation elsewhere. Pure.
 */
export function toTestSeriesListingDto(
  test: Test,
  entitledTestIds: ReadonlySet<string>,
): TestSeriesListingDto {
  const priceAmount = test.priceAmount ?? null;
  return {
    id: test.id,
    title: test.title,
    timingMode: test.timingMode,
    timeLimitSeconds: test.timeLimitSeconds,
    priceAmount,
    currency: test.currency ?? DEFAULT_CURRENCY,
    isFree: classifyPrice(priceAmount) === 'free',
    isEntitled: entitledTestIds.has(test.id),
  };
}

/**
 * Map a priced Section (with its parent Test) to its Sectional Test listing DTO
 * (Req 6.1, 6.2). Only Sections with a positive Price reach this mapper, so the
 * paise `priceAmount` is always present and positive. Pure.
 */
export function toSectionalTestListingDto(
  section: SectionWithTest,
  entitledSectionIds: ReadonlySet<string>,
): SectionalTestListingDto {
  return {
    sectionId: section.id,
    testId: section.testId,
    title: section.title,
    timeLimitSeconds: section.timeLimitSeconds,
    priceAmount: section.priceAmount ?? 0,
    currency: section.currency ?? DEFAULT_CURRENCY,
    isEntitled: entitledSectionIds.has(section.id),
  };
}

// --- Service factory ------------------------------------------------------

/**
 * Construct the Test listing service over the injected repository slice. The
 * controller layer wires in the concrete Prisma-backed repository via
 * `createDefaultTestListingService`.
 */
export function createTestListingService(
  deps: TestListingServiceDeps,
): TestListingService {
  const { tests, entitlements } = deps;

  /**
   * Every Test offered as a Test Series product, including free Tests, in the
   * deterministic `createdAt asc, id asc` order (Req 6.1, 6.3, 6.4). When a
   * `userId` is resolved, the Test ids the Learner holds an Entitlement for are
   * marked `isEntitled = true`; an `undefined` caller yields an empty set so
   * every product is `isEntitled = false` (Req 2.1, 2.3).
   */
  async function listTestSeries(
    userId?: string,
  ): Promise<TestSeriesListingDto[]> {
    const rows = await tests.listTests();
    const entitledTestIds =
      userId === undefined
        ? new Set<string>()
        : new Set(await entitlements.listEntitledTestIds(userId));
    return rows.map((row) => toTestSeriesListingDto(row, entitledTestIds));
  }

  /**
   * Every Section whose Price amount is present and positive, in the
   * deterministic `createdAt asc, id asc` order (Req 6.1, 6.4). When a `userId`
   * is resolved, the Section ids the Learner holds an Entitlement for are marked
   * `isEntitled = true`; an `undefined` caller yields an empty set so every
   * product is `isEntitled = false` (Req 2.2, 2.3).
   */
  async function listSectionalTests(
    userId?: string,
  ): Promise<SectionalTestListingDto[]> {
    const rows = await tests.listPricedSections();
    const entitledSectionIds =
      userId === undefined
        ? new Set<string>()
        : new Set(await entitlements.listEntitledSectionIds(userId));
    return rows.map((row) =>
      toSectionalTestListingDto(row, entitledSectionIds),
    );
  }

  return { listTestSeries, listSectionalTests };
}

// --- Default wiring -------------------------------------------------------

/**
 * Construct the Test listing service wired to the real Prisma-backed Test Series
 * repository. Used by the catalog controller in production (mirrors
 * `createDefaultMaterialService`).
 */
export function createDefaultTestListingService(): TestListingService {
  return createTestListingService({
    tests: {
      listTests: testSeriesRepository.listTests,
      listPricedSections: testSeriesRepository.listPricedSections,
    },
    entitlements: {
      listEntitledTestIds: entitlementRepository.listEntitledTestIds,
      listEntitledSectionIds: entitlementRepository.listEntitledSectionIds,
    },
  });
}
