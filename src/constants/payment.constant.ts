// Payment-related constant values.
//
// Per the project conventions (Requirements 1.16, 1.17), all constant values
// live in a `*.constant.ts` file. This module centralizes the Price bounds, the
// default Currency, and the Payment Status values referenced across the
// payment services, validation, and repositories so they share a single source
// of truth.
//
// References:
//   - Req 11.13: A Paid Material Price amount is > 0 and <= 1000000, Currency INR.
//   - Req 11.14: No Price or a Price amount of 0 is treated as a Free Material.
//   - Req 11.15: An amount < 0, > 1000000, non-numeric, or a non-INR Currency is invalid.
//   - Req 12 (Payment Status): one of "created", "successful", or "failed".

/**
 * Minimum chargeable Price amount for a Paid Material. Amounts at or below the
 * free threshold (0) are treated as Free Materials (Req 11.14); a chargeable
 * Price must be strictly greater than 0 (Req 11.13).
 */
export const PRICE_MIN_AMOUNT = 1;

/** Maximum chargeable Price amount for a Paid Material (Req 11.13, 11.15). */
export const PRICE_MAX_AMOUNT = 1000000;

/**
 * The amount at or below which a Study Material carries no chargeable Price and
 * is treated as a Free Material (Req 11.14).
 */
export const FREE_PRICE_AMOUNT = 0;

/** The default (and only supported) Currency for Prices and Payments (Req 11.13). */
export const DEFAULT_CURRENCY = 'INR';

/** Payment Status values (Req 12 glossary: Payment Status). */
export const PAYMENT_STATUS_CREATED = 'created';
export const PAYMENT_STATUS_SUCCESSFUL = 'successful';
export const PAYMENT_STATUS_FAILED = 'failed';

/**
 * Grouped view of the supported Payment Status values for convenient,
 * type-safe access.
 */
export const PAYMENT_STATUS = {
  CREATED: PAYMENT_STATUS_CREATED,
  SUCCESSFUL: PAYMENT_STATUS_SUCCESSFUL,
  FAILED: PAYMENT_STATUS_FAILED,
} as const;

/** The full set of Payment Status identifiers the Backend API recognizes. */
export const PAYMENT_STATUS_VALUES = [
  PAYMENT_STATUS_CREATED,
  PAYMENT_STATUS_SUCCESSFUL,
  PAYMENT_STATUS_FAILED,
] as const;

/** Grouped view of the Price bounds for convenient, type-safe access. */
export const PRICE_BOUNDS = {
  min: PRICE_MIN_AMOUNT,
  max: PRICE_MAX_AMOUNT,
  free: FREE_PRICE_AMOUNT,
} as const;
