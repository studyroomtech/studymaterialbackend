// Authentication-resolution middleware.
//
// This middleware runs ahead of every route and resolves the caller's Role from
// the presented Access Token, attaching an `AuthContext` to `req.auth`. It is
// intentionally forgiving: a missing, malformed, invalid, or expired token is
// NOT an error — it simply resolves to `role_common`, the default public Role
// (Req 10.2). Authorization for Content Management Actions is enforced
// separately by `requireAdmin.middleware`.
//
// Resolution rules:
//   - No `Authorization: Bearer <token>` header, or a token that fails
//     signature/expiry verification → `role_common` with no identity attached
//     (Req 10.2, 10.3).
//   - A valid learner token (role_common) → `role_common` with the resolved
//     User Record id (`userId`) and `email` attached (Req 10.3, 6.6).
//   - A valid admin token (role_admin) → `role_admin` with the `username`
//     attached (Req 10.4).

import type { NextFunction, Request, Response } from 'express';

import { ROLE_ADMIN, ROLE_COMMON } from '../constants/roles.constant';
import { verifyToken } from '../services/token.service';
import type { AuthContext } from '../types/auth.types';

const BEARER_PREFIX = 'Bearer ';

/**
 * Extract the raw JWT from an `Authorization: Bearer <token>` header. Returns
 * `null` when the header is absent or is not a non-empty Bearer credential, so
 * the caller falls back to role_common (Req 10.2).
 */
function extractBearerToken(header: string | undefined): string | null {
  if (typeof header !== 'string' || !header.startsWith(BEARER_PREFIX)) {
    return null;
  }
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Resolve the `AuthContext` for a presented Authorization header. Pure: given a
 * header value it returns the context without touching the request/response, so
 * the resolution logic can be reasoned about and unit-tested in isolation.
 *
 * Missing/invalid/expired tokens resolve to role_common and never error
 * (Req 10.2).
 */
export function resolveAuthContext(header: string | undefined): AuthContext {
  const token = extractBearerToken(header);
  if (token === null) {
    return { role: ROLE_COMMON };
  }

  const claims = verifyToken(token);
  if (claims === null) {
    // Invalid, malformed, tampered, or expired token → default public Role.
    return { role: ROLE_COMMON };
  }

  if (claims.role === ROLE_ADMIN) {
    return { role: ROLE_ADMIN, username: claims.username };
  }

  // A valid learner token: attach the resolved User Record identity (Req 6.6).
  // Elevate the effective Role to role_admin when the token's `roles` (from
  // `User.roles`) include it, so an admin-signed-in learner can perform Content
  // Management Actions with their account token (Req 10.1, 10.4).
  const roles = Array.isArray(claims.roles) ? claims.roles : [];
  const role = roles.includes(ROLE_ADMIN) ? ROLE_ADMIN : ROLE_COMMON;
  return { role, userId: claims.sub, email: claims.email, roles };
}

/**
 * Express middleware that attaches the resolved `AuthContext` to `req.auth` and
 * always continues the chain. It never rejects a request on token grounds —
 * authorization is enforced downstream (Req 10.2–10.4).
 */
export function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  req.auth = resolveAuthContext(req.headers.authorization);
  next();
}
