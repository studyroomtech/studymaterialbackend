// Study Material repository (Req 1.13, 5.1, 5.3, 5.4, 11.1–11.6).
//
// Wraps Prisma access to the `StudyMaterial` table. The database stores only
// the material metadata together with the Object Storage Key that references
// the file in Cloudflare R2 — never the file bytes (Req 1.13). Reads resolve
// each material's Tags down to their Category Type so the service layer can
// group them by Category Type for the catalog (Req 2.5).

import { Prisma } from '@prisma/client';
import type { MaterialFile, StudyMaterial } from '@prisma/client';

import { getPrismaClient } from './prismaClient';
import type {
  CreateMaterialInput,
  MaterialFileInput,
  MaterialWithTags,
  UpdateMaterialInput,
} from './material.repository.types';

// Include shape that resolves each MaterialTag's Tag and its Category Type, and
// the material's ordered list of files (primary first). Shared by every read so
// create/find/list/update all return the resolved Tags and files.
const TAG_INCLUDE = {
  materialTags: { include: { tag: { include: { categoryType: true } } } },
  files: { orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }] },
} satisfies Prisma.StudyMaterialInclude;

/**
 * Persist a new Study Material's metadata and Object Storage Key (Req 11.1,
 * 1.13). Returns the created record with its (initially empty) resolved Tags.
 */
export function createMaterial(
  input: CreateMaterialInput
): Promise<MaterialWithTags> {
  return getPrismaClient().studyMaterial.create({
    data: {
      title: input.title,
      description: input.description ?? '',
      objectKey: input.objectKey,
      fileName: input.fileName,
      contentType: input.contentType,
      fileSizeBytes: input.fileSizeBytes,
      priceAmount: input.priceAmount ?? null,
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
    },
    include: TAG_INCLUDE,
  });
}

/**
 * Find a Study Material by id with its resolved Tags, or `null` when none
 * exists so the service layer can return a not-found error without content
 * (Req 5.4).
 */
export function findMaterialById(
  id: string
): Promise<MaterialWithTags | null> {
  return getPrismaClient().studyMaterial.findUnique({
    where: { id },
    include: TAG_INCLUDE,
  });
}

/**
 * List every Study Material with its resolved Tags, ordered by creation time
 * for a consistent order across views. Backs the catalog and search reads
 * (Req 2.5, 3.1, 4.1).
 */
export function listMaterials(): Promise<MaterialWithTags[]> {
  return getPrismaClient().studyMaterial.findMany({
    orderBy: { createdAt: 'asc' },
    include: TAG_INCLUDE,
  });
}

/**
 * Update a Study Material's editable metadata (title/description) and, when an
 * Admin edits the Price, its `priceAmount`/`currency`, leaving omitted fields
 * unchanged (Req 11.5, 11.6, 11.13, 11.14). Returns the updated record with its
 * resolved Tags.
 */
export function updateMaterial(
  id: string,
  input: UpdateMaterialInput
): Promise<MaterialWithTags> {
  return getPrismaClient().studyMaterial.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.priceAmount !== undefined
        ? { priceAmount: input.priceAmount }
        : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
    },
    include: TAG_INCLUDE,
  });
}

/**
 * Delete a Study Material by id (Req 11.3). Its Tags are removed via the
 * cascading relation defined in the schema. Returns the deleted record.
 */
export function deleteMaterial(id: string): Promise<StudyMaterial> {
  return getPrismaClient().studyMaterial.delete({ where: { id } });
}

/**
 * Append one or more files to a Study Material, assigning each a stable
 * `orderIndex` continuing after the material's current maximum so the existing
 * order (primary first) is preserved. Files are created in the order supplied.
 */
export async function addMaterialFiles(
  studyMaterialId: string,
  files: MaterialFileInput[],
): Promise<void> {
  if (files.length === 0) {
    return;
  }
  const prisma = getPrismaClient();
  const last = await prisma.materialFile.aggregate({
    where: { studyMaterialId },
    _max: { orderIndex: true },
  });
  const start = (last._max.orderIndex ?? -1) + 1;
  await prisma.materialFile.createMany({
    data: files.map((file, index) => ({
      studyMaterialId,
      objectKey: file.objectKey,
      fileName: file.fileName,
      contentType: file.contentType,
      fileSizeBytes: file.fileSizeBytes,
      orderIndex: start + index,
    })),
  });
}

/**
 * Find a single file belonging to a Study Material by its id, scoped to the
 * owning material so a file id from another material cannot be resolved.
 * Returns `null` (never throws) when no such file exists under the material.
 */
export function findMaterialFile(
  studyMaterialId: string,
  fileId: string,
): Promise<MaterialFile | null> {
  return getPrismaClient().materialFile.findFirst({
    where: { id: fileId, studyMaterialId },
  });
}

/**
 * Delete a file row by id and return it so the caller can clean up its Object
 * Storage object. Returns `null` when the row does not exist rather than
 * throwing, so a repeated/racy delete is idempotent.
 */
export async function deleteMaterialFile(
  fileId: string,
): Promise<MaterialFile | null> {
  try {
    return await getPrismaClient().materialFile.delete({ where: { id: fileId } });
  } catch {
    return null;
  }
}

/** Count the files currently attached to a Study Material. */
export function countMaterialFiles(studyMaterialId: string): Promise<number> {
  return getPrismaClient().materialFile.count({ where: { studyMaterialId } });
}
