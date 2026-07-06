// Types for the pure price classification/validation service (Req 1.15: all
// type/interface declarations live only in `*.types.ts`).
//
// These describe the inputs and outputs of the pure logic in
// `price.service.ts`, which decides whether a Study Material's Price makes it a
// Paid Material or a Free Material and validates an Admin-submitted Price
// (Req 11.13–11.15).

/**
 * The two possible classifications of a Study Material's Price.
 *
 * - `'paid'`: the Price carries a positive, in-bounds amount, so the Study
 *   Material is a Paid Material (Req 11.13).
 * - `'free'`: the Study Material has no Price or a Price amount of 0, so it is a
 *   Free Material served through the Download Gate flow (Req 11.14).
 */
export type PriceClassification = 'paid' | 'free';

/**
 * A validated, normalized Price as produced by `validatePrice`.
 *
 * When the input represents a Free Material, `amount` is `null` and `isPaid` is
 * `false`; when it represents a Paid Material, `amount` is the validated integer
 * in `[1, 1000000]` and `currency` is `"INR"` (Req 11.13, 11.14).
 */
export interface ValidatedPrice {
  /** Whether the Study Material is Paid or Free. */
  classification: PriceClassification;
  /** The chargeable amount for a Paid Material, or `null` for a Free Material. */
  amount: number | null;
  /** The Currency of the Price (always the default Currency, INR). */
  currency: string;
  /** Convenience flag mirroring `classification === 'paid'`. */
  isPaid: boolean;
}
