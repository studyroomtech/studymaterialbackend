// Tests for the pure price classification/validation service (Req 11.13–11.15).
//
// Combines example-based unit tests (specific cases and edge cases) with
// fast-check property tests (universal rules across many inputs).

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  DEFAULT_CURRENCY,
  PRICE_MAX_AMOUNT,
  PRICE_MIN_AMOUNT,
} from '../constants/payment.constant';
import { ValidationError } from '../utils/errors';
import { classifyPrice, validatePrice } from './price.service';

describe('classifyPrice', () => {
  it('classifies a positive amount as paid (Req 11.13)', () => {
    expect(classifyPrice(1)).toBe('paid');
    expect(classifyPrice(500)).toBe('paid');
    expect(classifyPrice(PRICE_MAX_AMOUNT)).toBe('paid');
  });

  it('classifies null/undefined/0 as free (Req 11.14)', () => {
    expect(classifyPrice(null)).toBe('free');
    expect(classifyPrice(undefined)).toBe('free');
    expect(classifyPrice(0)).toBe('free');
  });

  it('classifies a negative amount as free (no positive charge)', () => {
    expect(classifyPrice(-1)).toBe('free');
  });

  it('classifies non-finite numbers as free', () => {
    expect(classifyPrice(Number.NaN)).toBe('free');
    expect(classifyPrice(Number.POSITIVE_INFINITY)).toBe('free');
  });
});

describe('validatePrice — Free Materials (Req 11.14)', () => {
  it('treats a missing amount as free', () => {
    expect(validatePrice(null)).toEqual({
      classification: 'free',
      amount: null,
      currency: DEFAULT_CURRENCY,
      isPaid: false,
    });
    expect(validatePrice(undefined)).toEqual({
      classification: 'free',
      amount: null,
      currency: DEFAULT_CURRENCY,
      isPaid: false,
    });
  });

  it('treats an amount of 0 as free regardless of currency', () => {
    expect(validatePrice(0)).toEqual({
      classification: 'free',
      amount: null,
      currency: DEFAULT_CURRENCY,
      isPaid: false,
    });
    expect(validatePrice(0, 'USD')).toEqual({
      classification: 'free',
      amount: null,
      currency: DEFAULT_CURRENCY,
      isPaid: false,
    });
  });
});

describe('validatePrice — Paid Materials (Req 11.13)', () => {
  it('accepts an in-bounds integer amount with INR currency', () => {
    expect(validatePrice(1, 'INR')).toEqual({
      classification: 'paid',
      amount: 1,
      currency: 'INR',
      isPaid: true,
    });
    expect(validatePrice(PRICE_MAX_AMOUNT, 'INR')).toEqual({
      classification: 'paid',
      amount: PRICE_MAX_AMOUNT,
      currency: 'INR',
      isPaid: true,
    });
  });

  it('defaults a missing currency to INR for a chargeable amount', () => {
    expect(validatePrice(250)).toEqual({
      classification: 'paid',
      amount: 250,
      currency: 'INR',
      isPaid: true,
    });
  });
});

describe('validatePrice — invalid Prices (Req 11.15)', () => {
  it('rejects a negative amount', () => {
    expect(() => validatePrice(-1, 'INR')).toThrow(ValidationError);
  });

  it('rejects an amount above the maximum', () => {
    expect(() => validatePrice(PRICE_MAX_AMOUNT + 1, 'INR')).toThrow(
      ValidationError,
    );
  });

  it('rejects a non-integer amount', () => {
    expect(() => validatePrice(10.5, 'INR')).toThrow(ValidationError);
  });

  it('rejects a non-numeric amount', () => {
    // Genuinely non-numeric input (e.g. a value that failed to parse).
    expect(() => validatePrice('100' as unknown, 'INR')).toThrow(ValidationError);
    expect(() => validatePrice(Number.NaN, 'INR')).toThrow(ValidationError);
  });

  it('rejects a non-INR currency for a chargeable amount', () => {
    expect(() => validatePrice(100, 'USD')).toThrow(ValidationError);
    expect(() => validatePrice(100, 'inr')).toThrow(ValidationError);
  });
});

describe('validatePrice — properties (Req 11.13–11.15)', () => {
  // Validates: Requirements 11.13
  it('accepts every in-bounds integer amount with INR as a Paid Material', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: PRICE_MIN_AMOUNT, max: PRICE_MAX_AMOUNT }),
        (amount) => {
          const result = validatePrice(amount, DEFAULT_CURRENCY);
          expect(result).toEqual({
            classification: 'paid',
            amount,
            currency: DEFAULT_CURRENCY,
            isPaid: true,
          });
        },
      ),
    );
  });

  // Validates: Requirements 11.15
  it('rejects every integer amount above the maximum', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: PRICE_MAX_AMOUNT + 1 }),
        (amount) => {
          expect(() => validatePrice(amount, DEFAULT_CURRENCY)).toThrow(
            ValidationError,
          );
        },
      ),
    );
  });

  // Validates: Requirements 11.15
  it('rejects every negative integer amount', () => {
    fc.assert(
      fc.property(fc.integer({ max: -1 }), (amount) => {
        expect(() => validatePrice(amount, DEFAULT_CURRENCY)).toThrow(
          ValidationError,
        );
      }),
    );
  });

  // Validates: Requirements 11.15
  it('rejects any chargeable amount with a non-INR currency', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: PRICE_MIN_AMOUNT, max: PRICE_MAX_AMOUNT }),
        fc.string().filter((c) => c !== DEFAULT_CURRENCY),
        (amount, currency) => {
          expect(() => validatePrice(amount, currency)).toThrow(ValidationError);
        },
      ),
    );
  });

  // Validates: Requirements 11.13, 11.14
  it('classifyPrice agrees with a successful validatePrice classification', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: PRICE_MAX_AMOUNT }),
        (amount) => {
          const validated = validatePrice(amount, DEFAULT_CURRENCY);
          expect(validated.classification).toBe(classifyPrice(amount));
        },
      ),
    );
  });
});
