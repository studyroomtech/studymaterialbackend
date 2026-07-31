// Link Group repository (Req 2.7, 2.8, 3.2, 6.1, 1.5, 11.1).
//
// Wraps Prisma access to the `MaterialLinkGroup` table and the
// `StudyMaterial.linkGroupId` foreign key. A material belongs to at most one
// Link Group (structural at-most-one-group, Req 3.3); siblings are simply the
// other materials that share a `linkGroupId`, so grouping is symmetric and
// transitive by construction.
//
// Reads return plain data and never throw for "not found" (an ungrouped or
// missing material yields an empty result), which lets the pure Link_Manager
// algebra and the entitlement derivation reason over the returned rows without
// error handling. All membership writes for a single link/merge/dissolve run
// inside one `prisma.$transaction`, so the operation is atomic: a failure
// leaves every Link Group exactly as it was (Req 1.5, 3.2, 11.1).

import { getPrismaClient } from './prismaClient';
import type {
  LinkGroupMemberPrice,
  LinkPlan,
  MaterialMembership,
} from './linkGroup.repository.types';

/**
 * The Link Group membership of each referenced material — its id paired with
 * the id of the `MaterialLinkGroup` it belongs to, or `null` when ungrouped.
 * Materials that do not exist are simply absent from the result (never throws).
 * Backs the conversion of persisted membership into the in-memory `Grouping`
 * the pure planner operates over (Req 3.2, 3.3).
 */
export async function findMembershipFor(
  materialIds: string[]
): Promise<MaterialMembership[]> {
  if (materialIds.length === 0) {
    return [];
  }
  const rows = await getPrismaClient().studyMaterial.findMany({
    where: { id: { in: materialIds } },
    select: { id: true, linkGroupId: true },
  });
  return rows.map((row) => ({
    materialId: row.id,
    linkGroupId: row.linkGroupId,
  }));
}

/**
 * The member ids of the Link Group the given material belongs to — the material
 * itself plus its siblings. Returns an empty array when the material is
 * ungrouped or does not exist (never throws). Backs the entitlement gate's
 * group-closure resolution (Req 4.2).
 */
export async function listGroupMemberIds(
  materialId: string
): Promise<string[]> {
  const prisma = getPrismaClient();
  const material = await prisma.studyMaterial.findUnique({
    where: { id: materialId },
    select: { linkGroupId: true },
  });
  if (material === null || material.linkGroupId === null) {
    return [];
  }
  const members = await prisma.studyMaterial.findMany({
    where: { linkGroupId: material.linkGroupId },
    select: { id: true },
  });
  return members.map((member) => member.id);
}

/**
 * The members of the material's Link Group (self + siblings) paired with each
 * member's Price amount. Returns an empty array when the material is ungrouped
 * or does not exist (never throws). Backs the access gate's "does this group
 * contain a Paid Material?" decision so a Free Material linked to a Paid one is
 * gated behind a Direct Entitlement to some member.
 */
export async function listGroupMembersWithPrice(
  materialId: string
): Promise<LinkGroupMemberPrice[]> {
  const prisma = getPrismaClient();
  const material = await prisma.studyMaterial.findUnique({
    where: { id: materialId },
    select: { linkGroupId: true },
  });
  if (material === null || material.linkGroupId === null) {
    return [];
  }
  const members = await prisma.studyMaterial.findMany({
    where: { linkGroupId: material.linkGroupId },
    select: { id: true, priceAmount: true },
  });
  return members.map((member) => ({
    id: member.id,
    priceAmount: member.priceAmount,
  }));
}

/**
 * The sibling ids of the material — the members of its Link Group excluding the
 * material itself (Req 2.7). Returns an empty array when the material belongs
 * to no Link Group or does not exist (Req 2.8); never throws.
 */
export async function listSiblingIds(materialId: string): Promise<string[]> {
  const memberIds = await listGroupMemberIds(materialId);
  return memberIds.filter((id) => id !== materialId);
}

/**
 * All `(materialId → linkGroupId)` memberships for a set of materials. Backs the
 * Paid Materials listing, which derives Effective Entitlement from the current
 * membership of the listed materials (Req 6.1). Materials that do not exist are
 * absent from the result; never throws.
 */
export async function listMembershipsForMaterials(
  materialIds: string[]
): Promise<MaterialMembership[]> {
  if (materialIds.length === 0) {
    return [];
  }
  const rows = await getPrismaClient().studyMaterial.findMany({
    where: { id: { in: materialIds } },
    select: { id: true, linkGroupId: true },
  });
  return rows.map((row) => ({
    materialId: row.id,
    linkGroupId: row.linkGroupId,
  }));
}

/**
 * Which of the given material ids resolve to an existing `StudyMaterial`. The
 * service diffs this against the requested ids to compute the `NOT_FOUND` set
 * and reject a link operation before any write (Req 1.5, 3.7, 11.1). Never
 * throws for missing ids — they are simply excluded from the result.
 */
export async function findExistingMaterialIds(
  materialIds: string[]
): Promise<string[]> {
  if (materialIds.length === 0) {
    return [];
  }
  const rows = await getPrismaClient().studyMaterial.findMany({
    where: { id: { in: materialIds } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/**
 * Apply a computed grouping plan atomically (Req 1.5, 3.2, 11.1). All writes
 * run inside a single transaction so a link/merge/dissolve either fully applies
 * or leaves every Link Group unchanged:
 *
 *   1. Resolve the target group. When `plan.targetGroupId` is supplied, a fresh
 *      `MaterialLinkGroup` is created with that id. When it is `null` and there
 *      are materials to assign, an existing group already referenced by the
 *      assigned materials is reused; if none exists a fresh group is created.
 *   2. Reassign every material in `assignToTarget` to the resolved target group.
 *   3. Clear the membership of every material in `clearMembership` (unlink /
 *      dissolve), setting its `linkGroupId` to `null`.
 *   4. Delete every emptied `MaterialLinkGroup` in `deleteGroups`.
 *
 * The group row is always ensured before members are reassigned so the
 * `linkGroupId` foreign key stays satisfied, and emptied groups are deleted
 * only after their members have been reassigned or cleared.
 */
export async function applyLinkPlan(plan: LinkPlan): Promise<void> {
  await getPrismaClient().$transaction(async (tx) => {
    if (plan.assignToTarget.length > 0) {
      let targetGroupId = plan.targetGroupId;

      if (targetGroupId === null) {
        // Reuse an existing group already referenced by the assigned materials;
        // fall back to a fresh group when none of them is currently grouped.
        const existing = await tx.studyMaterial.findMany({
          where: { id: { in: plan.assignToTarget } },
          select: { linkGroupId: true },
        });
        targetGroupId =
          existing
            .map((row) => row.linkGroupId)
            .find((groupId) => groupId !== null) ?? null;
        if (targetGroupId === null) {
          const created = await tx.materialLinkGroup.create({ data: {} });
          targetGroupId = created.id;
        }
      } else {
        await tx.materialLinkGroup.create({ data: { id: targetGroupId } });
      }

      await tx.studyMaterial.updateMany({
        where: { id: { in: plan.assignToTarget } },
        data: { linkGroupId: targetGroupId },
      });
    }

    if (plan.clearMembership.length > 0) {
      await tx.studyMaterial.updateMany({
        where: { id: { in: plan.clearMembership } },
        data: { linkGroupId: null },
      });
    }

    if (plan.deleteGroups.length > 0) {
      await tx.materialLinkGroup.deleteMany({
        where: { id: { in: plan.deleteGroups } },
      });
    }
  });
}
