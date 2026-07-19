// Types for the Payment Entitlement repository (Req 1.15: type declarations
// live only in `*.types.ts`).

/**
 * The fields persisted when granting a Payment Entitlement after a successful
 * Payment (Req 12.8). The Entitlement grants the Learner's User Record access
 * to the Paid Material and references the successful Payment that granted it.
 * At most one Entitlement exists per `(userId, studyMaterialId)` pair, enforced
 * by the schema's compound unique (Req 12.8, 12.11).
 */
export interface GrantEntitlementInput {
  userId: string;
  studyMaterialId: string;
  paymentId: string;
}

/**
 * Discriminates which purchasable product an Entitlement grant covers. A grant
 * writes exactly one of `studyMaterialId`/`testId`/`sectionId` on the row,
 * selected by this type (Req 7.2).
 */
export type EntitlementProductType = 'study_material' | 'test' | 'section';

/** A purchasable product reference an Entitlement grant is keyed to. */
export interface EntitlementProductRef {
  type: EntitlementProductType;
  id: string;
}

/**
 * The fields persisted when granting a Payment Entitlement for a covered
 * product after a successful Payment (Req 7.2). Exactly one of
 * `studyMaterialId`/`testId`/`sectionId` is written on the Entitlement,
 * selected by `product.type`; idempotency per `(userId, product)` is enforced
 * by the matching composite unique index (Req 7.8).
 */
export interface GrantProductEntitlementInput {
  userId: string;
  product: EntitlementProductRef;
  paymentId: string;
}
