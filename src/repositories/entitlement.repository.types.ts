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
