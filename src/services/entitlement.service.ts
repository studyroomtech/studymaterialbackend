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

import type {
  EntitlementRef,
  MaterialMembership,
} from './entitlement.service.types';

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

// Effective Entitlement extends the Direct check across Link Groups: a Learner
// who is directly entitled to any member of a material's Link Group is
// Effectively Entitled to every member (Req 4.1, 4.2, 10.1). The functions
// below stay pure and total so the gate's propagation rule and the listing's
// derivation can be reasoned about and property-tested in isolation. Resolving
// the group membership (which rows belong together) is the repository's job;
// these functions only decide over already-resolved membership.

/**
 * Whether the Learner holds an Effective Entitlement for `materialId`: a Direct
 * Entitlement for the material itself, OR for any member of its Link Group.
 *
 * `groupMemberIds` is the closure of the material's group (self + siblings) as
 * resolved by `linkGroup.repository.listGroupMemberIds`. An empty or singleton
 * closure — i.e. an ungrouped material — reduces this to the Direct check
 * against `materialId` (Req 4.1, 4.2, 10.1). Pure and total: the same inputs
 * always yield the same decision and no records are consulted or changed.
 */
export function isEffectivelyEntitled(
  directlyEntitledMaterialIds: ReadonlySet<string>,
  groupMemberIds: readonly string[],
  materialId: string
): boolean {
  if (directlyEntitledMaterialIds.has(materialId)) {
    return true;
  }
  return groupMemberIds.some((memberId) =>
    directlyEntitledMaterialIds.has(memberId)
  );
}

/**
 * The set of material ids the Learner is Effectively Entitled to, derived for
 * the listing from the directly-entitled ids and the `(materialId → groupId |
 * null)` membership rows (Req 6.1, 6.2, 10.2).
 *
 * A Link Group is "entitled" iff at least one of its members is directly
 * entitled; every member of an entitled group is then included. In addition,
 * every directly-entitled ungrouped material (a row with `linkGroupId === null`)
 * is included. Pure and total: the result depends only on the inputs, so the
 * listing reflects Effective Entitlement live without mutating any record.
 */
export function effectivelyEntitledIds(
  directlyEntitledMaterialIds: ReadonlySet<string>,
  memberships: readonly MaterialMembership[]
): Set<string> {
  const membersByGroup = new Map<string, string[]>();
  const entitledGroupIds = new Set<string>();
  const result = new Set<string>();

  for (const { materialId, linkGroupId } of memberships) {
    if (linkGroupId === null) {
      // Ungrouped material: included only on its own Direct Entitlement.
      if (directlyEntitledMaterialIds.has(materialId)) {
        result.add(materialId);
      }
      continue;
    }

    const members = membersByGroup.get(linkGroupId);
    if (members === undefined) {
      membersByGroup.set(linkGroupId, [materialId]);
    } else {
      members.push(materialId);
    }

    if (directlyEntitledMaterialIds.has(materialId)) {
      entitledGroupIds.add(linkGroupId);
    }
  }

  // Every member of an entitled group inherits Effective Entitlement.
  for (const groupId of entitledGroupIds) {
    for (const memberId of membersByGroup.get(groupId) ?? []) {
      result.add(memberId);
    }
  }

  return result;
}
