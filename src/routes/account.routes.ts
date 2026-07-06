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
//
// Sign-out is purely client-side (the stateless JWT is discarded by the
// browser), so there is no logout route.

import { Router } from 'express';
import { z } from 'zod';

import { accountLoginHandler } from '../controllers/account.controller';
import {
  EMAIL_MAX_LENGTH,
  EMAIL_MIN_LENGTH,
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
} from '../constants/limits.constant';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';

/**
 * Body schema for `POST /api/account/login`. Enforces the name (1–100) and
 * email (1–254, valid format) bounds so a malformed submission is rejected with
 * per-field details before the service runs (Req 6.2, 6.3).
 */
const accountLoginBodySchema = z.object({
  name: z.string().min(NAME_MIN_LENGTH).max(NAME_MAX_LENGTH),
  email: z.string().min(EMAIL_MIN_LENGTH).max(EMAIL_MAX_LENGTH).email(),
});

/**
 * Router exposing the account sign-in endpoint. Mount at `/api` so the
 * effective route is `POST /api/account/login`.
 */
const accountRouter = Router();

accountRouter.use(authMiddleware);
accountRouter.post(
  '/account/login',
  validate({ body: accountLoginBodySchema }),
  accountLoginHandler,
);

export { accountRouter };
export default accountRouter;
