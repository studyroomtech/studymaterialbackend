// MaterialTag repository (Req 2.2–2.4).
//
// Wraps Prisma access to the `MaterialTag` table. A MaterialTag is the
// assignment of a Tag to a Study Material; the pair is unique so the same Tag
// cannot be assigned twice. The count helper backs the 50-Tag-per-material
// limit enforced by the service layer (Req 2.2, 2.4).

import type { MaterialTag } from '@prisma/client';

import { getPrismaClient } from './prismaClient';

/**
 * Assign a Tag to a Study Material (Req 2.3). The unique
 * `(studyMaterialId, tagId)` constraint prevents duplicate assignments.
 */
export function createMaterialTag(
  studyMaterialId: string,
  tagId: string
): Promise<MaterialTag> {
  return getPrismaClient().materialTag.create({
    data: { studyMaterialId, tagId },
  });
}

/**
 * Remove the MaterialTag assigning `tagId` to `studyMaterialId`. Returns the
 * deleted MaterialTag.
 */
export function deleteMaterialTag(
  studyMaterialId: string,
  tagId: string
): Promise<MaterialTag> {
  return getPrismaClient().materialTag.delete({
    where: {
      studyMaterialId_tagId: { studyMaterialId, tagId },
    },
  });
}

/**
 * Find the MaterialTag assigning `tagId` to `studyMaterialId`, or `null` when
 * the Tag is not assigned to the material.
 */
export function findMaterialTag(
  studyMaterialId: string,
  tagId: string
): Promise<MaterialTag | null> {
  return getPrismaClient().materialTag.findUnique({
    where: {
      studyMaterialId_tagId: { studyMaterialId, tagId },
    },
  });
}

/**
 * Count the MaterialTags currently assigned to a Study Material. Backs the
 * service-layer check that a material carries at most 50 Tags (Req 2.2, 2.4).
 */
export function countMaterialTagsForMaterial(
  studyMaterialId: string
): Promise<number> {
  return getPrismaClient().materialTag.count({ where: { studyMaterialId } });
}

/**
 * List the MaterialTags assigned to a Study Material.
 */
export function listMaterialTagsForMaterial(
  studyMaterialId: string
): Promise<MaterialTag[]> {
  return getPrismaClient().materialTag.findMany({ where: { studyMaterialId } });
}
