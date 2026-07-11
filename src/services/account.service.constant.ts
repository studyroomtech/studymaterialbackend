// Constant values for the account service.
//
// Per the project conventions, all constant values live in a `*.constant.ts`
// file. This module defines the single, fixed message the Account Service
// attaches to every authentication failure at login.
//
// Enumeration/timing resistance (Req 4.4, 7.1–7.3) requires that every rejected
// sign-in — a non-existent email supplied a Password, an Unprotected Account
// supplied a Password, or a Password-Protected Account with a missing, empty,
// over-long, or incorrect Password — return a byte-for-byte identical
// `AUTH_REQUIRED` (401) body. Centralizing the message in one constant
// guarantees no branch can accidentally vary it and thereby leak whether the
// email exists or whether the account is protected.

/**
 * The single fixed message returned for every `AUTH_REQUIRED` (401) login
 * rejection, regardless of the underlying cause (Req 4.4, 7.1–7.3). It carries
 * no per-field details and reveals nothing about account existence or
 * protection state.
 */
export const AUTH_FAILED_MESSAGE = 'Authentication failed.';
