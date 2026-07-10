// Types for the Payment Record repository (Req 1.15: type declarations live
// only in `*.types.ts`).

import type { PaymentStatus } from '@prisma/client';

/**
 * The fields persisted when a Payment is initiated (Req 12.4). A new Payment
 * Record references the Learner's User Record and the Paid Material, records the
 * charged amount and Currency, and carries the unique Razorpay Order Identifier
 * returned by Razorpay. The `status` defaults to `created` via the schema, so it
 * is not part of the create input.
 */
export interface CreatePaymentInput {
  userId: string;
  studyMaterialIds: string[];
  amount: number;
  currency?: string;
  razorpayOrderId: string;
}

/**
 * The fields updated when a Payment transitions to `successful` or `failed`
 * (Req 12.6, 12.7). The `updatedAt` timestamp is maintained automatically by
 * the schema's `@updatedAt` mapping. On a successful verification the Razorpay
 * Payment Identifier is recorded; a failed transition leaves it unset.
 */
export interface UpdatePaymentStatusInput {
  status: PaymentStatus;
  razorpayPaymentId?: string;
}

/**
 * Selection criteria for Stale Payment Records (Req 2.1–2.4). Selects only
 * status `created` records whose `createdAt` is at or before the Grace Window
 * cutoff, ordered oldest-first, capped at `limit` (the Batch Size).
 */
export interface FindStalePaymentsInput {
  /** Cutoff instant (the Grace Window cutoff): include records created at or before this time. */
  olderThan: Date;
  /** Maximum number of records to return (the Batch Size). */
  limit: number;
}
