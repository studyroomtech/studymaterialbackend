// Study Material service — upload, edit, delete, and get (Phase 1, free
// materials).
//
// This service implements the admin Content Management Actions for Study
// Materials plus the learner-facing single-material read:
//
//   - Upload: validate the title (1–200 chars) and that a file is present, then
//     store the file bytes in Object Storage and persist the metadata together
//     with the Object Storage Key; on validation failure nothing is stored in
//     the database or R2 (Req 11.1, 11.2, 1.13).
//   - Edit: validate the title (1–200) and/or description (0–2000) when
//     supplied and persist the change, leaving omitted fields unchanged; an
//     out-of-bounds value is rejected with the metadata unchanged (Req 11.5,
//     11.6).
//   - Delete: remove the database metadata and the R2 object for an existing
//     material (Req 11.3).
//   - Get: return the complete metadata for an existing material (Req 5.1,
//     5.3).
//   - A missing material on get/edit/delete yields a not-found error and no
//     content is returned (Req 5.4, 11.4).
//
// Business rules that don't require I/O — title/description normalization and
// length validation, file-presence checks, and mapping a persisted record to
// its public DTO — are isolated into exported pure functions so they can be
// reasoned about and property-tested without a repository or storage. All
// persistence and byte storage is reached only through the injected contracts
// (`MaterialRepository`, `MaterialStorage`), keeping the service independent of
// Prisma and R2.
//
// Paid Materials (`priceAmount > 0`) are gated on a Payment Entitlement: `get`
// resolves the learner and requires an Entitlement for `(userId, materialId)`,
// throwing `PaymentRequiredError` (403) with no content returned when the
// learner is not entitled (or no learner is resolved). Free Materials are
// unaffected (Req 12.2, 12.3).
//
// Upload and edit accept an optional Price (`priceAmount` + `currency`)
// validated by `price.service.validatePrice` and persisted with the material: a
// positive integer in `[1, 1000000]` with Currency INR marks a Paid Material,
// while `null`/`0` marks a Free Material with no chargeable Price. An
// out-of-range, non-numeric, or non-INR Price is rejected with a
// `ValidationError` (422) before any storage or persistence, leaving the
// existing metadata and Price unchanged (Req 11.13, 11.14, 11.15).

import { randomUUID } from 'node:crypto';

import {
  DESCRIPTION_MAX_LENGTH,
  DESCRIPTION_MIN_LENGTH,
  MIN_MATERIAL_FILES,
  TITLE_MAX_LENGTH,
  TITLE_MIN_LENGTH,
} from '../constants/limits.constant';
import {
  NotFoundError,
  PaymentRequiredError,
  ValidationError,
} from '../utils/errors';
import * as materialRepository from '../repositories/material.repository';
import * as entitlementRepository from '../repositories/entitlement.repository';
import * as linkGroupRepository from '../repositories/linkGroup.repository';
import { deleteObject, putObject } from '../storage/storage.service';
import { DEFAULT_CURRENCY } from '../constants/payment.constant';
import { logError } from '../utils/logger';
import { classifyPrice, validatePrice } from './price.service';
import { isEffectivelyEntitled, isEntitled } from './entitlement.service';
import type { ApiErrorFieldDto } from '../types/api.types';
import type { MaterialDto, TagsByCategoryType } from '../types/domain.types';
import type { MaterialWithTags } from '../repositories/material.repository.types';
import { MATERIAL_OBJECT_KEY_PREFIX } from './material.service.constant';
import type {
  EditMaterialInput,
  MaterialFileRecord,
  MaterialRecord,
  MaterialService,
  MaterialServiceDeps,
  UnlockOptionDto,
  UpdateMaterialRecordInput,
  UploadedFile,
  UploadMaterialInput,
} from './material.service.types';

// --- Pure helpers (no I/O) ------------------------------------------------

/**
 * Normalize a raw title by trimming leading and trailing whitespace. Trimming
 * is applied before length validation and before persistence so a
 * whitespace-only title is treated as empty and stored titles are canonical.
 */
export function normalizeTitle(title: string | null | undefined): string {
  return (title ?? '').trim();
}

/**
 * Normalize a raw description by trimming surrounding whitespace and coalescing
 * a nullish value to an empty string (an absent description is stored as `''`).
 */
export function normalizeDescription(
  description: string | null | undefined,
): string {
  return (description ?? '').trim();
}

/**
 * Whether a normalized title satisfies the inclusive title length bound
 * (1–200 chars). A blank (whitespace-only) title normalizes to an empty string
 * and is rejected (Req 11.2). Pure.
 */
export function isTitleWithinBounds(title: string | null | undefined): boolean {
  const length = normalizeTitle(title).length;
  return length >= TITLE_MIN_LENGTH && length <= TITLE_MAX_LENGTH;
}

/**
 * Whether a normalized description satisfies the inclusive description length
 * bound (0–2000 chars); an empty description is valid (Req 11.6). Pure.
 */
export function isDescriptionWithinBounds(
  description: string | null | undefined,
): boolean {
  const length = normalizeDescription(description).length;
  return length >= DESCRIPTION_MIN_LENGTH && length <= DESCRIPTION_MAX_LENGTH;
}

/**
 * Validate a title against the 1–200 bound, returning the normalized value on
 * success or throwing a `ValidationError` naming the invalid field and the
 * reason (empty vs too long) (Req 11.2, 11.6, 8.3). Pure aside from the throw.
 */
function validateTitleOrThrow(title: string | null | undefined): string {
  const normalized = normalizeTitle(title);
  if (normalized.length < TITLE_MIN_LENGTH) {
    throw new ValidationError(
      'The request contains one or more invalid fields.',
      [{ field: 'title', reason: 'title must not be empty.' }],
    );
  }
  if (normalized.length > TITLE_MAX_LENGTH) {
    throw new ValidationError(
      'The request contains one or more invalid fields.',
      [
        {
          field: 'title',
          reason: `title must be at most ${TITLE_MAX_LENGTH} characters.`,
        },
      ],
    );
  }
  return normalized;
}

/**
 * Validate a description against the 0–2000 bound, returning the normalized
 * value on success or throwing a `ValidationError` naming the invalid field
 * (Req 11.6, 8.3). Pure aside from the throw.
 */
function validateDescriptionOrThrow(
  description: string | null | undefined,
): string {
  const normalized = normalizeDescription(description);
  if (normalized.length > DESCRIPTION_MAX_LENGTH) {
    throw new ValidationError(
      'The request contains one or more invalid fields.',
      [
        {
          field: 'description',
          reason: `description must be at most ${DESCRIPTION_MAX_LENGTH} characters.`,
        },
      ],
    );
  }
  return normalized;
}

/**
 * Whether a Study Material is a Paid Material — i.e. it carries a
 * strictly-positive Price amount (Req 12.2, 12.3). A `null`/`undefined`/`0`
 * amount is a Free Material. Delegates to the pure price classifier so the
 * Paid/Free boundary matches price validation. Pure.
 */
export function isPaidMaterial(
  priceAmount: number | null | undefined,
): boolean {
  return classifyPrice(priceAmount) === 'paid';
}

/** Whether an uploaded file carries a usable body (Req 11.2). Pure. */
export function isFilePresent(file: UploadedFile | null | undefined): boolean {
  if (file === null || file === undefined) {
    return false;
  }
  const { body } = file;
  if (body === null || body === undefined) {
    return false;
  }
  if (typeof body === 'string') {
    return body.length > 0;
  }
  if (body instanceof Uint8Array) {
    return body.byteLength > 0;
  }
  // A stream body carries no synchronously-knowable length; treat as present.
  return true;
}

/** Build the single-field validation payload for a missing-file rejection. */
function missingFileFields(): ApiErrorFieldDto[] {
  return [{ field: 'files', reason: 'at least one file is required.' }];
}

function lastFileFields(): ApiErrorFieldDto[] {
  return [
    {
      field: 'files',
      reason: `a Study Material must keep at least ${MIN_MATERIAL_FILES} file.`,
    },
  ];
}

/**
 * Validate that at least one file is present and that every supplied file
 * carries a usable body, returning the files on success or throwing a
 * `ValidationError` naming the `files` field. Runs before any storage or
 * persistence so a rejected upload stores nothing (Req 11.2). Pure aside from
 * the throw.
 */
export function validateFilesOrThrow(
  files: UploadedFile[] | null | undefined,
): UploadedFile[] {
  if (
    files === null ||
    files === undefined ||
    files.length === 0 ||
    !files.every((file) => isFilePresent(file))
  ) {
    throw new ValidationError(
      'The request contains one or more invalid fields.',
      missingFileFields(),
    );
  }
  return files;
}

/**
 * Group a material's resolved Tag assignments into the `tagsByCategoryType`
 * map keyed by Category Type id (Req 2.5, 5.1). A Category Type that the
 * material carries no Tags under simply does not appear as a key here; the
 * catalog builder is responsible for filling every supported Category Type
 * key for the catalog listing. Pure.
 */
export function buildTagsByCategoryType(
  record: MaterialRecord,
): TagsByCategoryType {
  const result: TagsByCategoryType = {};
  for (const tag of record.tags) {
    const entry = { categoryId: tag.categoryId, name: tag.name };
    const existing = result[tag.categoryTypeId];
    if (existing === undefined) {
      result[tag.categoryTypeId] = [entry];
    } else {
      existing.push(entry);
    }
  }
  return result;
}

/**
 * Map a persisted Study Material record to its public `MaterialDto`. The Object
 * Storage Key is never included in the DTO (Req 1.13); file metadata is carried
 * through. The Price is reflected as `priceAmount` (`null` for a Free
 * Material), its `currency` (defaulting to INR), and the convenience `isPaid`
 * flag so callers can render a Paid Material's stored Price (Req 11.13, 11.14).
 * Pure.
 */
export function toMaterialDto(record: MaterialRecord): MaterialDto {
  const priceAmount = record.priceAmount ?? null;
  const ratingCount = record.ratingCount ?? 0;
  const ratingSum = record.ratingSum ?? 0;
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    tagsByCategoryType: buildTagsByCategoryType(record),
    fileName: record.fileName,
    contentType: record.contentType,
    fileSizeBytes: record.fileSizeBytes,
    files: (record.files ?? []).map((file) => ({
      id: file.id,
      fileName: file.fileName,
      contentType: file.contentType,
      fileSizeBytes: file.fileSizeBytes,
    })),
    priceAmount,
    currency: record.currency ?? DEFAULT_CURRENCY,
    isPaid: isPaidMaterial(priceAmount),
    averageRating: ratingCount > 0 ? ratingSum / ratingCount : null,
    reviewCount: ratingCount,
  };
}

// --- Service factory ------------------------------------------------------

/**
 * Construct the Study Material service over the injected repository and storage
 * adapter. The controller layer wires in the concrete Prisma-backed repository
 * and Cloudflare R2 storage adapter.
 */
export function createMaterialService(
  deps: MaterialServiceDeps,
): MaterialService {
  const { materials, storage, entitlements, linkGroups } = deps;
  const generateObjectKey =
    deps.generateObjectKey ??
    (() => `${MATERIAL_OBJECT_KEY_PREFIX}${randomUUID()}`);

  /**
   * Store each uploaded file's bytes in Object Storage under a fresh Object
   * Storage Key, returning the persistable file metadata (key + display fields)
   * in the same order. Storage runs only after all validation has passed.
   */
  async function storeFiles(
    files: UploadedFile[],
  ): Promise<
    {
      objectKey: string;
      fileName: string;
      contentType: string;
      fileSizeBytes: number;
    }[]
  > {
    const stored: {
      objectKey: string;
      fileName: string;
      contentType: string;
      fileSizeBytes: number;
    }[] = [];
    for (const file of files) {
      const objectKey = generateObjectKey();
      await storage.putObject(objectKey, file.body, file.contentType);
      stored.push({
        objectKey,
        fileName: file.fileName,
        contentType: file.contentType,
        fileSizeBytes: file.sizeBytes,
      });
    }
    return stored;
  }

  /**
   * Upload a new Study Material: validate the title (1–200) and that a file is
   * present, store the bytes in Object Storage under a fresh Object Storage
   * Key, then persist the metadata + key (Req 11.1, 11.2, 1.13). Validation
   * runs before any storage or persistence, so a rejected upload stores nothing
   * in R2 or the database (Req 11.2).
   */
  async function uploadMaterial(
    input: UploadMaterialInput,
  ): Promise<MaterialDto> {
    const title = validateTitleOrThrow(input.title);
    const description = validateDescriptionOrThrow(input.description);
    // Validate the optional Price before touching storage/persistence so a
    // rejected Price stores nothing in R2 or the database (Req 11.13–11.15).
    const price = validatePrice(input.priceAmount, input.currency);
    const files = validateFilesOrThrow(input.files);

    // Store every file under its own generated Object Storage Key, then persist
    // the material with the FIRST file as the primary columns and record ALL
    // files (including the first) in the authoritative MaterialFile list.
    const stored = await storeFiles(files);
    const [primary] = stored;

    const record = await materials.create({
      title,
      description,
      objectKey: primary.objectKey,
      fileName: primary.fileName,
      contentType: primary.contentType,
      fileSizeBytes: primary.fileSizeBytes,
      priceAmount: price.amount,
      currency: price.currency,
    });
    await materials.addFiles(record.id, stored);

    // Re-fetch so the returned DTO reflects the persisted files.
    const created = await materials.findById(record.id);
    return toMaterialDto(created ?? record);
  }

  /**
   * Edit a Study Material's title (1–200) and/or description (0–2000). A
   * missing material yields a not-found error (Req 11.4, 5.4). An out-of-bounds
   * value is rejected before persistence, leaving the metadata unchanged
   * (Req 11.6). Omitted fields are left unchanged (Req 11.5).
   */
  async function editMaterial(
    id: string,
    input: EditMaterialInput,
  ): Promise<MaterialDto> {
    const update: UpdateMaterialRecordInput = {};
    if (input.title !== undefined) {
      update.title = validateTitleOrThrow(input.title);
    }
    if (input.description !== undefined) {
      update.description = validateDescriptionOrThrow(input.description);
    }
    // A supplied Price amount triggers Price validation; the validated amount
    // (`null` for a Free Material) and its Currency are persisted together. An
    // invalid Price is rejected before persistence, leaving the existing
    // metadata and Price unchanged (Req 11.13, 11.14, 11.15).
    if (input.priceAmount !== undefined) {
      const price = validatePrice(input.priceAmount, input.currency);
      update.priceAmount = price.amount;
      update.currency = price.currency;
    }

    const current = await materials.findById(id);
    if (current === null) {
      throw new NotFoundError('The requested Study Material was not found.');
    }

    const record = await materials.update(id, update);
    return toMaterialDto(record);
  }

  /**
   * Delete a Study Material: remove the database metadata and the R2 object for
   * an existing material (Req 11.3). A missing material yields a not-found
   * error with no data changed (Req 11.4).
   */
  async function deleteMaterial(id: string): Promise<void> {
    const current = await materials.findById(id);
    if (current === null) {
      throw new NotFoundError('The requested Study Material was not found.');
    }
    await materials.delete(id);
    // Delete every file's R2 object plus the primary object, deduped so the
    // primary (mirrored in the file list) is not deleted twice (Req 11.3).
    const objectKeys = new Set<string>([current.objectKey]);
    for (const file of current.files ?? []) {
      objectKeys.add(file.objectKey);
    }
    for (const objectKey of objectKeys) {
      await storage.deleteObject(objectKey);
    }
  }

  /**
   * Append one or more files to an existing Study Material (Req 11.1, 1.13). The
   * material must exist (a missing material yields a not-found error) and at
   * least one file must be present. Each file's bytes are stored in Object
   * Storage before the file rows are recorded, then the updated material DTO is
   * returned with its files.
   */
  async function addFiles(
    id: string,
    files: UploadedFile[],
  ): Promise<MaterialDto> {
    const current = await materials.findById(id);
    if (current === null) {
      throw new NotFoundError('The requested Study Material was not found.');
    }
    const validated = validateFilesOrThrow(files);
    const stored = await storeFiles(validated);
    await materials.addFiles(id, stored);

    const updated = await materials.findById(id);
    return toMaterialDto(updated ?? current);
  }

  function promotePrimaryFile(
    id: string,
    file: MaterialFileRecord,
  ): Promise<MaterialRecord> {
    return materials.update(id, {
      objectKey: file.objectKey,
      fileName: file.fileName,
      contentType: file.contentType,
      fileSizeBytes: file.fileSizeBytes,
    });
  }

  async function removeFile(
    id: string,
    fileId: string,
  ): Promise<MaterialDto> {
    const current = await materials.findById(id);
    if (current === null) {
      throw new NotFoundError('The requested Study Material was not found.');
    }
    const file = await materials.findFile(id, fileId);
    if (file === null) {
      throw new NotFoundError('The requested file was not found.');
    }

    const fileCount = await materials.countFiles(id);
    if (fileCount <= MIN_MATERIAL_FILES) {
      throw new ValidationError(
        'The request contains one or more invalid fields.',
        lastFileFields(),
      );
    }

    const isRemovingPrimaryFile = current.objectKey === file.objectKey;

    const deleted = await materials.deleteFile(fileId);
    if (deleted !== null) {
      await storage.deleteObject(deleted.objectKey);
    }

    const updated = await materials.findById(id);
    const [nextPrimaryFile] = updated?.files ?? [];

    if (isRemovingPrimaryFile && nextPrimaryFile !== undefined) {
      return toMaterialDto(await promotePrimaryFile(id, nextPrimaryFile));
    }

    return toMaterialDto(updated ?? current);
  }

  /**
   * Require that a resolved learner may view a material before its content is
   * served. A material is gated whenever it belongs to a Link Group containing
   * at least one Paid Material — so a Free Material linked to a Paid one is
   * locked behind a Direct Entitlement to some group member (Req 4.1–4.3, 5.1).
   *
   *   1. Truly-free pass-through — the material is a Free Material AND no member
   *      of its Link Group is a Paid Material: view is allowed for anyone,
   *      unchanged from prior behavior (Req 8.1).
   *   2. Otherwise the group is paid-gated: a resolved Learner must hold a
   *      Direct Entitlement for the material (fast path, Req 4.1) or for any
   *      member of its Link Group (Effective Entitlement, Req 4.2, 10.1);
   *      otherwise `PaymentRequiredError` (403) is thrown (Req 4.3).
   *
   * The decision reads only existing Direct Entitlement records and the current
   * Link Group membership, creating/modifying/deleting nothing (Req 5.1).
   * Fail-safe (Req 5.5): if the Link Group membership cannot be resolved, the
   * gate falls back to the material's own Price — a Free Material is served, a
   * Paid Material requires a Direct Entitlement.
   */
  async function requireAccess(
    userId: string | null | undefined,
    material: { id: string; priceAmount?: number | null },
  ): Promise<void> {
    // Resolve the Link Group closure with member Prices to decide gating. On
    // failure, fall back to the material's own Price only (Req 5.5).
    let members: { id: string; priceAmount?: number | null }[];
    try {
      members = await linkGroups.listGroupMembersWithPrice(material.id);
    } catch (error) {
      logError('Link Group resolution failed; gating by material Price only', {
        materialId: material.id,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!isPaidMaterial(material.priceAmount)) {
        return;
      }
      if (userId === null || userId === undefined) {
        throw new PaymentRequiredError();
      }
      const directFallback = await entitlements.findEntitlement(
        userId,
        material.id,
      );
      if (directFallback === null) {
        throw new PaymentRequiredError();
      }
      return;
    }

    const memberIds =
      members.length > 0 ? members.map((m) => m.id) : [material.id];
    const groupHasPaidMember =
      isPaidMaterial(material.priceAmount) ||
      members.some((m) => isPaidMaterial(m.priceAmount));

    // Truly free (Req 8.1): open to everyone.
    if (!groupHasPaidMember) {
      return;
    }

    if (userId === null || userId === undefined) {
      throw new PaymentRequiredError();
    }

    // Direct-Entitlement fast path (Req 4.1).
    const direct = await entitlements.findEntitlement(userId, material.id);
    if (direct !== null && isEntitled([direct], userId, material.id)) {
      return;
    }

    // Effective Entitlement across the group (Req 4.2, 10.1).
    const entitledIds = new Set(
      await entitlements.listEntitledMaterialIds(userId),
    );
    if (!isEffectivelyEntitled(entitledIds, memberIds, material.id)) {
      throw new PaymentRequiredError();
    }
  }

  /**
   * Return the complete metadata for an existing Study Material (Req 5.1, 5.3).
   * A missing material yields a not-found error naming the missing resource,
   * and no content is returned (Req 5.4).
   *
   * When the material is a Paid Material (`priceAmount > 0`), the resolved
   * learner (`userId`) must hold a Payment Entitlement for it; otherwise — or
   * when no learner is resolved — a `PaymentRequiredError` (403) is thrown
   * before any content is returned (Req 12.2, 12.3). Free Materials are
   * unaffected and returned without an entitlement check.
   *
   * Admin bypass (Req 17.2, 17.4): when `isAdmin` is true (the caller holds
   * `role_admin`, derived by the controller from `req.auth`), access is granted
   * to any Study Material regardless of Price WITHOUT evaluating the entitlement
   * gate and without reading, creating, or modifying any Entitlement/Payment
   * record. The non-admin flow is otherwise unchanged.
   */
  async function getMaterial(
    id: string,
    userId?: string | null,
    isAdmin?: boolean,
  ): Promise<MaterialDto> {
    const record = await materials.findById(id);
    if (record === null) {
      throw new NotFoundError('The requested Study Material was not found.');
    }
    if (isAdmin !== true) {
      await requireAccess(userId, record);
    }
    return toMaterialDto(record);
  }

  /**
   * List the Paid Materials a Learner could purchase to unlock the given
   * material through its Link Group. When the material is itself paid it is
   * included; when it is a Free Material locked by a paid sibling, its paid
   * group members are returned so the Frontend can link the Learner to a note
   * they can actually pay for. A missing material yields a not-found error.
   * On a Link Group resolution failure the material's own Price is used as the
   * sole closure, so a paid material still surfaces itself as an option.
   */
  async function getUnlockOptions(id: string): Promise<UnlockOptionDto[]> {
    const record = await materials.findById(id);
    if (record === null) {
      throw new NotFoundError('The requested Study Material was not found.');
    }

    let members: { id: string; priceAmount?: number | null }[];
    try {
      members = await linkGroups.listGroupMembersWithPrice(id);
    } catch (error) {
      logError('Link Group resolution failed; using material Price only', {
        materialId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      members = [];
    }

    // Ungrouped (or unresolved): the closure is the material itself.
    const closure =
      members.length > 0
        ? members
        : [{ id: record.id, priceAmount: record.priceAmount }];

    const options: UnlockOptionDto[] = [];
    for (const member of closure) {
      if (!isPaidMaterial(member.priceAmount)) {
        continue;
      }
      const memberRecord =
        member.id === record.id ? record : await materials.findById(member.id);
      if (memberRecord === null) {
        continue;
      }
      options.push({
        id: memberRecord.id,
        title: memberRecord.title,
        priceAmount: memberRecord.priceAmount ?? null,
        currency: memberRecord.currency ?? null,
      });
    }
    return options;
  }

  return {
    uploadMaterial,
    editMaterial,
    deleteMaterial,
    addFiles,
    removeFile,
    getMaterial,
    getUnlockOptions,
  };
}

// --- Default wiring -------------------------------------------------------

/**
 * Map a persisted `MaterialWithTags` (the Prisma-shaped repository record with
 * each Tag's Category and Category Type resolved) to the `MaterialRecord` the
 * service operates on, flattening each Tag to its Category id, owning Category
 * Type id, and display name (Req 2.5). The Object Storage Key is carried through
 * so the service can delete the R2 object on material deletion (Req 11.3).
 */
function toMaterialRecord(record: MaterialWithTags): MaterialRecord {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    objectKey: record.objectKey,
    fileName: record.fileName,
    contentType: record.contentType,
    fileSizeBytes: record.fileSizeBytes,
    files: record.files.map((file) => ({
      id: file.id,
      objectKey: file.objectKey,
      fileName: file.fileName,
      contentType: file.contentType,
      fileSizeBytes: file.fileSizeBytes,
    })),
    priceAmount: record.priceAmount,
    currency: record.currency,
    ratingCount: record.ratingCount,
    ratingSum: record.ratingSum,
    tags: record.materialTags.map((materialTag) => ({
      categoryId: materialTag.tagId,
      categoryTypeId: materialTag.tag.categoryTypeId,
      name: materialTag.tag.name,
    })),
  };
}

/**
 * Construct the Study Material service wired to the real Prisma-backed material
 * repository and the Cloudflare R2 storage adapter. Used by the controller
 * layer in production (mirrors `createDefaultDownloadService`).
 */
export function createDefaultMaterialService(): MaterialService {
  return createMaterialService({
    materials: {
      async create(input) {
        return toMaterialRecord(await materialRepository.createMaterial(input));
      },
      async findById(id) {
        const record = await materialRepository.findMaterialById(id);
        return record === null ? null : toMaterialRecord(record);
      },
      async update(id, input) {
        return toMaterialRecord(
          await materialRepository.updateMaterial(id, input),
        );
      },
      async delete(id) {
        await materialRepository.deleteMaterial(id);
      },
      async addFiles(studyMaterialId, files) {
        await materialRepository.addMaterialFiles(studyMaterialId, files);
      },
      async findFile(studyMaterialId, fileId) {
        const file = await materialRepository.findMaterialFile(
          studyMaterialId,
          fileId,
        );
        return file === null
          ? null
          : {
              id: file.id,
              objectKey: file.objectKey,
              fileName: file.fileName,
              contentType: file.contentType,
              fileSizeBytes: file.fileSizeBytes,
            };
      },
      async deleteFile(fileId) {
        const deleted = await materialRepository.deleteMaterialFile(fileId);
        return deleted === null ? null : { objectKey: deleted.objectKey };
      },
      async countFiles(studyMaterialId) {
        return materialRepository.countMaterialFiles(studyMaterialId);
      },
    },
    storage: { putObject, deleteObject },
    entitlements: {
      findEntitlement: entitlementRepository.findEntitlement,
      listEntitledMaterialIds: entitlementRepository.listEntitledMaterialIds,
    },
    linkGroups: {
      listGroupMemberIds: linkGroupRepository.listGroupMemberIds,
      listGroupMembersWithPrice: linkGroupRepository.listGroupMembersWithPrice,
    },
  });
}
