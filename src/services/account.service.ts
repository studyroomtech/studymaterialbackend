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

import { ACCESS_TOKEN_TTL_SECONDS } from '../constants/limits.constant';
import { issueLearnerToken } from './token.service';
import { validateGateSubmission } from './download.service';
import * as userRepository from '../repositories/user.repository';
import type {
  AccountLoginResult,
  AccountService,
  AccountServiceDeps,
} from './account.service.types';

/**
 * Construct the account service over the injected collaborators. The
 * controller/wiring layer supplies the concrete Prisma repository and token
 * issuer (see `createDefaultAccountService`).
 */
export function createAccountService(deps: AccountServiceDeps): AccountService {
  const { users } = deps;

  /**
   * Sign a Learner in by name + email (Req 6.2–6.6, 6.9). Validates both fields
   * (reusing the Download Gate validation), upserts the User Record by email —
   * reusing an existing record and refreshing its name (Req 6.4) — and issues a
   * learner Access Token whose lifetime is exactly `ACCESS_TOKEN_TTL_SECONDS`
   * and which carries the name (Req 6.5).
   */
  async function login(
    rawName: string,
    rawEmail: string,
  ): Promise<AccountLoginResult> {
    const { name, email } = validateGateSubmission(rawName, rawEmail);
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
    };
  }

  return { login };
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
    },
    issueLearnerToken,
  });
}
