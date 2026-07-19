// Types for the Test listing service (Req 1.15: type declarations live only in
// `*.types.ts`).
//
// The Test listing service builds the Home Page listings (Req 6) over the Test
// Series repository. It reads every Test (including free Tests) and every priced
// Section in the deterministic `createdAt asc, id asc` order and maps each row to
// its public listing DTO, deferring price classification to the pure
// `classifyPrice` helper. Only the ordered reads are needed from the repository,
// so the injected contract is a narrow slice of `TestRepository`.

import type {
  SectionalTestListingDto,
  TestSeriesListingDto,
} from '../types/domain.types';
import type { TestRepository } from '../repositories/testSeries.repository.types';

/**
 * The repository slice the listing service depends on: the two deterministic
 * ordered listing reads (Req 6.1, 6.4). Narrowed from `TestRepository` so the
 * service is injected with exactly what it needs, matching the
 * `createXxxService(deps)` convention.
 */
export type TestListingRepository = Pick<
  TestRepository,
  'listTests' | 'listPricedSections'
>;

/**
 * The Payment Entitlement lookups the listing service depends on to surface
 * per-product ownership: the Test and Section ids the Learner holds an
 * Entitlement for (Req 2.1, 2.2, 2.3). Mirrors the entitlements slice the
 * attempt and payment services already inject.
 */
export interface TestListingEntitlementRepository {
  listEntitledTestIds(userId: string): Promise<string[]>;
  listEntitledSectionIds(userId: string): Promise<string[]>;
}

/** Injected dependencies for the Test listing service. */
export interface TestListingServiceDeps {
  tests: TestListingRepository;
  entitlements: TestListingEntitlementRepository;
}

/**
 * The Test listing service contract (Req 6.1–6.4). Returns the Test Series list
 * (every Test, including free) and the Sectional Tests list (priced Sections
 * only), each in the deterministic order provided by the repository.
 */
export interface TestListingService {
  /**
   * Every Test offered as a Test Series product, including free Tests, mapped to
   * `TestSeriesListingDto` with `isFree` derived from the pure price classifier
   * (Req 6.1, 6.3, 6.4). When `userId` is provided, each Test the Learner holds
   * an Entitlement for is marked `isEntitled = true`; when `userId` is
   * `undefined` every product is `isEntitled = false` (Req 2.1, 2.3).
   */
  listTestSeries(userId?: string): Promise<TestSeriesListingDto[]>;
  /**
   * Every Section whose Price amount is present and positive, mapped to
   * `SectionalTestListingDto`, in the deterministic order (Req 6.1, 6.4). When
   * `userId` is provided, each Section the Learner holds an Entitlement for is
   * marked `isEntitled = true`; when `userId` is `undefined` every product is
   * `isEntitled = false` (Req 2.2, 2.3).
   */
  listSectionalTests(userId?: string): Promise<SectionalTestListingDto[]>;
}
