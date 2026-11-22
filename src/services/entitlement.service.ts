// Pure Payment Entitlement membership logic (Req 12.2, 12.3, 12.8).
//
// This module contains only pure, side-effect-free functions: given a set of
// Payment Entitlements and a `(userId, materialId)` pair, it decides whether the
// Learner's User Record holds an Entitlement for that Paid Material. It performs
// no I/O and holds no state, so the entitlement gate's decision rule can be
// reasoned about and property-tested in isolation from the HTTP/persistence
// layers.
//
// The entitlement gate (added to material.service/download.service in task
// 19.1) uses this to decide whether a Paid Material's view content or download
// presigning may proceed: access is served only when the material is Free or an
// Entitlement exists for the resolved Learner (Req 12.2, 12.3). Because an
// Entitlement persists once granted, repeated checks against the same set keep
// returning `true` — access is preserved without repayment (Req 12.8).

import type { EntitlementRef } from './entitlement.service.types';

/**
 * Whether an Entitlement record grants the given `(userId, materialId)` pair.
 * A match requires BOTH the User Record and the Paid Material to be identical —
 * an Entitlement for a different user or a different material does not grant
 * access (Req 12.2, 12.3).
 */
export function entitlementMatches(
  entitlement: EntitlementRef,
  userId: string,
  materialId: string
): boolean {
  return (
    entitlement.userId === userId &&
    entitlement.studyMaterialId === materialId
  );
}

/**
 * Whether the Learner's User Record holds a Payment Entitlement for the Paid
 * Material. Returns `true` if and only if some Entitlement in `entitlements`
 * references exactly this `(userId, materialId)` pair (Req 12.2, 12.3, 12.8).
 *
 * Pure and total: an empty set yields `false`, and the same inputs always
 * produce the same result, so an Entitlement that exists continues to grant
 * access on every subsequent request without an additional Payment (Req 12.8).
 */
export function isEntitled(
  entitlements: readonly EntitlementRef[],
  userId: string,
  materialId: string
): boolean {
  return entitlements.some((entitlement) =>
    entitlementMatches(entitlement, userId, materialId)
  );
}
