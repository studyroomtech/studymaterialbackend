// Account routes — name + email learner sign-in (Req 6.2–6.6).
//
// Wires the account settings sign-in endpoint through the authentication-
// resolution middleware and Zod request validation before delegating to the
// account controller. The router is designed to be mounted at `/api` by the
// Express app assembly, so the path is declared relative to that mount point.
//
//   - `POST /api/account/login` — validates the name (1–100) and email (1–254,
//     valid format) before the service resolves/creates the User Record and
//     issues a learner Access Token (Req 6.2, 6.3, 6.5). `auth.middleware`
//     resolves the caller's Role ahead of the handler.
//   - `POST /api/account/password` — behind `authMiddleware`, lets a signed-in
//     Learner set (first time) or change their Password; the new Password must
//     be within the 8–128 bounds (Req 2.4, 2.5) before the service runs.
//
// Sign-out is purely client-side (the stateless JWT is discarded by the
// browser), so there is no logout route.

import { Router } from 'express';
import { z } from 'zod';

import {
  accountLoginHandler,
  setPasswordHandler,
} from '../controllers/account.controller';
import {
  EMAIL_MAX_LENGTH,
  EMAIL_MIN_LENGTH,
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../constants/limits.constant';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';

/**
 * Body schema for `POST /api/account/login`. Enforces the name (1–100) and
 * email (1–254, valid format) bounds so a malformed submission is rejected with
 * per-field details before the service runs (Req 6.2, 6.3).
 *
 * The optional `password` caps at `PASSWORD_MAX_LENGTH` but intentionally
 * enforces no minimum: an under-/over-length password at login must surface as
 * an `AUTH_REQUIRED` (401) from the service rather than a `VALIDATION_ERROR`
 * (422), so the login response never reveals whether the account is protected
 * (Req 4.3).
 */
const accountLoginBodySchema = z.object({
  name: z.string().min(NAME_MIN_LENGTH).max(NAME_MAX_LENGTH),
  email: z.string().min(EMAIL_MIN_LENGTH).max(EMAIL_MAX_LENGTH).email(),
  password: z.string().max(PASSWORD_MAX_LENGTH).optional(),
});

/**
 * Body schema for `POST /api/account/password`. Enforces the new Password's
 * 8–128 bounds so an out-of-range or absent value is rejected as a
 * `VALIDATION_ERROR` (422) before the service runs (Req 2.4, 2.5). The optional
 * `currentPassword` is required by the service only when changing an existing
 * Password (Req 2.6).
 */
const setPasswordBodySchema = z.object({
  newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH).optional(),
});

/**
 * Router exposing the account sign-in endpoint. Mount at `/api` so the
 * effective route is `POST /api/account/login`.
 */
const accountRouter: Router = Router();

accountRouter.use(authMiddleware);
accountRouter.post(
  '/account/login',
  validate({ body: accountLoginBodySchema }),
  accountLoginHandler,
);
accountRouter.post(
  '/account/password',
  validate({ body: setPasswordBodySchema }),
  setPasswordHandler,
);

export { accountRouter };
export default accountRouter;
