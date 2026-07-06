// Authentication and authorization types for the Study Materials Platform.
//
// Access Tokens are stateless JWTs, so there is no token table; expiry is
// encoded in the token itself (Req 6.5). `auth.middleware` resolves a Role
// (and, for a learner token, the User Record identity) from the presented
// token, defaulting to role_common when no valid token is present
// (Req 10.2–10.4).

import type { Role } from './domain.types';

/**
 * JWT claims shared by every issued Access Token: the subject (the record id
 * the token is bound to), the Role it grants, and standard issued-at/expiry
 * timestamps in seconds since the epoch (`exp` encodes the 2592000s learner
 * expiry — Req 6.5).
 */
export interface BaseTokenClaims {
  sub: string;
  role: Role;
  iat?: number;
  exp?: number;
}

/**
 * Claims for a Learner Access Token issued after a completed Download Gate.
 * `sub` is the User Record id and `email` is the resolved unique email
 * (Req 6.5, 6.6, 6.9).
 */
export interface LearnerTokenClaims extends BaseTokenClaims {
  role: 'role_common';
  email: string;
  /**
   * The Learner's display name captured alongside the email (Download Gate or
   * account sign-in). Optional so tokens issued without a name still verify
   * (Req 6.2).
   */
  name?: string;
  /**
   * The Roles held by the User Record (from `User.roles`). Carried on the token
   * so `auth.middleware` can elevate the request to `role_admin` when the signed
   * -in user holds it, without a database lookup. Optional/absent for tokens
   * issued before roles existed → treated as `[role_common]` (Req 10.1, 10.2).
   */
  roles?: string[];
}

/**
 * Claims for an Admin Access Token issued after a successful admin login.
 * `sub` is the Admin id and `username` identifies the Admin (Req 10.5).
 */
export interface AdminTokenClaims extends BaseTokenClaims {
  role: 'role_admin';
  username: string;
}

/**
 * The full set of claims a decoded Access Token may carry (Req 6.5, 10.5).
 */
export type AccessTokenClaims = LearnerTokenClaims | AdminTokenClaims;

/**
 * The authentication context attached to a request after `auth.middleware`
 * runs. `role` is always resolved (role_common by default — Req 10.2). For a
 * valid learner token, `userId`/`email` are attached; for a valid admin token,
 * `username` is attached (Req 10.3–10.4).
 */
export interface AuthContext {
  role: Role;
  userId?: string;
  email?: string;
  username?: string;
  /** All Roles held by the signed-in learner (from the token's `roles` claim). */
  roles?: string[];
}

// Augment the Express `Request` so downstream middleware, controllers, and
// services can read the resolved authentication context in a type-safe way.
// `auth.middleware` always populates `req.auth` (defaulting to role_common), so
// it is safe to treat as always present on any request that has passed through
// that middleware (Req 10.2–10.4).
declare global {
  namespace Express {
    interface Request {
      auth: AuthContext;
    }
  }
}
