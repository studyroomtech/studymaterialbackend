// JWT Access Token issuance and verification.
//
// Access Tokens are stateless JWTs; there is no token table and expiry is
// encoded in the token itself (Req 6.5). This service issues two kinds of
// tokens and verifies either:
//
//   - Learner tokens (role_common) issued after a completed Download Gate,
//     carrying the User Record id (`sub`) and resolved unique email. They
//     expire exactly `ACCESS_TOKEN_TTL_SECONDS` (2592000s / 30 days) after
//     issuance (Req 6.5, 6.6).
//   - Admin tokens (role_admin) issued after a successful admin login, carrying
//     the Admin id (`sub`) and username, with a configurable lifetime read from
//     `ADMIN_TOKEN_TTL_SECONDS` (Req 10.5).
//
// `verifyToken` validates the signature and expiry and returns the decoded
// claims, or `null` when the token is missing, malformed, tampered with, or
// expired — so `auth.middleware` can default to role_common and the frontend
// can re-show the Download Gate (Req 6.7, 10.2, 10.4).
//
// Claim-shaping is kept in pure helpers (`buildLearnerClaims` /
// `buildAdminClaims`) so the token payload can be constructed and reasoned
// about without performing any signing I/O.

import jwt from 'jsonwebtoken';

import { getEnv } from '../config/env';
import { ROLE_ADMIN, ROLE_COMMON } from '../constants/roles.constant';
import { ACCESS_TOKEN_TTL_SECONDS } from '../constants/limits.constant';
import type {
  AccessTokenClaims,
  AdminTokenClaims,
  LearnerTokenClaims,
} from '../types/auth.types';

/**
 * The unsigned learner claim payload (without the `iat`/`exp` timestamps, which
 * are added by the signer). Pure: given the same inputs it always returns the
 * same shape (Req 6.5, 6.6).
 */
export function buildLearnerClaims(
  userId: string,
  email: string,
  name?: string,
  roles?: string[]
): Pick<LearnerTokenClaims, 'sub' | 'role' | 'email' | 'name' | 'roles'> {
  return {
    sub: userId,
    role: ROLE_COMMON,
    email,
    ...(name !== undefined ? { name } : {}),
    ...(roles !== undefined ? { roles } : {}),
  };
}

/**
 * The unsigned admin claim payload (without the `iat`/`exp` timestamps). Pure
 * (Req 10.5).
 */
export function buildAdminClaims(
  adminId: string,
  username: string
): Pick<AdminTokenClaims, 'sub' | 'role' | 'username'> {
  return { sub: adminId, role: ROLE_ADMIN, username };
}

/**
 * Resolves the signing/verification secret from the environment. Centralized so
 * issuance and verification always share the same key.
 */
function getSecret(): string {
  return getEnv().jwtSecret;
}

/**
 * Issues a signed learner Access Token that expires exactly
 * `ACCESS_TOKEN_TTL_SECONDS` after issuance (`exp = iat + 2592000`), binding the
 * token to the given User Record id and email (Req 6.5, 6.6).
 */
export function issueLearnerToken(
  userId: string,
  email: string,
  name?: string,
  roles?: string[]
): string {
  return jwt.sign(buildLearnerClaims(userId, email, name, roles), getSecret(), {
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

/**
 * Issues a signed admin Access Token bound to the given Admin id and username,
 * with a lifetime configured by `ADMIN_TOKEN_TTL_SECONDS` (Req 10.5).
 */
export function issueAdminToken(adminId: string, username: string): string {
  return jwt.sign(buildAdminClaims(adminId, username), getSecret(), {
    expiresIn: getEnv().adminTokenTtlSeconds,
  });
}

/**
 * Verifies a token's signature and expiry and returns its decoded claims, or
 * `null` when the token is absent, malformed, tampered with, expired, or does
 * not carry a recognized Role (Req 6.7, 10.2, 10.4).
 */
export function verifyToken(token: string): AccessTokenClaims | null {
  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }

  let decoded: unknown;
  try {
    decoded = jwt.verify(token, getSecret());
  } catch {
    // Invalid signature, malformed token, or expired token all fail closed.
    return null;
  }

  if (typeof decoded !== 'object' || decoded === null) {
    return null;
  }

  const claims = decoded as Partial<AccessTokenClaims>;
  if (typeof claims.sub !== 'string') {
    return null;
  }

  if (claims.role === ROLE_COMMON && typeof claims.email === 'string') {
    return claims as LearnerTokenClaims;
  }

  if (claims.role === ROLE_ADMIN && typeof claims.username === 'string') {
    return claims as AdminTokenClaims;
  }

  return null;
}
