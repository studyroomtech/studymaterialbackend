// Pure entitlement-based access resolution for Tests and Sections (Req 8), with
// an unconditional admin short-circuit (Req 17.1, 17.3).
//
// This module contains only pure, side-effect-free functions: given the caller's
// admin flag, the free-Test flag, and the ids of the Test/Section Entitlements
// the Learner's User Record holds, it decides whether an attempt may be started
// or resumed. It performs no I/O and holds no state, mirroring
// `entitlement.service.ts`, so the access rule (and the admin bypass) can be
// reasoned about and tested in isolation from the HTTP/persistence layers.
//
// The admin flag is evaluated FIRST in every function. When it is true, access
// is granted unconditionally, before any free-Test or Entitlement check is
// reached — so no payment gate (`PAYMENT_REQUIRED`/`ALREADY_ENTITLED`) is ever
// evaluated for an admin (Req 17.1, 17.3). A Test Entitlement grants every
// Section of its Test; a Section Entitlement grants only its exact Section and
// never a sibling (Req 8.1, 8.2, 8.4).

import type {
  SectionAccessInput,
  TestAccessInput,
  TestScopeAccessInput,
} from './access.service.types';

/**
 * Whether the caller may start or resume an attempt covering the whole Test.
 * True iff the caller is an admin (Req 17.1), OR the Test is free (Req 8.3), OR
 * a Test Entitlement for `testId` is held (Req 8.1). The admin flag
 * short-circuits before the free/entitlement check is evaluated (Req 17.3).
 */
export function canAccessTest(input: TestAccessInput): boolean {
  if (input.isAdmin) return true;
  if (input.isFreeTest) return true;
  return input.entitledTestIds.includes(input.testId);
}

/**
 * Whether the caller may start or resume an attempt scoped to one specific
 * Section. True iff the caller is an admin (Req 17.1), OR the parent Test is
 * free (Req 8.3), OR a Test Entitlement for the parent Test is held (Req 8.1),
 * OR a Section Entitlement for that exact Section is held (Req 8.2). A Section
 * Entitlement for a sibling Section never grants access, because only the exact
 * `sectionId` is looked up in `entitledSectionIds` (Req 8.4).
 */
export function canAccessSection(input: SectionAccessInput): boolean {
  if (input.isAdmin) return true;
  if (input.isFreeTest) return true;
  if (input.entitledTestIds.includes(input.testId)) return true;
  return input.entitledSectionIds.includes(input.sectionId);
}

/**
 * The set of Section ids of a Test the caller may attempt. For an admin, a free
 * Test, or a held Test Entitlement this is every Section of the Test (Req 8.1,
 * 8.3, 17.1); otherwise it is exactly those Sections for which a Section
 * Entitlement is held, never a sibling (Req 8.2, 8.4). Section order is
 * preserved from the caller-supplied `sectionIds`.
 */
export function accessibleSectionIds(input: TestScopeAccessInput): string[] {
  if (input.isAdmin || input.isFreeTest || input.entitledTestIds.includes(input.testId)) {
    return [...input.sectionIds];
  }
  const held = new Set(input.entitledSectionIds);
  return input.sectionIds.filter((sectionId) => held.has(sectionId));
}
