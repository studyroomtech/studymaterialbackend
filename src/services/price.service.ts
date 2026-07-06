// Pure price classification and validation logic for Study Material Prices
// (Req 11.13–11.15).
//
// This module contains only pure, side-effect-free functions. Given a raw
// amount (and Currency), it decides whether a Study Material is a Paid Material
// or a Free Material and validates an Admin-submitted Price. It performs no I/O
// and holds no state, so the rules can be reasoned about and property-tested in
// isolation from the HTTP/persistence layers.
//
// Rules:
//   - A positive amount in `[1, 1000000]` with Currency INR marks a Paid
//     Material and persists the Price (Req 11.13).
//   - No amount (null/undefined) or an amount of 0 marks a Free Material with no
//     chargeable Price (Req 11.14).
//   - An amount < 0, > 1000000, non-numeric/non-integer, or a non-INR Currency
//     is invalid and is rejected with a `ValidationError` (Req 11.15). Callers
//     leave existing metadata/Price unchanged on rejection.

import {
  DEFAULT_CURRENCY,
  FREE_PRICE_AMOUNT,
  PRICE_MAX_AMOUNT,
  PRICE_MIN_AMOUNT,
} from '../constants/payment.constant';
import { ValidationError } from '../utils/errors';
import type {
  PriceClassification,
  ValidatedPrice,
} from './price.service.types';

/**
 * Classify a Price amount as Paid or Free without validating its bounds.
 *
 * A strictly-positive numeric amount classifies as `'paid'`; a `null`,
 * `undefined`, or `0` amount classifies as `'free'` (Req 11.13, 11.14). This is
 * a pure classification helper — use `validatePrice` to also enforce the bounds
 * and Currency before persisting.
 */
export function classifyPrice(
  amount: number | null | undefined,
): PriceClassification {
  if (amount === null || amount === undefined) {
    return 'free';
  }
  if (typeof amount === 'number' && Number.isFinite(amount) && amount > FREE_PRICE_AMOUNT) {
    return 'paid';
  }
  return 'free';
}

/**
 * Whether a raw value is a finite integer (i.e. a well-formed amount). Rejects
 * `NaN`, `Infinity`, non-number types, and fractional numbers (Req 11.15).
 */
function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * Validate and normalize an Admin-submitted Price (Req 11.13–11.15).
 *
 * - `null`/`undefined`/`0` → Free Material: returns `{ classification: 'free',
 *   amount: null, currency: INR, isPaid: false }` (Req 11.14). The Currency is
 *   irrelevant for a Free Material and is normalized to the default.
 * - An integer in `[1, 1000000]` with Currency `"INR"` → Paid Material: returns
 *   the validated amount and Currency (Req 11.13). A missing Currency defaults
 *   to INR.
 * - An amount `< 0`, `> 1000000`, non-numeric/non-integer, or a non-INR
 *   Currency for a chargeable amount → throws `ValidationError` (Req 11.15).
 *
 * The amount is accepted as `unknown` so genuinely non-numeric inputs (for
 * example, a string that failed to parse) are rejected rather than silently
 * coerced.
 */
export function validatePrice(
  amount: unknown,
  currency?: string | null,
): ValidatedPrice {
  // No Price supplied → Free Material (Req 11.14).
  if (amount === null || amount === undefined) {
    return freePrice();
  }

  // Non-numeric or non-integer amounts are invalid (Req 11.15).
  if (!isInteger(amount)) {
    throw new ValidationError(
      'The Price amount must be a whole number.',
      [{ field: 'priceAmount', reason: 'The Price amount must be a whole number.' }],
    );
  }

  // An amount of 0 → Free Material regardless of Currency (Req 11.14).
  if (amount === FREE_PRICE_AMOUNT) {
    return freePrice();
  }

  // A negative or out-of-range amount is invalid (Req 11.15).
  if (amount < PRICE_MIN_AMOUNT || amount > PRICE_MAX_AMOUNT) {
    throw new ValidationError(
      `The Price amount must be between ${PRICE_MIN_AMOUNT} and ${PRICE_MAX_AMOUNT}.`,
      [
        {
          field: 'priceAmount',
          reason: `The Price amount must be between ${PRICE_MIN_AMOUNT} and ${PRICE_MAX_AMOUNT}.`,
        },
      ],
    );
  }

  // A chargeable amount requires the default Currency, INR (Req 11.13, 11.15).
  const normalizedCurrency =
    currency === null || currency === undefined ? DEFAULT_CURRENCY : currency;
  if (normalizedCurrency !== DEFAULT_CURRENCY) {
    throw new ValidationError(
      `The Price Currency must be ${DEFAULT_CURRENCY}.`,
      [{ field: 'currency', reason: `The Price Currency must be ${DEFAULT_CURRENCY}.` }],
    );
  }

  return {
    classification: 'paid',
    amount,
    currency: DEFAULT_CURRENCY,
    isPaid: true,
  };
}

/**
 * Build the canonical Free-Material result (Req 11.14).
 */
function freePrice(): ValidatedPrice {
  return {
    classification: 'free',
    amount: null,
    currency: DEFAULT_CURRENCY,
    isPaid: false,
  };
}
