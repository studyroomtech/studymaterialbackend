// Download Gate and download service (Req 6.2–6.6, 6.8, 6.9, 9.1–9.4).
//
// This service implements the two backend steps of the download flow:
//
//   1. `submitGate(name, email)` — the Download Gate. It validates the name
//      (1–100 chars) and email (1–254 chars in a valid email format), upserts a
//      User Record by its unique email so a repeat submission reuses the same
//      record rather than creating a duplicate, and issues a learner Access
//      Token that expires 2592000 seconds after issuance (Req 6.2–6.5, 6.9).
//
//   2. `prepareDownload(token, materialId)` — the tracked download. It resolves
//      the Learner from a valid Access Token (re-prompting the Download Gate via
//      a 401 when the token is missing/invalid/expired), confirms the Study
//      Material exists, mints a short-lived presigned R2 GET URL, and persists a
//      Download Record carrying an ISO 8601 completion timestamp (Req 6.6–6.8,
//      9.1–9.3). A Download Record persistence failure is logged with a
//      timestamp (Req 9.4).
//
//   Paid Materials (`priceAmount > 0`) are gated on a Payment Entitlement:
//   after the Learner is resolved and the material is found, a Paid Material
//   requires an Entitlement for `(userId, materialId)`; when it is not held the
//   service throws `PaymentRequiredError` (403), minting no presigned URL and
//   inserting no Download Record. Free Materials are unaffected (Req 12.2,
//   12.3).
//
// Business rules that require no I/O — name/email normalization and validation
// — are isolated into exported pure functions so they can be reasoned about and
// property-tested without any collaborator. Persistence, token issuance, and
// presigning are reached only through the injected `DownloadServiceDeps`,
// keeping the service independent of Prisma, JWT, and R2. Failures are signaled
// with typed domain errors that the errorHandler maps to the unified error
// envelope without leaking internals (Req 8.3, 8.4).

import { ROLE_ADMIN, ROLE_COMMON } from '../constants/roles.constant';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  EMAIL_MAX_LENGTH,
  EMAIL_MIN_LENGTH,
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
} from '../constants/limits.constant';
import {
  AuthRequiredError,
  InternalError,
  NotFoundError,
  PasswordRequiredError,
  PaymentRequiredError,
  ValidationError,
} from '../utils/errors';
import { logError } from '../utils/logger';
import { getEnv } from '../config/env';
import {
  getPresignedDownloadUrl,
  getPresignedPreviewUrl,
} from '../storage/storage.service';
import { issueLearnerToken, verifyToken } from './token.service';
import { verifyPassword } from './password.service';
import { isPaidMaterial } from './material.service';
import { isEffectivelyEntitled } from './entitlement.service';
import * as downloadRepository from '../repositories/download.repository';
import * as materialRepository from '../repositories/material.repository';
import * as userRepository from '../repositories/user.repository';
import * as entitlementRepository from '../repositories/entitlement.repository';
import * as linkGroupRepository from '../repositories/linkGroup.repository';
import { EMAIL_FORMAT_PATTERN } from './download.service.constant';
import type { ApiErrorFieldDto } from '../types/api.types';
import type { AccessTokenClaims } from '../types/auth.types';
import type {
  DownloadGateResult,
  DownloadService,
  DownloadServiceDeps,
  PreparedDownload,
  PreparedPreview,
} from './download.service.types';

// --- Pure validation helpers (no I/O) -------------------------------------

/**
 * Normalize a raw name by coalescing nullish to an empty string and trimming
 * leading/trailing whitespace, so a whitespace-only name is treated as empty
 * and the stored name is canonical (Req 6.2).
 */
export function normalizeName(name: string | null | undefined): string {
  return (name ?? '').trim();
}

/**
 * Normalize a raw email by coalescing nullish to an empty string and trimming
 * surrounding whitespace. Case is preserved so the stored email is not silently
 * altered; the unique-email upsert then keys off the exact normalized value
 * (Req 6.2, 6.9).
 */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim();
}

/**
 * Whether a name satisfies the inclusive 1–100 character bound after trimming
 * (Req 6.2). A blank (whitespace-only) name normalizes to empty and is
 * rejected.
 */
export function isNameValid(name: string | null | undefined): boolean {
  const length = normalizeName(name).length;
  return length >= NAME_MIN_LENGTH && length <= NAME_MAX_LENGTH;
}

/**
 * Whether an email satisfies the inclusive 1–254 character bound after trimming
 * AND matches the email-format pattern (Req 6.2, 6.3).
 */
export function isEmailValid(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  return (
    normalized.length >= EMAIL_MIN_LENGTH &&
    normalized.length <= EMAIL_MAX_LENGTH &&
    EMAIL_FORMAT_PATTERN.test(normalized)
  );
}

/**
 * Validate a Download Gate submission, returning the normalized name/email on
 * success (Req 6.2). On failure a `ValidationError` is thrown identifying each
 * invalid field and the reason, so no User Record is persisted (Req 6.3). Pure
 * aside from the throw.
 */
export function validateGateSubmission(
  rawName: string | null | undefined,
  rawEmail: string | null | undefined,
): { name: string; email: string } {
  const name = normalizeName(rawName);
  const email = normalizeEmail(rawEmail);
  const fields: ApiErrorFieldDto[] = [];

  if (!isNameValid(name)) {
    fields.push({
      field: 'name',
      reason: `name must be ${NAME_MIN_LENGTH}–${NAME_MAX_LENGTH} characters.`,
    });
  }
  if (!isEmailValid(email)) {
    fields.push({
      field: 'email',
      reason: `email must be ${EMAIL_MIN_LENGTH}–${EMAIL_MAX_LENGTH} characters in a valid email format.`,
    });
  }

  if (fields.length > 0) {
    throw new ValidationError(
      'The request contains one or more invalid fields.',
      fields,
    );
  }

  return { name, email };
}

/**
 * Whether the resolved caller holds the elevated `role_admin` Role, mirroring
 * how `auth.middleware` derives the effective Role: an Admin Access Token
 * (`role === role_admin`) qualifies, as does a learner token whose `roles`
 * claim (from `User.roles`) includes `role_admin`. When true, the caller is
 * granted access to any Study Material without an Entitlement or Payment,
 * regardless of Price (Req 17.2), so the Paid-Material gate is short-circuited.
 * No record is read, created, or modified for this decision. Pure.
 */
export function callerHoldsAdminRole(claims: AccessTokenClaims): boolean {
  if (claims.role === ROLE_ADMIN) {
    return true;
  }
  const roles = Array.isArray(claims.roles) ? claims.roles : [];
  return roles.includes(ROLE_ADMIN);
}

// --- Service factory ------------------------------------------------------

/**
 * Construct the download service over the injected collaborators. The
 * controller/wiring layer supplies the concrete Prisma repositories, token
 * service, and storage adapter (see `createDefaultDownloadService`).
 */
export function createDownloadService(
  deps: DownloadServiceDeps,
): DownloadService {
  const { users, materials, downloads } = deps;

  /**
   * Access gate shared by {@link prepareDownload} and {@link preparePreview}.
   * A material is gated whenever it belongs to a Link Group that contains at
   * least one Paid Material — so a Free Material linked to a Paid one is locked
   * behind a Direct Entitlement to some group member, and a purchase of any
   * paid member unlocks every member:
   *
   *   1. Admin bypass — a `role_admin` caller is granted regardless of Price or
   *      Link Group membership, touching no record (Req 8.3).
   *   2. Truly-free pass-through — the material is a Free Material AND no member
   *      of its Link Group is a Paid Material (an ungrouped Free Material, or a
   *      group of only Free Materials): proceed untouched (Req 8.1).
   *   3. Direct Entitlement — the Learner holds `(userId, materialId)`: grant
   *      via the fast path (Req 4.1).
   *   4. Effective Entitlement — the Learner holds a Direct Entitlement for any
   *      member of the material's Link Group: grant (Req 4.2, 10.1).
   *   5. Otherwise → `PaymentRequiredError` (403), no content (Req 4.3, 10.3).
   *
   * Fail-safe (Req 5.5): if the Link Group membership cannot be resolved, the
   * gate falls back to the material's own Price — a Free Material passes, a Paid
   * Material requires a Direct Entitlement — never creating/modifying a record.
   */
  async function assertPaidAccess(
    claims: AccessTokenClaims,
    userId: string,
    material: { id: string; priceAmount?: number | null },
  ): Promise<void> {
    // Admin bypass (Req 8.3) — no gate applies.
    if (callerHoldsAdminRole(claims)) {
      return;
    }

    // Resolve the Link Group closure (self + siblings) with member Prices to
    // decide whether the group is "paid-gated". On failure, fall back to the
    // material's own Price only (Req 5.5): a Free Material passes; a Paid
    // Material requires a Direct Entitlement.
    let members: { id: string; priceAmount?: number | null }[];
    try {
      members = await deps.linkGroups.listGroupMembersWithPrice(material.id);
    } catch (error) {
      logError('Link Group resolution failed; gating by material Price only', {
        userId,
        studyMaterialId: material.id,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!isPaidMaterial(material.priceAmount)) {
        return;
      }
      const directFallback = await deps.entitlements.findEntitlement(
        userId,
        material.id,
      );
      if (directFallback === null) {
        throw new PaymentRequiredError();
      }
      return;
    }

    // The group closure is the resolved members, or the material itself when
    // ungrouped. The group is paid-gated when any member is a Paid Material.
    const memberIds = members.length > 0 ? members.map((m) => m.id) : [material.id];
    const groupHasPaidMember =
      isPaidMaterial(material.priceAmount) ||
      members.some((m) => isPaidMaterial(m.priceAmount));

    // Truly free (Req 8.1): a Free Material whose group has no Paid Material is
    // open to everyone, unchanged from prior behavior.
    if (!groupHasPaidMember) {
      return;
    }

    // Direct-Entitlement fast path (Req 4.1).
    const direct = await deps.entitlements.findEntitlement(userId, material.id);
    if (direct !== null) {
      return;
    }

    // Effective Entitlement across the group (Req 4.2, 10.1): granted when the
    // Learner holds a Direct Entitlement for any member; otherwise denied.
    const entitledIds = new Set(
      await deps.entitlements.listEntitledMaterialIds(userId),
    );
    if (!isEffectivelyEntitled(entitledIds, memberIds, material.id)) {
      throw new PaymentRequiredError();
    }
  }

  /**
   * Handle a Download Gate submission (Req 6.2–6.5, 6.9). Validates the name
   * and email, upserts the User Record by email (reusing an existing record for
   * a known email — Req 6.4), and issues a learner Access Token whose lifetime
   * is exactly `ACCESS_TOKEN_TTL_SECONDS` (Req 6.5).
   *
   * When the email resolves to a Password-Protected Account (a stored Password
   * Hash), a correct `password` MUST be supplied — otherwise a
   * `PasswordRequiredError` (401) is thrown and no token is issued, so a
   * protected account cannot be entered through the gate with only an email.
   */
  async function submitGate(
    rawName: string,
    rawEmail: string,
    rawPassword?: string,
  ): Promise<DownloadGateResult> {
    const { name, email } = validateGateSubmission(rawName, rawEmail);

    // Detect a Password-Protected Account before upserting: if a hash is stored
    // the supplied password must verify against it (a missing, empty, or wrong
    // password is rejected identically).
    const existing = await users.findUserByEmail(email);
    const storedHash = existing?.passwordHash ?? null;
    if (storedHash !== null) {
      const password = typeof rawPassword === 'string' ? rawPassword : '';
      const verified =
        password.length > 0 && (await deps.verifyPassword(password, storedHash));
      if (!verified) {
        throw new PasswordRequiredError();
      }
    }

    const user = await users.upsertUserByEmail(email, name);
    const accessToken = deps.issueLearnerToken(user.id, user.email);
    return {
      accessToken,
      expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
      userId: user.id,
    };
  }

  /**
   * Prepare a tracked download for a resolved Learner (Req 6.6–6.8, 9.1–9.4).
   *
   * The Access Token must verify to a learner (role_common) whose User Record
   * still resolves; a missing/invalid/expired token or unresolved user yields a
   * 401 so the frontend re-shows the Download Gate (Req 6.6, 6.7). A missing
   * Study Material yields a 404 with no content (Req 5.4). On success a
   * presigned R2 GET URL is minted and a Download Record is persisted with an
   * ISO 8601 completion timestamp (Req 6.8, 9.1–9.3); a persistence failure is
   * logged with a timestamp before surfacing an internal error (Req 9.4).
   */
  async function prepareDownload(
    token: string,
    studyMaterialId: string,
  ): Promise<PreparedDownload> {
    const claims = deps.verifyToken(token);
    if (
      claims === null ||
      claims.role !== ROLE_COMMON ||
      typeof claims.sub !== 'string'
    ) {
      throw new AuthRequiredError(
        'A valid Access Token is required to download.',
      );
    }

    const user = await users.findUserById(claims.sub);
    if (user === null) {
      throw new AuthRequiredError(
        'A valid Access Token is required to download.',
      );
    }

    const material = await materials.findMaterialById(studyMaterialId);
    if (material === null) {
      throw new NotFoundError(
        `The requested Study Material '${studyMaterialId}' was not found.`,
      );
    }

    // Paid-Material access gate (Req 4.1–4.3, 8.1, 8.3, 10.1, 10.3): admin →
    // free → Direct → Effective Entitlement, with the Req 5.5 fail-safe. When
    // access is denied no presigned URL is minted and no Download Record is
    // inserted; the Learner is prompted to pay via PAYMENT_REQUIRED (403).
    await assertPaidAccess(claims, user.id, material);

    const downloadUrl = await deps.getPresignedDownloadUrl(
      material.objectKey,
      material.fileName,
    );

    try {
      await downloads.createDownload(user.id, material.id);
    } catch (error) {
      // Req 9.4: log the persistence failure with a timestamp (added by the
      // logger) without leaking internals to the caller.
      logError('Failed to persist Download Record', {
        userId: user.id,
        studyMaterialId: material.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new InternalError();
    }

    return {
      downloadUrl,
      fileName: material.fileName,
      expiresInSeconds: deps.presignedUrlTtlSeconds,
    };
  }

  /**
   * Prepare an inline preview for a resolved Learner (Req 5.1, 12.2, 12.3).
   *
   * Mirrors {@link prepareDownload}'s auth and Paid-Material entitlement gating
   * (a missing/invalid/expired token or unresolved user yields 401; a missing
   * material yields 404; an unentitled Learner on a Paid Material yields
   * 403 PAYMENT_REQUIRED), but mints an inline URL and does NOT record a
   * Download Record — a preview is not a download.
   */
  async function preparePreview(
    token: string,
    studyMaterialId: string,
  ): Promise<PreparedPreview> {
    const claims = deps.verifyToken(token);
    if (
      claims === null ||
      claims.role !== ROLE_COMMON ||
      typeof claims.sub !== 'string'
    ) {
      throw new AuthRequiredError(
        'A valid Access Token is required to preview.',
      );
    }

    const user = await users.findUserById(claims.sub);
    if (user === null) {
      throw new AuthRequiredError(
        'A valid Access Token is required to preview.',
      );
    }

    const material = await materials.findMaterialById(studyMaterialId);
    if (material === null) {
      throw new NotFoundError(
        `The requested Study Material '${studyMaterialId}' was not found.`,
      );
    }

    // Paid-Material access gate (Req 4.1–4.3, 8.1, 8.3, 10.1, 10.3): mirrors
    // prepareDownload — admin → free → Direct → Effective Entitlement with the
    // Req 5.5 fail-safe. A denied Learner yields PAYMENT_REQUIRED (403) and no
    // preview URL; previews record no Download Record.
    await assertPaidAccess(claims, user.id, material);

    const previewUrl = await deps.getPresignedPreviewUrl(
      material.objectKey,
      material.fileName,
      material.contentType,
    );

    return {
      previewUrl,
      fileName: material.fileName,
      contentType: material.contentType ?? '',
      expiresInSeconds: deps.presignedUrlTtlSeconds,
    };
  }

  /**
   * Resolve the Learner and material, apply the SAME note-level Paid-Material
   * gate as {@link prepareDownload}, then presign a specific file of the
   * material and record a Download Record against the material (Req 6.6–6.8,
   * 9.1–9.4). A file not belonging to the material yields a 404. Mirrors
   * {@link prepareDownload} exactly, differing only in resolving and presigning
   * the identified file rather than the primary columns.
   */
  async function prepareFileDownload(
    token: string,
    studyMaterialId: string,
    fileId: string,
  ): Promise<PreparedDownload> {
    const claims = deps.verifyToken(token);
    if (
      claims === null ||
      claims.role !== ROLE_COMMON ||
      typeof claims.sub !== 'string'
    ) {
      throw new AuthRequiredError(
        'A valid Access Token is required to download.',
      );
    }

    const user = await users.findUserById(claims.sub);
    if (user === null) {
      throw new AuthRequiredError(
        'A valid Access Token is required to download.',
      );
    }

    const material = await materials.findMaterialById(studyMaterialId);
    if (material === null) {
      throw new NotFoundError(
        `The requested Study Material '${studyMaterialId}' was not found.`,
      );
    }

    await assertPaidAccess(claims, user.id, material);

    const file = await materials.findMaterialFile(studyMaterialId, fileId);
    if (file === null) {
      throw new NotFoundError(
        `The requested file '${fileId}' was not found.`,
      );
    }

    const downloadUrl = await deps.getPresignedDownloadUrl(
      file.objectKey,
      file.fileName,
    );

    try {
      await downloads.createDownload(user.id, material.id);
    } catch (error) {
      logError('Failed to persist Download Record', {
        userId: user.id,
        studyMaterialId: material.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new InternalError();
    }

    return {
      downloadUrl,
      fileName: file.fileName,
      expiresInSeconds: deps.presignedUrlTtlSeconds,
    };
  }

  /**
   * Resolve the Learner and material, apply the SAME note-level Paid-Material
   * gate as {@link preparePreview}, then presign a specific file of the
   * material inline (Req 5.1, 12.2, 12.3). Records no Download Record. A file
   * not belonging to the material yields a 404.
   */
  async function prepareFilePreview(
    token: string,
    studyMaterialId: string,
    fileId: string,
  ): Promise<PreparedPreview> {
    const claims = deps.verifyToken(token);
    if (
      claims === null ||
      claims.role !== ROLE_COMMON ||
      typeof claims.sub !== 'string'
    ) {
      throw new AuthRequiredError(
        'A valid Access Token is required to preview.',
      );
    }

    const user = await users.findUserById(claims.sub);
    if (user === null) {
      throw new AuthRequiredError(
        'A valid Access Token is required to preview.',
      );
    }

    const material = await materials.findMaterialById(studyMaterialId);
    if (material === null) {
      throw new NotFoundError(
        `The requested Study Material '${studyMaterialId}' was not found.`,
      );
    }

    await assertPaidAccess(claims, user.id, material);

    const file = await materials.findMaterialFile(studyMaterialId, fileId);
    if (file === null) {
      throw new NotFoundError(
        `The requested file '${fileId}' was not found.`,
      );
    }

    const previewUrl = await deps.getPresignedPreviewUrl(
      file.objectKey,
      file.fileName,
      file.contentType,
    );

    return {
      previewUrl,
      fileName: file.fileName,
      contentType: file.contentType ?? '',
      expiresInSeconds: deps.presignedUrlTtlSeconds,
    };
  }

  return {
    submitGate,
    prepareDownload,
    preparePreview,
    prepareFileDownload,
    prepareFilePreview,
  };
}

/**
 * Construct the download service wired to the real Prisma repositories, JWT
 * token service, and R2 storage adapter, reading the presigned-URL lifetime
 * from the environment. Used by the controller layer in production.
 */
export function createDefaultDownloadService(): DownloadService {
  return createDownloadService({
    users: {
      upsertUserByEmail: userRepository.upsertUserByEmail,
      findUserByEmail: userRepository.findUserByEmail,
      findUserById: userRepository.findUserById,
    },
    materials: {
      findMaterialById: materialRepository.findMaterialById,
      async findMaterialFile(studyMaterialId, fileId) {
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
    },
    downloads: {
      createDownload: downloadRepository.createDownload,
    },
    entitlements: {
      findEntitlement: entitlementRepository.findEntitlement,
      listEntitledMaterialIds: entitlementRepository.listEntitledMaterialIds,
    },
    linkGroups: {
      listGroupMemberIds: linkGroupRepository.listGroupMemberIds,
      listGroupMembersWithPrice: linkGroupRepository.listGroupMembersWithPrice,
    },
    issueLearnerToken,
    verifyPassword,
    verifyToken,
    getPresignedDownloadUrl,
    getPresignedPreviewUrl,
    presignedUrlTtlSeconds: getEnv().presignedUrlTtlSeconds,
  });
}
