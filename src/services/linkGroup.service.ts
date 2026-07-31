// Link_Manager service (Req 1, 2, 3, 11).
//
// This module holds the Link Group domain logic. It is split into two layers:
//
//   1. A pure, side-effect-free grouping algebra (`planLink`, `planUnlink`,
//      `siblingsOf`) that operates on an in-memory `Grouping` — a set of
//      disjoint member groups, each with ≥2 distinct members. These functions
//      perform no I/O and hold no state, so the grouping invariants
//      (at-most-one-group Req 3.3, ≥2-members Req 3.4, symmetric/transitive
//      merge Req 3.1/3.2) can be reasoned about and property-tested in
//      isolation from Prisma and HTTP.
//
//   2. (Added in task 4.1) The orchestration factory `createLinkGroupService`
//      / `createDefaultLinkGroupService`, which resolves current membership
//      through the injected repository, runs the pure planner below, diffs the
//      result into a `LinkPlan`, and applies it in a transaction.
//
// Both the pure algebra and the orchestration factory live here.

import { randomUUID } from 'node:crypto';

import { NotFoundError, ValidationError } from '../utils/errors';
import type { LinkPlan } from '../repositories/linkGroup.repository.types';
import * as linkGroupRepository from '../repositories/linkGroup.repository';

import {
  LINK_GROUP_MAX_REFERENCES,
  LINK_GROUP_MIN_DISTINCT,
} from './linkGroup.service.constant';
import type {
  Grouping,
  LinkGroupResult,
  LinkGroupService,
  LinkGroupServiceDeps,
  LinkMaterialsInput,
} from './linkGroup.service.types';

/**
 * De-duplicate a list of ids preserving first-seen order. Used to normalize
 * referenced-id lists so linking a raw list and its deduplicated form produce
 * the same grouping (Req 1.3, 3.5).
 */
function distinctInOrder(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

/**
 * The index of the group in `current` that contains `materialId`, or `-1` when
 * the material belongs to no group. Because a `Grouping` is disjoint, at most
 * one group can contain the material (Req 3.3).
 */
function indexOfGroupContaining(
  current: Grouping,
  materialId: string,
): number {
  return current.findIndex((group) => group.includes(materialId));
}

/**
 * Link a set of referenced materials into a single group, merging any groups
 * they already belong to (Req 1.1, 1.2, 2.1, 2.2, 3.1, 3.2).
 *
 * The resulting group is the duplicate-free union of the distinct referenced
 * ids together with every member of any group any referenced id belonged to;
 * all of those source groups are replaced by the single merged group, and every
 * other group is left untouched. Linking is therefore symmetric and transitive:
 * chained links converge on one group.
 *
 * Pure and total. Duplicate references are normalized (Req 1.3, 3.5), so linking
 * a raw list and its deduplicated form yield the same grouping. When the union
 * would contain fewer than two distinct members (nothing meaningful to group),
 * the grouping is returned unchanged, preserving the ≥2-members invariant
 * (Req 3.4); validation of that case as an error is the service layer's
 * responsibility (Req 2.3, 11.2).
 */
export function planLink(
  current: Grouping,
  referencedIds: readonly string[],
): Grouping {
  const distinct = distinctInOrder(referencedIds);

  const affected: string[][] = [];
  const untouched: (readonly string[])[] = [];
  for (const group of current) {
    if (group.some((member) => distinct.includes(member))) {
      affected.push([...group]);
    } else {
      untouched.push(group);
    }
  }

  const mergedMembers = distinctInOrder([
    ...distinct,
    ...affected.flat(),
  ]);

  // Nothing to group (fewer than two distinct members): leave the grouping as
  // it was so the ≥2-members invariant holds (Req 3.4).
  if (mergedMembers.length < 2) {
    return current;
  }

  return [...untouched, mergedMembers];
}

/**
 * Remove a material from its Link Group (Req 2.4). When removal would leave the
 * former group with fewer than two members, the group is dissolved and its
 * remaining member becomes ungrouped (Req 2.5, 3.4).
 *
 * Pure and total. When the material belongs to no group, the grouping is
 * returned unchanged (Req 2.6).
 */
export function planUnlink(current: Grouping, materialId: string): Grouping {
  const groupIndex = indexOfGroupContaining(current, materialId);
  if (groupIndex === -1) {
    return current;
  }

  const remaining = current[groupIndex].filter(
    (member) => member !== materialId,
  );

  const others = current.filter((_, index) => index !== groupIndex);

  // Dissolve a group that would drop below two members (Req 2.5, 3.4).
  if (remaining.length < 2) {
    return others;
  }

  return [...others, remaining];
}

/**
 * The sibling ids of a material within a grouping: the members of the material's
 * group excluding the material itself (Req 2.7). Empty when the material belongs
 * to no group (Req 2.8).
 *
 * Pure and total.
 */
export function siblingsOf(current: Grouping, materialId: string): string[] {
  const groupIndex = indexOfGroupContaining(current, materialId);
  if (groupIndex === -1) {
    return [];
  }
  return current[groupIndex].filter((member) => member !== materialId);
}

// ---------------------------------------------------------------------------
// Orchestration factory (I/O behind injected deps)
// ---------------------------------------------------------------------------
//
// `createLinkGroupService` wires the pure grouping algebra above to a narrow
// repository contract. Every mutating method resolves the current persisted
// membership, validates the request, runs the pure planner, diffs the result
// into a `LinkPlan`, and hands the plan to `applyLinkPlan` — which applies all
// membership writes inside a single transaction so a link/merge/dissolve is
// atomic (Req 1.5, 3.2, 11.1). Validation always runs before any write, so a
// rejected operation leaves every Link Group unchanged.

/**
 * Whether two member collections describe the same set of ids. Because a merged
 * group is always a superset of any single group it absorbed, equal cardinality
 * is sufficient to conclude equality here (used to detect an idempotent link
 * that would leave the grouping unchanged, Req 3.5).
 */
function sameMemberCount(
  existing: readonly string[],
  merged: readonly string[],
): boolean {
  return existing.length === merged.length;
}

/**
 * Construct the Link_Manager service over an injected repository. Keeping the
 * repository behind {@link LinkGroupServiceDeps} lets the validation, precedence,
 * and plan-diffing logic be unit-tested with in-memory fakes, independent of
 * Prisma (mirrors the other `createXxxService` factories).
 */
export function createLinkGroupService(
  deps: LinkGroupServiceDeps,
): LinkGroupService {
  return {
    async linkMaterials(
      input: LinkMaterialsInput,
    ): Promise<LinkGroupResult> {
      const { subjectId } = input;

      // 1. Normalize duplicate references to distinct ids (Req 1.3, 3.5). The
      //    subject is always part of the union; the referenced ids that differ
      //    from the subject are the other endpoints of the link.
      const distinctReferenced = distinctInOrder(input.referencedIds);
      const referencedOthers = distinctReferenced.filter(
        (id) => id !== subjectId,
      );
      const union = distinctInOrder([subjectId, ...distinctReferenced]);

      // 2. Fewer than two distinct materials — including a link whose only
      //    endpoint is the subject itself — is a VALIDATION_ERROR and changes
      //    nothing (Req 2.3, 3.6, 11.2).
      if (referencedOthers.length === 0) {
        const isSelfLink = distinctReferenced.includes(subjectId);
        const message = isSelfLink
          ? 'A Study Material cannot be linked to itself.'
          : `A link operation must reference at least ${LINK_GROUP_MIN_DISTINCT} distinct Study Materials.`;
        const reason = isSelfLink
          ? 'A Study Material cannot be linked to itself; reference at least one other distinct Study Material.'
          : `Reference at least ${LINK_GROUP_MIN_DISTINCT} distinct Study Materials.`;
        throw new ValidationError(message, [
          { field: 'materialIds', reason },
        ]);
      }

      // 3. Referencing more than the maximum number of existing materials is a
      //    VALIDATION_ERROR that names the maximum (Req 1.6).
      if (distinctReferenced.length > LINK_GROUP_MAX_REFERENCES) {
        throw new ValidationError(
          `A link operation may reference at most ${LINK_GROUP_MAX_REFERENCES} Study Materials.`,
          [
            {
              field: 'materialIds',
              reason: `Reference at most ${LINK_GROUP_MAX_REFERENCES} Study Materials in a single link operation.`,
            },
          ],
        );
      }

      // 4. Every referenced material (and the subject) must exist. Any missing
      //    id rejects the whole operation as NOT_FOUND before any write, so
      //    every Link Group is left unchanged (Req 1.5, 3.7, 11.1).
      const existing = new Set(
        await deps.linkGroups.findExistingMaterialIds(union),
      );
      const missing = union.filter((id) => !existing.has(id));
      if (missing.length > 0) {
        throw new NotFoundError(
          `One or more referenced Study Materials were not found: ${missing.join(', ')}.`,
        );
      }

      // 5. Resolve the current membership of every group any union member
      //    already belongs to, so the merge unions their full membership.
      const unionMemberships =
        await deps.linkGroups.findMembershipFor(union);
      const affectedGroups = new Map<string, string[]>();
      for (const membership of unionMemberships) {
        if (
          membership.linkGroupId !== null &&
          !affectedGroups.has(membership.linkGroupId)
        ) {
          affectedGroups.set(
            membership.linkGroupId,
            await deps.linkGroups.listGroupMemberIds(membership.materialId),
          );
        }
      }
      const affectedGroupIds = [...affectedGroups.keys()];

      // 6. Run the pure planner over the affected groups and derive the merged
      //    group and the subject's resulting siblings.
      const currentGrouping: Grouping = affectedGroupIds.map(
        (groupId) => affectedGroups.get(groupId) ?? [],
      );
      const nextGrouping = planLink(currentGrouping, union);
      const mergedGroup =
        nextGrouping.find((group) => group.includes(subjectId)) ?? [];
      const siblingIds = siblingsOf(nextGrouping, subjectId);

      // 7. Linking materials that already share exactly one group leaves that
      //    group unchanged — an idempotent no-op (Req 3.5).
      const firstAffected =
        affectedGroupIds.length === 1
          ? affectedGroups.get(affectedGroupIds[0]) ?? []
          : null;
      if (firstAffected !== null && sameMemberCount(firstAffected, mergedGroup)) {
        return { siblingIds, changed: false };
      }

      // 8. Diff into a plan: create one fresh target group, assign every merged
      //    member to it, and delete the emptied source groups. Doing the whole
      //    merge through a single fresh target keeps deletion deterministic and
      //    the union duplicate-free (Req 1.2, 2.2, 3.2).
      const plan: LinkPlan = {
        targetGroupId: randomUUID(),
        assignToTarget: [...mergedGroup],
        clearMembership: [],
        deleteGroups: affectedGroupIds,
      };
      await deps.linkGroups.applyLinkPlan(plan);

      return { siblingIds, changed: true };
    },

    async unlinkMaterial(materialId: string): Promise<LinkGroupResult> {
      const memberIds = await deps.linkGroups.listGroupMemberIds(materialId);

      // Removing a material with no Link Group membership is a success no-op
      // (Req 2.6). A non-existent material resolves to no membership here too.
      if (memberIds.length === 0) {
        return { siblingIds: [], changed: false };
      }

      const [membership] = await deps.linkGroups.findMembershipFor([
        materialId,
      ]);
      const groupId = membership?.linkGroupId ?? null;
      const remaining = memberIds.filter((id) => id !== materialId);

      let plan: LinkPlan;
      if (remaining.length < LINK_GROUP_MIN_DISTINCT) {
        // Removing the material leaves fewer than two members, so dissolve the
        // group: clear every member's membership and delete the group row
        // (Req 2.5, 3.4).
        plan = {
          targetGroupId: null,
          assignToTarget: [],
          clearMembership: memberIds,
          deleteGroups: groupId === null ? [] : [groupId],
        };
      } else {
        // The group retains at least two members, so only the removed material
        // is cleared (Req 2.4).
        plan = {
          targetGroupId: null,
          assignToTarget: [],
          clearMembership: [materialId],
          deleteGroups: [],
        };
      }
      await deps.linkGroups.applyLinkPlan(plan);

      // The removed material is now ungrouped, so it has no siblings (Req 2.4).
      return { siblingIds: [], changed: true };
    },

    async getSiblings(materialId: string): Promise<string[]> {
      // The repository excludes the material itself and returns [] when the
      // material belongs to no Link Group (Req 2.7, 2.8).
      return deps.linkGroups.listSiblingIds(materialId);
    },
  };
}

/**
 * Construct a Link_Manager service wired to the real Prisma-backed Link Group
 * repository. Used by the controller layer in production (mirrors the other
 * `createDefaultXxxService` factories).
 */
export function createDefaultLinkGroupService(): LinkGroupService {
  return createLinkGroupService({
    linkGroups: {
      findMembershipFor: linkGroupRepository.findMembershipFor,
      listGroupMemberIds: linkGroupRepository.listGroupMemberIds,
      listSiblingIds: linkGroupRepository.listSiblingIds,
      listMembershipsForMaterials:
        linkGroupRepository.listMembershipsForMaterials,
      findExistingMaterialIds: linkGroupRepository.findExistingMaterialIds,
      applyLinkPlan: linkGroupRepository.applyLinkPlan,
    },
  });
}
