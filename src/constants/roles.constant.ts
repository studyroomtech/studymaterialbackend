// Role identifiers for Role-Based Access Control (RBAC).
//
// The Backend API supports exactly two Roles (Req 10.1):
//   - `role_common`: the default public Role for Learners (browse/search/view/
//     download without authentication).
//   - `role_admin`: the elevated Role permitted to perform Content Management
//     Actions.
//
// These string values are part of the JWT/authorization contract and MUST match
// exactly across middleware, services, and tokens.

export const ROLE_COMMON = 'role_common';
export const ROLE_ADMIN = 'role_admin';

// Grouped view of the supported Roles for convenient, type-safe access.
export const ROLES = {
  COMMON: ROLE_COMMON,
  ADMIN: ROLE_ADMIN,
} as const;

// The full set of Role identifiers the Backend API recognizes (Req 10.1).
export const ROLE_VALUES = [ROLE_COMMON, ROLE_ADMIN] as const;
