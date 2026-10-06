// Types for the Study Material service (Req 1.15: type/interface declarations
// live only in `*.types.ts`).
//
// This module describes:
//   - the persistence record the service reads/writes (a Study Material with
//     its resolved Tag assignments),
//   - the repository and storage contracts the service depends on (the concrete
//     Prisma-backed repository and the Cloudflare R2 storage adapter live in
//     `src/repositories/` and `src/storage/` and are wired in by the controller
//     layer), and
//   - the public surface of the Study Material service itself.
//
// Keeping these contracts here lets `material.service.ts` be written and tested
// against a small, well-defined dependency boundary, independent of Prisma and
// R2 (Req 5.1, 5.3, 5.4, 11.1–11.6). Price handling and the Paid-Material
// entitlement gate are deferred to Phase 2; in Phase 1 every material is served
// as Free content.

import type { MaterialDto } from '../types/domain.types';
import type { StorageObjectBody } from '../storage/storage.types';
import type { EntitlementRef } from './entitlement.service.types';

/**
 * A single resolved Tag assignment on a Study Material. It carries the Category
 * id and display name together with the owning Category Type id so the service
 * can group a material's Tags by Category Type for the response DTO (Req 2.5,
 * 5.1).
 */
export interface MaterialTagAssignment {
  categoryId: string;
  categoryTypeId: string;
  name: string;
}

/**
 * A persisted Study Material together with its metadata, the Object Storage Key
 * that references the file bytes in Cloudflare R2 (never the bytes themselves,
 * Req 1.13), and its resolved Tag assignments. Returned by the repository reads
 * and mapped to a {@link MaterialDto} by the service.
 */
export interface MaterialRecord {
  id: string;
  title: string;
  description: string;
  objectKey: string;
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
  tags: MaterialTagAssignment[];
  /**
   * Every file (PDF) belonging to the material, ordered primary-first. The
   * StudyMaterial's own `objectKey`/`fileName`/`contentType`/`fileSizeBytes`
   * mirror the first (primary) file for backward compatibility; this list is
   * authoritative for all files. The Object Storage Key is carried through so
   * the service can delete each R2 object on material/file deletion, but it is
   * never exposed in the public DTO (Req 1.13).
   */
  files: MaterialFileRecord[];
  /**
   * The Paid Material's Price amount, or `null`/absent for a Free Material. A
   * strictly-positive amount marks the material as Paid, which the entitlement
   * gate uses to decide whether a Payment Entitlement is required before its
   * view content may be returned (Req 12.2, 12.3).
   */
  priceAmount?: number | null;
  /**
   * The Currency of the Price, defaulting to INR. Carried through to the DTO
   * alongside `priceAmount` so a Paid Material's stored Price is reflected in
   * responses (Req 11.13, 11.14).
   */
  currency?: string | null;
  /**
   * The denormalized count of ratings the material has received (0 when none).
   * Surfaced on the DTO so the Frontend can render an aggregate rating badge.
   */
  ratingCount?: number;
  /**
   * The denormalized sum of all rating values. The DTO exposes the derived
   * average (`ratingSum / ratingCount`), never the raw sum.
   */
  ratingSum?: number;
}

/**
 * The uploaded file accompanying a Study Material upload (Req 11.1). `body` is
 * the raw bytes/stream stored in Object Storage; the remaining fields become
 * the material's file metadata.
 */
export interface UploadedFile {
  body: StorageObjectBody;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * A persisted file (PDF) belonging to a Study Material. Carries the Object
 * Storage Key (never exposed in the DTO, Req 1.13) plus its display metadata
 * so the service can presign, list, and delete it.
 */
export interface MaterialFileRecord {
  id: string;
  objectKey: string;
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
}

/**
 * The input to a Study Material upload: the title (1–200 chars), an optional
 * description (0–2000 chars), and the file to store (Req 11.1, 11.2).
 *
 * An optional Price may be supplied: `priceAmount` (an integer in `[1,
 * 1000000]` for a Paid Material, or `null`/`0` for a Free Material) together
 * with an optional `currency` (defaulting to INR). The Price is validated by
 * `price.service` before persistence; an out-of-range/non-numeric/non-INR
 * Price is rejected with a `ValidationError` → 422 and nothing is stored
 * (Req 11.13, 11.14, 11.15).
 */
export interface UploadMaterialInput {
  title: string;
  description?: string;
  /**
   * The files to store (at least one required, validated by the service). The
   * first file becomes the material's primary file (mirrored on the
   * StudyMaterial's own columns); every file — including the first — is also
   * recorded in the authoritative `MaterialFile` list.
   */
  files: UploadedFile[];
  priceAmount?: number | null;
  currency?: string | null;
}

/**
 * The editable Study Material metadata fields (Req 11.5, 11.6). Every field is
 * optional so callers can patch a subset; an omitted field is left unchanged.
 *
 * When `priceAmount` is supplied it is validated by `price.service` and the
 * resulting Price (amount + Currency) is persisted; an invalid Price is
 * rejected with a `ValidationError` → 422 and the existing metadata/Price are
 * left unchanged (Req 11.13, 11.14, 11.15).
 */
export interface EditMaterialInput {
  title?: string;
  description?: string;
  priceAmount?: number | null;
  currency?: string | null;
}

/**
 * The metadata persisted for a new Study Material (Req 11.1, 1.13). File bytes
 * live in Object Storage; only the `objectKey` reference plus metadata are
 * stored in the database.
 */
export interface CreateMaterialRecordInput {
  title: string;
  description: string;
  objectKey: string;
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
  /** Validated Price amount (`null` for a Free Material) (Req 11.13, 11.14). */
  priceAmount?: number | null;
  /** Validated Price Currency (defaults to INR) (Req 11.13). */
  currency?: string;
}

/**
 * The metadata fields the repository may update on an existing Study Material
 * (Req 11.5, 11.6). Omitted fields are left unchanged.
 */
export interface UpdateMaterialRecordInput {
  title?: string;
  description?: string;
  /** Validated Price amount (`null` for a Free Material) (Req 11.13, 11.14). */
  priceAmount?: number | null;
  /** Validated Price Currency (defaults to INR) (Req 11.13). */
  currency?: string;
  objectKey?: string;
  fileName?: string;
  contentType?: string;
  fileSizeBytes?: number;
}

/**
 * Persistence contract for Study Materials consumed by the service. The
 * concrete implementation wraps Prisma; `findById` returns `null` (never
 * throws) when the material does not exist so the service can map absence to a
 * not-found error without content (Req 5.4, 11.4).
 */
export interface MaterialRepository {
  /** Persist a new Study Material's metadata and Object Storage Key. */
  create(input: CreateMaterialRecordInput): Promise<MaterialRecord>;

  /** Load a Study Material by id with its resolved Tags, or `null`. */
  findById(id: string): Promise<MaterialRecord | null>;

  /** Update an existing Study Material's editable metadata. */
  update(id: string, input: UpdateMaterialRecordInput): Promise<MaterialRecord>;

  /** Delete a Study Material by id (its Tags cascade in the schema). */
  delete(id: string): Promise<void>;

  /**
   * Append files to an existing Study Material, preserving the existing order
   * (each new file is assigned a stable order after the current maximum).
   */
  addFiles(
    studyMaterialId: string,
    files: {
      objectKey: string;
      fileName: string;
      contentType: string;
      fileSizeBytes: number;
    }[],
  ): Promise<void>;

  /**
   * Load a single file belonging to the material (scoped by the owning material
   * id), or `null` (never throws) when no such file exists.
   */
  findFile(
    studyMaterialId: string,
    fileId: string,
  ): Promise<MaterialFileRecord | null>;

  /**
   * Delete a file row by id and return its Object Storage Key so the caller can
   * clean up the R2 object, or `null` when the row did not exist.
   */
  deleteFile(fileId: string): Promise<{ objectKey: string } | null>;

  /** Count the files currently attached to a Study Material. */
  countFiles(studyMaterialId: string): Promise<number>;
}

/**
 * Persistence contract for Payment Entitlement lookups consumed by the service
 * to gate Paid Material view content (Req 12.2, 12.3, 4.1, 4.2). The concrete
 * implementation wraps Prisma; `findEntitlement` returns `null` (never throws)
 * when the Learner holds no Entitlement for the `(userId, materialId)` pair, so
 * the service can map absence to a `PAYMENT_REQUIRED` error without content.
 */
export interface MaterialEntitlementRepository {
  findEntitlement(
    userId: string,
    studyMaterialId: string,
  ): Promise<EntitlementRef | null>;
  /**
   * List the Study Material ids the Learner holds a Direct Entitlement for.
   * Backs the Effective-Entitlement check: after the Direct fast path misses,
   * the gate derives access across the material's Link Group closure from this
   * set (Req 4.2, 10.1).
   */
  listEntitledMaterialIds(userId: string): Promise<string[]>;
}

/**
 * Persistence contract for Link Group membership lookups consumed by the view
 * gate to derive an Effective Entitlement across a material's Link Group
 * (Req 4.2). `listGroupMemberIds` returns the group closure (the material plus
 * its siblings), or an empty array when the material is ungrouped — reducing
 * the decision to the Direct check (Req 10.1). If the lookup throws, the gate
 * falls back to Direct-only and denies propagated access (Req 5.5).
 */
export interface MaterialLinkGroupRepository {
  listGroupMemberIds(materialId: string): Promise<string[]>;
  /**
   * The material's Link Group members (self + siblings) with each member's
   * Price, so the gate can tell whether the group contains a Paid Material and
   * therefore gates an otherwise-Free member. Empty when ungrouped.
   */
  listGroupMembersWithPrice(
    materialId: string,
  ): Promise<{ id: string; priceAmount: number | null }[]>;
}

/**
 * Storage contract for Study Material file bytes consumed by the service. The
 * concrete implementation is the Cloudflare R2 adapter (Req 1.13, 11.1, 11.3).
 */
export interface MaterialStorage {
  /** Store the file bytes under `objectKey` with the given content type. */
  putObject(
    objectKey: string,
    body: StorageObjectBody,
    contentType: string,
  ): Promise<void>;

  /** Delete the object stored under `objectKey` (idempotent). */
  deleteObject(objectKey: string): Promise<void>;
}

/**
 * The dependency bundle the Study Material service is constructed with. The
 * concrete Prisma-backed repository and R2 storage adapter are injected by the
 * controller layer. `generateObjectKey` mints the Object Storage Key for a new
 * upload; it is injectable so tests can make key generation deterministic.
 */
export interface MaterialServiceDeps {
  materials: MaterialRepository;
  storage: MaterialStorage;
  /**
   * Payment Entitlement lookups used to gate a Paid Material's view content
   * (Req 12.2, 12.3). Injected by the controller layer; the concrete
   * implementation wraps the Prisma-backed Entitlement repository.
   */
  entitlements: MaterialEntitlementRepository;
  /**
   * Link Group membership lookups used to extend the view gate with an
   * Effective Entitlement across a material's Link Group (Req 4.2, 5.5).
   * Injected by the controller layer; the concrete implementation wraps the
   * Prisma-backed Link Group repository.
   */
  linkGroups: MaterialLinkGroupRepository;
  generateObjectKey?: () => string;
}

/**
 * The public surface of the Study Material service. Every method resolves with
 * the affected material's public DTO or throws a typed domain error
 * (ValidationError → 422, NotFoundError → 404) that the errorHandler maps to
 * the unified error envelope without leaking internals (Req 8.3, 8.4).
 */
export interface MaterialService {
  uploadMaterial(input: UploadMaterialInput): Promise<MaterialDto>;
  editMaterial(id: string, input: EditMaterialInput): Promise<MaterialDto>;
  deleteMaterial(id: string): Promise<void>;
  /**
   * Append one or more files to an existing Study Material, storing each in
   * Object Storage and recording it in the authoritative file list. A missing
   * material yields a not-found error; an empty file list is rejected with a
   * validation error. Returns the updated material DTO with its files.
   */
  addFiles(id: string, files: UploadedFile[]): Promise<MaterialDto>;
  /**
   * Remove a single file from a Study Material: delete its database row and its
   * R2 object. A missing material or a file not belonging to it yields a
   * not-found error. Returns the updated material DTO with its remaining files.
   */
  removeFile(id: string, fileId: string): Promise<MaterialDto>;
  /**
   * Return the complete metadata for an existing Study Material (Req 5.1, 5.3).
   * When the material is a Paid Material (`priceAmount > 0`), the resolved
   * learner (`userId`) must hold a Payment Entitlement for it; otherwise — or
   * when no learner is resolved — a `PaymentRequiredError` (403) is thrown and
   * no content is returned (Req 12.2, 12.3). Free Materials are unaffected and
   * returned without an entitlement check. A missing material yields a
   * not-found error (Req 5.4).
   *
   * When `isAdmin` is true (the caller holds `role_admin`), access is granted to
   * any Study Material regardless of Price without evaluating the entitlement
   * gate and without creating or modifying any Entitlement/Payment record
   * (Req 17.2, 17.4).
   */
  getMaterial(
    id: string,
    userId?: string | null,
    isAdmin?: boolean,
  ): Promise<MaterialDto>;
  /**
   * List the purchasable Paid Materials whose purchase would unlock the given
   * material through its Link Group (linked-material-entitlement). When the
   * material is itself paid it is included; when it is a Free Material locked by
   * a paid sibling, its paid group members are returned so the Frontend can link
   * the Learner to a note they can actually pay for. A missing material yields a
   * not-found error (Req 5.4). Empty when nothing in the group is purchasable.
   */
  getUnlockOptions(id: string): Promise<UnlockOptionDto[]>;
}

/**
 * A purchasable Paid Material offered to unlock a locked material through its
 * Link Group: the paid note's id, title, and Price. The Frontend links the
 * Learner to `/materials/{id}` to complete payment there.
 */
export interface UnlockOptionDto {
  id: string;
  title: string;
  priceAmount: number | null;
  currency: string | null;
}
