// Public download routes — Download Gate and tracked download (Req 6, 9).
//
// Wires the two public download endpoints through the authentication-resolution
// middleware and Zod request validation before delegating to the download
// controller. The router is designed to be mounted at `/api` by the Express app
// assembly (task 9.4), so paths are declared relative to that mount point.
//
//   - `POST /api/downloads/gate` — validates the Download Gate submission: a
//     name of 1–100 characters and an email of 1–254 characters in a valid
//     email format, rejecting a malformed submission with a per-field
//     validation error before the service persists anything (Req 6.2, 6.3).
//   - `POST /api/materials/:id/download` — validates that a non-empty material
//     `:id` is present, then resolves the Learner from the Bearer Access Token
//     in the controller/service and returns a presigned URL (Req 6.6–6.8, 9).
//     `auth.middleware` resolves the caller's Role ahead of the handler; the
//     controller extracts and verifies the Bearer token itself and surfaces a
//     missing/expired/invalid token as a 401 so the frontend re-shows the
//     Download Gate (Req 6.1, 6.7).
//
// The Paid-Material entitlement gate on download is added in Phase 2
// (task 19.1); Phase 1 lets every resolved Learner download.

import { Router } from 'express';
import { z } from 'zod';

import {
  downloadMaterialHandler,
  previewMaterialHandler,
  submitGateHandler,
} from '../controllers/download.controller';
import {
  EMAIL_MAX_LENGTH,
  EMAIL_MIN_LENGTH,
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from '../constants/limits.constant';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate } from '../middleware/validate.middleware';

/**
 * Body schema for `POST /api/downloads/gate`. Enforces the Download Gate
 * character-length bounds and a valid email format, so a malformed submission
 * is rejected with per-field details before any User Record is persisted
 * (Req 6.2, 6.3).
 */
const gateBodySchema = z.object({
  name: z.string().min(NAME_MIN_LENGTH).max(NAME_MAX_LENGTH),
  email: z
    .string()
    .min(EMAIL_MIN_LENGTH)
    .max(EMAIL_MAX_LENGTH)
    .email(),
  // Optional: supplied only when the account is Password-Protected. No minimum
  // is enforced here so an under-/over-length password is treated as a failed
  // password (PASSWORD_REQUIRED) rather than a VALIDATION_ERROR.
  password: z.string().max(PASSWORD_MAX_LENGTH).optional(),
});

/**
 * Params schema for `POST /api/materials/:id/download` — a non-empty material
 * id must be present before the controller runs (Req 6.8).
 */
const downloadParamsSchema = z.object({
  id: z.string().min(1),
});

/**
 * Router exposing the public Download Gate and tracked-download endpoints.
 * Mount at `/api` so the effective routes are `POST /api/downloads/gate` and
 * `POST /api/materials/:id/download`.
 */
const downloadsRouter: Router = Router();

downloadsRouter.use(authMiddleware);
downloadsRouter.post(
  '/downloads/gate',
  validate({ body: gateBodySchema }),
  submitGateHandler,
);
downloadsRouter.post(
  '/materials/:id/download',
  validate({ params: downloadParamsSchema }),
  downloadMaterialHandler,
);
downloadsRouter.post(
  '/materials/:id/preview',
  validate({ params: downloadParamsSchema }),
  previewMaterialHandler,
);

export { downloadsRouter };
export default downloadsRouter;
