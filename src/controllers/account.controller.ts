// Account controller — optional-password learner sign-in and password setting
// (Req 3, 4, 6.4, 7.4).
//
// Shapes the HTTP surface of the account settings area, holding no business
// logic of its own: name/email validation, User Record resolution/creation,
// optional Password verification, Access Token issuance, and Password setting
// all live in `account.service.ts`.
//
//   - `POST /api/account/login` — sign a Learner in with a name and email and
//     an optional Password. On success the response carries the issued Access
//     Token, its lifetime, the resolved name/email/roles, and the account's
//     `passwordProtected` status so the Frontend Project can prompt the Learner
//     to secure an Unprotected Account (Req 3.3, 7.4). A malformed name/email
//     surfaces as a 422 validation error; a missing/incorrect Password on a
//     Password-Protected Account surfaces as a uniform 401 (Req 4.3, 4.4).
//   - `POST /api/account/password` — set (first time) or change a Learner's
//     Password. The caller must be authenticated (`req.auth.userId`), otherwise
//     the request is rejected with `AUTH_REQUIRED` (401). On success the account
//     is Password-Protected (Req 2). The stored `passwordHash` never appears in
//     any response (Req 6.4).
//
// Sign-out is purely client-side (the stateless JWT is discarded by the
// browser), so there is no logout endpoint.

import type { NextFunction, Request, Response } from 'express';

import { createDefaultAccountService } from '../services/account.service';
import { AuthRequiredError } from '../utils/errors';
import type {
  AccountLoginResponse,
  AccountMeResponse,
  SetPasswordRequest,
  SetPasswordResponse,
} from '../types/api.types';

/**
 * `POST /api/account/login` — validate the name + email, resolve or create the
 * Learner's User Record, optionally verify a supplied Password, and issue a
 * learner Access Token (Req 3, 4, 7). The `passwordProtected` status is present
 * only on this successful sign-in response (Req 3.3, 7.4).
 */
export async function accountLoginHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { name, email, password } = req.body as {
      name: string;
      email: string;
      password?: string;
    };
    const result = await createDefaultAccountService().login(
      name,
      email,
      password,
    );
    const body: AccountLoginResponse = {
      accessToken: result.accessToken,
      expiresInSeconds: result.expiresInSeconds,
      name: result.name,
      email: result.email,
      roles: result.roles,
      passwordProtected: result.passwordProtected,
    };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `POST /api/account/password` — set (first time) or change the signed-in
 * Learner's Password (Req 2). The authenticated identity comes from
 * `req.auth.userId` (populated by `authMiddleware` from a valid learner token);
 * an absent identity is rejected with `AUTH_REQUIRED` (401). On success the
 * account is Password-Protected; the stored `passwordHash` is never included in
 * the response (Req 6.4).
 */
export async function setPasswordHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.auth.userId;
    if (userId === undefined) {
      throw new AuthRequiredError();
    }
    const { newPassword, currentPassword } = req.body as SetPasswordRequest;
    await createDefaultAccountService().setPassword({
      userId,
      newPassword,
      currentPassword,
    });
    const body: SetPasswordResponse = { passwordProtected: true };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `GET /api/account/me` — return the signed-in Learner's profile (name, email,
 * roles) and the authoritative `passwordProtected` status derived from the DB,
 * so the Frontend can reconcile its cached protection state with the source of
 * truth. The authenticated identity comes from `req.auth.userId`; an absent
 * identity is rejected with `AUTH_REQUIRED` (401). The stored `passwordHash` is
 * never included in the response (Req 6.4).
 */
export async function accountMeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.auth.userId;
    if (userId === undefined) {
      throw new AuthRequiredError();
    }
    const profile = await createDefaultAccountService().getAccount(userId);
    const body: AccountMeResponse = {
      name: profile.name,
      email: profile.email,
      roles: profile.roles,
      passwordProtected: profile.passwordProtected,
    };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}
