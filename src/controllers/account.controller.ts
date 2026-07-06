// Account controller — name + email learner sign-in (Req 6.2–6.6).
//
// Shapes the HTTP surface of the account settings sign-in endpoint, holding no
// business logic of its own: name/email validation, User Record
// resolution/creation, and Access Token issuance all live in
// `account.service.ts`.
//
//   - `POST /api/account/login` — sign a Learner in with a name and email,
//     returning the issued Access Token, its lifetime, and the resolved
//     name/email so the Frontend Project can persist the identity and display
//     it. A malformed name/email surfaces as a 422 validation error (Req 6.3).
//
// Sign-out is purely client-side (the stateless JWT is discarded by the
// browser), so there is no logout endpoint.

import type { NextFunction, Request, Response } from 'express';

import { createDefaultAccountService } from '../services/account.service';
import type { AccountLoginResponse } from '../types/api.types';

/**
 * `POST /api/account/login` — validate the name + email, resolve or create the
 * Learner's User Record, and issue a learner Access Token (Req 6.2–6.6, 6.9).
 */
export async function accountLoginHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { name, email } = req.body as { name: string; email: string };
    const result = await createDefaultAccountService().login(name, email);
    const body: AccountLoginResponse = {
      accessToken: result.accessToken,
      expiresInSeconds: result.expiresInSeconds,
      name: result.name,
      email: result.email,
      roles: result.roles,
    };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}
