// Types for the account service (Req 1.15: type/interface declarations live
// only in `*.types.ts`).
//
// The account service implements a lightweight name + email learner sign-in
// that reuses the same identity as the Download Gate: it upserts the User
// Record for an email (setting the submitted name) and issues a learner Access
// Token, so signing in on the account page and downloading share one identity
// (Req 6.2, 6.4, 6.5, 6.9).

/**
 * The subset of a persisted User Record the account service needs: the record
 * id and the unique email it is keyed by (Req 6.4, 6.9).
 */
export interface AccountUserRecord {
  id: string;
  email: string;
  /** The Roles held by the User Record (from `User.roles`), e.g. `[role_common]`. */
  roles: string[];
}

/**
 * Persistence contract for User Records consumed by the account service. The
 * concrete implementation wraps Prisma; `upsertUserByEmail` reuses the existing
 * record for a known email (refreshing its name) or creates one, guaranteeing
 * at most one record per email (Req 6.4, 6.9).
 */
export interface AccountUserRepository {
  /** Create or reuse a User Record for the given email, setting the name (Req 6.4). */
  upsertUserByEmail(email: string, name: string): Promise<AccountUserRecord>;
}

/**
 * The dependency bundle the account service is constructed with. The concrete
 * Prisma-backed repository and the JWT token issuer are injected by
 * `createDefaultAccountService`, keeping the service logic testable in
 * isolation.
 */
export interface AccountServiceDeps {
  users: AccountUserRepository;
  /**
   * Issue a signed learner Access Token bound to the user id + email, carrying
   * the display name and the user's Roles so the Frontend Project can show them
   * after a reload and the Backend can elevate to role_admin (Req 6.5, 10.1).
   */
  issueLearnerToken(
    userId: string,
    email: string,
    name?: string,
    roles?: string[],
  ): string;
}

/**
 * The result of a successful name + email sign-in: the issued learner Access
 * Token, its lifetime in seconds (2592000 — Req 6.5), and the resolved
 * name/email.
 */
export interface AccountLoginResult {
  accessToken: string;
  expiresInSeconds: number;
  name: string;
  email: string;
  /** The Roles held by the signed-in User Record (from `User.roles`). */
  roles: string[];
}

/**
 * The public surface of the account service. `login` validates the name +
 * email, resolves/creates the learner identity, and issues an Access Token, or
 * throws a `ValidationError` (→ 422) when either field is invalid (Req 6.3).
 */
export interface AccountService {
  login(name: string, email: string): Promise<AccountLoginResult>;
}
