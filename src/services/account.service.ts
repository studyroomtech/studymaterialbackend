// Account service — lightweight name + email learner sign-in (Req 6.2–6.6, 6.9).
//
// This service backs the account settings area, where a Learner signs in with a
// name and email and signs out. It reuses the exact identity model of the
// Download Gate rather than introducing a second one:
//
//   - `login(name, email)` validates the name (1–100 chars) and email (1–254
//     chars in a valid email format), upserts the User Record for that email
//     (reusing an existing record and refreshing its name — Req 6.4), and issues
//     a learner Access Token that expires `ACCESS_TOKEN_TTL_SECONDS` (30 days)
//     after issuance, carrying the name so the Frontend Project can display the
//     signed-in identity after a reload (Req 6.2, 6.5, 6.9).
//
// Signing in by email and downloading share one identity: the same unique-email
// User Record and the same learner token power both. The name/email validation
// is reused from `download.service` so the account and Download Gate flows
// accept exactly the same submissions. Sign-out is a purely client-side concern
// (the stateless JWT is simply discarded), so this service exposes no logout
// operation.

import {
  ACCESS_TOKEN_TTL_SECONDS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../constants/limits.constant';
import {
  AuthRequiredError,
  InternalError,
  ValidationError,
} from '../utils/errors';
import { issueLearnerToken } from './token.service';
import { validateGateSubmission } from './download.service';
import { AUTH_FAILED_MESSAGE } from './account.service.constant';
import { DUMMY_PASSWORD_HASH } from './password.service.constant';
import { hashPassword, verifyPassword } from './password.service';
import * as userRepository from '../repositories/user.repository';
import type {
  AccountLoginResult,
  AccountProfile,
  AccountService,
  AccountServiceDeps,
  SetPasswordInput,
  SetPasswordResult,
} from './account.service.types';

/**
 * Construct the account service over the injected collaborators. The
 * controller/wiring layer supplies the concrete Prisma repository and token
 * issuer (see `createDefaultAccountService`).
 */
export function createAccountService(deps: AccountServiceDeps): AccountService {
  const { users } = deps;

  /**
   * Sign a Learner in by name + email, with optional Password verification
   * (Req 3, 4, 7). Validates both fields (reusing the Download Gate validation,
   * throwing `ValidationError` → 422 for a malformed name/email — Req 3.4),
   * resolves the User Record by email, then branches per the Login decision
   * flow:
   *
   *   - Password supplied (non-empty): the Password Hasher is **always**
   *     exercised — against the stored hash when the account is
   *     Password-Protected, otherwise against `DUMMY_PASSWORD_HASH` with the
   *     result forced `false` — so an existing email and a non-existing email
   *     take comparable time, resisting enumeration by timing (Req 7.5). A
   *     successful verification (only possible when a real hash is stored)
   *     refreshes the name, issues exactly one Access Token (Req 4.1), and
   *     returns `passwordProtected: true`. Any failure throws
   *     `AuthRequiredError` (401) with the single fixed message (Req 4.3, 4.4).
   *   - No Password supplied: a Password-Protected Account is rejected with
   *     `AuthRequiredError` (401) (Req 3.2, 4.3); an Unprotected or not-yet-
   *     existing account is upserted (creating/refreshing the name — Req 6.4),
   *     issued a token, and returned with `passwordProtected: false` (Req 3.1,
   *     3.3).
   *
   * Every failure returns the byte-for-byte identical `AUTH_REQUIRED` body and
   * leaves the account's stored state unchanged (Req 4.5, 7.1–7.3). The
   * plaintext Password and the stored hash are never logged.
   */
  async function login(
    rawName: string,
    rawEmail: string,
    rawPassword?: string,
  ): Promise<AccountLoginResult> {
    const { name, email } = validateGateSubmission(rawName, rawEmail);
    const existing = await users.findUserByEmail(email);
    const storedHash = existing?.passwordHash ?? null;
    const hasStoredHash =
      typeof storedHash === 'string' && storedHash.length > 0;

    // Narrow `rawPassword` to a non-empty string directly so the type flows
    // into `verifyPassword` (a separate boolean const would not narrow it).
    if (typeof rawPassword === 'string' && rawPassword.length > 0) {
      // Always exercise the hasher so an existing email (real hash) and a
      // non-existing/Unprotected email (dummy hash) take comparable time
      // (Req 7.5). Verifying against the dummy hash can never succeed, so the
      // result is forced `false` on that path.
      let verified: boolean;
      if (hasStoredHash) {
        verified = await deps.verifyPassword(rawPassword, storedHash);
      } else {
        await deps.verifyPassword(rawPassword, DUMMY_PASSWORD_HASH);
        verified = false;
      }

      if (!verified) {
        throw new AuthRequiredError(AUTH_FAILED_MESSAGE);
      }

      // A successful verification implies a stored hash existed, so the account
      // is Password-Protected. Refresh the name and issue exactly one token.
      const user = await users.upsertUserByEmail(email, name);
      const accessToken = deps.issueLearnerToken(
        user.id,
        user.email,
        name,
        user.roles,
      );
      return {
        accessToken,
        expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
        name,
        email: user.email,
        roles: user.roles,
        passwordProtected: true,
      };
    }

    // No Password supplied: a Password-Protected Account requires one.
    if (hasStoredHash) {
      throw new AuthRequiredError(AUTH_FAILED_MESSAGE);
    }

    // Unprotected or not-yet-existing account: create/refresh the name and
    // issue a token exactly as the pre-feature flow did (Req 3.1, 3.3).
    const user = await users.upsertUserByEmail(email, name);
    const accessToken = deps.issueLearnerToken(
      user.id,
      user.email,
      name,
      user.roles,
    );
    return {
      accessToken,
      expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
      name,
      email: user.email,
      roles: user.roles,
      passwordProtected: false,
    };
  }

  /**
   * Set (first time) or change (with the current Password) the Password for the
   * signed-in User Record (Req 2). The caller is already authenticated as a
   * specific user (`input.userId` derives from a valid learner token), so —
   * unlike `login` — there is no enumeration/timing concern here and failures
   * are ordinary `ValidationError`s (422). Per the Set-password flow:
   *
   *   1. The `newPassword` bounds (present, 8–128 chars inclusive) are validated
   *      first; an out-of-bounds/absent value is rejected with a
   *      `ValidationError` (422) before any lookup, so the stored hash is left
   *      unchanged (Req 2.4, 2.5).
   *   2. `findUserById` resolves the record. An Unprotected Account (no stored
   *      hash) is set for the first time — hash the new Password and persist it
   *      (Req 2.1, 2.3). A Password-Protected Account requires the current
   *      Password to be supplied and to verify against the stored hash;
   *      otherwise the change is rejected with a `ValidationError` (422) whose
   *      `fields` name `currentPassword`, leaving the existing hash unchanged
   *      (Req 2.6).
   *   3. If persisting the hash fails, an `InternalError` (500) is thrown and
   *      the existing hash is left unchanged (Req 1.5).
   *
   * The plaintext Password is never logged, returned, or persisted (only the
   * derived hash is stored — Req 2.2, 6.5, 6.6). Returns `passwordProtected:
   * true` because the account is Password-Protected after a successful set.
   */
  async function setPassword(
    input: SetPasswordInput,
  ): Promise<SetPasswordResult> {
    const { userId, newPassword, currentPassword } = input;

    // 1. Validate the new-password bounds before any lookup or state change
    //    (Req 2.4, 2.5). An absent, empty, too-short, or too-long value is a
    //    VALIDATION_ERROR (422) and must not touch the User Record.
    if (
      typeof newPassword !== 'string' ||
      newPassword.length < PASSWORD_MIN_LENGTH ||
      newPassword.length > PASSWORD_MAX_LENGTH
    ) {
      throw new ValidationError(
        'The request contains one or more invalid fields.',
        [
          {
            field: 'newPassword',
            reason: `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`,
          },
        ],
      );
    }

    // 2. Resolve the signed-in User Record. The identity comes from a valid
    //    learner token, so a missing record means the authenticated identity
    //    no longer resolves — reject as AUTH_REQUIRED without altering state.
    const user = await users.findUserById(userId);
    if (user === null) {
      throw new AuthRequiredError(AUTH_FAILED_MESSAGE);
    }

    const storedHash = user.passwordHash;
    const hasStoredHash =
      typeof storedHash === 'string' && storedHash.length > 0;

    // A Password-Protected Account requires the current Password to be supplied
    // and to verify against the stored hash before it can be changed (Req 2.6).
    if (hasStoredHash) {
      const currentSupplied =
        typeof currentPassword === 'string' && currentPassword.length > 0;
      const verified =
        currentSupplied &&
        (await deps.verifyPassword(currentPassword, storedHash));
      if (!verified) {
        throw new ValidationError(
          'The request contains one or more invalid fields.',
          [
            {
              field: 'currentPassword',
              reason: 'The current password is missing or incorrect.',
            },
          ],
        );
      }
    }

    // 3. Hash the new Password and persist only the derived hash (Req 2.1, 2.2,
    //    6.6). If persistence fails, surface an InternalError (500) — the
    //    existing hash is left unchanged (Req 1.5). Never log the plaintext.
    const newHash = await deps.hashPassword(newPassword);
    try {
      await users.setUserPasswordHash(userId, newHash);
    } catch {
      throw new InternalError();
    }

    return { passwordProtected: true };
  }

  /**
   * Resolve the signed-in User Record's public profile from the DB, giving the
   * Frontend an authoritative `passwordProtected` status instead of relying on
   * a client-persisted value that can drift. Throws `AuthRequiredError` (401)
   * when the id no longer resolves. The stored Password Hash is never returned
   * (Req 6.4) — only the boolean protection status derived from it.
   */
  async function getAccount(userId: string): Promise<AccountProfile> {
    const user = await users.findUserById(userId);
    if (user === null) {
      throw new AuthRequiredError(AUTH_FAILED_MESSAGE);
    }
    const storedHash = user.passwordHash;
    const passwordProtected =
      typeof storedHash === 'string' && storedHash.length > 0;
    return {
      name: user.name,
      email: user.email,
      roles: user.roles,
      passwordProtected,
    };
  }

  return { login, setPassword, getAccount };
}

/**
 * Construct the account service wired to the real Prisma User repository and
 * JWT token issuer. Used by the controller layer in production (mirrors
 * `createDefaultDownloadService`).
 */
export function createDefaultAccountService(): AccountService {
  return createAccountService({
    users: {
      upsertUserByEmail: userRepository.upsertUserByEmail,
      findUserByEmail: userRepository.findUserByEmail,
      findUserById: userRepository.findUserById,
      setUserPasswordHash: userRepository.setUserPasswordHash,
    },
    issueLearnerToken,
    hashPassword,
    verifyPassword,
  });
}
