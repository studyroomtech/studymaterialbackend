// Types for the Download Gate / download service (Req 1.15: type/interface
// declarations live only in `*.types.ts`).
//
// This module describes:
//   - the minimal persistence records the service reads/writes (User Records,
//     Download Records, Study Materials),
//   - the repository/collaborator contracts the service depends on (the
//     concrete Prisma-backed repositories, the JWT token service, and the R2
//     storage adapter are wired in by `createDefaultDownloadService`), and
//   - the public surface of the download service itself.
//
// Keeping the dependency contract here lets `download.service.ts` be written
// and property-tested against a small, well-defined boundary — independent of
// Prisma, JWT, and R2 (Req 6.2–6.6, 6.8, 9.1–9.4).

import type { AccessTokenClaims } from '../types/auth.types';
import type { EntitlementRef } from './entitlement.service.types';

/**
 * The subset of a persisted User Record the download service needs: the record
 * id and the unique email it is keyed by (Req 6.4, 6.9).
 */
export interface DownloadUserRecord {
  id: string;
  email: string;
}

/**
 * The subset of a persisted Study Material the download service needs to mint a
 * presigned URL: its id, the Object Storage Key that locates the file bytes in
 * R2, and the file name presented to the browser (Req 1.13, 6.8).
 */
export interface DownloadMaterialRecord {
  id: string;
  objectKey: string;
  fileName: string;
  /** The object's MIME type, used to render an inline preview (Req 5.1). */
  contentType?: string;
  /**
   * The Paid Material's Price amount, or `null`/absent for a Free Material. A
   * strictly-positive amount marks the material as Paid, gating download
   * presigning on a Payment Entitlement for the resolved Learner (Req 12.2,
   * 12.3).
   */
  priceAmount?: number | null;
}

/**
 * The subset of a persisted Download Record confirming a tracked download: the
 * referenced User Record and Study Material plus the completion timestamp
 * (Req 9.1–9.3). `downloadedAt` is serialized in ISO 8601 format (Req 9.2).
 */
export interface DownloadRecord {
  id: string;
  userId: string;
  studyMaterialId: string;
  downloadedAt: Date;
}

/**
 * Persistence contract for User Records consumed by the download service. The
 * concrete implementation wraps Prisma; `upsertUserByEmail` guarantees at most
 * one record per email (Req 6.4, 6.9) and `findUserById` returns `null` (never
 * throws) when the id does not resolve so the service can map absence to an
 * auth error (Req 6.6).
 */
export interface DownloadUserRepository {
  /** Upsert a User Record by its unique email, returning the record (Req 6.4). */
  upsertUserByEmail(email: string, name: string): Promise<DownloadUserRecord>;
  /** Load a User Record by id, or `null` when none exists (Req 6.6). */
  findUserById(id: string): Promise<DownloadUserRecord | null>;
}

/**
 * Persistence contract for Study Material lookups consumed by the download
 * service. Returns `null` (never throws) when the material does not exist so
 * the service can return a not-found error without content (Req 5.4).
 */
export interface DownloadMaterialRepository {
  findMaterialById(id: string): Promise<DownloadMaterialRecord | null>;
}

/**
 * Persistence contract for Download Records consumed by the download service.
 * Each successful download persists a separate record (Req 9.1, 9.3).
 */
export interface DownloadRecordRepository {
  createDownload(
    userId: string,
    studyMaterialId: string,
  ): Promise<DownloadRecord>;
}

/**
 * Persistence contract for Payment Entitlement lookups consumed by the download
 * service to gate a Paid Material's download presigning (Req 12.2, 12.3).
 * Returns `null` (never throws) when the Learner holds no Entitlement for the
 * `(userId, materialId)` pair, so the service can withhold the presigned URL
 * and the Download Record and surface a `PAYMENT_REQUIRED` error instead.
 */
export interface DownloadEntitlementRepository {
  findEntitlement(
    userId: string,
    studyMaterialId: string,
  ): Promise<EntitlementRef | null>;
}

/**
 * The dependency bundle the download service is constructed with. The concrete
 * Prisma-backed repositories, the JWT token service, and the R2 storage adapter
 * are injected by `createDefaultDownloadService`, keeping the service logic
 * independent of those collaborators for testing.
 */
export interface DownloadServiceDeps {
  users: DownloadUserRepository;
  materials: DownloadMaterialRepository;
  downloads: DownloadRecordRepository;
  /**
   * Payment Entitlement lookups used to gate a Paid Material's download
   * presigning (Req 12.2, 12.3). Injected by `createDefaultDownloadService`;
   * the concrete implementation wraps the Prisma-backed Entitlement repository.
   */
  entitlements: DownloadEntitlementRepository;
  /** Issue a signed learner Access Token bound to the user id + email (Req 6.5). */
  issueLearnerToken(userId: string, email: string): string;
  /** Verify a token, returning its claims or `null` when invalid/expired (Req 6.6, 6.7). */
  verifyToken(token: string): AccessTokenClaims | null;
  /** Mint a short-lived presigned GET URL for the object (Req 6.8). */
  getPresignedDownloadUrl(objectKey: string, fileName?: string): Promise<string>;
  /** Mint a short-lived URL that renders the object inline for preview. */
  getPresignedPreviewUrl(
    objectKey: string,
    fileName?: string,
    contentType?: string,
  ): Promise<string>;
  /** Lifetime of the presigned URL in seconds, echoed to the caller. */
  presignedUrlTtlSeconds: number;
}

/**
 * The result of a successful Download Gate submission: the issued Access Token,
 * its lifetime in seconds (2592000 — Req 6.5), and the resolved User Record id.
 */
export interface DownloadGateResult {
  accessToken: string;
  expiresInSeconds: number;
  userId: string;
}

/**
 * The result of a prepared download: a short-lived presigned R2 GET URL, the
 * file name, and the URL lifetime in seconds (Req 6.8, 9.1).
 */
export interface PreparedDownload {
  downloadUrl: string;
  fileName: string;
  expiresInSeconds: number;
}

/**
 * The result of a prepared preview: a short-lived URL that renders the object
 * inline, the file name, the object's Content-Type (so the Frontend can pick an
 * appropriate viewer), and the URL lifetime in seconds. Previews do not record
 * a Download Record.
 */
export interface PreparedPreview {
  previewUrl: string;
  fileName: string;
  contentType: string;
  expiresInSeconds: number;
}

/**
 * The public surface of the download service. Methods either resolve with the
 * result or throw a typed domain error (ValidationError → 422,
 * AuthRequiredError → 401, NotFoundError → 404, InternalError → 500) that the
 * errorHandler maps to the unified error envelope (Req 6.3, 6.6, 6.7, 8.4).
 */
export interface DownloadService {
  /**
   * Validate a Download Gate submission (name 1–100, email 1–254 + format),
   * upsert the User Record by email, and issue an Access Token (Req 6.2–6.5).
   */
  submitGate(name: string, email: string): Promise<DownloadGateResult>;
  /**
   * Resolve the Learner from an Access Token, confirm the Study Material
   * exists, record the download with an ISO 8601 timestamp, and return a
   * presigned download URL (Req 6.6, 6.8, 9.1–9.4).
   */
  prepareDownload(
    token: string,
    studyMaterialId: string,
  ): Promise<PreparedDownload>;
  /**
   * Resolve the Learner from an Access Token, confirm the Study Material
   * exists (and, for a Paid Material, that the Learner is entitled), and return
   * a short-lived URL that renders the file inline for preview. Unlike
   * {@link prepareDownload}, no Download Record is created (Req 5.1, 12.2, 12.3).
   */
  preparePreview(
    token: string,
    studyMaterialId: string,
  ): Promise<PreparedPreview>;
}
