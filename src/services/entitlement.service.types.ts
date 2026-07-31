// Types for the pure Payment Entitlement service (Req 1.15: type declarations
// live only in `*.types.ts`).
//
// These describe the inputs to the pure entitlement-membership logic in
// `entitlement.service.ts`, which decides whether a Learner's User Record holds
// a Payment Entitlement for a given Paid Material (Req 12.2, 12.3, 12.8).

/**
 * The minimal shape of a Payment Entitlement needed to decide entitlement
 * membership: the User Record it was granted to and the Paid Material it
 * grants access to. The persisted Prisma `Entitlement` row (and any richer DTO)
 * is assignable to this structural type, so the pure check can be exercised
 * without depending on the persistence layer (Req 12.8).
 */
export interface EntitlementRef {
  /** The User Record the Entitlement was granted to. */
  userId: string;
  /**
   * The Paid Material the Entitlement grants access to, or `null` for a
   * non-study-material Entitlement (e.g. a Test/Section grant). A `null` value
   * never matches a study-material id in the membership check.
   */
  studyMaterialId: string | null;
}

// Re-exported so the pure Effective-Entitlement derivation in
// `entitlement.service.ts` depends on its membership contract through this
// module (Req 1.15) rather than reaching into the repository types directly.
// A `MaterialMembership` pairs a Study Material with the Link Group it belongs
// to (or `null` when ungrouped) and backs `effectivelyEntitledIds` (Req 6.1,
// 6.2).
export type { MaterialMembership } from '../repositories/linkGroup.repository.types';
