// Authorization middleware guarding Content Management Actions.
//
// This middleware runs AFTER `auth.middleware` (Task 8.1), which resolves an
// `AuthContext` from the presented Access Token and attaches it to `req.auth`
// (role_common by default when no valid token is present — Req 10.2). Here we
// enforce that only an authenticated Admin holding `role_admin` may proceed to
// a Content Management Action (Req 10.4, 10.5, 11.16).
//
// Rejections are surfaced as typed domain errors (`utils/errors.ts`) forwarded
// via `next(err)` so the central `errorHandler.middleware` maps them to the
// unified error envelope. Because the request is rejected here — before any
// controller/service runs — no stored data is created, edited, or deleted
// (Req 10.6, 10.7).
//
// Status selection:
//   - `role_admin`                       -> allow the request to proceed.
//   - `role_common` with a resolved
//     Learner identity (authenticated
//     but not an Admin)                  -> 403 FORBIDDEN (Req 10.7).
//   - No admin authentication present
//     (anonymous default role_common, or
//     a missing/invalid/expired token)   -> 401 AUTH_REQUIRED (Req 10.6, 10.8).

import type { NextFunction, Request, Response } from 'express';

import { ROLE_ADMIN } from '../constants/roles.constant';
import { AuthRequiredError, ForbiddenError } from '../utils/errors';

/**
 * Express middleware that permits only `role_admin` callers to continue to a
 * Content Management Action. Non-admin callers are rejected without mutating
 * any stored data (Req 10.6, 10.7, 11.16).
 */
export function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const auth = req.auth;

  // An authenticated Admin (role_admin) is authorized for all Content
  // Management Actions (Req 10.4, 10.5).
  if (auth?.role === ROLE_ADMIN) {
    next();
    return;
  }

  // Distinguish an authenticated but non-admin caller (a Learner resolved from
  // a valid Access Token, who holds role_common) from a caller for whom no
  // admin authentication is present at all (the anonymous role_common default,
  // or a missing/invalid/expired token resolved to role_common by
  // auth.middleware — Req 10.2, 10.8).
  const hasAuthenticatedIdentity =
    auth !== undefined &&
    (auth.userId !== undefined ||
      auth.email !== undefined ||
      auth.username !== undefined);

  if (hasAuthenticatedIdentity) {
    // A caller holding role_common requested a Content Management Action; the
    // caller is identified but not permitted (Req 10.7).
    next(
      new ForbiddenError(
        'Admin privileges are required to perform this action.',
      ),
    );
    return;
  }

  // No admin authentication is present: reject as unauthenticated so the
  // caller can authenticate (Req 10.6, 10.8).
  next(
    new AuthRequiredError(
      'Admin authentication is required to perform this action.',
    ),
  );
}
