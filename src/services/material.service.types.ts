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
  file: UploadedFile;
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
}

/**
 * Persistence contract for Payment Entitlement lookups consumed by the service
 * to gate Paid Material view content (Req 12.2, 12.3). The concrete
 * implementation wraps Prisma; `findEntitlement` returns `null` (never throws)
 * when the Learner holds no Entitlement for the `(userId, materialId)` pair, so
 * the service can map absence to a `PAYMENT_REQUIRED` error without content.
 */
export interface MaterialEntitlementRepository {
  findEntitlement(
    userId: string,
    studyMaterialId: string,
  ): Promise<EntitlementRef | null>;
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
}
