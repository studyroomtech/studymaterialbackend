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
 * id, the unique email it is keyed by (Req 6.4, 6.9), and the optional stored
 * Password Hash used to classify the account as Protected/Unprotected (Req 1.1,
 * 1.2). `null` => Unprotected Account; a non-empty value => Password-Protected
 * Account. The hash is internal only and is never surfaced in a response.
 */
export interface AccountUserRecord {
  id: string;
  email: string;
  /** The display name persisted on the User Record. */
  name: string;
  /** The Roles held by the User Record (from `User.roles`), e.g. `[role_common]`. */
  roles: string[];
  /** Stored Password Hash; `null` for an Unprotected Account (Req 1.1, 1.2). */
  passwordHash: string | null;
}

/**
 * Persistence contract for User Records consumed by the account service. The
 * concrete implementation wraps Prisma; `upsertUserByEmail` reuses the existing
 * record for a known email (refreshing its name) or creates one, guaranteeing
 * at most one record per email (Req 6.4, 6.9). `findUserByEmail` / `findUserById`
 * resolve a record so the service can read its protection state, and
 * `setUserPasswordHash` persists a derived Password Hash (Req 2.1).
 */
export interface AccountUserRepository {
  /** Create or reuse a User Record for the given email, setting the name (Req 6.4). */
  upsertUserByEmail(email: string, name: string): Promise<AccountUserRecord>;
  /** Resolve a User Record by its unique email, or `null` when none exists. */
  findUserByEmail(email: string): Promise<AccountUserRecord | null>;
  /** Resolve a User Record by its id, or `null` when none exists. */
  findUserById(id: string): Promise<AccountUserRecord | null>;
  /** Persist a derived Password Hash on a User Record (Req 2.1). */
  setUserPasswordHash(
    id: string,
    passwordHash: string,
  ): Promise<AccountUserRecord>;
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
  /**
   * Compute a salted, one-way Password Hash for a plaintext password (Req 6.1).
   * Never logs or returns plaintext.
   */
  hashPassword(plaintext: string): Promise<string>;
  /**
   * Verify a candidate plaintext against a stored encoded Password Hash in
   * constant time, returning `false` for a malformed hash rather than throwing
   * (Req 6.2, 6.3).
   */
  verifyPassword(plaintext: string, encodedHash: string): Promise<boolean>;
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
  /**
   * Protection status of the signed-in User Record, carried only on a
   * successful sign-in (Req 3.3, 7.4). `true` => Password-Protected Account;
   * `false` => Unprotected Account.
   */
  passwordProtected: boolean;
}

/**
 * Input to `setPassword`: the signed-in User Record id, the new plaintext
 * Password to store, and the current Password — required only when changing an
 * existing Password on a Password-Protected Account (Req 2.6).
 */
export interface SetPasswordInput {
  userId: string;
  newPassword: string;
  currentPassword?: string;
}

/**
 * The result of a successful `setPassword`: the account is a Password-Protected
 * Account afterwards.
 */
export interface SetPasswordResult {
  passwordProtected: true;
}

/**
 * The public surface of the account service. `login` validates the name +
 * email, resolves/creates the learner identity, optionally verifies a supplied
 * Password, and issues an Access Token; it throws a `ValidationError` (→ 422)
 * for a malformed name/email (Req 6.3) or an `AuthRequiredError` (→ 401) for an
 * authentication failure (Req 3, 4, 7). `setPassword` sets (first time) or
 * changes (with the current Password) the Password for the signed-in User
 * Record (Req 2).
 */
export interface AccountService {
  login(
    name: string,
    email: string,
    password?: string,
  ): Promise<AccountLoginResult>;
  setPassword(input: SetPasswordInput): Promise<SetPasswordResult>;
}
