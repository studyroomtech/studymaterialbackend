// Types for the pure access-resolution service (Req 1.15: type declarations
// live only in `*.types.ts`).
//
// These describe the inputs to the pure entitlement-based access logic in
// `access.service.ts`, which decides whether a caller may start or resume an
// attempt of a Test or a specific Section (Req 8.1–8.4), with an unconditional
// admin short-circuit (Req 17.1, 17.3).
//
// Every input carries an `isAdmin` flag derived by the caller (the attempt /
// payment service) from `req.auth` — true iff the resolved User Record holds
// `role_admin`. The core itself performs no I/O, holds no state, and never
// touches a token or clock: it is pure membership logic over the ids the caller
// resolved, so the admin bypass and the "a Section Entitlement never grants a
// sibling Section" rule can be reasoned about in isolation.

/**
 * Input to `canAccessTest`: whether the caller may attempt the whole Test.
 * Access is granted when the caller is an admin, when the Test is free, or when
 * a Test Entitlement for `testId` is held.
 */
export interface TestAccessInput {
  /** Derived by the caller from `req.auth` (role_admin). Short-circuits access (Req 17.1). */
  isAdmin: boolean;
  /** Whether the Test has no/zero Price and is attemptable without an Entitlement (Req 8.3). */
  isFreeTest: boolean;
  /** The Test being accessed. */
  testId: string;
  /** The ids of Tests for which the Learner's User Record holds a Test Entitlement. */
  entitledTestIds: readonly string[];
}

/**
 * Input to `canAccessSection`: whether the caller may attempt one specific
 * Section. Access is granted when the caller is an admin, when the parent Test
 * is free, when a Test Entitlement for the parent Test is held, or when a
 * Section Entitlement for that exact Section is held. A Section Entitlement for
 * a different Section never grants access here (Req 8.2, 8.4).
 */
export interface SectionAccessInput {
  /** Derived by the caller from `req.auth` (role_admin). Short-circuits access (Req 17.1). */
  isAdmin: boolean;
  /** Whether the parent Test is free (grants every Section, Req 8.3). */
  isFreeTest: boolean;
  /** The parent Test of the Section being accessed. */
  testId: string;
  /** The exact Section being accessed. */
  sectionId: string;
  /** The ids of Tests for which a Test Entitlement is held. */
  entitledTestIds: readonly string[];
  /** The ids of Sections for which a Section Entitlement is held. */
  entitledSectionIds: readonly string[];
}

/**
 * Input to `accessibleSectionIds`: the Section ids of one Test the caller may
 * attempt. For an admin (or a free Test, or a held Test Entitlement) this is
 * every Section of the Test; otherwise it is the subset of Sections for which a
 * Section Entitlement is held.
 */
export interface TestScopeAccessInput {
  /** Derived by the caller from `req.auth` (role_admin). Short-circuits to every Section (Req 17.1). */
  isAdmin: boolean;
  /** Whether the Test is free (grants every Section, Req 8.3). */
  isFreeTest: boolean;
  /** The Test being scoped. */
  testId: string;
  /** Every Section id of the Test, in the Admin-defined order the caller resolved. */
  sectionIds: readonly string[];
  /** The ids of Tests for which a Test Entitlement is held. */
  entitledTestIds: readonly string[];
  /** The ids of Sections for which a Section Entitlement is held. */
  entitledSectionIds: readonly string[];
}
